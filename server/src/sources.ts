// Import, validation (spec §6.2, §7.3) and bounded reads (§8.2) of a review's sources. CSV and the Markdown policy
// document are read here; XLSX, DOCX and PDF files through their documented layouts (formats.ts), into the same rows.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { parseCsv } from './csv.ts'
import { abs, dec, div, fmt, isDec, sum } from './decimal.ts'
import { EXTRACTOR, importDocument, type Provenance } from './formats.ts'

// A CSV row keyed by column name, plus its row_id (`<source>:<n>`).
export type Row = Record<string, string>
// One numbered section of the policy document; its id is the heading's leading number. location is where it starts.
export type Section = { id: string; heading: string; text: string; location?: string }
// One source as imported: its rows (or sections, for the policy document) and its validation issues. A file in a
// documented layout may hold several sources (a workbook with a sheet for each). format is the file's; extractor
// the layout version that read it; labels each field's original header; provenance each row's original location.
export type Source = {
  id: string
  file: string
  sha256: string
  description: string
  fields: Record<string, string>
  rows: Row[]
  sections?: Section[]
  issues: string[]
  format: 'csv' | 'md' | 'xlsx' | 'docx' | 'pdf' | 'unsupported'
  extractor?: string
  labels?: Record<string, string>
  provenance?: Record<string, Provenance>
}
export type Review = { id: string; periodEnd: string; periods: string[]; sources: Source[] }

// The CSV kinds IGI recognises, keyed by source id. A CSV is recognised by its exact header (these field names,
// in this order). `key` lists the columns that must be unique together, `optional` the ones that may be blank,
// and `fields` describes each column for the agent (list_sources shows them).
type Kind = { description: string; key: string[]; optional?: string[]; fields: Record<string, string> }
const FRACTION = 'decimal string, fraction of 1 (0.1234 = 12.34%)'
const KINDS: Record<string, Kind> = {
  portfolios: {
    description: 'Model portfolios with objective and benchmark.',
    key: ['portfolio_id'],
    fields: { portfolio_id: 'Portfolio identifier', portfolio_name: 'Name', objective: 'Investment objective', benchmark: 'Benchmark description' },
  },
  positions: {
    description: 'Holdings of each portfolio at each period end.',
    key: ['portfolio_id', 'period_end', 'instrument_id'],
    fields: {
      portfolio_id: 'Portfolio identifier',
      period_end: 'Valuation date (ISO date)',
      instrument_id: 'Fund identifier',
      instrument_name: 'Fund name',
      fund_type: "Fund's own classification",
      market_value_gbp: 'Market value in GBP at the period end, decimal string',
      reported_weight: `Weight in the portfolio as reported, ${FRACTION}`,
    },
  },
  lookthrough: {
    description: "Underlying asset-class exposures of each fund (look-through data), by date.",
    key: ['instrument_id', 'as_of', 'asset_class'],
    fields: { instrument_id: 'Fund identifier', as_of: 'Date of the look-through data (ISO date)', asset_class: 'Asset class', exposure_weight: `Fund's exposure to the asset class, ${FRACTION}` },
  },
  performance: {
    description: 'Returns of each portfolio and its benchmark for each period.',
    key: ['portfolio_id', 'period_end'],
    fields: { portfolio_id: 'Portfolio identifier', period_end: 'Period end (ISO date)', portfolio_return: `Portfolio return for the period ending period_end, ${FRACTION}`, benchmark_return: `Benchmark return for the period ending period_end, ${FRACTION}` },
  },
  fees: {
    description: 'Ongoing charges of each fund by period.',
    key: ['instrument_id', 'period_end'],
    fields: { instrument_id: 'Fund identifier', period_end: 'Period end (ISO date)', ongoing_charge: `Annual ongoing charge, ${FRACTION}` },
  },
  committee_actions: {
    description: "Actions recorded at the previous Investment Committee meeting, with current status.",
    key: ['action_id'],
    optional: ['due_date', 'notes'],
    fields: { action_id: 'Action identifier', meeting_date: 'Meeting date (ISO date)', action: 'Action text', owner: 'Owner', due_date: 'Due date (ISO date), blank if standing', status: 'Status as recorded', notes: 'Notes' },
  },
  policy_rules: {
    description: 'Structured policy rules: the authoritative limits, with effective dates and versions.',
    key: ['rule_id', 'version'],
    optional: ['effective_to'],
    fields: {
      rule_id: 'Rule identifier (stable across versions)',
      version: 'Rule version',
      portfolio_id: 'Portfolio the rule applies to, or ALL',
      metric: 'Measured quantity',
      limit_type: 'max or min',
      threshold: `Limit, ${FRACTION}`,
      basis: 'Measurement basis',
      effective_from: 'First date the version applies (ISO date)',
      effective_to: 'Last date the version applies (ISO date), blank if open',
      methodology: 'How the metric is calculated',
      document_clause: 'Clause of the policy document stating the rule',
    },
  },
}
// Columns validated by type: decimal strings (all but market values must be fractions of 1), ISO dates, and
// instrument ids shaped like an ISIN (two letters, nine letters or digits, a digit; the check digit isn't verified).
const DECIMALS = ['market_value_gbp', 'reported_weight', 'exposure_weight', 'portfolio_return', 'benchmark_return', 'ongoing_charge', 'threshold']
const FRACTIONS = DECIMALS.filter((f) => f !== 'market_value_gbp')
const DATES = ['period_end', 'as_of', 'effective_from', 'effective_to', 'meeting_date', 'due_date']
const INSTRUMENT_ID = /^[A-Z]{2}[A-Z0-9]{9}\d$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Reads every file in a review's source folder and returns the review: each CSV recognised by its header, the
 * Markdown policy document split into sections, and every file's SHA-256. The period end is the review's own
 * (§6.1) when given, otherwise the latest position date; the review's periods are the position dates up to it.
 * Positions missing at the period end, or dated after it, are validation issues. Issues are attached to each
 * source, never fixed.
 */
