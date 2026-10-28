// Typed evidence and the validation of a finding's claims against it (spec §6.4, §9.6). A trusted check's result
// becomes a list of facts, each a figure with its measure, unit and scope. A finding states its figures as claims:
// each says what the figure means and where it comes from (a fact, a structured policy rule, a quote from a source
// text, or a calculation on other claims), and IGI checks that the evidence says the same thing, for the same
// portfolio, period, instrument and rule, in the same unit. Coverage claims prove statements about a whole
// population. What IGI checks is the figures and the populations, never the finding's reasoning or conclusion.
import { abs, dec, div, fmt, isDec, type Dec } from './decimal.ts'
import type { CheckArgs } from './checks.ts'
import type { Review, Row } from './sources.ts'

// How a figure is expressed: a fraction of 1 shown as a percentage, a difference of two fractions shown in
// percentage points, an amount in pounds, or a count.
export type Unit = 'fraction' | 'points' | 'gbp' | 'count'

// What a figure measures. The agent names one in every claim, and it must be the measure of the evidence cited.
export const MEASURES = {
  exposure: 'a portfolio’s look-through exposure to an asset class',
  holding_weight: 'a holding’s weight computed from market values',
  reported_weight: 'a holding’s weight as reported',
  largest_holding_weight: 'the computed weight of a portfolio’s largest holding',
  reported_weight_sum: 'the sum of a portfolio’s reported weights',
  weight_difference: 'the largest gap between reported and computed weights, in pp',
  total_market_value: 'a portfolio’s total market value',
  fund_exposure: 'a fund’s own exposure to an asset class',
  exposure_contribution: 'a holding’s contribution to a portfolio’s look-through exposure',
  holdings_without_lookthrough: 'how many holdings have no look-through data',
  portfolio_return: 'a portfolio’s return for the quarter',
  benchmark_return: 'a benchmark’s return for the quarter',
  return_difference: 'portfolio return minus benchmark return, in pp',
  return_deviation: 'the absolute difference between portfolio and benchmark return, in pp',
  ongoing_charge: 'a fund’s annual ongoing charge',
  charge_change: 'the change in a fund’s ongoing charge between two periods, in pp',
  policy_limit: 'the limit of a structured policy rule',
  limit_breach: 'how far a value is beyond a rule’s limit, in pp',
  limit_headroom: 'how far a value is within a rule’s limit, in pp',
  action_threshold: 'a figure quoted from a committee action',
  document_figure: 'a figure quoted from the policy document',
  change: 'the difference between two other claims (derived)',
  relative_change: 'the change between two other claims relative to the second (derived)',
  comparison: 'how one claim compares with another (derived; no value)',
}
export type Measure = keyof typeof MEASURES

// One figure in a check result: its id (`C7:exposure`), measure, unit, exact decimal value and scope.
export type Fact = {
  id: string
  measure: Measure
  unit: Unit
  exact: string
  portfolio?: string
  period?: string
  from_period?: string
  instrument?: string
  asset_class?: string
  rule?: { id: string; version: string }
}

// A check as the evidence functions need it: id, arguments and result.
type CheckLike = { id: string; args: CheckArgs; result: Record<string, unknown> }

// Narrowing for check results, which are stored as open JSON: an object, a list of objects, a string.
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const recs = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(rec) : [])
const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

// The metric each check compares with the rules, which decides the unit of a rule's limit.
const metricOf = (a: CheckArgs) =>
  a.check === 'lookthrough_exposure' ? `${a.asset_class}_exposure` : a.check === 'holding_concentration' ? 'single_holding_weight' : a.check === 'relative_performance' ? 'relative_return_deviation' : ''
/** A rule's limit is a fraction, except for a deviation between two returns, which is a difference in pp. */
export const limitUnit = (metric: string): Unit => (metric === 'relative_return_deviation' ? 'points' : 'fraction')

/**
 * Every figure in a check result as a typed fact. Per-holding figures are keyed by instrument id; each rule
 * compared gives its limit and, by status, how far beyond or within it the value is. Only figures with an exact
 * value become facts, so a fee missing at one period gives no change fact.
 */
