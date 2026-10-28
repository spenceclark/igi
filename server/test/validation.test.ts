// Finding validation and revisions (spec §6.4, §9.6), deterministically: real checks on the dev-01 fixture, or on a
// copy with one file edited for a case the fixture lacks, and findings proposed through the tool as the agent would.
// No model and no database. Portfolios, rules, actions and instruments are found in the data, never named here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isCurrent, type Claim, type CoverageClaim } from '../src/evidence.ts'
import { importReview, type Review, type Row } from '../src/sources.ts'
import { callTool, type Finding, type FindingArgs, type RunState } from '../src/tools.ts'

const DEV01 = fileURLToPath(new URL('../../fixtures/scenarios/dev-01', import.meta.url))
type CheckOut = { check_id: string; facts: Record<string, string>; comparisons?: { rule_id: string; version: string; status: string }[] } & Record<string, unknown>
type Proposed = { finding_id: string; classification: string; validation: { state: string; unmatched: string[] }; current: boolean; message: string }

/** A fresh run state for a review folder. */
const runOn = (dir = DEV01): RunState => ({ review: importReview(dir, 'r'), now: new Date(), executions: [], checks: [], notes: [], findings: [], maxPython: 0 })
/** A copy of dev-01 with one file edited, for a case the fixture doesn't contain. */
function variant(file: string, edit: (text: string) => string): string {
  const dir = mkdtempSync(join(tmpdir(), 'igi-validation-'))
  cpSync(DEV01, dir, { recursive: true })
  writeFileSync(join(dir, file), edit(readFileSync(join(dir, file), 'utf8')))
  return dir
}
const rows = (review: Review, id: string): Row[] => review.sources.find((s) => s.id === id)?.rows ?? []
const check = async (s: RunState, args: Record<string, string>) => (await callTool(s, 'run_check', args)) as CheckOut
/** A fact's value as run_check shows it (36.97%, 1.97pp), from the facts index. */
const valueOf = (c: CheckOut, key: string) => c.facts[`${c.check_id}:${key}`]?.split(' ')[0]
/** Proposes a finding with defaults for whatever the case doesn't set. */
const propose = async (s: RunState, a: Partial<FindingArgs>) =>
  (await callTool(s, 'propose_finding', { title: 'Case', classification: 'observation', review_area: 'allocation_risk', materiality: 'low', explanation: 'For the record.', ...a })) as Proposed
const finding = (s: RunState, id: string) => s.findings.find((f) => f.id === id)!
const claimResult = (f: Finding, key: string) => f.validation.claims!.find((c) => c.key === key)!

/** The first portfolio whose equity exposure breaches a rule, with that check and the rule it breaches. */
async function equityBreach(s: RunState) {
  for (const p of rows(s.review, 'portfolios')) {
    const c = await check(s, { check: 'lookthrough_exposure', portfolio_id: p.portfolio_id, asset_class: 'equity' })
    const rule = c.comparisons?.find((x) => x.status === 'breach')
    if (rule) return { portfolio: p.portfolio_id, c, rule }
  }
  throw new Error('the fixture has no equity breach')
}
/** Claims for an equity breach: exposure (a fact), limit (the structured rule) and excess (a fact). */
function breachClaims(b: Awaited<ReturnType<typeof equityBreach>>): Claim[] {
  return [
    { key: 'exposure', label: 'Equity exposure', value: valueOf(b.c, 'exposure'), measure: 'exposure', asset_class: 'equity', source: { fact: `${b.c.check_id}:exposure` } },
    { key: 'limit', label: 'Equity maximum', value: valueOf(b.c, `rule:${b.rule.rule_id}:limit`), measure: 'policy_limit', source: { rule: b.rule.rule_id, version: b.rule.version } },
    { key: 'excess', label: 'Excess over the limit', value: valueOf(b.c, `rule:${b.rule.rule_id}:breach`), measure: 'limit_breach', source: { fact: `${b.c.check_id}:rule:${b.rule.rule_id}:breach` } },
  ]
}
const breachText = (b: Awaited<ReturnType<typeof equityBreach>>) =>
  `Equity exposure was ${valueOf(b.c, 'exposure')}, above the ${valueOf(b.c, `rule:${b.rule.rule_id}:limit`)} maximum by ${valueOf(b.c, `rule:${b.rule.rule_id}:breach`)}.`

