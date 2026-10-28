// Gate B proof of concept (spec §17.3 item 4): import a scenario and let Spark investigate it.
// The run and its trace are saved in IGI's database (npm run db:up for the local one).
// Run from server/: node --env-file-if-exists=.env scripts/investigate.ts ../fixtures/scenarios/dev-01 [--review id] [--effort high]
// The review id defaults to the folder's name; give another to start a fresh review (and Cairn record) on the same sources.
import { basename, resolve } from 'node:path'
import { investigate } from '../src/agent.ts'
import { migrate, saveReview } from '../src/db.ts'
import { retainSources } from '../src/files.ts'
import { closeSandbox } from '../src/sandbox.ts'
import { importReview } from '../src/sources.ts'

const [dir, ...rest] = process.argv.slice(2)
if (!dir) {
  console.error('usage: scripts/investigate.ts <scenario dir> [--review id] [--effort low|medium|high]')
  process.exit(2)
}
const option = (name: string) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined)
const effort = option('--effort')
const review = importReview(dir, option('--review') ?? basename(dir))
const issues = review.sources.flatMap((s) => s.issues)
console.log(`Imported ${review.id}: ${review.sources.length} sources, ${issues.length} validation issues`)
await migrate()
await saveReview({ id: review.id, periodEnd: review.periodEnd, sourceDir: resolve(dir) })
retainSources(dir, review.sources) // the run records these hashes; the file store keeps the bytes behind them

const r = await investigate(review, { budget: effort ? { effort } : {}, log: console.log })
await closeSandbox()
const live = r.state.findings.filter((f) => !f.superseded_by)
console.log(`\n${r.status}: ${r.turns} turns, ${r.toolCalls} tool calls, ${r.state.executions.length} Python runs, ${r.state.checks.length} checks, $${r.usage.costUsd.toFixed(3)}`)
for (const f of live) console.log(`  ${f.id} [${f.classification}${f.classification !== f.proposed_classification ? ` <- ${f.proposed_classification}` : ''}, ${f.validation.state}] ${f.portfolios} ${f.title}`)
console.log(`\nSummary:\n${r.summary}\n\nSaved as ${r.runId}.`)
process.exit(r.status === 'failed' ? 1 : 0)
