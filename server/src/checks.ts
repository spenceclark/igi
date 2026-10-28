// Trusted deterministic calculations (spec §8.2 run_check, §9.6). Decimal arithmetic only; weights are
// computed from market values, rules are the structured table's versions in force at the period end.
import { abs, dec, div, fmt, mul, sum, type Dec } from './decimal.ts'
import type { Review, Row } from './sources.ts'

export type CheckArgs = { check: string; portfolio_id: string; period_end?: string; asset_class?: string; from_period?: string; to_period?: string }
// One rule compared with a computed value. margin is the room left before the limit; negative means a breach.
export type Comparison = { rule_id: string; version: string; limit_type: string; threshold: string; value: string; status: 'within' | 'breach'; margin: string; document_clause: string }

// The checks run_check offers: each one's arguments and what it returns. The agent reads these texts.
export const CHECK_CATALOGUE: Record<string, string> = {
  weight_reconciliation: 'portfolio_id, period_end: total market value, each holding\'s computed weight against its reported weight, and the sum of reported weights.',
  lookthrough_exposure: 'portfolio_id, period_end, asset_class: look-through exposure to the asset class, each holding\'s contribution, coverage, and comparison with the applicable rules for that exposure.',
  holding_concentration: 'portfolio_id, period_end: holdings by computed weight, the largest, and comparison with the single-holding rule in force at the period end.',
  relative_performance: 'portfolio_id, period_end: portfolio and benchmark return for the quarter, their difference, and comparison with the applicable tolerance rule.',
  fee_change: 'portfolio_id, from_period, to_period: ongoing charge of each fund held at to_period, at both periods, and the change.',
}

// The rows of one source by id, or none.
const rowsOf = (review: Review, id: string): Row[] => review.sources.find((s) => s.id === id)?.rows ?? []
// Figures leave a check as decimal strings to 4 places.
const f4 = (x: Dec) => fmt(x, 4)

/** A portfolio's positions at a period, each with its weight computed from market values. Throws if there are none. */
function holdings(review: Review, portfolio: string, period: string) {
  const rows = rowsOf(review, 'positions').filter((r) => r.portfolio_id === portfolio && r.period_end === period)
  if (!rows.length) throw new Error(`no positions for ${portfolio} at ${period}`)
  const total = sum(rows.map((r) => dec(r.market_value_gbp)))
  return { total, rows: rows.map((r) => ({ row: r, weight: div(dec(r.market_value_gbp), total) })) }
}

/**
 * Compares a value with every rule for the metric in force for the portfolio (or ALL) at the period. The margin
 * is threshold minus value for a max and value minus threshold for a min, so a negative margin is a breach.
 * Returns the comparisons and the rule rows used.
 */
function compareRules(review: Review, portfolio: string, period: string, metric: string, value: Dec) {
  const rules = rowsOf(review, 'policy_rules').filter(
    (r) => r.metric === metric && (r.portfolio_id === portfolio || r.portfolio_id === 'ALL') && r.effective_from <= period && (!r.effective_to || r.effective_to >= period),
  )
  const comparisons: Comparison[] = rules.map((r) => {
    const margin = r.limit_type === 'max' ? dec(r.threshold) - value : value - dec(r.threshold)
    return { rule_id: r.rule_id, version: r.version, limit_type: r.limit_type, threshold: r.threshold, value: f4(value), status: margin < 0n ? 'breach' : 'within', margin: f4(margin), document_clause: r.document_clause }
  })
  return { comparisons, ruleRows: rules.map((r) => r.row_id) }
}

/**
 * Runs one catalogue check for a portfolio, at the period given or the review's period end. Returns the result
 * and every source row it depends on, the rules compared included. Throws Error with a message for the agent on bad input.
 */
