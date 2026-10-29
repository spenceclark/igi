// Fail-closed inputs and rule coverage (spec §6.2, §6.4, §7.3, §7.5, §8.2): a missing, invalid, unrecognised or
// conflicting input never becomes a value, a pass or full coverage, while clean data still yields valid results.
// Deterministic: real checks and validation on dev-01, or on a copy with files edited for a case the fixture lacks.
// No model and no database. Portfolios, rules and instruments are found in the data, never named here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ruleCoverage, runCheck, type CheckArgs } from '../src/checks.ts'
import { dec, fmt } from '../src/decimal.ts'
import { blockers, getPolicy, importReview, metricCheck, type Review, type Row } from '../src/sources.ts'
import { callTool, type FindingArgs, type RunState } from '../src/tools.ts'

const DEV01 = fileURLToPath(new URL('../../fixtures/scenarios/dev-01', import.meta.url))
type Result = Record<string, unknown> & {
  exposure?: string | null
  incomplete?: string
  comparisons: { rule_id: string; version: string; status: string }[]
  unresolved?: { reason: string; rows: string[]; instrument_id?: string }[]
  not_compared?: { rule_id: string; version: string; reason: string }[]
}
type Proposed = { finding_id: string; validation: { state: string; unmatched: string[] } }

/** A copy of dev-01 with files edited, added (the edit gets '') or removed (the edit returns null). */
function variant(edits: Record<string, (text: string) => string | null>): string {
  const dir = mkdtempSync(join(tmpdir(), 'igi-fail-closed-'))
  cpSync(DEV01, dir, { recursive: true })
  for (const [file, edit] of Object.entries(edits)) {
    const path = join(dir, file)
    const text = edit(existsSync(path) ? readFileSync(path, 'utf8') : '')
    if (text === null) rmSync(path)
    else writeFileSync(path, text)
  }
  return dir
}
/** Edits a CSV's data rows cell by cell (the files edited this way have no quoted fields); null drops a row. */
const editRows = (edit: (cells: string[], i: number) => string[] | null) => (text: string) => {
  const [header, ...rows] = text.trimEnd().split('\n')
  return [header, ...rows.flatMap((r, i) => [edit(r.split(','), i)].filter((c) => c !== null).map((c) => c.join(',')))].join('\n') + '\n'
}
const rowsOf = (review: Review, id: string): Row[] => review.sources.find((s) => s.id === id)?.rows ?? []
const issues = (review: Review) => review.sources.flatMap((s) => s.issues).join('\n')
const check = (review: Review, args: CheckArgs) => runCheck(review, args).result as Result
const runOn = (dir = DEV01): RunState => ({ review: importReview(dir, 'r'), now: new Date(), executions: [], checks: [], notes: [], findings: [], maxPython: 0 })
const propose = async (s: RunState, a: Partial<FindingArgs>) =>
  (await callTool(s, 'propose_finding', { title: 'Case', classification: 'observation', review_area: 'allocation_risk', materiality: 'low', explanation: 'For the record.', ...a })) as Proposed

/** The portfolio whose equity exposure at the period end breaches a rule, the breached rule and the exposure. */
function equityBreach(review: Review) {
  for (const p of rowsOf(review, 'portfolios')) {
    const r = check(review, { check: 'lookthrough_exposure', portfolio_id: p.portfolio_id, asset_class: 'equity' })
    const rule = r.comparisons.find((c) => c.status === 'breach')
    if (rule) return { portfolio: p.portfolio_id, rule, exposure: r.exposure! }
  }
  throw new Error('the fixture has no equity breach')
}

/** Runs, through the tool, every trusted check that compares a rule in force for the portfolio at the period end. */
async function checkEveryRule(s: RunState, portfolio: string): Promise<string[]> {
  const ids: string[] = []
  for (const r of getPolicy(s.review, { portfolio_id: portfolio, as_of: s.review.periodEnd }).rules) {
    const m = metricCheck(r.metric)
    if (!m) continue
    const out = (await callTool(s, 'run_check', { check: m.check, portfolio_id: portfolio, ...(m.asset_class ? { asset_class: m.asset_class } : {}) })) as { check_id: string }
    ids.push(out.check_id)
  }
  return ids
}

