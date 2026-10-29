// The investigation evaluation (spec §15.2–§15.5): the isolation check, then several fresh Spark runs on each
// scenario, each scored against its answer key. Each run is a new review of the scenario's sources, with no Cairn
// calls and no memory, saved in IGI's database like any other run. Costs about $0.25 a run.
// Run from the repository root, with MODEL_API_KEY set (node --env-file=server/.env ...):
//   node eval/run.ts <scenario ...> [--runs 3] [--effort medium] [--vessel]
import { investigate } from '../server/src/agent.ts'
import { migrate, saveReview, sql } from '../server/src/db.ts'
import { retainSources } from '../server/src/files.ts'
import { useVessel } from '../server/src/model.ts'
import { closeSandbox } from '../server/src/sandbox.ts'
import { blockers, importReview } from '../server/src/sources.ts'
import { answerKeys, scenarioDir } from './answer-keys.ts'
import { leakScan } from './leak-scan.ts'
import { runLine, saveScores, scoreRun, summary, type RunScore } from './score.ts'

const args = process.argv.slice(2)
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const scenarios = args.filter((a, i) => !a.startsWith('--') && !['--runs', '--effort'].includes(args[i - 1]))
const runs = Number(option('--runs') ?? 1)
const effort = option('--effort')
if (!scenarios.length || !(runs >= 1)) {
  console.error('usage: node eval/run.ts <scenario ...> [--runs n] [--effort low|medium|high] [--vessel]')
  process.exit(2)
}
answerKeys(scenarios) // every scenario must have an answer key to score against
// Nothing runs while the agent could see answer-key content (§15.2).
const leaks = leakScan()
if (leaks.length) {
  for (const l of leaks) console.error(`LEAK ${l}`)
  console.error('The isolation check failed: no runs started.')
  process.exit(1)
}
if (args.includes('--vessel')) console.log(`Model requests go through Vessel at ${useVessel()}.`)
await migrate()

const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13)
const scores: RunScore[] = []
for (const scenario of scenarios)
  for (let n = 1; n <= runs; n++) {
    // A fresh review each time, so no run sees another's findings, submissions or packs.
    const id = `eval-${scenario}-${stamp}-${n}`
    const review = importReview(scenarioDir(scenario), id)
    const problems = blockers(review)
    if (problems.length) throw new Error(`${scenario}: ${problems.join('; ')}`)
    await saveReview({ id, periodEnd: review.periodEnd, sourceDir: scenarioDir(scenario) })
    retainSources(scenarioDir(scenario), review.sources)
    console.log(`\n${id}: investigating`)
    const r = await investigate(review, { budget: effort ? { effort } : {}, log: (l) => console.log(`  ${l}`) })
    const s = await scoreRun(r.runId)
    if (typeof s === 'string') console.log(`not scored: ${s}`)
    else console.log(runLine(s)), scores.push(s)
  }
console.log(`\n${summary(scores).join('\n\n')}`)
console.log(`\nSaved ${saveScores('eval', scores, { scenarios, runs, effort: effort ?? 'default' })}`)
await closeSandbox()
await sql.end()