test('validation: a clean breach with every figure claimed is validated, with no downgrade', async () => {
  const s = runOn()
  const b = await equityBreach(s)
  const r = await propose(s, { classification: 'potential_exception', portfolios: [b.portfolio], statement: breachText(b), claims: breachClaims(b) })
  assert.deepEqual([r.classification, r.validation.state, r.validation.unmatched], ['potential_exception', 'validated', []])
  const f = finding(s, r.finding_id)
  assert.deepEqual(f.validation.claims!.map((c) => c.basis), ['calculation', 'policy_rule', 'calculation'])
})

test('validation: a figure in the text with no claim prevents validation, and the finding is kept', async () => {
  const s = runOn()
  const b = await equityBreach(s)
  const r = await propose(s, { classification: 'potential_exception', portfolios: [b.portfolio], statement: breachText(b), claims: breachClaims(b).slice(0, 2) })
  assert.deepEqual([r.classification, r.validation.state], ['observation', 'unvalidated'])
  assert.deepEqual(finding(s, r.finding_id).validation.unclaimed_figures, [valueOf(b.c, `rule:${b.rule.rule_id}:breach`)])
  assert.match(r.message, /appears in the text but is not a verified claim/)
})

test('validation: matching numbers from the wrong portfolio, period, measure or rule version are rejected', async () => {
  const s = runOn()
  const b = await equityBreach(s)
  const other = rows(s.review, 'portfolios').find((p) => p.portfolio_id !== b.portfolio)!.portfolio_id
  const elsewhere = await check(s, { check: 'lookthrough_exposure', portfolio_id: other, asset_class: 'equity' })
  const before = await check(s, { check: 'lookthrough_exposure', portfolio_id: b.portfolio, asset_class: 'equity', period_end: s.review.periods.at(-2)! })
  const claims: Claim[] = [
    // Another portfolio's exposure, its value stated exactly.
    { key: 'portfolio', label: 'Exposure', value: valueOf(elsewhere, 'exposure'), measure: 'exposure', asset_class: 'equity', source: { fact: `${elsewhere.check_id}:exposure` } },
    // The previous period's exposure, claimed for the finding's period.
    { key: 'period', label: 'Exposure', value: valueOf(before, 'exposure'), measure: 'exposure', asset_class: 'equity', source: { fact: `${before.check_id}:exposure` } },
    // The same figure, given its period: accepted.
    { key: 'dated', label: 'Exposure last quarter', value: valueOf(before, 'exposure'), measure: 'exposure', asset_class: 'equity', period: s.review.periods.at(-2), source: { fact: `${before.check_id}:exposure` } },
    // A limit presented as an exposure.
    { key: 'measure', label: 'Exposure', value: valueOf(b.c, `rule:${b.rule.rule_id}:limit`), measure: 'exposure', asset_class: 'equity', source: { fact: `${b.c.check_id}:rule:${b.rule.rule_id}:limit` } },
  ]
  // A rule version that is not in force at the period end, from a rule with more than one version.
  const versions = rows(s.review, 'policy_rules')
  const old = versions.find((r) => r.effective_to && r.effective_to < s.review.periodEnd && versions.some((x) => x.rule_id === r.rule_id && x.version !== r.version))!
  claims.push({ key: 'version', label: 'Limit', value: `${Number(old.threshold) * 100}%`, measure: 'policy_limit', portfolio: old.portfolio_id === 'ALL' ? undefined : old.portfolio_id, source: { rule: old.rule_id, version: old.version } })
  const r = await propose(s, { portfolios: [b.portfolio], statement: 'Several figures.', claims })
  const f = finding(s, r.finding_id)
  assert.equal(r.validation.state, 'unvalidated')
  assert.match(claimResult(f, 'portfolio').reason!, new RegExp(`is for ${other}`))
  assert.match(claimResult(f, 'period').reason!, new RegExp(`is at ${s.review.periods.at(-2)}`))
  assert.ok(claimResult(f, 'dated').ok)
  assert.match(claimResult(f, 'measure').reason!, /is policy_limit/)
  assert.match(claimResult(f, 'version').reason!, /is not in force/)
})