/** A portfolio whose every rule in force at the period end is met. */
function cleanPortfolio(review: Review): string {
  const s = { ...runOn(), review }
  const statuses = ruleCoverage(review, rowsOf(review, 'portfolios').flatMap((p) =>
    getPolicy(review, { portfolio_id: p.portfolio_id, as_of: review.periodEnd }).rules.flatMap((r, i) => {
      const m = metricCheck(r.metric)
      if (!m) return []
      const args = { check: m.check, portfolio_id: p.portfolio_id, ...(m.asset_class ? { asset_class: m.asset_class } : {}) }
      return [{ id: `${p.portfolio_id}-${i}`, args, result: runCheck(s.review, args).result }]
    }),
  ))
  const clean = rowsOf(review, 'portfolios').find((p) => statuses.filter((x) => x.portfolio_id === p.portfolio_id && x.period === review.periodEnd).every((x) => x.status === 'passed'))
  if (!clean) throw new Error('the fixture has no portfolio meeting every rule')
  return clean.portfolio_id
}

test('asset classes: equity, Equity and EQUITY are one class, in the request and in the source, with the original kept', () => {
  const review = importReview(DEV01, 'r')
  const base = equityBreach(review)
  for (const asked of ['Equity', 'EQUITY', ' equity ']) {
    const r = check(review, { check: 'lookthrough_exposure', portfolio_id: base.portfolio, asset_class: asked })
    assert.equal(r.asset_class, 'equity')
    assert.equal(r.exposure, base.exposure)
    assert.deepEqual(r.comparisons.map((c) => [c.rule_id, c.status]), [[base.rule.rule_id, 'breach']])
  }
  // The source writes the class in other cases: it is read as the taxonomy's class, and the label as written is kept.
  const relabelled = importReview(variant({ 'lookthrough.csv': editRows((c, i) => (c[2] === 'equity' ? [c[0], c[1], i % 2 ? 'EQUITY' : ' Equity', c[3]] : c)) }), 'r')
  assert.equal(issues(relabelled), '')
  const source = relabelled.sources.find((s) => s.id === 'lookthrough')!
  const changed = Object.entries(source.provenance!).filter(([, p]) => p.original?.asset_class)
  assert.ok(changed.length > 0)
  for (const [rowId, p] of changed) {
    assert.match(p.original!.asset_class, /^(Equity|EQUITY)$/) // a CSV cell is read trimmed
    assert.equal(source.rows.find((r) => r.row_id === rowId)!.asset_class, 'equity')
  }
  const r = check(relabelled, { check: 'lookthrough_exposure', portfolio_id: base.portfolio, asset_class: 'equity' })
  assert.equal(r.exposure, base.exposure)
  assert.deepEqual(r.comparisons.map((c) => [c.rule_id, c.status]), [[base.rule.rule_id, 'breach']])
})

test('asset classes: a breach behind a label outside the taxonomy is unknown, never 0% within the limit', async () => {
  const base = equityBreach(importReview(DEV01, 'r'))
  for (const label of ['Equities', 'stocks']) {
    const dir = variant({ 'lookthrough.csv': editRows((c) => (c[2] === 'equity' ? [c[0], c[1], label, c[3]] : c)) })
    const s = runOn(dir)
    assert.match(issues(s.review), new RegExp(`asset class "${label}" is not one of equity, bonds, cash, property, alternatives`))
    // The exposure the label hides is unknown: no figure, no comparison, the rows and label named, the rule not compared.
    const r = (await callTool(s, 'run_check', { check: 'lookthrough_exposure', portfolio_id: base.portfolio, asset_class: 'equity' })) as Result & { check_id: string; facts: Record<string, string> }
    assert.equal(r.exposure, null)
    assert.match(r.incomplete!, /the exposure is unknown and no rule was compared/)
    assert.deepEqual(r.comparisons, [])
    assert.ok(r.unresolved!.length > 0)
    for (const u of r.unresolved!) {
      assert.match(u.reason, new RegExp(`asset class "${label}"`))
      assert.ok(u.instrument_id && u.rows.length && u.rows.every((id) => id.startsWith('lookthrough:')))
    }
    assert.deepEqual(r.not_compared!.map((x) => [x.rule_id, x.version]), [[base.rule.rule_id, base.rule.version]])
    assert.equal(r.facts[`${r.check_id}:exposure`], undefined, 'no exposure fact for a claim to cite')
    // The rule is accounted for as not evaluated, and neither "within" nor "all limits met" can be claimed.
    const status = ruleCoverage(s.review, s.checks).find((x) => x.period === s.review.periodEnd && x.portfolio_id === base.portfolio && x.rule_id === base.rule.rule_id)!
    assert.equal(status.status, 'not_evaluated')
    assert.match(status.reason!, /the exposure is unknown/)
    const ids = await checkEveryRule(s, base.portfolio)
    const f = await propose(s, { portfolios: [base.portfolio], statement: 'All limits are met.', coverage: [{ kind: 'limits_met', portfolios: [base.portfolio], checks: ids }] })
    assert.equal(f.validation.state, 'unvalidated')
    assert.match(f.validation.unmatched.join('\n'), new RegExp(`${base.rule.rule_id} v${base.rule.version} is compared in no cited check`))
  }
})