export function factsOf(c: CheckLike): Fact[] {
  const r = c.result
  const scope = { portfolio: c.args.portfolio_id, period: text(r.period_end) ?? c.args.period_end }
  const out: Fact[] = []
  const add = (key: string, measure: Measure, unit: Unit, exact: unknown, more: Partial<Fact> = {}) => {
    if (typeof exact === 'string' && isDec(exact)) out.push({ id: `${c.id}:${key}`, measure, unit, exact, ...scope, ...more })
  }
  switch (c.args.check) {
    case 'weight_reconciliation':
      add('total_market_value', 'total_market_value', 'gbp', r.total_market_value_gbp)
      add('reported_weight_sum', 'reported_weight_sum', 'fraction', r.reported_weight_sum)
      add('max_abs_difference', 'weight_difference', 'points', r.max_abs_difference)
      for (const h of recs(r.holdings)) {
        const instrument = text(h.instrument_id)
        add(`${instrument}:computed_weight`, 'holding_weight', 'fraction', h.computed_weight, { instrument })
        add(`${instrument}:reported_weight`, 'reported_weight', 'fraction', h.reported_weight, { instrument })
      }
      break
    case 'lookthrough_exposure': {
      const asset_class = c.args.asset_class
      add('exposure', 'exposure', 'fraction', r.exposure, { asset_class })
      add('holdings_without_lookthrough', 'holdings_without_lookthrough', 'count', String(Array.isArray(r.holdings_without_lookthrough) ? r.holdings_without_lookthrough.length : ''))
      for (const h of recs(r.contributions)) {
        const instrument = text(h.instrument_id)
        add(`${instrument}:weight`, 'holding_weight', 'fraction', h.weight, { instrument })
        add(`${instrument}:fund_exposure`, 'fund_exposure', 'fraction', h.fund_exposure, { instrument, asset_class })
        add(`${instrument}:contribution`, 'exposure_contribution', 'fraction', h.contribution, { instrument, asset_class })
      }
      break
    }
    case 'holding_concentration': {
      const largest = rec(r.largest)
      add('largest_weight', 'largest_holding_weight', 'fraction', largest.weight, { instrument: text(largest.instrument_id) })
      for (const h of recs(r.holdings)) add(`${text(h.instrument_id)}:weight`, 'holding_weight', 'fraction', h.weight, { instrument: text(h.instrument_id) })
      break
    }
    case 'relative_performance':
      add('portfolio_return', 'portfolio_return', 'fraction', r.portfolio_return)
      add('benchmark_return', 'benchmark_return', 'fraction', r.benchmark_return)
      add('return_difference', 'return_difference', 'points', r.difference)
      add('return_deviation', 'return_deviation', 'points', r.absolute_difference)
      break
    case 'fee_change': {
      const from = text(r.from_period)
      const to = text(r.to_period)
      for (const f of recs(r.funds)) {
        const instrument = text(f.instrument_id)
        add(`${instrument}:charge_from`, 'ongoing_charge', 'fraction', f.from, { instrument, period: from })
        add(`${instrument}:charge_to`, 'ongoing_charge', 'fraction', f.to, { instrument, period: to })
        add(`${instrument}:charge_change`, 'charge_change', 'points', f.change, { instrument, period: to, from_period: from })
      }
      break
    }
  }
  // Each rule compared: its limit, then the distance beyond it (a breach) or within it, as a positive figure in pp.
  for (const x of recs(r.comparisons)) {
    const rule = { id: String(x.rule_id), version: String(x.version) }
    const margin = text(x.margin)
    add(`rule:${rule.id}:limit`, 'policy_limit', limitUnit(metricOf(c.args)), x.threshold, { rule })
    if (margin && isDec(margin)) {
      const breach = x.status === 'breach'
      add(`rule:${rule.id}:${breach ? 'breach' : 'headroom'}`, breach ? 'limit_breach' : 'limit_headroom', 'points', fmt(abs(dec(margin)), 4), { rule })
    }
  }
  return out
}

// ---- Figures as written: in a claim's value, a quote, or the finding's text ----

// A figure as written: its value in its unit, the decimals it was stated to (in the unit shown), and whether it
// carried a sign. `bare` is a number with no unit, which matches any unit by its raw digits.
export type Figure = { text: string; exact: Dec; unit: Unit | 'bare'; places: number; signed: boolean }

