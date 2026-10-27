// Import, validation (spec §6.2, §7.3) and bounded reads (§8.2) of a review's sources.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseCsv } from './csv.ts'
import { abs, dec, div, fmt, isDec, sum } from './decimal.ts'

export type Row = Record<string, string>
export type Section = { id: string; heading: string; text: string }
export type Source = {
  id: string
  file: string
  sha256: string
  description: string
  fields: Record<string, string>
  rows: Row[]
  sections?: Section[]
  issues: string[]
}
export type Review = { id: string; periodEnd: string; periods: string[]; sources: Source[] }

type Kind = { description: string; key: string[]; optional?: string[]; fields: Record<string, string> }
const FRACTION = 'decimal string, fraction of 1 (0.2500 = 25%)'
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
    description: 'Quarterly returns of each portfolio and its benchmark.',
    key: ['portfolio_id', 'period_end'],
    fields: { portfolio_id: 'Portfolio identifier', period_end: 'Quarter end (ISO date)', portfolio_return: `Portfolio return for the quarter, ${FRACTION}`, benchmark_return: `Benchmark return for the quarter, ${FRACTION}` },
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
const DECIMALS = ['market_value_gbp', 'reported_weight', 'exposure_weight', 'portfolio_return', 'benchmark_return', 'ongoing_charge', 'threshold']
const FRACTIONS = DECIMALS.filter((f) => f !== 'market_value_gbp')
const DATES = ['period_end', 'as_of', 'effective_from', 'effective_to', 'meeting_date', 'due_date']
const INSTRUMENT_ID = /^[A-Z]{2}[A-Z0-9]{9}\d$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function importReview(dir: string, id: string): Review {
  const sources: Source[] = []
  for (const file of readdirSync(dir).sort()) {
    const bytes = readFileSync(join(dir, file))
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const text = bytes.toString('utf8')
    if (file.endsWith('.md')) {
      const sections = text.split(/^## /m).slice(1).map((s) => {
        const [heading, ...body] = s.split('\n')
        return { id: heading.split('.')[0].trim(), heading: heading.trim(), text: body.join('\n').trim() }
      })
      const title = /^# (.+)$/m.exec(text)?.[1] ?? file
      sources.push({ id: 'policy_document', file, sha256, description: `Policy document: ${title}. Human-readable; the structured rules are authoritative for limits.`, fields: {}, rows: [], sections, issues: [] })
      continue
    }
    const [header, ...data] = parseCsv(text)
    const kind = Object.entries(KINDS).find(([, k]) => Object.keys(k.fields).join() === header.join())
    if (!kind) {
      sources.push({ id: file, file, sha256, description: 'Unrecognised source', fields: {}, rows: [], issues: [`unrecognised columns: ${header.join(', ')}`] })
      continue
    }
    const [kid, k] = kind
    const rows = data.map((r, i) => ({ row_id: `${kid}:${i + 1}`, ...Object.fromEntries(header.map((h, j) => [h, (r[j] ?? '').trim()])) }))
    sources.push({ id: kid, file, sha256, description: k.description, fields: k.fields, rows, issues: [] })
  }
  const periods = [...new Set(table(sources, 'positions').map((r) => r.period_end))].sort()
  const review: Review = { id, periodEnd: periods.at(-1) ?? '', periods, sources }
  validate(review)
  return review
}

function table(sources: Source[], id: string): Row[] {
  return sources.find((s) => s.id === id)?.rows ?? []
}

// Establishes whether the data is safe to analyse (§7.3). Never repairs anything.
function validate(review: Review) {
  const get = (id: string) => table(review.sources, id)
  const portfolios = new Set(get('portfolios').map((r) => r.portfolio_id))
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
      if (s.id === 'positions' && r.period_end && !review.periods.includes(r.period_end)) issue(r, `period_end ${r.period_end} is not a review period`)
    }
  }

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
  const rules = review.sources.find((s) => s.id === 'policy_rules')
  for (const p of portfolios) {
    const applicable = (rules?.rows ?? []).filter((r) => (r.portfolio_id === p || r.portfolio_id === 'ALL') && r.effective_from <= review.periodEnd && (!r.effective_to || r.effective_to >= review.periodEnd))
    if (!applicable.length) rules?.issues.push(`no policy rule applies to ${p} at ${review.periodEnd}`)
  }
}

// ---- Bounded reads, shared by the read_data tool and the sandbox's read_data host function ----

export const READ_LIMIT = 200
const READ_BYTES = 60_000
const OPS = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'contains'] as const
export type Filter = { column: string; op: (typeof OPS)[number]; value: string | string[] }
export type ReadArgs = { source: string; columns?: string[]; filters?: Filter[]; sort?: { column: string; descending?: boolean }[]; limit?: number }

function compare(a: string, b: string): number {
  if (isDec(a) && isDec(b)) {
    const d = dec(a) - dec(b)
    return d < 0n ? -1 : d > 0n ? 1 : 0
  }
  return a < b ? -1 : a > b ? 1 : 0
}

/** Throws Error with a message meant for the agent when the request is invalid. */
export function readData(review: Review, args: ReadArgs) {
  const s = review.sources.find((x) => x.id === args.source)
  if (!s || !s.rows.length) throw new Error(`unknown tabular source "${args.source}"; available: ${review.sources.filter((x) => x.rows.length).map((x) => x.id).join(', ')}`)
  const known = ['row_id', ...Object.keys(s.fields)]
  const bad = [...(args.columns ?? []), ...(args.filters ?? []).map((f) => f.column), ...(args.sort ?? []).map((x) => x.column)].filter((c) => !known.includes(c))
  if (bad.length) throw new Error(`unknown column(s) ${bad.join(', ')} in ${s.id}; columns: ${known.join(', ')}`)
  for (const f of args.filters ?? []) if (!OPS.includes(f.op)) throw new Error(`unknown filter op "${f.op}"; use one of ${OPS.join(', ')}`)
  const limit = Math.min(Math.max(1, Math.floor(args.limit ?? 50)), READ_LIMIT)

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
  for (const o of [...(args.sort ?? [])].reverse()) rows = [...rows].sort((a, b) => compare(a[o.column] ?? '', b[o.column] ?? '') * (o.descending ? -1 : 1))
  const cols = args.columns?.length ? ['row_id', ...args.columns.filter((c) => c !== 'row_id')] : known
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

export function rowExists(review: Review, rowId: string): boolean {
  const [source] = rowId.split(':')
  return !!review.sources.find((s) => s.id === source)?.rows.some((r) => r.row_id === rowId)
}

/** Policy document sections and structured rules, optionally for one portfolio and date. */
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