test('validation: percentages and percentage-point differences are not interchangeable', async () => {
  const s = runOn()
  const p = rows(s.review, 'portfolios')[0].portfolio_id
  const c = await check(s, { check: 'relative_performance', portfolio_id: p })
  const pp = valueOf(c, 'return_deviation')
  const asPercent = pp.replace('pp', '%')
  const claim = (value: string): Claim => ({ key: 'deviation', label: 'Deviation from benchmark', value, measure: 'return_deviation', source: { fact: `${c.check_id}:return_deviation` } })
  const wrong = await propose(s, { portfolios: [p], statement: `The deviation was ${asPercent}.`, claims: [claim(asPercent)] })
  assert.match(finding(s, wrong.finding_id).validation.claims![0].reason!, /percentage points \(pp\)/)
  assert.deepEqual(finding(s, wrong.finding_id).validation.unclaimed_figures, [asPercent])
  const right = await propose(s, { portfolios: [p], statement: `The deviation was ${pp}.`, claims: [claim(pp)] })
  assert.equal(right.validation.state, 'validated')
})

/** The first committee action whose text states a threshold or target as a percentage, and that figure as written. */
function actionWithFigure(review: Review) {
  for (const a of rows(review, 'committee_actions')) {
    const m = /[-−]?\d+(?:\.\d+)?%/.exec(a.action)
    if (m) return { action: a, figure: m[0] }
  }
  throw new Error('no committee action states a percentage')
}

test('validation: an action threshold rests on the quoted action, not on a check; a trigger shows only that it was met', async () => {
  const s = runOn()
  const { action, figure } = actionWithFigure(s.review)
  const p = rows(s.review, 'portfolios')[0].portfolio_id
  const perf = await check(s, { check: 'relative_performance', portfolio_id: p })
  const ret = valueOf(perf, 'portfolio_return')
  // The comparison the data supports, worked out here so the test assumes no outcome.
  const relation = Number(ret.replace('%', '')) < Number(figure.replace('%', '').replace('−', '-')) ? 'below' : 'at_or_above'
  const opposite = relation === 'below' ? 'at_or_above' : 'below'
  const claims: Claim[] = [
    { key: 'return', label: 'Quarterly return', value: ret, measure: 'portfolio_return', source: { fact: `${perf.check_id}:portfolio_return` } },
    { key: 'trigger', label: 'Threshold in the action', value: figure, measure: 'action_threshold', source: { quote: figure, row: action.row_id } },
    { key: 'met', label: 'Return against the threshold', measure: 'comparison', source: { derived: 'comparison', of: ['return', 'trigger'], relation } },
  ]
  const r = await propose(s, { classification: 'outstanding_action', review_area: 'committee_actions', portfolios: [p], statement: `The quarterly return was ${ret} against the ${figure} threshold in ${action.action_id}.`, claims })
  const f = finding(s, r.finding_id)
  assert.equal(r.validation.state, 'validated')
  assert.equal(claimResult(f, 'trigger').basis, 'source_text', 'a quoted threshold is labelled an extract, not a rule')
  // Nothing in the records evidences delivery or its absence, so a claim that it failed has no source to rest on.
  const delivery = await propose(s, {
    classification: 'outstanding_action',
    portfolios: [p],
    statement: 'The required notice was not given.',
    claims: [...claims.slice(0, 2), { key: 'met', label: 'Return against the threshold', measure: 'comparison', source: { derived: 'comparison', of: ['return', 'trigger'], relation: opposite } }, { key: 'notice', label: 'Notice not given', value: '0', measure: 'action_threshold', source: { quote: 'not notified', row: action.row_id } }],
  })
  const d = finding(s, delivery.finding_id)
  assert.equal(delivery.validation.state, 'unvalidated')
  assert.match(claimResult(d, 'met').reason!, /is not/)
  assert.match(claimResult(d, 'notice').reason!, /is not in/)
  // The threshold can't come from an unrelated calculation, nor from a row that isn't a committee action.
  const misplaced = await propose(s, { portfolios: [p], statement: 'A threshold.', claims: [{ key: 't', label: 'Threshold', value: ret, measure: 'action_threshold', source: { fact: `${perf.check_id}:portfolio_return` } }, { key: 'u', label: 'Threshold', value: figure, measure: 'action_threshold', source: { quote: figure, row: rows(s.review, 'fees')[0].row_id } }] })
  const m = finding(s, misplaced.finding_id)
  assert.match(claimResult(m, 't').reason!, /is portfolio_return/)
  assert.match(claimResult(m, 'u').reason!, /quotes a committee_actions row/)
})