// A number with an optional sign (including the Unicode minus) and £, then an optional unit. The look-behind keeps
// out digits glued to a word or an identifier (C7, s2.4, §2.4, 2026-09-30, A-2026-07-04).
const FIGURE = /(?<![\w.§/-])([+\-−]?)\s?(£\s?)?(\d[\d,]*(?:\.\d+)?)(\s?(?:%|pp\b|percentage points?\b|bps\b|bp\b|basis points?\b))?/gi
// Words that make a bare decimal a reference rather than a figure: clause 2.4, section 4.2, policy 2.4, version 1.1.
const REFERENCE = /(?:clause|section|para(?:graph)?|policy|rule|version|v|s|§)\s*$/i

/** Parses one figure: 36.97%, -1.97pp, 2 bps, £1,000,000.00, 16 or 0.3697. Undefined if it isn't one. */
export function parseFigure(s: string): Figure | undefined {
  const m = new RegExp(`^${FIGURE.source}$`, 'i').exec(s.trim())
  return m ? toFigure(m) : undefined
}

/** A matched figure as a value: % and pp divide by 100, bps by 10,000; £ is an amount; a plain integer a count. */
function toFigure(m: RegExpExecArray): Figure | undefined {
  const [whole, sign, pound, digits, rawUnit] = m
  const raw = digits.replaceAll(',', '')
  if (!isDec(raw)) return undefined
  const places = (raw.split('.')[1] ?? '').length
  const negative = sign === '-' || sign === '−'
  const unitText = (rawUnit ?? '').trim().toLowerCase()
  const value = dec(raw) * (negative ? -1n : 1n)
  const [unit, exact]: [Figure['unit'], Dec] = pound
    ? ['gbp', value]
    : unitText === '%'
      ? ['fraction', div(value, dec('100'))]
      : unitText.startsWith('pp') || unitText.startsWith('percentage')
        ? ['points', div(value, dec('100'))]
        : unitText.startsWith('bp') || unitText.startsWith('basis')
          ? ['points', div(value, dec('10000'))]
          : places
            ? ['bare', value]
            : ['count', value]
  return { text: whole.trim(), exact, unit, places, signed: !!sign }
}

/**
 * The material figures in a finding's text: anything with %, pp, bps or £, and any bare decimal with two or more
 * places (0.3697) that isn't a clause, section or version reference. A bare number with one place (2.4) reads as a
 * reference far more often than a figure. Dates, identifiers and plain integers (counts, years) are left out.
 */
export function proseFigures(s: string): Figure[] {
  return [...s.matchAll(FIGURE)].flatMap((m) => {
    const f = toFigure(m)
    if (!f || f.unit === 'count') return []
    if (f.unit === 'bare' && (f.places < 2 || REFERENCE.test(s.slice(Math.max(0, m.index - 12), m.index)))) return []
    return [f]
  })
}

// How a figure is written in a unit: a fraction or pp scaled by 100 for display, bps by 10,000.
const scaled = (x: Dec, unit: Figure['unit'], stated: Figure['unit']) => (stated === 'bare' || unit === 'gbp' || unit === 'count' ? x : x * 100n)
/**
 * Whether a stated figure equals an exact value at the precision stated. Units must agree (a bare decimal matches
 * any); `ignoreSign` lets an unsigned figure in prose ("exceeded by 1.97pp") match a negative value.
 */
export function sameFigure(stated: Figure, exact: Dec, unit: Unit, ignoreSign = false): boolean {
  if (stated.unit !== 'bare' && stated.unit !== unit) return false
  const bps = /bp|basis/i.test(stated.text)
  const value = bps ? exact * 10000n : scaled(exact, unit, stated.unit)
  const want = bps ? stated.exact * 10000n : scaled(stated.exact, unit, stated.unit)
  const [a, b] = ignoreSign && !stated.signed ? [abs(value), abs(want)] : [value, want]
  return fmt(a, stated.places) === fmt(b, stated.places)
}

/** An exact value as a reader sees it: 36.97%, -1.97pp, £1,000.00 or 3. */
export function show(exact: string | Dec, unit: Unit): string {
  const x = typeof exact === 'string' ? dec(exact) : exact
  return unit === 'fraction' ? `${fmt(x * 100n, 2)}%` : unit === 'points' ? `${fmt(x * 100n, 2)}pp` : unit === 'gbp' ? `£${fmt(x, 2)}` : fmt(x, 0)
}

