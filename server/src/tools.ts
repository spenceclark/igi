// The seven agent tools (spec §8.2). Read-only, scoped to one review; only record_note and
// propose_finding write, and only to this run's own record.
import { CHECK_CATALOGUE, runCheck, type CheckArgs } from './checks.ts'
import { COVERAGE, MEASURES, factIndex, factsOf, isCurrent, validateFinding, type Claim, type CoverageClaim, type Revision, type Validation } from './evidence.ts'
import { LIMITS, hostFunction, runPython } from './sandbox.ts'
import { ASSET_CLASSES, READ_LIMIT, getPolicy, readData, rowExists, sourceSummary, type ReadArgs, type Review } from './sources.ts'

// Finding classifications and what each means; propose_finding's description lists them for the agent.
export const CLASSIFICATIONS = {
  potential_exception: 'a limit or policy requirement appears not to be met',
  policy_inconsistency: 'the policy document and the structured rules disagree',
  outstanding_action: 'a committee action is overdue, unfulfilled or newly triggered',
  data_quality: 'the data is inconsistent or unreliable',
  missing_information: 'information needed for a conclusion is absent',
  explained_anomaly: 'something looks wrong but has a legitimate explanation, which the finding states',
  observation: 'noteworthy, but needs no action or is unresolved',
}
const NOTE_KINDS = ['observation', 'hypothesis', 'assumption', 'open_question', 'blocker']
// The areas of the review a finding can belong to, as the governed procedure divides it; the area decides which
// step of the Cairn record its evidence is proposed for (AREA_STEP in ledger.ts).
export const REVIEW_AREAS = {
  source_data: 'the source data: its completeness, reconciliation and quality',
  allocation_risk: 'portfolio allocation and risk: exposures, limits, concentration and performance',
  funds_fees: 'the funds and managers used, and their charges',
  committee_actions: 'previous committee decisions, and whether their actions were carried out',
}

// What the tools leave in the run's record: Python executions (X1, X2...), checks (C1...) and notes (N1...).
export type Execution = { id: string; purpose: string; code: string; ok: boolean; result?: unknown; stdout: string; error?: string; errorType?: string; ms: number; reads: { source: string; returned: number }[] }
export type Check = { id: string; args: CheckArgs; result: Record<string, unknown>; rowsUsed: string[] }
export type Note = { id: string; kind: string; text: string; related_ids?: string[] }
// propose_finding's arguments, as its JSON schema below declares them. review_area is required of the agent, but
// findings stored before it existed have none. claims and coverage replaced material_numbers, which older stored
// findings still carry: one figure each, checked only for appearing somewhere in a cited check's result.
export type FindingArgs = {
  title: string
  statement: string
  classification: string
  review_area?: string
  materiality: string
  portfolios: string[]
  period_end?: string
  policy_rule?: { rule_id: string; version: string }
  cited_rows?: string[]
  execution_ids?: string[]
  check_ids?: string[]
  claims?: Claim[]
  coverage?: CoverageClaim[]
  material_numbers?: { label: string; value: string; check_id: string }[]
  explanation: string
  assumptions?: string[]
  uncertainties?: string[]
  replaces?: string
}
// A stored finding: the agent's arguments plus its id (F1...), the classification the agent proposed, the
// validation outcome, and the id of the finding that revised it, if any. revision is set on a finding proposed to
// replace another: accepted when it became current, or not, with why, leaving the earlier finding current.
export type Finding = FindingArgs & {
  id: string
  proposed_classification: string
  validation: Validation
  superseded_by?: string
  revision?: Revision
}
// A tool call refused because a run budget is spent: the agent is told, and the run ends budget_exhausted (§8.4).
export class BudgetSpent extends Error {}
// Everything one investigation run builds up, held in memory and saved with the run.
export type RunState ={ review: Review; now: Date; executions: Execution[]; checks: Check[]; notes: Note[]; findings: Finding[]; maxPython: number }

// Builders for the tools' JSON schemas. An object rejects properties it doesn't declare.
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })
const str = (description: string) => ({ type: 'string', description })
const strs = (description: string) => ({ type: 'array', items: { type: 'string' }, description })