test('validation: a claim about every fund held fails when the cited checks miss one holding', async () => {
  const s = runOn()
  const portfolios = rows(s.review, 'portfolios').map((p) => p.portfolio_id)
  const held = (p: string) => rows(s.review, 'positions').filter((r) => r.portfolio_id === p && r.period_end === s.review.periodEnd).map((r) => r.instrument_id)
  // A portfolio holding a fund no other portfolio holds: leaving out its check leaves that fund uncovered.
  const lone = portfolios.find((p) => held(p).some((i) => portfolios.every((q) => q === p || !held(q).includes(i))))!
  const fees = Object.fromEntries(await Promise.all(portfolios.map(async (p) => [p, await check(s, { check: 'fee_change', portfolio_id: p })] as const)))
  const changed = Object.values(fees).flatMap((c) => (c.funds as { instrument_id: string; change: string | null }[]).filter((x) => x.change !== '0.0000').map((x) => x.instrument_id))
  const coverage = (checks: string[]): CoverageClaim[] => [{ kind: 'charges_unchanged', portfolios, except: changed, checks }]
  const statement = 'All other funds held had unchanged charges.'
  const partial = await propose(s, { review_area: 'funds_fees', portfolios, statement, coverage: coverage(portfolios.filter((p) => p !== lone).map((p) => fees[p].check_id)) })
  const missing = finding(s, partial.finding_id).validation.coverage![0].missing
  assert.equal(partial.validation.state, 'unvalidated')
  assert.ok(missing.length && missing.every((m) => m.startsWith(`${lone}:`)), missing.join('\n'))
  const whole = await propose(s, { review_area: 'funds_fees', portfolios, statement, coverage: coverage(portfolios.map((p) => fees[p].check_id)) })
  assert.equal(whole.validation.state, 'validated')
  // The same sentence with no coverage claim is a statement about a population nobody proved.
  const bare = await propose(s, { review_area: 'funds_fees', portfolios, statement, check_ids: [fees[lone].check_id] })
  assert.deepEqual(finding(s, bare.finding_id).validation.unsupported_scope, ['All other funds'])
})

test('validation: look-through totals of 100% do not hide a holding with no look-through data', async () => {
  // A copy where the first holding of the first portfolio has no look-through rows at the period end; every other
  // fund's rows still sum to 100%.
  const base = importReview(DEV01, 'r')
  const first = rows(base, 'positions').find((r) => r.period_end === base.periodEnd)!
  const dir = variant('lookthrough.csv', (t) => t.split('\n').filter((l) => !l.startsWith(`${first.instrument_id},${base.periodEnd},`)).join('\n'))
  const s = runOn(dir)
  const c = await check(s, { check: 'lookthrough_exposure', portfolio_id: first.portfolio_id, asset_class: 'equity' })
  assert.equal(valueOf(c, 'holdings_without_lookthrough'), '1')
  const claim: CoverageClaim = { kind: 'lookthrough_complete', portfolios: [first.portfolio_id], checks: [c.check_id] }
  const r = await propose(s, { review_area: 'source_data', portfolios: [first.portfolio_id], statement: 'Look-through data has full coverage.', coverage: [claim] })
  const v = finding(s, r.finding_id).validation
  assert.equal(r.validation.state, 'unvalidated')
  assert.match(v.coverage![0].missing[0], new RegExp(`${first.instrument_id} .* has no look-through data`))
  // A Python result (a sum of the groups that exist) is not coverage evidence.
  const py = await propose(s, { review_area: 'source_data', portfolios: [first.portfolio_id], statement: 'Every holding has look-through data.', coverage: [{ ...claim, checks: ['X1'] }], check_ids: [c.check_id] })
  assert.match(finding(s, py.finding_id).validation.coverage![0].reason!, /Python executions/)
})