/** The facts of a check, as run_check returns them to the agent: id, value with its unit, measure and detail. */
export function factIndex(facts: Fact[]): Record<string, string> {
  return Object.fromEntries(facts.map((f) => [f.id, [show(f.exact, f.unit), f.measure, f.asset_class, f.instrument, f.rule && `${f.rule.id} v${f.rule.version}`].filter(Boolean).join(' ')]))
}

// ---- Claims, coverage and the validation of a finding ----

// Where a claim's figure comes from: one of a fact, a structured rule version, a quote from a committee action row
// or a policy document section, or a calculation on two other claims of the same finding, named by their keys.
export type Relation = 'above' | 'below' | 'at_or_above' | 'at_or_below' | 'equal'
export type ClaimSource = {
  fact?: string
  rule?: string
  version?: string
  quote?: string
  row?: string
  section?: string
  derived?: 'difference' | 'relative_change' | 'comparison'
  of?: string[]
  relation?: Relation
}
// One figure a finding relies on: a key other claims can refer to, its label and value as the reader sees them,
// what it measures, the scope it applies to, and its source. The scope defaults to the finding's.
export type Claim = { key: string; label: string; value?: string; measure: string; portfolio?: string; period?: string; instrument?: string; asset_class?: string; source: ClaimSource }
// A statement about a whole population, and the checks that cover it: weights reconcile, look-through data is
// complete, charges are unchanged, or limits are met, for the portfolios named, at a period, with exceptions.
export const COVERAGE = {
  weights_reconcile: 'every holding’s reported weight equals its weight computed from market values (internal consistency of the sources, not an independent check of them); cite weight_reconciliation checks',
  lookthrough_complete: 'every holding has look-through data (completeness of the look-through source); cite lookthrough_exposure checks',
  charges_unchanged: 'every fund held has an unchanged ongoing charge, apart from the instrument ids in except; cite fee_change checks',
  limits_met: 'every structured rule in force for the portfolios is met, apart from the rule ids in except; cite the checks that compare them',
}
export type CoverageClaim = { kind: keyof typeof COVERAGE; portfolios: string[]; period?: string; except?: string[]; checks: string[] }

// How each claim was checked. basis says what kind of evidence it rests on; a source_text claim is an extract a
// person should read in context, not a structured rule. evidence names it; scope is what it applies to.
export type ClaimResult = { key: string; label: string; value: string | null; measure: string; basis: 'calculation' | 'policy_rule' | 'source_text' | 'derived'; ok: boolean; reason?: string; evidence?: string; exact?: string; unit?: Unit; scope?: string }
export type CoverageResult = { kind: string; portfolios: string[]; period: string; checks: string[]; ok: boolean; missing: string[]; reason?: string }
// The outcome stored with a finding. validated only when every claim and coverage claim checked out, every figure
// in the text is one of the verified claims, and every statement about a whole population has a verified coverage
// claim. matched and unmatched summarise it in one line per item, as older findings stored it.
export type Validation = {
  state: 'validated' | 'unvalidated'
  matched: string[]
  unmatched: string[]
  claims?: ClaimResult[]
  coverage?: CoverageResult[]
  unclaimed_figures?: string[]
  unsupported_scope?: string[]
}

// A finding proposed to replace another: accepted when it became current, or not, with why.
export type Revision = { of: string; accepted: boolean; reason?: string }
/**
 * Whether a finding is current: neither revised by a later finding nor a revision that was not accepted. Takes a
 * finding as the run holds it (revision at the top) or as stored (revision inside its content).
 */
export const isCurrent = (f: { superseded_by?: string | null; revision?: Revision; content?: { revision?: Revision } }) =>
  !f.superseded_by && (f.revision ?? f.content?.revision)?.accepted !== false

// What validation needs from the run and the finding.
type Context = { review: Review; checks: CheckLike[] }
type FindingText = { portfolios: string[]; period_end?: string; statement: string; explanation: string; claims?: Claim[]; coverage?: CoverageClaim[] }

// Wording that makes a statement about a whole population: all portfolios, every holding, no other fund, full coverage.
const UNIVERSAL = /\b(?:all|every|none of the|no other)\b(?:\s+[\w-]+){0,3}?\s+(?:portfolios?|holdings?|funds?|fees?|charges?|limits?|rules?|positions?)\b|\b(?:full|complete)\s+(?:look-?through\s+)?coverage\b/gi
// A quote and the text it is checked against compare with whitespace collapsed and the Unicode minus as a hyphen.
const plain = (s: string) => s.replace(/−/g, '-').replace(/\s+/g, ' ').trim()
const rows = (review: Review, id: string): Row[] => review.sources.find((s) => s.id === id)?.rows ?? []