test('asset classes: an unknown requested class is refused with the supported classes', async () => {
  const s = runOn()
  const portfolio = rowsOf(s.review, 'portfolios')[0].portfolio_id
  await assert.rejects(callTool(s, 'run_check', { check: 'lookthrough_exposure', portfolio_id: portfolio, asset_class: 'equities' }), /asset_class, one of equity, bonds, cash, property, alternatives; "equities" is not one/)
  await assert.rejects(callTool(s, 'run_check', { check: 'lookthrough_exposure', portfolio_id: portfolio }), /asset_class, one of equity/)
  assert.equal(s.checks.length, 0)
})

test('asset classes: a nil established by complete look-through data is 0%, and compared with its rule', () => {
  // No fund names one class: its weight is folded into another class of the same fund, so every fund's exposures
  // still sum to 1, and a limit for the class is added.
  const fold = (text: string) => {
    const [header, ...lines] = text.trimEnd().split('\n')
    const cells = lines.map((l) => l.split(','))
    const fund = (c: string[]) => `${c[0]}|${c[1]}`
    const out = cells.flatMap((c) => {
      const other = cells.find((x) => fund(x) === fund(c) && x[2] === 'property')
      if (c[2] === 'alternatives' && other) return [[c[0], c[1], c[2], fmt(dec(c[3]) + dec(other[3]), 4)]]
      if (c[2] !== 'property') return [c]
      return cells.some((x) => fund(x) === fund(c) && x[2] === 'alternatives') ? [] : [[c[0], c[1], 'alternatives', c[3]]]
    })
    return [header, ...out.map((c) => c.join(','))].join('\n') + '\n'
  }
  const portfolio = rowsOf(importReview(DEV01, 'r'), 'portfolios')[0].portfolio_id
  const rule = `ZZ-NIL,1,${portfolio},property_exposure,max,0.0500,look-through,2026-01-01,,"Sum over holdings of weight times fund exposure.",9.9`
  const review = importReview(variant({ 'lookthrough.csv': fold, 'policy_rules.csv': (t) => `${t.trimEnd()}\n${rule}\n` }), 'r')
  assert.equal(issues(review), '')
  const r = check(review, { check: 'lookthrough_exposure', portfolio_id: portfolio, asset_class: 'property' })
  assert.equal(r.exposure, '0.0000')
  assert.equal(r.incomplete, undefined)
  assert.equal(r.unresolved, undefined)
  assert.ok((r.contributions as { fund_exposure: string }[]).every((c) => c.fund_exposure === '0.0000'))
  assert.deepEqual(r.comparisons.map((c) => [c.rule_id, c.status]), [['ZZ-NIL', 'within']])
})

