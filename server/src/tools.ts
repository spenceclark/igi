// The seven agent tools (spec §8.2). Read-only, scoped to one review; only record_note and
// propose_finding write, and only to this run's own record.
import { dec, fmt, isDec } from './decimal.ts'
import { CHECK_CATALOGUE, runCheck, type CheckArgs } from './checks.ts'
import { LIMITS, hostFunction, runPython } from './sandbox.ts'
import { READ_LIMIT, getPolicy, readData, rowExists, sourceSummary, type ReadArgs, type Review } from './sources.ts'

export const CLASSIFICATIONS = {
  potential_exception: 'a limit or policy requirement appears not to be met',
  policy_inconsistency: 'the policy document and the structured rules disagree',
  outstanding_action: 'a committee action is overdue or unfulfilled',
  data_quality: 'the data is inconsistent or unreliable',
  missing_information: 'information needed for a conclusion is absent',
  explained_anomaly: 'something looks wrong but has a legitimate explanation, which the finding states',
  observation: 'noteworthy, but needs no action or is unresolved',
}
const NOTE_KINDS = ['observation', 'hypothesis', 'assumption', 'open_question', 'blocker']

export type Execution = { id: string; purpose: string; code: string; ok: boolean; result?: unknown; stdout: string; error?: string; errorType?: string; ms: number; reads: { source: string; returned: number }[] }
export type Check = { id: string; args: CheckArgs; result: Record<string, unknown>; rowsUsed: string[] }
export type Note = { id: string; kind: string; text: string; related_ids?: string[] }
// propose_finding's arguments, as its JSON schema below declares them.
export type FindingArgs = {
  title: string
  statement: string
  classification: string
  materiality: string
  portfolios: string[]
  period_end?: string
  policy_rule?: { rule_id: string; version: string }
  cited_rows?: string[]
  execution_ids?: string[]
  check_ids?: string[]
  material_numbers?: { label: string; value: string; check_id: string }[]
  explanation: string
  assumptions?: string[]
  uncertainties?: string[]
  replaces?: string
}
export type Finding = FindingArgs & { id: string; proposed_classification: string; validation: { state: string; matched: string[]; unmatched: string[] }; superseded_by?: string }
export type RunState = { review: Review; now: Date; executions: Execution[]; checks: Check[]; notes: Note[]; findings: Finding[]; maxPython: number }

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })
const str = (description: string) => ({ type: 'string', description })
const strs = (description: string) => ({ type: 'array', items: { type: 'string' }, description })