/**
 * Checks a finding's claims, coverage claims and text against the run's evidence (spec §6.4). Never throws for a
 * claim that fails: every failure is recorded with its reason, so the finding is kept and the agent told what to fix.
 */
export function validateFinding(ctx: Context, a: FindingText): Validation {
  const period = a.period_end ?? ctx.review.periodEnd
  const facts = new Map(ctx.checks.flatMap((c) => factsOf(c)).map((f) => [f.id, f]))
  const claims = a.claims ?? []
  const results: ClaimResult[] = []
  const exactOf = new Map<string, { exact: Dec; unit: Unit }>()

  // Claims resting on evidence first, then derived ones, which need their inputs' verified values.
  const order = [...claims.filter((c) => !c.source?.derived), ...claims.filter((c) => c.source?.derived)]
  for (const c of order) {
    const r = checkClaim(c, ctx, facts, exactOf, a.portfolios, period, claims)
    if (r.ok && r.exact !== undefined && r.unit) exactOf.set(c.key, { exact: dec(r.exact), unit: r.unit })
    results.push(r)
  }
  const keys = claims.map((c) => c.key)
  const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i)
  for (const r of results) if (duplicates.includes(r.key)) Object.assign(r, { ok: false, reason: `key "${r.key}" is used by more than one claim` })

  const coverage = (a.coverage ?? []).map((c) => checkCoverage(c, ctx, period))

  // Every material figure in the text must be one of the verified claims' values, at the precision written.
  const verified = [...exactOf.values()]
  const prose = `${a.statement}\n${a.explanation}`
  const unclaimed = proseFigures(prose)
    .filter((f) => !verified.some((v) => sameFigure(f, v.exact, v.unit, true)))
    .map((f) => f.text)
  // Every statement about a whole population needs a verified coverage claim.
  const universal = [...prose.matchAll(UNIVERSAL)].map((m) => m[0])
  const unsupported = coverage.some((c) => c.ok) ? [] : [...new Set(universal)]

  const state = (results.length || coverage.length) && results.every((r) => r.ok) && coverage.every((c) => c.ok) && !unclaimed.length && !unsupported.length ? 'validated' : 'unvalidated'
  return {
    state,
    matched: [...results.filter((r) => r.ok).map((r) => `${r.label}: ${r.value ?? r.measure} (${r.evidence})`), ...coverage.filter((c) => c.ok).map((c) => `${c.kind} for ${c.portfolios.join(', ')} (${c.checks.join(', ')})`)],
    unmatched: [
      ...results.filter((r) => !r.ok).map((r) => `${r.label}: ${r.reason}`),
      ...coverage.filter((c) => !c.ok).map((c) => `${c.kind} for ${c.portfolios.join(', ')}: ${c.reason ?? `not covered: ${c.missing.join('; ')}`}`),
      ...unclaimed.map((f) => `${f} appears in the text but is not a verified claim`),
      ...unsupported.map((p) => `"${p}" states something about a whole population without a verified coverage claim`),
    ],
    claims: results,
    coverage,
    unclaimed_figures: unclaimed,
    unsupported_scope: unsupported,
  }
}