test('policy rules: a rule no trusted check measures is unsupported, never met, and cannot be set aside', async () => {
  const portfolio = cleanPortfolio(importReview(DEV01, 'r'))
  const rule = `ZZ-TE,1,${portfolio},tracking_error,max,0.0500,ex-post,2026-01-01,,"Annualised tracking error against the benchmark.",9.1`
  const s = runOn(variant({ 'policy_rules.csv': (t) => `${t.trimEnd()}\n${rule}\n` }))
  assert.match(issues(s.review), /no trusted check measures tracking_error; rule ZZ-TE v1 is reported as unsupported, never as met/)
  const listed = getPolicy(s.review, { portfolio_id: portfolio, as_of: s.review.periodEnd }).rules.find((r) => r.rule_id === 'ZZ-TE')!
  assert.match(listed.evaluation, /^unsupported: no trusted check measures tracking_error/)
  const ids = await checkEveryRule(s, portfolio)
  const statuses = ruleCoverage(s.review, s.checks).filter((x) => x.portfolio_id === portfolio && x.period === s.review.periodEnd)
  assert.deepEqual(statuses.filter((x) => x.status !== 'passed').map((x) => [x.rule_id, x.status]), [['ZZ-TE', 'unsupported']])
  // Every other rule passes, but "all limits met" still can't validate, with or without naming the unsupported rule.
  for (const except of [[], ['ZZ-TE']]) {
    const f = await propose(s, { portfolios: [portfolio], statement: 'The portfolio is fully compliant: all limits are met.', coverage: [{ kind: 'limits_met', portfolios: [portfolio], checks: ids, except }] })
    assert.equal(f.validation.state, 'unvalidated')
    assert.match(f.validation.unmatched.join('\n'), except.length ? /ZZ-TE v1 is named as an exception but no cited check evaluated it/ : /ZZ-TE v1 is compared in no cited check/)
  }
})

test('policy rules: each period is accounted for with the version in force then; limit types are read only as max or min', async () => {
  const review = importReview(DEV01, 'r')
  const versioned = rowsOf(review, 'policy_rules').find((r) => rowsOf(review, 'policy_rules').filter((x) => x.rule_id === r.rule_id).length > 1)!
  const versions = rowsOf(review, 'policy_rules').filter((x) => x.rule_id === versioned.rule_id)
  const portfolio = versioned.portfolio_id
  const m = metricCheck(versioned.metric)!
  const runAll = (r: Review) => r.periods.map((period, i) => ({ id: `C${i + 1}`, args: { check: m.check, portfolio_id: portfolio, period_end: period, ...(m.asset_class ? { asset_class: m.asset_class } : {}) }, result: runCheck(r, { check: m.check, portfolio_id: portfolio, period_end: period, ...(m.asset_class ? { asset_class: m.asset_class } : {}) }).result }))
  const statuses = ruleCoverage(review, runAll(review)).filter((x) => x.rule_id === versioned.rule_id)
  // One entry per period, each the version in force at that date, evaluated by that period's check.
  assert.deepEqual(statuses.map((x) => x.period), review.periods)
  for (const x of statuses) {
    const inForce = versions.filter((v) => v.effective_from <= x.period && (!v.effective_to || v.effective_to >= x.period))
    assert.deepEqual([x.version], inForce.map((v) => v.version))
    assert.ok(x.status === 'passed' || x.status === 'breached')
  }
  assert.notEqual(statuses[0].version, statuses.at(-1)!.version)

  // A limit type in another case is the same limit; one that is neither max nor min is never compared.
  const latest = versions.at(-1)!
  const setLimitType = (to: string) => (t: string) => t.split('\n').map((l) => (l.startsWith(`${latest.rule_id},${latest.version},`) ? l.replace(`,${latest.limit_type},`, `,${to},`) : l)).join('\n')
  const cased = importReview(variant({ 'policy_rules.csv': setLimitType(latest.limit_type.toUpperCase()) }), 'r')
  assert.equal(issues(cased), '')
  assert.deepEqual(ruleCoverage(cased, runAll(cased)).filter((x) => x.rule_id === latest.rule_id).map((x) => x.status), statuses.map((x) => x.status))
  const unknown = importReview(variant({ 'policy_rules.csv': setLimitType('maximum') }), 'r')
  assert.match(issues(unknown), new RegExp(`limit_type "maximum" is neither max nor min; rule ${latest.rule_id} v${latest.version} can't be evaluated`))
  const r = check(unknown, { check: m.check, portfolio_id: portfolio, ...(m.asset_class ? { asset_class: m.asset_class } : {}) })
  assert.ok(!r.comparisons.some((c) => c.rule_id === latest.rule_id))
  assert.match(r.not_compared!.find((x) => x.rule_id === latest.rule_id)!.reason, /neither max nor min/)
  assert.equal(ruleCoverage(unknown, runAll(unknown)).find((x) => x.rule_id === latest.rule_id && x.version === latest.version)!.status, 'not_evaluated')
})

