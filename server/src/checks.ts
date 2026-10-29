// Trusted deterministic calculations (spec §8.2 run_check, §9.6). Decimal arithmetic only; weights are
// computed from market values, rules are the structured table's versions in force at the period end. A check never
// turns a missing, invalid, duplicated or unrecognised input into a value (§6.2, §7.5): the figures that depend on
// it are null, the input is listed under unresolved with its rows, and no rule is compared on it.
import { abs, dec, div, fmt, isDec, mul, ONE, sum, type Dec } from './decimal.ts'
import { ASSET_CLASSES, assetClass, inForce, metricCheck, ruleProblem, type Review, type Row } from './sources.ts'

export type CheckArgs = { check: string; portfolio_id: string; period_end?: string; asset_class?: string; from_period?: string; to_period?: string }
// One rule compared with a computed value. margin is the room left before the limit; negative means a breach.
export type Comparison = { rule_id: string; version: string; limit_type: string; threshold: string; value: string; status: 'within' | 'breach'; margin: string; document_clause: string }
// An input a check could not use, why, and the source rows behind it; instrument_id when it concerns one holding.
export type Unresolved = { reason: string; rows: string[]; instrument_id?: string }
// A rule in force for the check's metric that was not compared, and why: an input was unresolved, or the rule is invalid.
export type NotCompared = { rule_id: string; version: string; reason: string }

// The checks run_check offers: each one's arguments and what it returns. The agent reads these texts.
export const CHECK_CATALOGUE: Record<string, string> = {
  weight_reconciliation: 'portfolio_id, period_end: total market value, each holding\'s computed weight against its reported weight, and the sum of reported weights.',
  lookthrough_exposure: `portfolio_id, period_end, asset_class (one of ${ASSET_CLASSES.join(', ')}): look-through exposure to the asset class, each holding's contribution, coverage, and comparison with the applicable rules for that exposure. A fund whose look-through rows at the date are complete (every label in the taxonomy, each class once, exposures summing to 1) and have no row for the class has none. If any holding has no look-through data, or incomplete data, the exposure is unknown, so none is given and no rule is compared.`,
  holding_concentration: 'portfolio_id, period_end: holdings by computed weight, the largest, and comparison with the single-holding rule in force at the period end.',
  relative_performance: 'portfolio_id, period_end: portfolio and benchmark return for the period ending period_end, their difference, and comparison with the applicable tolerance rule.',
  fee_change: 'portfolio_id, from_period, to_period: ongoing charge of each fund held at to_period, at both periods, and the change.',
}

// The rows of one source by id, or none.
const rowsOf = (review: Review, id: string): Row[] => review.sources.find((s) => s.id === id)?.rows ?? []
// Figures leave a check as decimal strings to 4 places.
const f4 = (x: Dec) => fmt(x, 4)
// What a result adds when inputs were unresolved or rules not compared; nothing when all was used, so a result on
// clean data is the same as before these fields existed.
const gaps = (unresolved: Unresolved[], notCompared: NotCompared[] = []) => ({ ...(unresolved.length ? { unresolved } : {}), ...(notCompared.length ? { not_compared: notCompared } : {}) })
// Rows of a list that repeat an earlier row's key.
const repeats = (rows: Row[], key: (r: Row) => string) => rows.filter((r, i) => rows.findIndex((x) => key(x) === key(r)) !== i)

/**
 * A portfolio's positions at a period, each with its weight computed from market values. Throws if there are none.
 * A market value that isn't a non-negative amount, a zero total, or a fund listed twice makes the total and so every
 * weight unknown: the weights are then undefined and the rows are listed as unresolved.
 */