/** Checks one claim: its source resolves, means what the claim says, applies to its scope, and has its value. */
function checkClaim(c: Claim, ctx: Context, facts: Map<string, Fact>, exactOf: Map<string, { exact: Dec; unit: Unit }>, portfolios: string[], period: string, all: Claim[]): ClaimResult {
  const s = c.source ?? {}
  const kinds = (['fact', 'rule', 'quote', 'derived'] as const).filter((k) => s[k] !== undefined)
  const base = { key: c.key, label: c.label, value: c.value ?? null, measure: c.measure }
  const fail = (basis: ClaimResult['basis'], reason: string): ClaimResult => ({ ...base, basis, ok: false, reason })
  if (kinds.length !== 1) return fail('calculation', 'give exactly one source: fact, rule (with version), quote (with row or section) or derived (with of)')
  if (!(c.measure in MEASURES)) return fail('calculation', `unknown measure "${c.measure}"; use one of ${Object.keys(MEASURES).join(', ')}`)
  const claimPeriod = c.period ?? period

  // Resolve the source to an exact value, a unit, the evidence's name and its scope, or say why it can't.
  let basis: ClaimResult['basis']
  let exact: Dec
  let unit: Unit
  let evidence: string
  let scope = ''
  if (s.fact !== undefined) {
    basis = 'calculation'
    const f = facts.get(s.fact)
    if (!f) {
      const check = s.fact.split(':')[0]
      const known = [...facts.keys()].filter((k) => k.startsWith(`${check}:`))
      return fail(basis, known.length ? `no fact ${s.fact}; ${check} has ${known.slice(0, 12).join(', ')}${known.length > 12 ? ', …' : ''}` : `no check ${check} in this run`)
    }
    // The fact must mean what the claim says, for the scope the claim states (or the finding's).
    if (f.measure !== c.measure) return fail(basis, `${f.id} is ${f.measure} (${MEASURES[f.measure]}), not ${c.measure}`)
    if (f.portfolio && (c.portfolio ? c.portfolio !== f.portfolio : !portfolios.includes(f.portfolio))) return fail(basis, `${f.id} is for ${f.portfolio}, not ${c.portfolio ?? portfolios.join(', ')}`)
    if (f.period && f.period !== claimPeriod) return fail(basis, `${f.id} is at ${f.period}, not ${claimPeriod}; give the claim's period if it is another date`)
    if (f.instrument && c.instrument !== f.instrument) return fail(basis, `${f.id} is for instrument ${f.instrument}; name it in the claim's instrument`)
    if (f.asset_class && c.asset_class !== f.asset_class) return fail(basis, `${f.id} is for ${f.asset_class}; name it in the claim's asset_class`)
    ;[exact, unit, evidence] = [dec(f.exact), f.unit, f.id]
    scope = [f.portfolio, f.instrument, f.asset_class, f.rule && `${f.rule.id} v${f.rule.version}`, f.from_period ? `${f.from_period} to ${f.period}` : f.period].filter(Boolean).join(', ')
  } else if (s.rule !== undefined) {
    // A structured rule version: the authoritative source for a numerical limit, if in force and applicable.
    basis = 'policy_rule'
    const rule = rows(ctx.review, 'policy_rules').find((r) => r.rule_id === s.rule && r.version === s.version)
    if (!rule) return fail(basis, `no rule ${s.rule} version ${s.version}`)
    if (c.measure !== 'policy_limit') return fail(basis, `a rule gives a policy_limit, not ${c.measure}`)
    if (rule.effective_from > claimPeriod || (rule.effective_to && rule.effective_to < claimPeriod)) {
      const current = rows(ctx.review, 'policy_rules').find((r) => r.rule_id === s.rule && r.effective_from <= claimPeriod && (!r.effective_to || r.effective_to >= claimPeriod))
      return fail(basis, `${s.rule} version ${s.version} is not in force at ${claimPeriod}${current ? `; version ${current.version} is` : ''}`)
    }
    const applies = rule.portfolio_id === 'ALL' || (c.portfolio ? c.portfolio === rule.portfolio_id : portfolios.includes(rule.portfolio_id))
    if (!applies) return fail(basis, `${s.rule} applies to ${rule.portfolio_id}, not ${c.portfolio ?? portfolios.join(', ')}`)
    ;[exact, unit, evidence] = [dec(rule.threshold), limitUnit(rule.metric), `rule ${rule.rule_id} v${rule.version}`]
    scope = `${rule.portfolio_id}, ${rule.metric} ${rule.limit_type}, clause ${rule.document_clause}`
  } else if (s.quote !== undefined) {
    // A figure quoted from a committee action or a policy document section: checked word for word, but it remains
    // an extract from text, which a person reads in context. A numerical limit is never taken from a quote.
    basis = 'source_text'
    if (c.measure === 'policy_limit') return fail(basis, 'numerical limits come from the structured rules (give rule and version); quote the document as a document_figure, and report any disagreement as a policy_inconsistency')
    const where = s.row ? rows(ctx.review, s.row.split(':')[0]).find((r) => r.row_id === s.row) : undefined
    const section = s.section ? ctx.review.sources.find((x) => x.id === 'policy_document')?.sections?.find((x) => x.id === s.section) : undefined
    if (c.measure === 'action_threshold' && (!s.row?.startsWith('committee_actions:') || !where)) return fail(basis, `an action_threshold quotes a committee_actions row; ${s.row ?? 'no row'} is not one`)
    if (c.measure === 'document_figure' && !section) return fail(basis, `a document_figure quotes a policy document section; no section "${s.section ?? ''}"`)
    if (c.measure !== 'action_threshold' && c.measure !== 'document_figure') return fail(basis, `a quote gives an action_threshold or a document_figure, not ${c.measure}`)
    const source = where ? `${where.action} ${where.notes ?? ''}` : (section?.text ?? '')
    if (!plain(source).includes(plain(s.quote))) return fail(basis, `the quote "${s.quote}" is not in ${s.row ?? `section ${s.section}`}`)
    const figures = proseFigures(s.quote)
    if (figures.length !== 1 || figures[0].unit === 'bare') return fail(basis, 'quote exactly one figure with its unit, as the source writes it')
    ;[exact, unit] = [figures[0].exact, figures[0].unit as Unit]
    evidence = where ? `quoted from ${where.action_id ?? s.row}` : `quoted from policy section ${s.section}`
    scope = 'an extract from source text, not a structured rule'
  } else {
    // A calculation on two verified claims of this finding, in decimal arithmetic.
    basis = 'derived'
    const [x, y] = (s.of ?? []).map((k) => exactOf.get(k))
    if ((s.of ?? []).length !== 2) return fail(basis, 'a derived claim names exactly two other claims in of')
    const missing = (s.of ?? []).filter((k) => !exactOf.has(k))
    if (missing.length) return fail(basis, `${missing.join(', ')} ${all.some((c2) => missing.includes(c2.key)) ? 'did not check out' : 'is not a claim of this finding'}`)
    if (x!.unit !== y!.unit) return fail(basis, `${s.of![0]} is in ${x!.unit} and ${s.of![1]} in ${y!.unit}; compare like with like`)
    const want = { difference: 'change', relative_change: 'relative_change', comparison: 'comparison' }[s.derived!]
    if (c.measure !== want) return fail(basis, `a ${s.derived} claim has measure ${want}`)
    // The inputs are named by their labels, as the reader sees them.
    const [nx, ny] = s.of!.map((k) => all.find((c2) => c2.key === k)?.label ?? k)
    evidence = `${s.derived!.replaceAll('_', ' ')} of ${nx} and ${ny}`
    if (s.derived === 'comparison') {
      const d = x!.exact - y!.exact
      const holds = { above: d > 0n, below: d < 0n, at_or_above: d >= 0n, at_or_below: d <= 0n, equal: d === 0n }[s.relation ?? 'equal']
      if (s.relation === undefined) return fail(basis, 'a comparison needs a relation: above, below, at_or_above, at_or_below or equal')
      if (!holds) return fail(basis, `${nx} (${show(x!.exact, x!.unit)}) is not ${s.relation.replaceAll('_', ' ')} ${ny} (${show(y!.exact, y!.unit)})`)
      return { ...base, basis, ok: true, evidence: `calculated: ${nx} ${show(x!.exact, x!.unit)} is ${s.relation.replaceAll('_', ' ')} ${ny} ${show(y!.exact, y!.unit)}` }
    }
    if (s.derived === 'relative_change' && y!.exact === 0n) return fail(basis, `${s.of![1]} is zero`)
    ;[exact, unit] = s.derived === 'difference' ? [x!.exact - y!.exact, x!.unit === 'fraction' ? 'points' : x!.unit] : [div(x!.exact - y!.exact, y!.exact), 'fraction']
  }

  // The stated value must be the evidence's, in the same unit, at the precision stated.
  const stated = c.value === undefined ? undefined : parseFigure(c.value)
  const alsoPoints = c.measure === 'exposure_contribution' && unit === 'fraction' && stated?.unit === 'points' // a contribution reads either way
  if (!stated) return fail(basis, `value "${c.value ?? ''}" is not a figure; write it with its unit, e.g. ${show(exact, unit)}`)
  if (stated.unit !== unit && !alsoPoints) return fail(basis, `${evidence} is in ${unit === 'points' ? 'percentage points (pp)' : unit === 'fraction' ? 'percent (%)' : unit}: write ${show(exact, unit)}, not ${c.value}`)
  if (!sameFigure(stated, exact, alsoPoints ? 'points' : unit)) return fail(basis, `${evidence} is ${show(exact, unit)}, not ${c.value}`)
  return { ...base, basis, ok: true, evidence, exact: fmt(exact, 12), unit, scope }
}