test('inputs: missing look-through data or an invalid number blocks only what depends on it, and says which rows', async () => {
  const review = importReview(DEV01, 'r')
  const portfolios = rowsOf(review, 'portfolios').map((p) => p.portfolio_id)
  const held = (r: Review, p: string) => rowsOf(r, 'positions').filter((x) => x.portfolio_id === p && x.period_end === r.periodEnd)
  // A fund held by one portfolio only loses its look-through rows at the period end.
  const [owner, fund] = portfolios.flatMap((p) => held(review, p).map((h) => [p, h.instrument_id])).find(([, id]) => portfolios.filter((q) => held(review, q).some((h) => h.instrument_id === id)).length === 1)!
  const other = portfolios.find((p) => p !== owner)!
  const gap = importReview(variant({ 'lookthrough.csv': editRows((c) => (c[0] === fund && c[1] === review.periodEnd ? null : c)) }), 'r')
  const blocked = check(gap, { check: 'lookthrough_exposure', portfolio_id: owner, asset_class: 'equity' })
  assert.equal(blocked.exposure, null)
  assert.deepEqual(blocked.holdings_without_lookthrough, [fund])
  assert.deepEqual(blocked.comparisons, [])
  assert.match(check(gap, { check: 'lookthrough_exposure', portfolio_id: other, asset_class: 'equity' }).exposure!, /^\d\.\d{4}$/, 'a portfolio without the fund is unaffected')
  assert.match(String(check(gap, { check: 'weight_reconciliation', portfolio_id: owner }).max_abs_difference), /^\d\.\d{4}$/, 'weights need no look-through data')

  // A market value that isn't a number: the total and every weight are unknown, named by row, with no low-level error.
  const target = held(review, owner)[0]
  const line = Number(target.row_id.split(':')[1])
  const s = runOn(variant({ 'positions.csv': editRows((c, i) => (i + 1 === line ? [...c.slice(0, 5), '', c[6]] : c)) }))
  assert.match(issues(s.review), new RegExp(`${target.row_id}: missing market_value_gbp`))
  const w = (await callTool(s, 'run_check', { check: 'weight_reconciliation', portfolio_id: owner })) as Result & { check_id: string }
  assert.equal(w.total_market_value_gbp, null)
  assert.equal(w.max_abs_difference, null)
  assert.match(w.unresolved![0].reason, new RegExp(`market_value_gbp is not a valid amount in ${target.row_id} \\(""\\)`))
  assert.deepEqual(w.unresolved![0].rows, [target.row_id])
  const conc = check(s.review, { check: 'holding_concentration', portfolio_id: owner })
  assert.equal(conc.largest, null)
  assert.deepEqual(conc.comparisons, [])
  assert.ok(conc.not_compared!.length > 0)
  assert.equal(check(s.review, { check: 'lookthrough_exposure', portfolio_id: owner, asset_class: 'equity' }).exposure, null)
  assert.ok(check(s.review, { check: 'relative_performance', portfolio_id: owner }).comparisons.length > 0, 'returns need no market values')
  assert.ok(check(s.review, { check: 'holding_concentration', portfolio_id: other }).comparisons.length > 0, 'another portfolio is unaffected')
  const f = await propose(s, { portfolios: [owner], statement: 'Every holding’s reported weight reconciles.', coverage: [{ kind: 'weights_reconcile', portfolios: [owner], checks: [w.check_id] }] })
  assert.equal(f.validation.state, 'unvalidated')
  assert.match(f.validation.unmatched.join('\n'), /could not reconcile the weights: market_value_gbp is not a valid amount/)

  // A charge that isn't a number leaves that fund's change unknown, and "charges unchanged" unproven.
  const fees = runOn(variant({ 'fees.csv': editRows((c) => (c[0] === target.instrument_id && c[1] === review.periodEnd ? [c[0], c[1], 'n/a'] : c)) }))
  const fc = (await callTool(fees, 'run_check', { check: 'fee_change', portfolio_id: owner })) as Result & { check_id: string; funds: { instrument_id: string; change: string | null }[] }
  assert.equal(fc.funds.find((x) => x.instrument_id === target.instrument_id)!.change, null)
  assert.match(fc.unresolved![0].reason, /ongoing_charge "n\/a" .* is not a decimal/)
  const cf = await propose(fees, { portfolios: [owner], statement: 'All charges are unchanged.', coverage: [{ kind: 'charges_unchanged', portfolios: [owner], checks: [fc.check_id] }] })
  assert.equal(cf.validation.state, 'unvalidated')
})