function holdings(review: Review, portfolio: string, period: string) {
  const rows = rowsOf(review, 'positions').filter((r) => r.portfolio_id === portfolio && r.period_end === period)
  if (!rows.length) throw new Error(`no positions for ${portfolio} at ${period}`)
  const bad = rows.filter((r) => !isDec(r.market_value_gbp) || dec(r.market_value_gbp) < 0n)
  const twice = repeats(rows, (r) => r.instrument_id)
  const unresolved: Unresolved[] = []
  if (bad.length) unresolved.push({ reason: `market_value_gbp is not a valid amount in ${bad.map((r) => `${r.row_id} ("${r.market_value_gbp}")`).join(', ')}, so the total and every weight in ${portfolio} at ${period} are unknown`, rows: bad.map((r) => r.row_id) })
  if (twice.length) unresolved.push({ reason: `${twice.map((r) => r.instrument_id).join(', ')} is listed more than once in ${portfolio} at ${period}, so the total and every weight are unknown`, rows: rows.filter((r) => twice.some((t) => t.instrument_id === r.instrument_id)).map((r) => r.row_id) })
  const total = unresolved.length ? undefined : sum(rows.map((r) => dec(r.market_value_gbp)))
  if (total === 0n) unresolved.push({ reason: `the total market value of ${portfolio} at ${period} is zero, so no weight can be computed`, rows: rows.map((r) => r.row_id) })
  const known = unresolved.length ? undefined : total
  return { total: known, unresolved, rows: rows.map((r) => ({ row: r, weight: known === undefined ? undefined : div(dec(r.market_value_gbp), known) })) }
}

/**
 * Why a fund's look-through rows at one date can't establish its exposures, or undefined when they can: every label
 * in the taxonomy, every exposure a decimal, each class once, and the exposures summing to 1 (within 0.001, as import
 * validation allows). Only then is a class with no row a genuine nil rather than one written another way or missing.
 */
function lookthroughProblem(rows: Row[]): string | undefined {
  const labels = rows.filter((x) => !assetClass(x.asset_class)).map((x) => `"${x.asset_class}"`)
  if (labels.length) return `asset class ${labels.join(', ')} is not one of ${ASSET_CLASSES.join(', ')}`
  const bad = rows.filter((x) => !isDec(x.exposure_weight))
  if (bad.length) return `exposure_weight ${bad.map((x) => `"${x.exposure_weight}"`).join(', ')} is not a decimal`
  const twice = repeats(rows, (x) => x.asset_class)
  if (twice.length) return `asset class ${twice.map((x) => x.asset_class).join(', ')} appears more than once`
  const total = sum(rows.map((x) => dec(x.exposure_weight)))
  if (abs(total - ONE) > dec('0.0010')) return `the exposures sum to ${f4(total)}, not 1, so a class with no row is not shown to be nil`
  return undefined
}

/**
 * Compares a value with every rule for the metric in force for the portfolio (or ALL) at the period. The margin
 * is threshold minus value for a max and value minus threshold for a min, so a negative margin is a breach. With no
 * value (an unresolved input, said in `blocked`) or an invalid rule, the rule is listed as not compared instead.
 * Returns the comparisons, the rules not compared and the rule rows considered.
 */
function compareRules(review: Review, portfolio: string, period: string, metric: string, value: Dec | undefined, blocked: string) {
  const rules = rowsOf(review, 'policy_rules').filter((r) => r.metric === metric && (r.portfolio_id === portfolio || r.portfolio_id === 'ALL') && inForce(r, period))
  const comparisons: Comparison[] = []
  const notCompared: NotCompared[] = []
  for (const r of rules) {
    const problem = ruleProblem(r)
    if (problem || value === undefined) {
      notCompared.push({ rule_id: r.rule_id, version: r.version, reason: problem ? `the rule can't be evaluated: ${problem}` : blocked })
      continue
    }
    const margin = r.limit_type === 'max' ? dec(r.threshold) - value : value - dec(r.threshold)
    comparisons.push({ rule_id: r.rule_id, version: r.version, limit_type: r.limit_type, threshold: r.threshold, value: f4(value), status: margin < 0n ? 'breach' : 'within', margin: f4(margin), document_clause: r.document_clause })
  }
  return { comparisons, notCompared, ruleRows: rules.map((r) => r.row_id) }
}

/**
 * Runs one catalogue check for a portfolio, at the period given or the review's period end. Returns the result
 * and every source row it depends on, the rules compared included. Throws Error with a message for the agent on bad
 * input (an unknown check or asset class, no positions); a problem in the data is reported in the result instead.
 */