test('validation: when the policy document and a structured rule disagree, both are shown and the rule governs the limit', async () => {
  // A copy whose document states a different figure for one exposure rule's clause.
  const base = importReview(DEV01, 'r')
  const rule = rows(base, 'policy_rules').find((r) => r.metric.endsWith('_exposure') && r.limit_type === 'max' && r.effective_from <= base.periodEnd && !r.effective_to)!
  const stated = `${Number(rule.threshold) * 100}%`
  const changed = `${Number(rule.threshold) * 100 - 5}%`
  const dir = variant('investment_policy.md', (t) => t.replace(new RegExp(`^(${rule.document_clause.replace('.', '\\.')} .*?)${stated.replace('%', '')}%`, 'm'), `$1${changed}`))
  const s = runOn(dir)
  const section = rule.document_clause.split('.')[0]
  const portfolio = rule.portfolio_id
  const claims: Claim[] = [
    { key: 'rule', label: 'Limit in the structured rules', value: `${Number(rule.threshold) * 100}.00%`, measure: 'policy_limit', source: { rule: rule.rule_id, version: rule.version } },
    { key: 'document', label: 'Limit in the policy document', value: changed, measure: 'document_figure', source: { quote: changed, section } },
  ]
  const r = await propose(s, { classification: 'policy_inconsistency', portfolios: [portfolio], statement: `The rules give ${claims[0].value}; the document gives ${changed}.`, claims })
  const f = finding(s, r.finding_id)
  assert.equal(r.validation.state, 'validated')
  assert.deepEqual(f.validation.claims!.map((c) => c.basis), ['policy_rule', 'source_text'])
  // A limit for assessing a breach can't be taken from the document text.
  const fromText = await propose(s, { classification: 'potential_exception', portfolios: [portfolio], statement: `The limit is ${changed}.`, claims: [{ key: 'limit', label: 'Limit', value: changed, measure: 'policy_limit', source: { quote: changed, section } }] })
  assert.equal(fromText.classification, 'observation')
  assert.match(finding(s, fromText.finding_id).validation.claims![0].reason!, /come from the structured rules/)
})

test('validation: an action recorded Completed whose target the holdings miss stays visibly inconsistent', async () => {
  // A copy where a completed action's percentage target is set below the current weight of the fund it names.
  const base = importReview(DEV01, 'r')
  const portfolios = rows(base, 'portfolios')
  const held = rows(base, 'positions').filter((r) => r.period_end === base.periodEnd)
  const done = rows(base, 'committee_actions').find((a) => a.status.toLowerCase() === 'completed' && /\d+(?:\.\d+)?%/.test(a.action) && held.some((h) => a.action.includes(h.instrument_name)))!
  const holding = held.find((h) => done.action.includes(h.instrument_name) && done.action.includes(portfolios.find((p) => p.portfolio_id === h.portfolio_id)!.portfolio_name))!
  const target = `${Math.floor(Number(holding.reported_weight) * 100) - 1}%`
  const dir = variant('committee_actions.csv', (t) => t.replace(done.action, done.action.replace(/\d+(?:\.\d+)?%/, target)))
  const s = runOn(dir)
  const c = await check(s, { check: 'holding_concentration', portfolio_id: holding.portfolio_id })
  const action = rows(s.review, 'committee_actions').find((a) => a.action_id === done.action_id)!
  const claims = (relation: 'at_or_below' | 'above'): Claim[] => [
    { key: 'weight', label: 'Weight of the fund', value: valueOf(c, `${holding.instrument_id}:weight`), measure: 'holding_weight', instrument: holding.instrument_id, source: { fact: `${c.check_id}:${holding.instrument_id}:weight` } },
    { key: 'target', label: 'Target in the action', value: target, measure: 'action_threshold', source: { quote: target, row: action.row_id } },
    { key: 'meets', label: 'Weight against the target', measure: 'comparison', source: { derived: 'comparison', of: ['weight', 'target'], relation } },
  ]
  const text = `${action.action_id} is recorded ${action.status}; the fund's weight is ${valueOf(c, `${holding.instrument_id}:weight`)} against a ${target} target.`
  // Taking the status at its word fails: the comparison it implies does not hold.
  const trusting = await propose(s, { review_area: 'committee_actions', portfolios: [holding.portfolio_id], statement: text, claims: claims('at_or_below') })
  assert.equal(trusting.validation.state, 'unvalidated')
  assert.match(claimResult(finding(s, trusting.finding_id), 'meets').reason!, /Weight of the fund \(.+\) is not at or below Target in the action \(.+\)/)
  // Reporting the conflict, with neither source overruling the other, is supported.
  const conflict = await propose(s, { classification: 'data_quality', review_area: 'committee_actions', portfolios: [holding.portfolio_id], statement: text, claims: claims('above') })
  assert.equal(conflict.validation.state, 'validated')
})