export function importReview(dir: string, id: string, periodEnd?: string): Review {
  const sources: Source[] = []
  // Adds a source of a known kind, unless an earlier file already provides that kind: then the later one is kept
  // with an issue and no rows, so nothing reads two versions of the same data.
  const add = (s: Source) => {
    const first = sources.find((x) => x.id === s.id)
    if (first) sources.push({ ...s, id: `${s.file}#${s.id}`, rows: [], sections: undefined, provenance: undefined, issues: [`also provides ${s.id}, which ${first.file} already does; it is not used`] })
    else sources.push(s)
  }
  for (const file of readdirSync(dir).sort()) {
    const bytes = readFileSync(join(dir, file))
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const ext = extname(file).toLowerCase()
    const text = bytes.toString('utf8')
    const policy = (title: string, sections: Section[], format: Source['format']) =>
      add({ id: 'policy_document', file, sha256, description: `Policy document: ${title}. Human-readable; the structured rules are authoritative for limits.`, fields: {}, rows: [], sections, issues: [], format, ...(format === 'pdf' ? { extractor: EXTRACTOR } : {}) })
    // The Markdown policy document: each `## ` heading starts a section, whose id is its leading number (`## 3. Limits` is 3).
    if (ext === '.md') {
      const lines = text.split('\n')
      const sections = text.split(/^## /m).slice(1).map((s) => {
        const [heading, ...body] = s.split('\n')
        return { id: heading.split('.')[0].trim(), heading: heading.trim(), text: body.join('\n').trim(), location: `line ${lines.findIndex((l) => l === `## ${heading}`) + 1}` }
      })
      policy(/^# (.+)$/m.exec(text)?.[1] ?? file, sections, 'md')
      continue
    }
    // An XLSX, DOCX or PDF file: each table it holds in a documented layout becomes a source, in the CSV kind's
    // fields; a policy PDF becomes the policy document. A file that can't be read is kept with the reason.
    if (ext === '.xlsx' || ext === '.docx' || ext === '.pdf') {
      const format = ext.slice(1) as Source['format']
      let doc
      try {
        doc = importDocument(file, new Uint8Array(bytes), sha256)
      } catch (e) {
        sources.push({ id: file, file, sha256, description: 'Unreadable source', fields: {}, rows: [], issues: [(e as Error).message], format })
        continue
      }
      if (doc.policy) policy(doc.policy.title, doc.policy.sections, format)
      for (const t of doc.tables) {
        const k = KINDS[t.kind]
        const rows = t.rows.map((r, i) => ({ row_id: `${t.kind}:${i + 1}`, ...Object.fromEntries(Object.keys(k.fields).map((f) => [f, r[f] ?? ''])) }))
        add({ id: t.kind, file, sha256, description: k.description, fields: k.fields, rows, issues: t.issues, format, extractor: EXTRACTOR, labels: t.labels, provenance: Object.fromEntries(rows.map((r, i) => [r.row_id, t.provenance[i]])) })
      }
      if (!doc.policy && !doc.tables.length) sources.push({ id: file, file, sha256, description: 'Unrecognised source', fields: {}, rows: [], issues: doc.issues, format })
      continue
    }
    if (ext !== '.csv') {
      sources.push({ id: file, file, sha256, description: 'Unsupported source', fields: {}, rows: [], issues: [`${ext || 'files without an extension'} is not a supported format; use CSV, XLSX, DOCX, a text-based PDF or the Markdown policy document`], format: 'unsupported' })
      continue
    }
    // A CSV's kind is the one whose fields match its header exactly; anything else is kept with an issue.
    const [header, ...data] = parseCsv(text)
    const kind = Object.entries(KINDS).find(([, k]) => Object.keys(k.fields).join() === header.join())
    if (!kind) {
      sources.push({ id: file, file, sha256, description: 'Unrecognised source', fields: {}, rows: [], issues: [`unrecognised columns: ${header.join(', ')}`], format: 'csv' })
      continue
    }
    const [kid, k] = kind
    // Each row gets the id findings cite: `<source>:<n>`, counting data rows from 1 (the header isn't counted), and
    // its line in the file (the header is line 1; a quoted value spanning lines would shift later ones).
    const rows = data.map((r, i) => ({ row_id: `${kid}:${i + 1}`, ...Object.fromEntries(header.map((h, j) => [h, (r[j] ?? '').trim()])) }))
    add({ id: kid, file, sha256, description: k.description, fields: k.fields, rows, issues: [], format: 'csv', provenance: Object.fromEntries(rows.map((r, i) => [r.row_id, { location: `line ${i + 2}` }])) })
  }
  const dates = [...new Set(table(sources, 'positions').map((r) => r.period_end))].sort()
  const end = periodEnd ?? dates.at(-1) ?? ''
  const review: Review = { id, periodEnd: end, periods: dates.filter((d) => d <= end), sources }
  if (periodEnd && dates.length && !dates.includes(periodEnd)) sources.find((s) => s.id === 'positions')?.issues.push(`no positions at the review's period end ${periodEnd}; the positions are dated ${dates.join(', ')}`)
  validate(review)
  return review
}

/** Why a review can't be investigated: its sources hold no positions at its period end. Undefined when they do. */
export const periodProblem = (r: Review) => (r.periods.includes(r.periodEnd) ? undefined : `the sources hold no positions at the review's period end ${r.periodEnd}; upload the sources for that period`)

/** The rows of one source by id, or none when the review lacks it. */
function table(sources: Source[], id: string): Row[] {
  return sources.find((s) => s.id === id)?.rows ?? []
}

// Establishes whether the data is safe to analyse (§7.3). Never repairs anything.
function validate(review: Review) {
  const get = (id: string) => table(review.sources, id)
  const portfolios = new Set(get('portfolios').map((r) => r.portfolio_id))
  // Row checks, source by source: required fields present, keys unique, ids and dates well formed, decimals parse,
  // fractions within -1..1 (a value like 25 suggests a percentage), and no position dated after the period end.
  for (const s of review.sources) {
    const k = KINDS[s.id]
    if (!k) continue
    const issue = (r: Row, msg: string) => s.issues.push(`${r.row_id}: ${msg}`)
    const seen = new Set<string>()
    for (const r of s.rows) {
      for (const f of Object.keys(k.fields)) if (!r[f] && !k.optional?.includes(f)) issue(r, `missing ${f}`)
      const key = k.key.map((f) => r[f]).join('|')
      if (seen.has(key)) issue(r, `duplicate of an earlier row (${k.key.join(', ')} = ${key})`)
      seen.add(key)
      if (r.instrument_id && !INSTRUMENT_ID.test(r.instrument_id)) issue(r, `invalid instrument_id ${r.instrument_id}`)
      if (r.portfolio_id && s.id !== 'portfolios' && !portfolios.has(r.portfolio_id) && !(s.id === 'policy_rules' && r.portfolio_id === 'ALL')) issue(r, `unknown portfolio_id ${r.portfolio_id}`)
      for (const f of DATES) if (r[f] && !ISO_DATE.test(r[f])) issue(r, `${f} is not an ISO date: ${r[f]}`)
      for (const f of DECIMALS) {
        if (!(f in r) || !r[f]) continue
        if (!isDec(r[f])) issue(r, `${f} is not a decimal number: ${r[f]}`)
        else if (FRACTIONS.includes(f) && abs(dec(r[f])) > dec('1')) issue(r, `${f} ${r[f]} is outside -1..1; possibly a percentage rather than a fraction`)
        else if (f === 'market_value_gbp' && dec(r[f]) < 0n) issue(r, `negative market value ${r[f]}`)
      }
      if (s.id === 'positions' && r.period_end > review.periodEnd) issue(r, `period_end ${r.period_end} is after the review's period end ${review.periodEnd}`)
    }
  }

  // Cross-source checks for each portfolio and period: positions exist; reported weights sum to 1 (within 0.001)
  // and match each holding's share of market value (within 0.0005); every fund held has look-through exposures
  // summing to 1; and a performance row exists.
  const positions = review.sources.find((s) => s.id === 'positions')
  const lookthrough = get('lookthrough')
  for (const period of review.periods)
    for (const p of portfolios) {
      const rows = get('positions').filter((r) => r.portfolio_id === p && r.period_end === period && isDec(r.market_value_gbp) && isDec(r.reported_weight))
      if (!rows.length) {
        positions?.issues.push(`no positions for ${p} at ${period}`)
        continue
      }
      const total = sum(rows.map((r) => dec(r.market_value_gbp)))
      const weightSum = sum(rows.map((r) => dec(r.reported_weight)))
      if (abs(weightSum - dec('1')) > dec('0.0010')) positions?.issues.push(`${p} ${period}: reported weights sum to ${fmt(weightSum, 4)}, not 1`)
      for (const r of rows) {
        const computed = div(dec(r.market_value_gbp), total)
        if (abs(computed - dec(r.reported_weight)) > dec('0.0005')) positions?.issues.push(`${r.row_id}: reported_weight ${r.reported_weight} differs from market value share ${fmt(computed, 4)}`)
        const lt = lookthrough.filter((x) => x.instrument_id === r.instrument_id && x.as_of === period && isDec(x.exposure_weight))
        if (!lt.length) positions?.issues.push(`${r.row_id}: no look-through data for ${r.instrument_id} at ${period}`)
        else if (abs(sum(lt.map((x) => dec(x.exposure_weight))) - dec('1')) > dec('0.0010')) positions?.issues.push(`${r.row_id}: look-through exposures for ${r.instrument_id} at ${period} do not sum to 1`)
      }
      const performance = review.sources.find((s) => s.id === 'performance')
      if (performance && !performance.rows.some((r) => r.portfolio_id === p && r.period_end === period)) performance.issues.push(`no performance for ${p} at ${period}`)
    }
  // Every portfolio needs at least one policy rule in force at the period end, its own or one for ALL.
  const rules = review.sources.find((s) => s.id === 'policy_rules')
  for (const p of portfolios) {
    const applicable = (rules?.rows ?? []).filter((r) => (r.portfolio_id === p || r.portfolio_id === 'ALL') && r.effective_from <= review.periodEnd && (!r.effective_to || r.effective_to >= review.periodEnd))
    if (!applicable.length) rules?.issues.push(`no policy rule applies to ${p} at ${review.periodEnd}`)
  }
  // An exposure rule's metric names an asset class (`<class>_exposure`), and the look-through data must use the same
  // label for the rule to be measured. A class the data doesn't name at a period the rule is in force is reported,
  // not matched to a similar label (Equity for equity), since the exposure can't be told from nil.
  for (const period of review.periods) {
    const classes = [...new Set(lookthrough.filter((x) => x.as_of === period).map((x) => x.asset_class))].sort()
    if (!classes.length) continue
    for (const r of rules?.rows ?? []) {
      const cls = /^(.+)_exposure$/.exec(r.metric)?.[1]
      if (cls && r.effective_from <= period && (!r.effective_to || r.effective_to >= period) && !classes.includes(cls)) rules!.issues.push(`${r.row_id}: ${r.metric} names asset class ${cls}, which no look-through row at ${period} has (classes: ${classes.join(', ')})`)
    }
  }
}

// ---- Bounded reads, shared by the read_data tool and the sandbox's read_data host function ----

// At most READ_LIMIT rows and about READ_BYTES of JSON per read, so one call can't flood the model's context.
export const READ_LIMIT = 200
const READ_BYTES = 60_000
const OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'contains'] as const
export type Filter = { column: string; op: (typeof OPS)[number]; value: string | string[] }
export type ReadArgs = { source: string; columns?: string[]; filters?: Filter[]; sort?: { column: string; descending?: boolean }[]; limit?: number }