export function runCheck(review: Review, a: CheckArgs): { result: Record<string, unknown>; rowsUsed: string[] } {
  if (!CHECK_CATALOGUE[a.check]) throw new Error(`unknown check "${a.check}"; available: ${Object.keys(CHECK_CATALOGUE).join(', ')}`)
  const period = a.period_end ?? review.periodEnd
  switch (a.check) {
    // Each holding's weight from market values against its reported weight, and the sum of reported weights.
    case 'weight_reconciliation': {
      const h = holdings(review, a.portfolio_id, period)
      const lines = h.rows.map(({ row, weight }) => ({ row_id: row.row_id, instrument_name: row.instrument_name, computed_weight: f4(weight), reported_weight: row.reported_weight, difference: f4(dec(row.reported_weight) - weight) }))
      return {
        result: { portfolio_id: a.portfolio_id, period_end: period, total_market_value_gbp: fmt(h.total, 2), reported_weight_sum: f4(sum(h.rows.map((x) => dec(x.row.reported_weight)))), max_abs_difference: f4(h.rows.reduce((m, x) => { const d = abs(dec(x.row.reported_weight) - x.weight); return d > m ? d : m }, 0n)), holdings: lines },
        rowsUsed: h.rows.map((x) => x.row.row_id),
      }
    }
    // Exposure to an asset class: the sum over holdings of weight times the fund's exposure to that class at the
    // same date. A fund without look-through data at that date contributes nothing and is listed as missing.
    // The rules compared are those for the metric `<asset class>_exposure`.
    case 'lookthrough_exposure': {
      if (!a.asset_class) throw new Error('lookthrough_exposure needs asset_class')
      const h = holdings(review, a.portfolio_id, period)
      const lt = rowsOf(review, 'lookthrough')
      const used: string[] = []
      const missing: string[] = []
      const contributions = h.rows.map(({ row, weight }) => {
        const funds = lt.filter((x) => x.instrument_id === row.instrument_id && x.as_of === period)
        if (!funds.length) missing.push(row.instrument_id)
        const e = funds.find((x) => x.asset_class === a.asset_class)
        used.push(row.row_id, ...funds.map((x) => x.row_id))
        const exposure = e ? dec(e.exposure_weight) : 0n
        return { row_id: row.row_id, instrument_name: row.instrument_name, fund_type: row.fund_type, weight: f4(weight), fund_exposure: f4(exposure), contribution: f4(mul(weight, exposure)), raw: mul(weight, exposure) }
      })
      const exposure = sum(contributions.map((c) => c.raw))
      const metric = `${a.asset_class}_exposure`
      const { comparisons, ruleRows } = compareRules(review, a.portfolio_id, period, metric, exposure)
      return {
        result: { portfolio_id: a.portfolio_id, period_end: period, asset_class: a.asset_class, exposure: f4(exposure), holdings_without_lookthrough: missing, contributions: contributions.map(({ raw, ...c }) => c), comparisons },
        rowsUsed: [...used, ...ruleRows],
      }
    }
    // Holdings by computed weight, largest first; the largest is compared with the single-holding rule.
    case 'holding_concentration': {
      const h = holdings(review, a.portfolio_id, period)
      const sorted = [...h.rows].sort((x, y) => (y.weight > x.weight ? 1 : y.weight < x.weight ? -1 : 0))
      const { comparisons, ruleRows } = compareRules(review, a.portfolio_id, period, 'single_holding_weight', sorted[0].weight)
      return {
        result: { portfolio_id: a.portfolio_id, period_end: period, largest: { row_id: sorted[0].row.row_id, instrument_name: sorted[0].row.instrument_name, weight: f4(sorted[0].weight) }, holdings: sorted.map((x) => ({ row_id: x.row.row_id, instrument_name: x.row.instrument_name, weight: f4(x.weight) })), comparisons },
        rowsUsed: [...h.rows.map((x) => x.row.row_id), ...ruleRows],
      }
    }
    // Portfolio minus benchmark return for the quarter; the tolerance rule limits its absolute size.
    case 'relative_performance': {
      const p = rowsOf(review, 'performance').find((r) => r.portfolio_id === a.portfolio_id && r.period_end === period)
      if (!p) throw new Error(`no performance for ${a.portfolio_id} at ${period}`)
      const deviation = dec(p.portfolio_return) - dec(p.benchmark_return)
      const { comparisons, ruleRows } = compareRules(review, a.portfolio_id, period, 'relative_return_deviation', abs(deviation))
      return {
        result: { portfolio_id: a.portfolio_id, period_end: period, portfolio_return: p.portfolio_return, benchmark_return: p.benchmark_return, difference: f4(deviation), absolute_difference: f4(abs(deviation)), comparisons },
        rowsUsed: [p.row_id, ...ruleRows],
      }
    }
    // Ongoing charge of each fund held at to_period, at both periods (by default the last two). A charge missing
    // at either period gives null rather than an error.
    case 'fee_change': {
      const from = a.from_period ?? review.periods.at(-2)
      const to = a.to_period ?? review.periodEnd
      if (!from) throw new Error('fee_change needs from_period')
      const fees = rowsOf(review, 'fees')
      const h = holdings(review, a.portfolio_id, to)
      const used: string[] = []
      const funds = h.rows.map(({ row }) => {
        const before = fees.find((f) => f.instrument_id === row.instrument_id && f.period_end === from)
        const after = fees.find((f) => f.instrument_id === row.instrument_id && f.period_end === to)
        used.push(row.row_id, ...[before, after].filter((x): x is Row => !!x).map((x) => x.row_id))
        return { instrument_name: row.instrument_name, from: before?.ongoing_charge ?? null, to: after?.ongoing_charge ?? null, change: before && after ? f4(dec(after.ongoing_charge) - dec(before.ongoing_charge)) : null }
      })
      return { result: { portfolio_id: a.portfolio_id, from_period: from, to_period: to, funds }, rowsUsed: used }
    }
  }
  throw new Error('unreachable')
}