test('revisions: a suspected breach resolved by the structured rule replaces it, and the earlier finding is kept', async () => {
  // The suspicion rests on the document's figure in a copy where the document is stricter than the rule.
  const base = importReview(DEV01, 'r')
  const rule = rows(base, 'policy_rules').find((r) => r.metric === 'equity_exposure' && r.limit_type === 'max' && !r.effective_to)!
  const s0 = runOn()
  const p = rule.portfolio_id
  const e0 = await check(s0, { check: 'lookthrough_exposure', portfolio_id: p, asset_class: 'equity' })
  const strict = `${Math.floor(Number(e0.exposure) * 100) - 1}%`
  const dir = variant('investment_policy.md', (t) => t.replace(new RegExp(`^(${rule.document_clause.replace('.', '\\.')} .*?)\\d+(?:\\.\\d+)?%`, 'm'), `$1${strict}`))
  const s = runOn(dir)
  const e = await check(s, { check: 'lookthrough_exposure', portfolio_id: p, asset_class: 'equity' })
  const exposure: Claim = { key: 'exposure', label: 'Equity exposure', value: valueOf(e, 'exposure'), measure: 'exposure', asset_class: 'equity', source: { fact: `${e.check_id}:exposure` } }
  const suspected = await propose(s, {
    classification: 'potential_exception',
    portfolios: [p],
    statement: `Equity exposure of ${exposure.value} is above the ${strict} in the policy document.`,
    claims: [exposure, { key: 'doc', label: 'Document figure', value: strict, measure: 'document_figure', source: { quote: strict, section: rule.document_clause.split('.')[0] } }, { key: 'over', label: 'Exposure against the document', measure: 'comparison', source: { derived: 'comparison', of: ['exposure', 'doc'], relation: 'above' } }],
  })
  const limit = valueOf(e, `rule:${rule.rule_id}:limit`)
  const below = Number(exposure.value!.replace('%', '')) <= Number(limit.replace('%', ''))
  const resolved = await propose(s, {
    replaces: suspected.finding_id,
    classification: 'policy_inconsistency',
    materiality: 'medium',
    portfolios: [p],
    statement: `The structured rule's limit is ${limit}; the document's ${strict} disagrees with it.`,
    claims: [exposure, { key: 'limit', label: 'Structured limit', value: limit, measure: 'policy_limit', source: { rule: rule.rule_id, version: rule.version } }, { key: 'doc', label: 'Document figure', value: strict, measure: 'document_figure', source: { quote: strict, section: rule.document_clause.split('.')[0] } }, { key: 'vs', label: 'Exposure against the rule', measure: 'comparison', source: { derived: 'comparison', of: ['exposure', 'limit'], relation: below ? 'at_or_below' : 'above' } }],
  })
  const earlier = finding(s, suspected.finding_id)
  assert.equal(resolved.validation.state, 'validated')
  assert.ok(resolved.current && !isCurrent(earlier), 'the revision is current and the earlier finding is not')
  assert.equal(earlier.superseded_by, resolved.finding_id)
  assert.equal(earlier.classification, 'potential_exception', 'the earlier finding is kept as it was, with its own evidence')
  assert.equal(finding(s, resolved.finding_id).revision!.of, suspected.finding_id)
})

test('revisions: an unsupported replacement leaves the validated finding current; a supported one may raise a breach', async () => {
  const s = runOn()
  const b = await equityBreach(s)
  const valid = await propose(s, { classification: 'potential_exception', portfolios: [b.portfolio], statement: breachText(b), claims: breachClaims(b) })
  const weak = await propose(s, { replaces: valid.finding_id, classification: 'observation', portfolios: [b.portfolio], statement: 'Equity is at 99.99% of the portfolio.', claims: breachClaims(b).slice(0, 1) })
  assert.equal(weak.validation.state, 'unvalidated')
  assert.ok(isCurrent(finding(s, valid.finding_id)) && !weak.current, 'the validated finding stays current; the attempt is kept, not current')
  assert.match(weak.message, /stays current/)
  // Refused outright: an unknown finding, a rejected revision, and (below) one already revised.
  await assert.rejects(propose(s, { replaces: 'F99', portfolios: [b.portfolio], statement: 'x' }), /unknown finding F99/)
  await assert.rejects(propose(s, { replaces: weak.finding_id, portfolios: [b.portfolio], statement: 'x' }), /rejected revision/)

  // The other direction: an unsupported observation revised into a supported breach.
  const vague = await propose(s, { portfolios: [b.portfolio], statement: 'Equity looks high.', check_ids: [b.c.check_id] })
  const raised = await propose(s, { replaces: vague.finding_id, classification: 'potential_exception', materiality: 'high', portfolios: [b.portfolio], statement: breachText(b), claims: breachClaims(b) })
  assert.deepEqual([raised.classification, raised.current, isCurrent(finding(s, vague.finding_id))], ['potential_exception', true, false])
  await assert.rejects(propose(s, { replaces: vague.finding_id, portfolios: [b.portfolio], statement: 'x' }), new RegExp(`already revised as ${raised.finding_id}`))
})
