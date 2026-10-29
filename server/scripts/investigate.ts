// Gate B proof of concept (spec §17.3 item 4): import a scenario and let Spark investigate it.
// The run and its trace are saved in IGI's database (npm run db:up for the local one).
// Run from server/: node --env-file-if-exists=.env scripts/investigate.ts ../fixtures/scenarios/dev-01 [--review id] [--effort high] [--vessel]
// The review id defaults to the folder's name; give another to start a fresh review (and Cairn record) on the same sources.
// --vessel sends the model requests through the local Vessel proxy (VESSEL_URL, default 127.0.0.1:4550), tagged
// spark, in a Vessel session named after the run, so every turn can be inspected there.
import { basename, resolve } from 'node:path'
import { investigate } from '../src/agent.ts'
import { migrate, saveReview, sql } from '../src/db.ts'
import { retainSources } from '../src/files.ts'
import { useVessel } from '../src/model.ts'
import { closeSandbox } from '../src/sandbox.ts'
import { importReview, periodProblem } from '../src/sources.ts'
import { isCurrent } from '../src/evidence.ts'

const [dir, ...rest] = process.argv.slice(2)
if (!dir) {
  console.error('usage: scripts/investigate.ts <scenario dir> [--review id] [--effort low|medium|high] [--vessel]')
  process.exit(2)
}
const option = (name: string) => (rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined)
const effort = option('--effort')
if (rest.includes('--vessel')) console.log(`Model requests go through Vessel at ${useVessel()}, in a session named after the run.`)
const id = option('--review') ?? basename(dir)
await migrate()
// An existing review keeps its own period end; a new one takes the latest position date in the folder.
const [existing] = await sql<{ period_end: string }[]>`select period_end::text from review where id = ${id}`
const review = importReview(dir, id, existing?.period_end)
const issues = review.sources.flatMap((s) => s.issues)
console.log(`Imported ${review.id}: ${review.sources.length} sources, ${issues.length} validation issues`)
const problem = periodProblem(review)
if (problem) {
  console.error(problem)
  process.exit(1)
}
await saveReview({ id: review.id, periodEnd: review.periodEnd, sourceDir: resolve(dir) })
retainSources(dir, review.sources) // the run records these hashes; the file store keeps the bytes behind them

const r = await investigate(review, { budget: effort ? { effort } : {}, log: console.log })
await closeSandbox()
const live = r.state.findings.filter(isCurrent)
console.log(`\n${r.status}: ${r.turns} turns, ${r.toolCalls} tool calls, ${r.state.executions.length} Python runs, ${r.state.checks.length} checks, $${r.usage.costUsd.toFixed(3)}`)
for (const f of live) console.log(`  ${f.id} [${f.classification}${f.classification !== f.proposed_classification ? ` <- ${f.proposed_classification}` : ''}, ${f.validation.state}] ${f.portfolios} ${f.title}`)
// What each current finding left unsupported, and the revisions made during the run, accepted or not.
for (const f of live) if (f.validation.unmatched.length) console.log(`  ${f.id} not supported: ${f.validation.unmatched.join('; ')}`)
for (const f of r.state.findings) if (f.revision) console.log(`  ${f.id} ${f.revision.accepted ? 'revised' : 'tried to revise'} ${f.revision.of}${f.revision.reason ? `: ${f.revision.reason}` : ''}`)
console.log(`\nSummary:\n${r.summary}\n\nSaved as ${r.runId}.`)
process.exit(r.status === 'failed' ? 1 : 0)
