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
// unused says why none of the file's content is used: unreadable, unrecognised, unsupported, or a second source of
// a kind another file already provides, which is also a conflict and blocks an investigation (§6.2).
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
  unused?: string
  conflict?: boolean
}
export type Review = { id: string; periodEnd: string; periods: string[]; sources: Source[] }

// The asset classes IGI measures look-through exposure in: the domain taxonomy (spec §7.5). A label matches a class
// when it is the same word ignoring case and extra spaces; nothing else is mapped, so "Equities" or "Stocks" is not
// equity but an unrecognised label.
export const ASSET_CLASSES = ['equity', 'bonds', 'cash', 'property', 'alternatives'] as const
/** The taxonomy class a label names, ignoring case and extra spaces; undefined when it names none. */
export function assetClass(label: string): string | undefined {
  const c = label.trim().replace(/\s+/g, ' ').toLowerCase()
  return (ASSET_CLASSES as readonly string[]).includes(c) ? c : undefined
}

/**
 * The trusted check that measures a rule metric, with the asset class for an exposure, or undefined when no check
 * does (§8.2): such a rule is reported as unsupported, never as met. Metrics are compared in their canonical form.
 */
export function metricCheck(metric: string): { check: string; asset_class?: string } | undefined {
  if (metric === 'single_holding_weight') return { check: 'holding_concentration' }
  if (metric === 'relative_return_deviation') return { check: 'relative_performance' }
  const cls = /^(.+)_exposure$/.exec(metric)?.[1]
  return cls && assetClass(cls) === cls ? { check: 'lookthrough_exposure', asset_class: cls } : undefined
}

/**
 * Whether a rule version is in force on a date. A rule whose effective dates aren't ISO dates may be in force, so
 * it counts as in force and stays to be accounted for; ruleProblem says it can't be evaluated.
 */
export const inForce = (r: Row, date: string) =>
  !ISO_DATE.test(r.effective_from) || (!!r.effective_to && !ISO_DATE.test(r.effective_to)) || (r.effective_from <= date && (!r.effective_to || r.effective_to >= date))

/** Why a rule version can't be compared with a value, or undefined when it can: its limit, limit type and dates must be valid. */
export function ruleProblem(r: Row): string | undefined {
  if (!isDec(r.threshold)) return `its threshold "${r.threshold}" is not a decimal`
  if (r.limit_type !== 'max' && r.limit_type !== 'min') return `its limit_type "${r.limit_type}" is neither max nor min`
  if (!ISO_DATE.test(r.effective_from) || (r.effective_to && !ISO_DATE.test(r.effective_to))) return 'its effective dates are not ISO dates, so when it applies is unknown'
  return undefined
}

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
    fields: { instrument_id: 'Fund identifier', as_of: 'Date of the look-through data (ISO date)', asset_class: `Asset class: one of ${ASSET_CLASSES.join(', ')}`, exposure_weight: `Fund's exposure to the asset class, ${FRACTION}` },
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
      metric: 'Measured quantity; get_policy says which trusted check measures it, if any',
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
  // Adds a source of a known kind, unless an earlier file (or an earlier table of the same file) already provides
  // that kind: then the later one is kept with an issue and no rows, and marked as a conflict, which blocks an
  // investigation (blockers), so no analysis runs on one of two sources while the other is silently left out.
  const add = (s: Source) => {
    const first = sources.find((x) => x.id === s.id)
    const why = `also provides ${s.id}, which ${first?.file === s.file ? 'an earlier table of the same file' : first?.file} already does`
    if (first) sources.push({ ...s, id: `${s.file}#${s.id}`, rows: [], sections: undefined, provenance: undefined, issues: [`${why}; one source of each kind is read, so remove one file or combine them into one`], unused: why, conflict: true })
    else sources.push(s)
  }
  for (const file of readdirSync(dir).sort()) {
    const bytes = readFileSync(join(dir, file))
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const ext = extname(file).toLowerCase()
    // A UTF-8 byte order mark (as Excel writes before a CSV) is not part of the text; the hash is of the bytes as uploaded.
    const text = bytes.toString('utf8').replace(/^﻿/, '')
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
        sources.push({ id: file, file, sha256, description: 'Unreadable source', fields: {}, rows: [], issues: [(e as Error).message], format, unused: 'unreadable' })
        continue
      }
      if (doc.policy) policy(doc.policy.title, doc.policy.sections, format)
      for (const t of doc.tables) {
        const k = KINDS[t.kind]
        const rows = t.rows.map((r, i) => ({ row_id: `${t.kind}:${i + 1}`, ...Object.fromEntries(Object.keys(k.fields).map((f) => [f, r[f] ?? ''])) }))
        add({ id: t.kind, file, sha256, description: k.description, fields: k.fields, rows, issues: t.issues, format, extractor: EXTRACTOR, labels: t.labels, provenance: Object.fromEntries(rows.map((r, i) => [r.row_id, t.provenance[i]])) })
      }
      if (!doc.policy && !doc.tables.length) sources.push({ id: file, file, sha256, description: 'Unrecognised source', fields: {}, rows: [], issues: doc.issues, format, unused: 'not in a documented layout' })
      continue
    }
    if (ext !== '.csv') {
      sources.push({ id: file, file, sha256, description: 'Unsupported source', fields: {}, rows: [], issues: [`${ext || 'files without an extension'} is not a supported format; use CSV, XLSX, DOCX, a text-based PDF or the Markdown policy document`], format: 'unsupported', unused: 'unsupported format' })
      continue
    }
    // A CSV's kind is the one whose fields match its header exactly; anything else is kept with an issue.
    const [header, ...data] = parseCsv(text)
    const kind = Object.entries(KINDS).find(([, k]) => Object.keys(k.fields).join() === header.join())
    if (!kind) {
      sources.push({ id: file, file, sha256, description: 'Unrecognised source', fields: {}, rows: [], issues: [`unrecognised columns: ${header.join(', ')}`], format: 'csv', unused: 'unrecognised columns' })
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
  canonicalise(review)
  validate(review)
  return review
}