// The tool definitions sent with every model request: name, description and JSON schema for each.
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
    description: 'Returns the policy document (all sections, or one by number or heading text) and the structured policy rules, optionally only those applying to a portfolio (rules for ALL included) on a date. The structured rules are authoritative for numerical limits; do not take limits from the document text. Each rule\'s evaluation says which trusted check compares it, or that none can (unsupported, or not evaluable with the reason).',
    parameters: obj({ section: str('Section number or heading text'), portfolio_id: str('Portfolio id'), as_of: str('ISO date: only rule versions in force on that date') }),
  },
  {
    type: 'function',
    name: 'run_python',
    description: [
      'Runs Python in a sandbox (Monty, a restricted subset of Python) and returns the value of the last expression, printed output and any error. Each run is independent: nothing persists between runs.',
      `Inside the code, read_data(source, columns=None, filters=None, sort=None, limit=${READ_LIMIT}) returns rows as a list of dicts with string values, exactly like the read_data tool. At most ${LIMITS.maxSuspensions} read_data calls per run.`,
      'All numbers are decimal strings: convert with Decimal(value), never float(), and return results as strings (str(x)).',
      'Read every value with read_data inside the code and join the rows there; never type figures from earlier results into the code.',
      'Available modules: decimal, datetime, math, json, re, collections, itertools. Not supported: class inheritance, @property, @staticmethod, @classmethod, user-defined exceptions, generator functions (yield), the statistics module, third-party packages (no pandas or numpy), files and network. Write plain functions over lists and dicts.',
      `Limits: ${LIMITS.maxFeedDurationSecs} s, ${LIMITS.maxMemory / 1024 / 1024} MB, recursion depth ${LIMITS.maxRecursionDepth}. Errors come back verbatim: fix the code and run it again.`,
    ].join('\n'),
    parameters: obj({ purpose: str('What this run is meant to establish, in one sentence'), code: str('Python source') }, ['purpose', 'code']),
  },
  {
    type: 'function',
    name: 'run_check',
    description: `Runs a named, tested deterministic calculation in decimal arithmetic and returns its result with an id (C...). Rules are the structured rule versions in force at the period end. The result's facts lists each figure as a fact id (C7:exposure) with its value in its unit, its measure and, where it has one, its asset class, instrument or rule; a finding's claims cite these ids. Catalogue (arguments: what it returns):\n${Object.entries(CHECK_CATALOGUE).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\nperiod_end defaults to the review period end; for fee_change, from_period defaults to the previous period end.\nA check never treats a missing, invalid, duplicated or unrecognised input as a value: the figures that depend on it are null, unresolved lists it with its source rows, and a rule that could not be compared is listed under not_compared with the reason, rather than shown as met.`,
    parameters: obj(
      { check: { type: 'string', enum: Object.keys(CHECK_CATALOGUE) }, portfolio_id: str('Portfolio id'), period_end: str('ISO date'), asset_class: { type: 'string', enum: [...ASSET_CLASSES], description: 'For lookthrough_exposure' }, from_period: str('ISO date'), to_period: str('ISO date') },
      ['check', 'portfolio_id'],
    ),
  },
  {
    type: 'function',
    name: 'record_note',
    description: 'Records an observation, hypothesis, assumption, open question (a matter you could not resolve, and what it affects) or blocker (missing information that stops a conclusion) in the investigation record. Returns its id (N...).',
    parameters: obj({ kind: { type: 'string', enum: NOTE_KINDS }, text: str('The note'), related_ids: strs('Row, execution, check or finding ids it relates to') }, ['kind', 'text']),
  },
  {
    type: 'function',
    name: 'propose_finding',
    description: [
      'Proposes a finding for human review. Returns its id (F...), its stored classification and its validation state.',
      `Classifications: ${Object.entries(CLASSIFICATIONS).map(([k, v]) => `${k} (${v})`).join('; ')}.`,
      `review_area is the part of the review the finding belongs to: ${Object.entries(REVIEW_AREAS).map(([k, v]) => `${k} (${v})`).join('; ')}.`,
      'Cite the source row_ids, execution ids (X...) and check ids (C...) from this run that support it; unknown ids are rejected.',
      'claims lists every figure the finding relies on, and every %, pp, bps or £ figure in its statement and explanation must be one of them. Each claim has a key, a label, a value written as a reader sees it (12.34%, 0.56pp, £1,000,000; a fraction as %, a difference between two fractions or a margin as pp), a measure, the scope it applies to, and one source:',
      '- fact: a fact id from a run_check result, for any computed or reported figure;',
      '- rule and version: a structured policy rule version in force, for a numerical limit (measure policy_limit);',
      '- quote with row or section: the exact words of a committee_actions row or a policy document section that contain the figure, for a threshold or target written only in text (measure action_threshold or document_figure). A quoted figure is an extract a person reads in context, never a structured rule;',
      '- derived with of (two claim keys): difference (measure change), relative_change, or comparison with a relation (above, below, at_or_above, at_or_below, equal; no value).',
      `Scope: portfolio, period, instrument (an instrument id) and asset_class must match the evidence; portfolio defaults to the finding's portfolios and period to its period_end, so give them for a figure from another portfolio or date. Measures: ${Object.entries(MEASURES).map(([k, v]) => `${k} (${v})`).join('; ')}.`,
      `coverage proves a statement about a whole population (all portfolios, every holding, no other fund, full coverage), or assurance of compliance (fully compliant, in full compliance, no breaches, no exceptions), from run_check results only: ${Object.entries(COVERAGE).map(([k, v]) => `${k} (${v})`).join('; ')}. Give the portfolios it covers. A statement is supported only by coverage of the kind it states, over the population it names: wording about portfolios needs every portfolio in the review, other wording the finding's portfolios.`,
      'IGI checks each claim against its evidence and each coverage claim against the population in the sources. The finding is validated only if all of them check out and no figure or population statement in the text is left unsupported; a potential_exception that is not validated is stored as an unvalidated observation. The reasoning and conclusion are not checked: they are yours, reviewed by a person.',
      'To revise a current finding, propose the new version with replaces set to its id. The revision becomes current if it is validated, or if the finding it replaces was not; otherwise it is kept as a rejected revision and the earlier finding stays current.',
    ].join('\n'),
    parameters: obj(
      {
        title: str('Short title'),
        statement: str('The finding, stated plainly'),
        classification: { type: 'string', enum: Object.keys(CLASSIFICATIONS) },
        review_area: { type: 'string', enum: Object.keys(REVIEW_AREAS) },
        materiality: { type: 'string', enum: ['high', 'medium', 'low'] },
        portfolios: strs('Portfolio ids concerned'),
        period_end: str('ISO date the finding concerns'),
        policy_rule: obj({ rule_id: str('Rule id'), version: str('Rule version') }, ['rule_id', 'version']),
        cited_rows: strs('Source row_ids'),
        execution_ids: strs('run_python execution ids'),
        check_ids: strs('run_check ids'),
        claims: {
          type: 'array',
          items: obj(
            {
              key: str('Short name, unique in the finding, that derived claims refer to'),
              label: str('What the figure is, as a reader would put it'),
              value: str('The figure with its unit, e.g. 12.34%, -0.5pp or £1,000,000; omit for a comparison'),
              measure: { type: 'string', enum: Object.keys(MEASURES) },
              portfolio: str('Portfolio id, when not the finding’s only portfolio'),
              period: str('ISO date, when not the finding’s period_end'),
              instrument: str('Instrument id, for a figure about one holding or fund'),
              asset_class: str('Asset class, for an exposure'),
              source: obj({
                fact: str('Fact id from a run_check result, e.g. C7:exposure'),
                rule: str('Structured rule id'),
                version: str('Rule version'),
                quote: str('Exact words from the row or section containing the figure'),
                row: str('committee_actions row_id the quote is from'),
                section: str('Policy document section number the quote is from'),
                derived: { type: 'string', enum: ['difference', 'relative_change', 'comparison'] },
                of: strs('The two claim keys a derived claim is calculated from, in order'),
                relation: { type: 'string', enum: ['above', 'below', 'at_or_above', 'at_or_below', 'equal'] },
              }),
            },
            ['key', 'label', 'measure', 'source'],
          ),
        },
        coverage: {
          type: 'array',
          items: obj(
            {
              kind: { type: 'string', enum: Object.keys(COVERAGE) },
              portfolios: strs('Portfolio ids the statement covers'),
              period: str('ISO date, when not the finding’s period_end'),
              except: strs('Instrument ids or rule ids the statement excludes'),
              checks: strs('run_check ids covering the population'),
            },
            ['kind', 'portfolios', 'checks'],
          ),
        },
        explanation: str('Why it matters or does not, and the reasoning behind it'),
        assumptions: strs('Assumptions the finding depends on'),
        uncertainties: strs('What remains uncertain, including anything the records do not establish'),
        replaces: str('Id of a current finding this one revises'),
      },
      ['title', 'statement', 'classification', 'review_area', 'materiality', 'portfolios', 'explanation'],
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
      if (state.executions.length >= state.maxPython) throw new BudgetSpent(`Python execution budget (${state.maxPython}) is spent; use run_check or conclude`)
      // read_data inside Python is the same bounded read as the tool, with the largest limit by default; each
      // call is logged on the execution.
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
      // Decimal literals in the code suggest figures copied from earlier results rather than read from the data;
      // the warning goes back to the agent and stays in the trace with the result.
      const typed = [...new Set(args.code.match(/(?<![\w.])\d+\.\d{2,}/g) ?? [])]
      const warning = typed.length ? `The code contains typed-in figures (${typed.slice(0, 6).join(', ')}${typed.length > 6 ? ', …' : ''}): read values with read_data inside the code instead, so the result rests on the sources.` : undefined
      return { execution_id: id, ok: r.ok, result: r.result, stdout: r.stdout + (r.stdoutTruncated ? '\n... (output truncated)' : ''), error: r.error, warning }
    }
    case 'run_check': {
      const checkArgs = args as CheckArgs
      const { result, rowsUsed } = runCheck(review, checkArgs)
      const id = `C${state.checks.length + 1}`
      const check = { id, args: checkArgs, result, rowsUsed }
      state.checks.push(check)
      return { check_id: id, ...result, facts: factIndex(factsOf(check)) }
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

/**
 * Checks and stores a proposed finding. Its citations must exist in this run. Its claims, coverage claims and text
 * are validated against the run's evidence (validateFinding in evidence.ts); a potential exception that is not
 * validated is stored as an unvalidated observation. Either way the finding is kept, and the message lists what
 * failed and how to put it right. With `replaces`, the finding revises a current finding of this run: it takes
 * that finding's place if it is validated or the earlier one was not, and otherwise is kept as a rejected revision.
 */
function proposeFinding(state: RunState, a: FindingArgs) {
  if (!CLASSIFICATIONS[a.classification as keyof typeof CLASSIFICATIONS]) throw new Error(`classification must be one of ${Object.keys(CLASSIFICATIONS).join(', ')}`)
  if (!REVIEW_AREAS[a.review_area as keyof typeof REVIEW_AREAS]) throw new Error(`review_area must be one of ${Object.keys(REVIEW_AREAS).join(', ')}`)
  for (const f of ['title', 'statement', 'explanation'] as const) if (typeof a[f] !== 'string' || !a[f].trim()) throw new Error(`${f} is required`)
  if (!Array.isArray(a.portfolios) || !a.portfolios.length) throw new Error('portfolios is required')
  if (a.material_numbers) throw new Error('material_numbers is replaced by claims: give each figure as a claim with its measure and source')
  // Only a current finding of this run can be revised: an unknown id, one already revised, or a rejected
  // revision is refused, which also rules out a finding revising itself and any cycle.
  const replaced = a.replaces ? state.findings.find((f) => f.id === a.replaces) : undefined
  if (a.replaces && !replaced) throw new Error(`unknown finding ${a.replaces}; replaces names a finding of this run`)
  if (replaced?.superseded_by) throw new Error(`${replaced.id} was already revised as ${replaced.superseded_by}; revise that instead`)
  if (replaced && !isCurrent(replaced)) throw new Error(`${replaced.id} is a rejected revision; revise the finding it tried to replace instead`)
  const unknown = [
    ...(a.cited_rows ?? []).filter((r) => !rowExists(state.review, r)),
    ...(a.execution_ids ?? []).filter((x) => !state.executions.some((e) => e.id === x)),
    ...(a.check_ids ?? []).filter((x) => !state.checks.some((c) => c.id === x)),
  ]
  if (unknown.length) throw new Error(`unknown citation ids: ${unknown.join(', ')}. Cite only row_ids, execution ids and check ids from this run.`)
  if (!(a.cited_rows?.length || a.check_ids?.length || a.execution_ids?.length || a.claims?.length || a.coverage?.length)) throw new Error('cite at least one source row, execution, check or claim')

  const validation = validateFinding({ review: state.review, checks: state.checks }, a)
  const validated = validation.state === 'validated'
  const downgraded = a.classification === 'potential_exception' && !validated
  const id = `F${state.findings.length + 1}`
  // A revision that is not validated never retires a validated finding; the attempt is kept for the record.
  const accepted = !replaced || validated || replaced.validation.state !== 'validated'
  const finding: Finding = {
    ...a,
    id,
    proposed_classification: a.classification,
    classification: downgraded ? 'observation' : a.classification,
    validation,
    ...(replaced ? { revision: { of: replaced.id, accepted, ...(accepted ? {} : { reason: `${replaced.id} is validated and this revision is not` }) } } : {}),
  }
  state.findings.push(finding)
  if (replaced && accepted) replaced.superseded_by = id

  const problems = validation.unmatched.length ? ` Not supported: ${validation.unmatched.join('; ')}.` : ''
  const message = [
    `Stored as ${finding.classification} (${validation.state}).${problems}`,
    downgraded ? `It was proposed as a potential_exception: fix the claims and propose again with replaces="${id}" to record it as one.` : '',
    replaced ? (accepted ? `It replaces ${replaced.id}, which is kept as history.` : `It does not replace ${replaced.id}, which is validated and stays current; fix the claims and propose again with replaces="${replaced.id}".`) : '',
  ].filter(Boolean).join(' ')
  return { finding_id: id, classification: finding.classification, validation: { state: validation.state, matched: validation.matched, unmatched: validation.unmatched }, current: isCurrent(finding), message }
}