export function runCheck(review: Review, a: CheckArgs): { result: Record<string, unknown>; rowsUsed: string[] } {
  if (!CHECK_CATALOGUE[a.check]) throw new Error(`unknown check "${a.check}"; available: ${Object.keys(CHECK_CATALOGUE).join(', ')}`)
  const period = a.period_end ?? review.periodEnd
  switch (a.check) {
    // Each holding's weight from market values against its reported weight, and the sum of reported weights. A
    // reported weight that isn't a decimal leaves its difference, the sum and the largest difference unknown.
    case 'weight_reconciliation': {
      const h = holdings(review, a.portfolio_id, period)
      const badWeights = h.rows.filter((x) => !isDec(x.row.reported_weight))
      const unresolved = [...h.unresolved, ...badWeights.map((x) => ({ reason: `reported_weight "${x.row.reported_weight}" of ${x.row.instrument_id} is not a decimal`, rows: [x.row.row_id], instrument_id: x.row.instrument_id }))]
      const differences = h.rows.map(({ row, weight }) => (weight !== undefined && isDec(row.reported_weight) ? dec(row.reported_weight) - weight : undefined))
      const lines = h.rows.map(({ row, weight }, i) => ({ row_id: row.row_id, instrument_id: row.instrument_id, instrument_name: row.instrument_name, computed_weight: weight === undefined ? null : f4(weight), reported_weight: row.reported_weight, difference: differences[i] === undefined ? null : f4(differences[i]!) }))
      const largest = differences.reduce<Dec>((m, d) => (d !== undefined && abs(d) > m ? abs(d) : m), 0n)
      return {
        result: {
          portfolio_id: a.portfolio_id,
          period_end: period,
          total_market_value_gbp: h.total === undefined ? null : fmt(h.total, 2),
          reported_weight_sum: badWeights.length ? null : f4(sum(h.rows.map((x) => dec(x.row.reported_weight)))),
          max_abs_difference: unresolved.length ? null : f4(largest),
          holdings: lines,
          ...gaps(unresolved),
        },
        rowsUsed: h.rows.map((x) => x.row.row_id),
      }
    }
    // Exposure to an asset class: the sum over holdings of weight times the fund's exposure to that class at the
    // same date. The rules compared are those for the metric `<asset class>_exposure`. A holding with no look-through
    // data at that date, or with rows that can't establish its exposures (lookthroughProblem), has an unknown
    // exposure, not zero: it is listed as missing or unresolved, and the portfolio's exposure is then not computed
    // and no rule is compared, since a sum over the rest would present part of the portfolio as the whole (§7.5).
    case 'lookthrough_exposure': {
      const cls = assetClass(a.asset_class ?? '')
      if (!cls) throw new Error(`lookthrough_exposure needs asset_class, one of ${ASSET_CLASSES.join(', ')}${a.asset_class ? `; "${a.asset_class}" is not one` : ''}`)
      const h = holdings(review, a.portfolio_id, period)
      const lt = rowsOf(review, 'lookthrough')
      const used: string[] = []
      const missing: string[] = []
      const unresolved = [...h.unresolved]
      let uncovered = 0n
      const contributions = h.rows.map(({ row, weight }) => {
        const funds = lt.filter((x) => x.instrument_id === row.instrument_id && x.as_of === period)
        used.push(row.row_id, ...funds.map((x) => x.row_id))
        const line = { row_id: row.row_id, instrument_id: row.instrument_id, instrument_name: row.instrument_name, fund_type: row.fund_type, weight: weight === undefined ? null : f4(weight) }
        const unknown = { ...line, fund_exposure: null, contribution: null, raw: undefined }
        if (!funds.length) {
          missing.push(row.instrument_id)
          uncovered += weight ?? 0n
          return unknown
        }
        const problem = lookthroughProblem(funds)
        if (problem) {
          unresolved.push({ reason: `look-through data for ${row.instrument_id} at ${period}: ${problem}`, rows: funds.map((x) => x.row_id), instrument_id: row.instrument_id })
          return unknown
        }
        const e = funds.find((x) => x.asset_class === cls)
        const exposure = e ? dec(e.exposure_weight) : 0n
        const raw = weight === undefined ? undefined : mul(weight, exposure)
        return { ...line, fund_exposure: f4(exposure), contribution: raw === undefined ? null : f4(raw), raw }
      })
      const complete = !missing.length && !unresolved.length
      const exposure = complete ? sum(contributions.map((c) => c.raw!)) : undefined
      const { comparisons, notCompared, ruleRows } = compareRules(review, a.portfolio_id, period, `${cls}_exposure`, exposure, 'the exposure is unknown (see incomplete)')
      // Why the exposure is unknown, in one sentence; the uncovered weight is given only when the weights are known.
      const reasons = [
        missing.length ? `${missing.length} holding(s)${h.total !== undefined ? `, ${f4(uncovered)} of the portfolio by weight,` : ''} have no look-through data at ${period}` : '',
        unresolved.length ? `${unresolved.length} input(s) are unresolved (see unresolved)` : '',
      ].filter(Boolean)
      return {
        result: {
          portfolio_id: a.portfolio_id,
          period_end: period,
          asset_class: cls,
          exposure: exposure === undefined ? null : f4(exposure),
          ...(reasons.length ? { incomplete: `${reasons.join('; ')}: the exposure is unknown and no rule was compared` } : {}),
          holdings_without_lookthrough: missing,
          contributions: contributions.map(({ raw, ...c }) => c),
          comparisons,
          ...gaps(unresolved, notCompared),
        },
        rowsUsed: [...used, ...ruleRows],
      }
    }
    // Holdings by computed weight, largest first; the largest is compared with the single-holding rule. Unknown
    // weights leave the order, the largest and the comparison out.
    case 'holding_concentration': {
      const h = holdings(review, a.portfolio_id, period)
      const known = !h.unresolved.length
      const sorted = known ? [...h.rows].sort((x, y) => (y.weight! > x.weight! ? 1 : y.weight! < x.weight! ? -1 : 0)) : h.rows
      const largest = known ? sorted[0] : undefined
      const { comparisons, notCompared, ruleRows } = compareRules(review, a.portfolio_id, period, 'single_holding_weight', largest?.weight, 'the weights are unknown (see unresolved)')
      return {
        result: {
          portfolio_id: a.portfolio_id,
          period_end: period,
          largest: largest ? { row_id: largest.row.row_id, instrument_id: largest.row.instrument_id, instrument_name: largest.row.instrument_name, weight: f4(largest.weight!) } : null,
          holdings: sorted.map((x) => ({ row_id: x.row.row_id, instrument_id: x.row.instrument_id, instrument_name: x.row.instrument_name, weight: x.weight === undefined ? null : f4(x.weight) })),
          comparisons,
          ...gaps(h.unresolved, notCompared),
        },
        rowsUsed: [...h.rows.map((x) => x.row.row_id), ...ruleRows],
      }
    }
    // Portfolio minus benchmark return for the period; the tolerance rule limits its absolute size. A return that
    // isn't a decimal, or two rows for the period, leaves the difference unknown.
    case 'relative_performance': {
      const ps = rowsOf(review, 'performance').filter((r) => r.portfolio_id === a.portfolio_id && r.period_end === period)
      const p = ps[0]
      if (!p) throw new Error(`no performance for ${a.portfolio_id} at ${period}`)
      const bad = (['portfolio_return', 'benchmark_return'] as const).filter((f) => !isDec(p[f]))
      const unresolved: Unresolved[] = [
        ...(ps.length > 1 ? [{ reason: `${ps.length} performance rows for ${a.portfolio_id} at ${period}`, rows: ps.map((r) => r.row_id) }] : []),
        ...(bad.length ? [{ reason: `${bad.map((f) => `${f} "${p[f]}"`).join(' and ')} is not a decimal`, rows: [p.row_id] }] : []),
      ]
      const deviation = unresolved.length ? undefined : dec(p.portfolio_return) - dec(p.benchmark_return)
      const { comparisons, notCompared, ruleRows } = compareRules(review, a.portfolio_id, period, 'relative_return_deviation', deviation === undefined ? undefined : abs(deviation), 'the return difference is unknown (see unresolved)')
      return {
        result: { portfolio_id: a.portfolio_id, period_end: period, portfolio_return: p.portfolio_return, benchmark_return: p.benchmark_return, difference: deviation === undefined ? null : f4(deviation), absolute_difference: deviation === undefined ? null : f4(abs(deviation)), comparisons, ...gaps(unresolved, notCompared) },
        rowsUsed: [...ps.map((r) => r.row_id), ...ruleRows],
      }
    }
    // Ongoing charge of each fund held at to_period, at both periods (by default the last two). A charge missing
    // at either period gives null rather than an error; one that isn't a decimal, or given twice, is also unresolved.
    case 'fee_change': {
      const from = a.from_period ?? review.periods.at(-2)
      const to = a.to_period ?? review.periodEnd
      if (!from) throw new Error('fee_change needs from_period')
      const fees = rowsOf(review, 'fees')
      const h = holdings(review, a.portfolio_id, to)
      const used: string[] = []
      const unresolved: Unresolved[] = []
      // A fund's charge at a period: undefined when there is no row, or when the rows can't be used (then unresolved).
      const charge = (instrument: string, period: string) => {
        const rows = fees.filter((f) => f.instrument_id === instrument && f.period_end === period)
        used.push(...rows.map((x) => x.row_id))
        if (rows.length > 1) {
          unresolved.push({ reason: `${rows.length} charges for ${instrument} at ${period}`, rows: rows.map((x) => x.row_id), instrument_id: instrument })
          return undefined
        }
        if (rows.length && !isDec(rows[0].ongoing_charge)) {
          unresolved.push({ reason: `ongoing_charge "${rows[0].ongoing_charge}" of ${instrument} at ${period} is not a decimal`, rows: [rows[0].row_id], instrument_id: instrument })
          return undefined
        }
        return rows[0]?.ongoing_charge
      }
      const funds = h.rows.map(({ row }) => {
        used.push(row.row_id)
        const before = charge(row.instrument_id, from)
        const after = charge(row.instrument_id, to)
        return { instrument_id: row.instrument_id, instrument_name: row.instrument_name, from: before ?? null, to: after ?? null, change: before !== undefined && after !== undefined ? f4(dec(after) - dec(before)) : null }
      })
      return { result: { portfolio_id: a.portfolio_id, from_period: from, to_period: to, funds, ...gaps(unresolved) }, rowsUsed: used }
    }
  }
  throw new Error('unreachable')
}

