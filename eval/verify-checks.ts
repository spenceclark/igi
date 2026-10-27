// Cross-checks the server's trusted checks against the facts the scenario generator computed
// independently. Run from the repository root: node eval/verify-checks.ts
import { readFileSync, readdirSync } from 'node:fs'
import { runCheck } from '../server/src/checks.ts'
import { importReview } from '../server/src/sources.ts'

let failures = 0
for (const file of readdirSync('eval/answer-keys')) {
  const key = JSON.parse(readFileSync(`eval/answer-keys/${file}`, 'utf8'))
  const review = importReview(`fixtures/scenarios/${key.scenario}`, key.scenario)
  const breaches: string[] = []
  for (const [k, expected] of Object.entries(key.facts as Record<string, string>)) {
    const [portfolio_id, period_end, metric] = k.split('|')
    const r: any =
      metric === 'equity_exposure' || metric === 'cash_exposure'
        ? runCheck(review, { check: 'lookthrough_exposure', portfolio_id, period_end, asset_class: metric.split('_')[0] }).result
        : metric === 'single_holding_weight'
          ? runCheck(review, { check: 'holding_concentration', portfolio_id, period_end }).result
          : runCheck(review, { check: 'relative_performance', portfolio_id, period_end }).result
    const actual = r.exposure ?? r.largest?.weight ?? r.absolute_difference
    if (actual !== expected) failures++, console.log(`FAIL ${key.scenario} ${k}: check ${actual}, generator ${expected}`)
    for (const c of r.comparisons) if (c.status === 'breach') breaches.push(`${portfolio_id}|${period_end}|${c.rule_id}`)
  }
  const same = JSON.stringify([...new Set(breaches)].sort()) === JSON.stringify([...key.expectedBreaches].sort())
  if (!same) failures++
  console.log(`${same ? 'ok  ' : 'FAIL'} ${key.scenario}: ${Object.keys(key.facts).length} facts, breaches ${[...new Set(breaches)].join(', ')}`)
}
process.exit(failures ? 1 : 0)