/** Orders two cell values: as numbers when both are decimals, otherwise as text (ISO dates sort correctly as text). */
function compare(a: string, b: string): number {
  if (isDec(a) && isDec(b)) {
    const d = dec(a) - dec(b)
    return d < 0n ? -1 : d > 0n ? 1 : 0
  }
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * One bounded read of a tabular source: filters, then sorts, then returns up to `limit` rows (default 50, at most
 * READ_LIMIT), stopping early at READ_BYTES. It says how many rows matched and whether it truncated, so the agent
 * knows to narrow its query. Throws Error with a message meant for the agent when the request is invalid.
 */
export function readData(review: Review, args: ReadArgs) {
  const s = review.sources.find((x) => x.id === args.source)
  if (!s || !s.rows.length) throw new Error(`unknown tabular source "${args.source}"; available: ${review.sources.filter((x) => x.rows.length).map((x) => x.id).join(', ')}`)
  const known = ['row_id', ...Object.keys(s.fields)]
  const bad = [...(args.columns ?? []), ...(args.filters ?? []).map((f) => f.column), ...(args.sort ?? []).map((x) => x.column)].filter((c) => !known.includes(c))
  if (bad.length) throw new Error(`unknown column(s) ${bad.join(', ')} in ${s.id}; columns: ${known.join(', ')}`)
  for (const f of args.filters ?? []) if (!OPS.includes(f.op)) throw new Error(`unknown filter op "${f.op}"; use one of ${OPS.join(', ')}`)
  const limit = Math.min(Math.max(1, Math.floor(args.limit ?? 50)), READ_LIMIT)

  // Every filter must hold. `in` takes a list, `contains` is a case-insensitive substring match, and the
  // comparisons go through compare(), so numbers compare as numbers.
  let rows = s.rows.filter((r) =>
    (args.filters ?? []).every((f) => {
      const v = r[f.column] ?? ''
      const want = f.value
      if (f.op === 'in') return (Array.isArray(want) ? want : [want]).map(String).includes(v)
      const w = String(Array.isArray(want) ? want[0] : want)
      if (f.op === 'contains') return v.toLowerCase().includes(w.toLowerCase())
      const c = compare(v, w)
      return { eq: c === 0, ne: c !== 0, lt: c < 0, lte: c <= 0, gt: c > 0, gte: c >= 0 }[f.op]
    }),
  )
  // Several sort keys: sorting by the last key first, then each earlier one, works because Array.sort is stable.
  for (const o of [...(args.sort ?? [])].reverse()) rows = [...rows].sort((a, b) => compare(a[o.column] ?? '', b[o.column] ?? '') * (o.descending ? -1 : 1))
  // row_id always comes first, so the agent can cite what it read.
  const cols = args.columns?.length ? ['row_id', ...args.columns.filter((c) => c !== 'row_id')] : known
  // Stop before the row that would take the JSON past READ_BYTES.
  const out: Row[] = []
  let bytes = 0
  for (const r of rows.slice(0, limit)) {
    const picked = Object.fromEntries(cols.map((c) => [c, r[c]]))
    bytes += JSON.stringify(picked).length
    if (bytes > READ_BYTES) break
    out.push(picked)
  }
  return { source: s.id, matching: rows.length, returned: out.length, truncated: out.length < rows.length, rows: out }
}

/** Whether a cited row id (`<source>:<n>`) names a real row; propose_finding rejects citations that don't. */
export function rowExists(review: Review, rowId: string): boolean {
  const [source] = rowId.split(':')
  return !!review.sources.find((s) => s.id === source)?.rows.some((r) => r.row_id === rowId)
}

/**
 * Policy document sections and structured rules, optionally for one portfolio and date (the get_policy tool).
 * A section matches by its number or by part of its heading; rules for ALL portfolios are always included, and a
 * date keeps only the rule versions in force on it.
 */
export function getPolicy(review: Review, args: { section?: string; portfolio_id?: string; as_of?: string }) {
  const doc = review.sources.find((s) => s.id === 'policy_document')
  const sections = (doc?.sections ?? []).filter((s) => !args.section || s.id === args.section || s.heading.toLowerCase().includes(args.section.toLowerCase()))
  if (args.section && !sections.length) throw new Error(`no section "${args.section}"; sections: ${doc?.sections?.map((s) => s.heading).join(' | ')}`)
  const rules = table(review.sources, 'policy_rules').filter(
    (r) =>
      (!args.portfolio_id || r.portfolio_id === args.portfolio_id || r.portfolio_id === 'ALL') &&
      (!args.as_of || (r.effective_from <= args.as_of && (!r.effective_to || r.effective_to >= args.as_of))),
  )
  return { document: { file: doc?.file, sections }, rules }
}

/** What list_sources returns for each source: file, hash, description, size, sections or columns, and issues. */
export function sourceSummary(review: Review) {
  return review.sources.map((s) => ({
    source: s.id,
    file: s.file,
    sha256: s.sha256,
    description: s.description,
    rows: s.rows.length || undefined,
    sections: s.sections?.map((x) => x.heading),
    fields: s.rows.length ? s.fields : undefined,
    validation_issues: s.issues,
  }))
}