// Whether one rule version in force for a portfolio at a period was evaluated by a trusted check of a run.
export type RuleStatus = {
  period: string
  portfolio_id: string
  rule_id: string
  version: string
  metric: string
  status: 'passed' | 'breached' | 'not_evaluated' | 'unsupported'
  check_id?: string
  reason?: string
}

/**
 * Accounts for every structured rule version in force at each period of the review, for each portfolio it applies
 * to (a rule for ALL once per portfolio) (§6.4, §8.2): passed or breached when a check of the run compared it,
 * unsupported when no trusted check measures its metric, and otherwise not evaluated, with why. Unknown and
 * unsupported never count as met.
 */
export function ruleCoverage(review: Review, checks: { id: string; args: CheckArgs; result: Record<string, unknown> }[]): RuleStatus[] {
  // Check results are stored as open JSON; these are the lists runCheck writes.
  const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  const out: RuleStatus[] = []
  for (const period of review.periods)
    for (const { portfolio_id } of rowsOf(review, 'portfolios'))
      for (const r of rowsOf(review, 'policy_rules')) {
        if ((r.portfolio_id !== portfolio_id && r.portfolio_id !== 'ALL') || !inForce(r, period)) continue
        const base = { period, portfolio_id, rule_id: r.rule_id, version: r.version, metric: r.metric }
        const problem = ruleProblem(r)
        const mine = checks.filter((c) => c.args.portfolio_id === portfolio_id && (c.result.period_end ?? c.result.to_period) === period)
        const compared = mine.flatMap((c) => list<Comparison>(c.result.comparisons).filter((x) => x.rule_id === r.rule_id && x.version === r.version).map((x) => ({ c, x })))
        const blocked = mine.flatMap((c) => list<NotCompared>(c.result.not_compared).filter((x) => x.rule_id === r.rule_id && x.version === r.version).map((x) => ({ c, x })))
        const breach = compared.find((y) => y.x.status === 'breach')
        if (!metricCheck(r.metric)) out.push({ ...base, status: 'unsupported', reason: `no trusted check measures ${r.metric}` })
        else if (problem) out.push({ ...base, status: 'not_evaluated', reason: `the rule can't be evaluated: ${problem}` })
        else if (breach) out.push({ ...base, status: 'breached', check_id: breach.c.id })
        else if (compared.length) out.push({ ...base, status: 'passed', check_id: compared[0].c.id })
        else if (blocked.length) out.push({ ...base, status: 'not_evaluated', check_id: blocked[0].c.id, reason: blocked[0].x.reason })
        else out.push({ ...base, status: 'not_evaluated', reason: 'no check of the run compared it' })
      }
  return out
}