export const TOOLS = [
  {
    type: 'function',
    name: 'list_sources',
    description: "Lists the review's sources: description, fields and units, row counts, file hashes, policy document sections, and import validation issues.",
    parameters: obj({}),
  },
  {
    type: 'function',
    name: 'read_data',
    description: `Returns rows from one tabular source with chosen columns, filters, sort and a row limit (default 50, max ${READ_LIMIT}). Every row has a row_id to cite. Values are strings; numbers are decimal strings, and weights, exposures and returns are fractions of 1. Filter ops: eq, ne, lt, lte, gt, gte, in (value is a list), contains (case-insensitive). Comparisons are numeric when both sides are numbers; dates compare as ISO strings.`,
    parameters: obj(
      {
        source: str('Source id from list_sources'),
        columns: strs('Columns to return; all if omitted. row_id is always included.'),
        filters: { type: 'array', items: obj({ column: str('Column'), op: str('eq, ne, lt, lte, gt, gte, in or contains'), value: { description: 'Value, or a list for in' } }, ['column', 'op', 'value']) },
        sort: { type: 'array', items: obj({ column: str('Column'), descending: { type: 'boolean' } }, ['column']) },
        limit: { type: 'integer', minimum: 1, maximum: READ_LIMIT },
      },
      ['source'],
    ),
  },
  {
    type: 'function',
    name: 'get_policy',
    description: 'Returns the policy document (all sections, or one by number or heading text) and the structured policy rules, optionally only those applying to a portfolio (rules for ALL included) on a date. The structured rules are authoritative for numerical limits; do not take limits from the document text.',
    parameters: obj({ section: str('Section number or heading text'), portfolio_id: str('Portfolio id'), as_of: str('ISO date: only rule versions in force on that date') }),
  },
  {
    type: 'function',
    name: 'run_python',
    description: [
      'Runs Python in a sandbox (Monty, a restricted subset of Python) and returns the value of the last expression, printed output and any error. Each run is independent: nothing persists between runs.',
      `Inside the code, read_data(source, columns=None, filters=None, sort=None, limit=${READ_LIMIT}) returns rows as a list of dicts with string values, exactly like the read_data tool. At most ${LIMITS.maxSuspensions} read_data calls per run.`,
      'All numbers are decimal strings: convert with Decimal(value), never float(), and return results as strings (str(x)).',
      'Available modules: decimal, datetime, math, json, re, collections, itertools. Not supported: class inheritance, @property, @staticmethod, @classmethod, user-defined exceptions, generator functions (yield), the statistics module, third-party packages (no pandas or numpy), files and network. Write plain functions over lists and dicts.',
      `Limits: ${LIMITS.maxFeedDurationSecs} s, ${LIMITS.maxMemory / 1024 / 1024} MB, recursion depth ${LIMITS.maxRecursionDepth}. Errors come back verbatim: fix the code and run it again.`,
    ].join('\n'),
    parameters: obj({ purpose: str('What this run is meant to establish, in one sentence'), code: str('Python source') }, ['purpose', 'code']),
  },
  {
    type: 'function',
    name: 'run_check',
    description: `Runs a named, tested deterministic calculation in decimal arithmetic and returns its result with an id (C...). Rules are the structured rule versions in force at the period end. These results are the independent validation for numbers in findings. Catalogue (arguments: what it returns):\n${Object.entries(CHECK_CATALOGUE).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\nperiod_end defaults to the review period end; for fee_change, from_period defaults to the previous period end.`,
    parameters: obj(
      { check: { type: 'string', enum: Object.keys(CHECK_CATALOGUE) }, portfolio_id: str('Portfolio id'), period_end: str('ISO date'), asset_class: str('For lookthrough_exposure, e.g. equity, bonds, cash'), from_period: str('ISO date'), to_period: str('ISO date') },
      ['check', 'portfolio_id'],
    ),
  },
  {
    type: 'function',
    name: 'record_note',
    description: 'Records an observation, hypothesis, assumption, open question or blocker (missing information that stops a conclusion) in the investigation record. Returns its id (N...).',
    parameters: obj({ kind: { type: 'string', enum: NOTE_KINDS }, text: str('The note'), related_ids: strs('Row, execution, check or finding ids it relates to') }, ['kind', 'text']),
  },
  {
    type: 'function',
    name: 'propose_finding',
    description: [
      'Proposes a finding for human review. Returns its id (F...), its stored classification and its validation state.',
      `Classifications: ${Object.entries(CLASSIFICATIONS).map(([k, v]) => `${k} (${v})`).join('; ')}.`,
      'Cite the source row_ids, execution ids (X...) and check ids (C...) from this run that support it; unknown ids are rejected.',
      'material_numbers lists every figure the finding relies on, each with the id of a run_check result containing it (as a fraction, percentage or amount). A potential_exception whose material numbers are not all found in the cited check results is stored as an unvalidated observation.',
      'To revise an earlier finding, propose the new version with replaces set to the earlier id.',
    ].join('\n'),
    parameters: obj(
      {
        title: str('Short title'),
        statement: str('The finding, stated plainly'),
        classification: { type: 'string', enum: Object.keys(CLASSIFICATIONS) },
        materiality: { type: 'string', enum: ['high', 'medium', 'low'] },
        portfolios: strs('Portfolio ids concerned'),
        period_end: str('ISO date the finding concerns'),
        policy_rule: obj({ rule_id: str('Rule id'), version: str('Rule version') }, ['rule_id', 'version']),
        cited_rows: strs('Source row_ids'),
        execution_ids: strs('run_python execution ids'),
        check_ids: strs('run_check ids'),
        material_numbers: { type: 'array', items: obj({ label: str('What the number is'), value: str('The number as stated, e.g. 0.1234, 12.34% or 1,000,000'), check_id: str('run_check id containing it') }, ['label', 'value', 'check_id']) },
        explanation: str('Why it matters or does not, and the reasoning behind it'),
        assumptions: strs('Assumptions the finding depends on'),
        uncertainties: strs('What remains uncertain'),
        replaces: str('Id of an earlier finding this one revises'),
      },
      ['title', 'statement', 'classification', 'materiality', 'portfolios', 'explanation'],
    ),
  },
]

/**
 * Executes one tool call. Returns the JSON result for the model; throws Error with a message for the model.
 * Each tool's JSON schema declares its argument types; the functions behind them report a value of the
 * wrong type as an error to Spark rather than acting on it.
 */