test('sources: positions split across two files block an investigation, naming both, and are never half used', () => {
  const [header, ...lines] = readFileSync(join(DEV01, 'positions.csv'), 'utf8').trimEnd().split('\n')
  const periods = [...new Set(lines.map((l) => l.split(',')[1]))].sort()
  const part = (period: string) => () => [header, ...lines.filter((l) => l.split(',')[1] === period)].join('\n') + '\n'
  const review = importReview(variant({ 'positions.csv': () => null, 'positions-earlier.csv': part(periods[0]), 'positions-later.csv': part(periods.at(-1)!) }), 'r', periods.at(-1))
  assert.match(blockers(review).join('\n'), /positions-later\.csv also provides positions, which positions-earlier\.csv already does: remove one of them or combine them into one file/)
  assert.equal(review.sources.find((s) => s.file === 'positions-later.csv')!.rows.length, 0)
  // One combined file is a source set an investigation can start on.
  const combined = importReview(variant({ 'positions.csv': () => null, 'positions-all.csv': () => [header, ...lines].join('\n') + '\n' }), 'r')
  assert.deepEqual(blockers(combined), [])
})

test('sources: a CSV saved by Excel with a UTF-8 byte order mark is read with its headers, and its bytes and hash kept', () => {
  const text = readFileSync(join(DEV01, 'positions.csv'), 'utf8')
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text.replace(/\r?\n/g, '\r\n'))])
  const dir = variant({})
  writeFileSync(join(dir, 'positions.csv'), bytes)
  const review = importReview(dir, 'r')
  const positions = review.sources.find((s) => s.id === 'positions')!
  assert.equal(issues(review), '')
  assert.deepEqual(positions.rows, rowsOf(importReview(DEV01, 'r'), 'positions'))
  assert.equal(positions.sha256, createHash('sha256').update(bytes).digest('hex'))
})

test('whole-population claims: clean, complete data validates; compliance wording needs coverage; incomplete look-through is not coverage', async () => {
  const s = runOn()
  const portfolio = cleanPortfolio(s.review)
  const ids = await checkEveryRule(s, portfolio)
  const coverage = [{ kind: 'limits_met' as const, portfolios: [portfolio], checks: ids }]
  assert.equal((await propose(s, { portfolios: [portfolio], statement: 'The portfolio is fully compliant with every limit.', coverage })).validation.state, 'validated')
  // Assurance of compliance without coverage is unsupported; a negation asserts nothing about every rule.
  for (const statement of ['The portfolio is fully compliant.', 'There were no breaches this period.', 'The portfolio is in full compliance.']) {
    const f = await propose(s, { portfolios: [portfolio], statement, check_ids: ids })
    assert.equal(f.validation.state, 'unvalidated', statement)
    assert.match(f.validation.unmatched.join('\n'), /states something about a whole population without verified coverage/, statement)
  }
  for (const statement of ['The portfolio is not fully compliant.', 'The portfolio isn’t fully compliant.', "It isn't fully compliant.", 'It is no longer fully compliant.', 'It is not yet in full compliance.'])
    assert.deepEqual((await propose(s, { portfolios: [portfolio], statement, check_ids: ids })).validation.unmatched, [], statement)

  // Look-through rows present but with a label outside the taxonomy are not complete coverage.
  const base = equityBreach(s.review)
  const t = runOn(variant({ 'lookthrough.csv': editRows((c) => (c[2] === 'equity' ? [c[0], c[1], 'Equities', c[3]] : c)) }))
  const c = (await callTool(t, 'run_check', { check: 'lookthrough_exposure', portfolio_id: base.portfolio, asset_class: 'bonds' })) as { check_id: string }
  const f = await propose(t, { review_area: 'source_data', portfolios: [base.portfolio], statement: 'Look-through data has full coverage.', coverage: [{ kind: 'lookthrough_complete', portfolios: [base.portfolio], checks: [c.check_id] }] })
  assert.equal(f.validation.state, 'unvalidated')
  assert.match(f.validation.unmatched.join('\n'), /has no usable look-through data/)
})