/**
 * Checks a coverage claim: computes the population from the sources (holdings held at the period, rules in force)
 * and requires a cited check result to cover each member. Python executions are not accepted: a total or a sum
 * across what exists says nothing about what is missing.
 */
function checkCoverage(c: CoverageClaim, ctx: Context, period: string): CoverageResult {
  const at = c.period ?? period
  const out = { kind: c.kind, portfolios: c.portfolios ?? [], period: at, checks: c.checks ?? [] }
  const fail = (reason: string): CoverageResult => ({ ...out, ok: false, missing: [], reason })
  if (!(c.kind in COVERAGE)) return fail(`unknown kind; use one of ${Object.keys(COVERAGE).join(', ')}`)
  if (!out.portfolios.length) return fail('name the portfolios the claim covers')
  const unknown = out.portfolios.filter((p) => !rows(ctx.review, 'portfolios').some((r) => r.portfolio_id === p))
  if (unknown.length) return fail(`unknown portfolios: ${unknown.join(', ')}`)
  const notChecks = out.checks.filter((id) => !ctx.checks.some((x) => x.id === id))
  if (notChecks.length) return fail(`${notChecks.join(', ')} ${notChecks.some((x) => x.startsWith('X')) ? 'are Python executions or unknown ids; coverage needs run_check results' : 'are not checks of this run'}`)
  const cited = ctx.checks.filter((x) => out.checks.includes(x.id))
  const periodOf = (x: CheckLike) => text(x.result.period_end) ?? text(x.result.to_period)
  const held = (p: string) => rows(ctx.review, 'positions').filter((r) => r.portfolio_id === p && r.period_end === at)
  const missing: string[] = []

  for (const p of out.portfolios) {
    const mine = cited.filter((x) => x.args.portfolio_id === p && periodOf(x) === at)
    if (c.kind === 'weights_reconcile') {
      const x = mine.find((y) => y.args.check === 'weight_reconciliation')
      const gap = x && text(x.result.max_abs_difference)
      if (!x || !gap) missing.push(`${p}: no weight_reconciliation check at ${at}`)
      else if (dec(gap) !== 0n) missing.push(`${p}: reported and computed weights differ by up to ${show(gap, 'points')}`)
    }
    if (c.kind === 'lookthrough_complete') {
      const xs = mine.filter((y) => y.args.check === 'lookthrough_exposure')
      if (!xs.length) missing.push(`${p}: no lookthrough_exposure check at ${at}`)
      // A holding is covered when some cited check found look-through data for it.
      else for (const h of held(p)) if (xs.every((x) => (x.result.holdings_without_lookthrough as unknown[] | undefined)?.includes(h.instrument_id))) missing.push(`${p}: ${h.instrument_id} (${h.instrument_name}) has no look-through data at ${at}`)
    }
    if (c.kind === 'charges_unchanged') {
      for (const h of held(p)) {
        if (c.except?.includes(h.instrument_id)) continue
        const line = cited.filter((x) => x.args.check === 'fee_change' && text(x.result.to_period) === at).flatMap((x) => recs(x.result.funds)).find((f) => f.instrument_id === h.instrument_id)
        if (!line) missing.push(`${p}: ${h.instrument_id} (${h.instrument_name}) is in no cited fee_change check`)
        else if (typeof line.change !== 'string' || dec(line.change) !== 0n) missing.push(`${p}: ${h.instrument_id} (${h.instrument_name}) charge ${typeof line.change === 'string' ? `changed by ${show(line.change, 'points')}` : 'missing at a period'}`)
      }
    }
    if (c.kind === 'limits_met') {
      const inForce = rows(ctx.review, 'policy_rules').filter((r) => (r.portfolio_id === p || r.portfolio_id === 'ALL') && r.effective_from <= at && (!r.effective_to || r.effective_to >= at) && !c.except?.includes(r.rule_id))
      for (const r of inForce) {
        const x = mine.flatMap((y) => recs(y.result.comparisons)).find((k) => k.rule_id === r.rule_id && k.version === r.version)
        if (!x) missing.push(`${p}: ${r.rule_id} v${r.version} is compared in no cited check`)
        else if (x.status !== 'within') missing.push(`${p}: ${r.rule_id} v${r.version} is breached`)
      }
    }
  }
  return { ...out, ok: !missing.length, missing }
}