export async function callTool(state: RunState, name: string, args: Record<string, unknown>): Promise<unknown> {
  const { review } = state
  switch (name) {
    case 'list_sources':
      return { review_id: review.id, period_end: review.periodEnd, periods: review.periods, sources: sourceSummary(review) }
    case 'read_data':
      return readData(review, args as ReadArgs)
    case 'get_policy':
      return getPolicy(review, args as Parameters<typeof getPolicy>[1])
    case 'run_python': {
      if (typeof args.code !== 'string' || !args.code.trim()) throw new Error('code is required')
      if (state.executions.length >= state.maxPython) throw new Error(`Python execution budget (${state.maxPython}) is spent; use run_check or conclude`)
      const reads: Execution['reads'] = []
      const host = {
        read_data: hostFunction(['source', 'columns', 'filters', 'sort', 'limit'], (a) => {
          const r = readData(review, { ...(a as ReadArgs), limit: (a.limit as number | undefined) ?? READ_LIMIT })
          reads.push({ source: r.source, returned: r.returned })
          return r.rows
        }),
      }
      const r = await runPython(args.code, host, state.now)
      const id = `X${state.executions.length + 1}`
      state.executions.push({ id, purpose: String(args.purpose ?? ''), code: args.code, ok: r.ok, result: r.result, stdout: r.stdout, error: r.error, errorType: r.errorType, ms: r.ms, reads })
      return { execution_id: id, ok: r.ok, result: r.result, stdout: r.stdout + (r.stdoutTruncated ? '\n... (output truncated)' : ''), error: r.error }
    }
    case 'run_check': {
      const checkArgs = args as CheckArgs
      const { result, rowsUsed } = runCheck(review, checkArgs)
      const id = `C${state.checks.length + 1}`
      state.checks.push({ id, args: checkArgs, result, rowsUsed })
      return { check_id: id, ...result }
    }
    case 'record_note': {
      if (typeof args.kind !== 'string' || !NOTE_KINDS.includes(args.kind)) throw new Error(`kind must be one of ${NOTE_KINDS.join(', ')}`)
      const id = `N${state.notes.length + 1}`
      state.notes.push({ id, kind: args.kind, text: String(args.text ?? ''), related_ids: args.related_ids as string[] | undefined })
      return { note_id: id }
    }
    case 'propose_finding':
      return proposeFinding(state, args as FindingArgs)
  }
  throw new Error(`unknown tool ${name}`)
}

function numbersIn(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string' && isDec(v)) out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => numbersIn(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => numbersIn(x, out))
  return out
}

/** Does a stated figure (0.1234, 12.34%, -0.5pp, £1,000,000) appear in the check result at the stated precision? */
export function figureMatches(stated: string, candidates: string[]): boolean {
  const m = /^(-?)\s*£?\s*([\d,]*\.?\d+)\s*(%|pp|percentage points)?$/i.exec(stated.trim())
  if (!m) return false
  const raw = `${m[1]}${m[2].replaceAll(',', '')}`
  if (!isDec(raw)) return false
  const dp = (raw.split('.')[1] ?? '').length
  const [value, places] = m[3] ? [dec(raw) / 100n, dp + 2] : [dec(raw), dp]
  return candidates.some((c) => fmt(dec(c), places) === fmt(value, places))
}

function proposeFinding(state: RunState, a: FindingArgs) {
  if (!CLASSIFICATIONS[a.classification as keyof typeof CLASSIFICATIONS]) throw new Error(`classification must be one of ${Object.keys(CLASSIFICATIONS).join(', ')}`)
  for (const f of ['title', 'statement', 'explanation'] as const) if (typeof a[f] !== 'string' || !a[f].trim()) throw new Error(`${f} is required`)
  if (!Array.isArray(a.portfolios) || !a.portfolios.length) throw new Error('portfolios is required')
  const unknown = [
    ...(a.cited_rows ?? []).filter((r) => !rowExists(state.review, r)),
    ...(a.execution_ids ?? []).filter((x) => !state.executions.some((e) => e.id === x)),
    ...(a.check_ids ?? []).filter((x) => !state.checks.some((c) => c.id === x)),
  ]
  if (unknown.length) throw new Error(`unknown citation ids: ${unknown.join(', ')}. Cite only row_ids, execution ids and check ids from this run.`)
  if (!(a.cited_rows?.length || a.check_ids?.length || a.execution_ids?.length)) throw new Error('cite at least one source row, execution or check')
  const replaced = a.replaces ? state.findings.find((f) => f.id === a.replaces) : undefined
  if (a.replaces && !replaced) throw new Error(`unknown finding ${a.replaces}`)

  const matched: string[] = []
  const unmatched: string[] = []
  for (const n of a.material_numbers ?? []) {
    const check = state.checks.find((c) => c.id === n.check_id)
    const ok = !!check && figureMatches(String(n.value), numbersIn(check.result))
    ;(ok ? matched : unmatched).push(`${n.label}: ${n.value} (${n.check_id})`)
  }
  const validated = matched.length > 0 && unmatched.length === 0
  const downgraded = a.classification === 'potential_exception' && !validated
  const id = `F${state.findings.length + 1}`
  const finding: Finding = {
    ...a,
    id,
    proposed_classification: a.classification,
    classification: downgraded ? 'observation' : a.classification,
    validation: { state: validated ? 'validated' : 'unvalidated', matched, unmatched },
  }
  state.findings.push(finding)
  if (replaced) replaced.superseded_by = id
  const message = downgraded
    ? `Stored as an unvalidated observation: ${unmatched.length ? `these numbers were not found in the cited check results: ${unmatched.join('; ')}` : 'no material numbers were validated against a run_check result'}. Run the relevant check and propose again with replaces="${id}" to record it as a potential_exception.`
    : `Stored as ${finding.classification} (${finding.validation.state}).`
  return { finding_id: id, classification: finding.classification, validation: finding.validation, message }
}
