// The scorer's matching rules on dev-01: a finding is about an issue only through the evidence the answer key names,
// on the issue's portfolio. Run from the repository root: node --test eval/*.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runCheck } from '../server/src/checks.ts'
import type { CheckRow, FindingRow } from '../server/src/db.ts'
import { importReview } from '../server/src/sources.ts'
import type { FindingArgs } from '../server/src/tools.ts'
import { answerKeys, scenarioDir } from './answer-keys.ts'
import { about, cited } from './score.ts'

const key = answerKeys(['dev-01'])[0]
const review = importReview(scenarioDir('dev-01'), 'r')
const issue = (id: string) => [...key.issues, ...key.benign].find((i) => i.id === id)!
// A stored version-1 finding with the given content.
const row = (content: Partial<FindingArgs>): FindingRow => ({
  run_id: 'run', id: 'F1', version: 1, classification: 'potential_exception', proposed_classification: 'potential_exception',
  validation: { state: 'validated', matched: [], unmatched: [] }, superseded_by: null, package_key: null, package_sha256: null, artifacts: null, withdrawn_at: null, withdrawal_reason: null,
  content: { title: 't', statement: 's', explanation: 'e', materiality: 'high', portfolios: [], ...content },
})
const check = (id: string, args: CheckRow['args']): CheckRow => ({ run_id: 'run', id, args, result: runCheck(review, args).result, rows_used: [] })
const matches = (f: FindingRow, id: string, checks: CheckRow[] = []) => about(f, cited(f, checks, review), issue(id))

test('score: a breach matches only its own rule version, on its own portfolio', () => {
  const [rule, version] = issue('I2').rule!.split(' v')
  const p = issue('I2').portfolio!
  assert.ok(matches(row({ portfolios: [p], policy_rule: { rule_id: rule, version } }), 'I2'))
  assert.ok(!matches(row({ portfolios: [p], policy_rule: { rule_id: rule, version: String(Number(version) - 1) } }), 'I2'), 'the superseded version is a different rule')
  assert.ok(!matches(row({ portfolios: ['P-OTHER'], policy_rule: { rule_id: rule, version } }), 'I2'))
  // A breach fact names the rule version its check compared, which is the one in force.
  const c = check('C1', { check: 'holding_concentration', portfolio_id: p })
  assert.ok(matches(row({ portfolios: [p], claims: [{ key: 'x', label: 'x', measure: 'limit_breach', source: { fact: `C1:rule:${rule}:breach` } }] }), 'I2', [c]))
})

test('score: an action issue matches its cited row or its id; a benign anomaly its check', () => {
  const i3 = issue('I3')
  const actionRow = review.sources.find((s) => s.id === 'committee_actions')!.rows.find((r) => r.action_id === i3.action)!
  assert.ok(matches(row({ portfolios: [i3.portfolio!], cited_rows: [actionRow.row_id] }), 'I3'))
  assert.ok(matches(row({ portfolios: [i3.portfolio!], statement: `${i3.action} is overdue.` }), 'I3'))
  assert.ok(!matches(row({ portfolios: [i3.portfolio!], cited_rows: ['committee_actions:3'] }), 'I3'))
  const b1 = issue('B1')
  const c = check('C1', { check: 'relative_performance', portfolio_id: b1.portfolio! })
  assert.ok(matches(row({ portfolios: [b1.portfolio!], check_ids: ['C1'] }), 'B1', [c]))
  assert.ok(!matches(row({ portfolios: [b1.portfolio!], check_ids: ['C1'] }), 'B1', [check('C1', { check: 'fee_change', portfolio_id: b1.portfolio! })]))
})