/**
 * Why a review can't be investigated (§6.2), none when it can: its sources hold no positions at its period end, or
 * two files (or two tables of one file) provide the same kind of source, so an analysis would read one and leave the
 * other out. Other import issues don't block: they make the calculations that depend on them incomplete.
 */
export function blockers(r: Review): string[] {
  return [
    ...(r.periods.includes(r.periodEnd) ? [] : [`the sources hold no positions at the review's period end ${r.periodEnd}; upload the sources for that period`]),
    ...r.sources.filter((s) => s.conflict).map((s) => `${s.file} ${s.unused}: remove one of them or combine them into one file`),
  ]
}

/**
 * Puts harmless differences of form into canonical form (§7.5), keeping the original text in the row's provenance:
 * an asset-class label in the taxonomy's spelling (case and extra spaces), and a rule's metric and limit type in
 * lower case without surrounding spaces. A label outside the taxonomy is left as written; validate reports it.
 */
function canonicalise(review: Review) {
  const each = (id: string, field: string, canon: (v: string) => string | undefined) => {
    const s = review.sources.find((x) => x.id === id)
    for (const r of s?.rows ?? []) {
      const c = canon(r[field])
      if (c === undefined || c === r[field]) continue
      const p = ((s!.provenance ??= {})[r.row_id] ??= { location: '' })
      // A value normalised by its layout already keeps the text as the document wrote it.
      p.original = { [field]: r[field], ...p.original }
      r[field] = c
    }
  }
  each('lookthrough', 'asset_class', assetClass)
  each('policy_rules', 'metric', (v) => v.trim().toLowerCase())
  each('policy_rules', 'limit_type', (v) => v.trim().toLowerCase())
}

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
    const applicable = (rules?.rows ?? []).filter((r) => (r.portfolio_id === p || r.portfolio_id === 'ALL') && inForce(r, review.periodEnd))
    if (!applicable.length) rules?.issues.push(`no policy rule applies to ${p} at ${review.periodEnd}`)
  }
  // Labels and rules the trusted checks can't use, so that what they leave unknown is visible before any run: an
  // asset class outside the taxonomy makes its fund's exposures unknown at that date; a rule whose metric no check
  // measures is reported as unsupported, and a rule with an invalid limit type, limit or dates as not evaluable.
  for (const r of lookthrough) if (r.asset_class && !assetClass(r.asset_class)) review.sources.find((s) => s.id === 'lookthrough')!.issues.push(`${r.row_id}: asset class "${r.asset_class}" is not one of ${ASSET_CLASSES.join(', ')}; the exposures of ${r.instrument_id} at ${r.as_of} are unknown until the source names a class`)
  for (const r of rules?.rows ?? []) {
    if (!metricCheck(r.metric)) rules!.issues.push(`${r.row_id}: no trusted check measures ${r.metric}; rule ${r.rule_id} v${r.version} is reported as unsupported, never as met`)
    if (r.limit_type && r.limit_type !== 'max' && r.limit_type !== 'min') rules!.issues.push(`${r.row_id}: limit_type "${r.limit_type}" is neither max nor min; rule ${r.rule_id} v${r.version} can't be evaluated`)
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
 * date keeps only the rule versions in force on it. Each rule says how a trusted check can evaluate it, or why none
 * can (§8.2): what is possible, never whether it is met.
 */
export function getPolicy(review: Review, args: { section?: string; portfolio_id?: string; as_of?: string }) {
  const doc = review.sources.find((s) => s.id === 'policy_document')
  const sections = (doc?.sections ?? []).filter((s) => !args.section || s.id === args.section || s.heading.toLowerCase().includes(args.section.toLowerCase()))
  if (args.section && !sections.length) throw new Error(`no section "${args.section}"; sections: ${doc?.sections?.map((s) => s.heading).join(' | ')}`)
  const rules = table(review.sources, 'policy_rules')
    .filter((r) => (!args.portfolio_id || r.portfolio_id === args.portfolio_id || r.portfolio_id === 'ALL') && (!args.as_of || inForce(r, args.as_of)))
    .map((r): Row => ({ ...r, evaluation: ruleEvaluation(r) }))
  return { document: { file: doc?.file, sections }, rules }
}

/** How a rule can be evaluated: the trusted check that compares it, or why it is unsupported or can't be evaluated. */
export function ruleEvaluation(r: Row): string {
  const m = metricCheck(r.metric)
  const problem = ruleProblem(r)
  if (!m) return `unsupported: no trusted check measures ${r.metric}; a run_python result about it is not a trusted check, so a finding resting on it stays unvalidated`
  if (problem) return `not evaluable: ${problem}`
  return `run_check ${m.check}${m.asset_class ? ` with asset_class ${m.asset_class}` : ''}`
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
