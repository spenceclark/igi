// Durable operator work (spec §6.10, §15.7): operations that can't run twice at once, recovery after a restart,
// uploaded source versions and status reads that fail without deciding anything. In the igi_test_operations database.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cairnClient } from '../src/cairn.ts'
import { importReview } from '../src/sources.ts'
import { CONFIG, finding, resetDatabase, useTestDatabase } from './helpers.ts'

const skip = await useTestDatabase('operations')
const db = await import('../src/db.ts')
const ops = await import('../src/operations.ts')
const sources = await import('../src/review-sources.ts')
const reviews = await import('../src/reviews.ts')
after(() => db.sql.end())

const DEV01 = fileURLToPath(new URL('../../fixtures/scenarios/dev-01', import.meta.url))
/** A promise and the function that settles it, for work a test finishes when it chooses. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: Error) => void
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}

test('operations: one of a kind at a time per review, with its result or error recorded', { skip }, async () => {
  await resetDatabase(db)
  await reviews.createReview('r1', '2026-09-30')
  await assert.rejects(reviews.createReview('r1', '2026-09-30'), /already exists/)
  await assert.rejects(reviews.createReview('R 1', '2026-09-30'), /lowercase letters/)
  const gate = deferred<string>()
  const first = await ops.startOperation('r1', 'generate_pack', () => gate.promise)
  // A repeated click gets the running operation back, not a second one; another kind runs alongside.
  await assert.rejects(ops.startOperation('r1', 'generate_pack', async () => 'twice'), (e) => e instanceof ops.AlreadyRunning && e.running.id === first.op.id)
  const other = await ops.startOperation('r1', 'refresh_status', async () => ({ checked: true }))
  assert.equal((await other.done).state, 'succeeded')
  gate.resolve('v1')
  assert.deepEqual([(await first.done).state, (await first.done).result], ['succeeded', 'v1'])
  // Once it has finished, the same kind can start again; a failure is recorded with its message.
  const failing = await ops.startOperation('r1', 'generate_pack', async () => {
    throw new Error('no sources')
  })
  assert.deepEqual([(await failing.done).state, (await failing.done).error], ['failed', 'no sources'])
})

test('operations: after a restart, stopped work is marked interrupted and its run failed; live work is left', { skip }, async () => {
  await resetDatabase(db)
  await reviews.createReview('r1', '2026-09-30')
  // An operation and a run from a process that died, and a run still writing its trace (as from the command line).
  await db.sql`insert into operation (review_id, kind, heartbeat_at) values ('r1', 'investigate', now() - interval '5 minutes')`
  const at = new Date(Date.now() - 3_600_000).toISOString()
  const run = (id: string) => db.saveRun({ id, reviewId: 'r1', startedAt: at, status: 'running', config: CONFIG, turns: 0, toolCalls: 0, usage: {}, summary: '', events: [], state: { executions: [], checks: [], notes: [], findings: [] } })
  await run('run-dead')
  await run('run-live')
  await db.sql`insert into trace_event (run_id, seq, at, type, data) values ('run-live', 1, now(), 'model_turn', '{}')`
  assert.deepEqual(await ops.recoverOperations(), { operations: 1, runs: 1 })
  const states = await db.sql<{ id: string; status: string; summary: string }[]>`select id, status, summary from analysis_run order by id`
  assert.deepEqual(states.map((r) => [r.id, r.status]), [['run-dead', 'failed'], ['run-live', 'running']])
  assert.match(states[0].summary, /Interrupted: the service stopped during this run/)
  const [op] = await db.sql<{ state: string }[]>`select state from operation`
  assert.equal(op.state, 'interrupted')
  // The interrupted operation no longer blocks a new one of its kind.
  await ops.startOperation('r1', 'investigate', async () => 'again')
})

test('sources: each upload is an immutable version; the review reads the current set', { skip }, async () => {
  await resetDatabase(db)
  await reviews.createReview('r1', '2026-09-30')
  await assert.rejects(sources.reviewDir('r1'), /no sources; upload them first/)
  for (const f of readdirSync(DEV01)) await sources.uploadSource('r1', f, new Uint8Array(readFileSync(join(DEV01, f))))
  const dir = await sources.reviewDir('r1')
  assert.deepEqual(importReview(dir, 'r1').sources.map((s) => s.sha256), importReview(DEV01, 'r1').sources.map((s) => s.sha256), 'the assembled folder holds exactly the uploads')
  assert.equal(await sources.reviewDir('r1'), dir, 'the same set reuses its folder')
  // A changed file is a new version: the current set and its folder change, and the old bytes are kept.
  const fees = readFileSync(join(DEV01, 'fees.csv'), 'utf8') + 'ZZ4RJNDOLY80,2026-12-31,0.0006\n'
  await sources.uploadSource('r1', 'fees.csv', new TextEncoder().encode(fees))
  const current = await sources.currentSources('r1')
  assert.equal(current.length, readdirSync(DEV01).length)
  assert.notEqual(await sources.reviewDir('r1'), dir)
  assert.equal((await db.sql`select 1 from review_source where file = 'fees.csv'`).length, 2)
  // Names that could reach outside the folder, other formats and empty files are refused.
  for (const bad of ['../fees.csv', 'a/b.csv', 'fees.exe', '.hidden.csv']) await assert.rejects(sources.uploadSource('r1', bad, new Uint8Array(1)), /not an accepted source file/)
  await assert.rejects(sources.uploadSource('r1', 'empty.csv', new Uint8Array()), /is empty/)

  // A review for a period the sources don't reach is refused before any model call.
  await reviews.createReview('r2', '2026-12-31')
  for (const f of readdirSync(DEV01)) await sources.uploadSource('r2', f, new Uint8Array(readFileSync(join(DEV01, f))))
  await assert.rejects(reviews.investigateReview('r2'), /no positions at the review's period end 2026-12-31/)
  assert.equal((await db.sql`select 1 from operation where review_id = 'r2'`).length, 0)
})

test('status: a failed read of Cairn is recorded as uncertainty and changes no candidate', { skip }, async () => {
  await resetDatabase(db)
  await reviews.createReview('r1', '2026-09-30')
  await db.sql`update review set cairn_record = '{"record": {"cairnReference": "CAI-AAAA-BBBB-CCCC-D"}, "steps": []}'`
  // A submitted candidate whose last read-back said unfiled.
  const at = '2026-10-28T09:00:00.000Z'
  await db.saveRun({ id: 'run-1', reviewId: 'r1', startedAt: at, endedAt: at, status: 'completed', config: CONFIG, turns: 1, toolCalls: 1, usage: {}, summary: '', events: [], state: { executions: [], checks: [], notes: [], findings: [finding('F1')] } })
  const unfiled = { status: 'unfiled', evidence: null }
  await db.sql`insert into cairn_submission (run_id, finding_id, finding_version, kind, payload_sha256, source_reference, outcome, candidate_id, cairn_status)
    values ('run-1', 'F1', 1, 'assertion', 'x', 'r', 'submitted', ${crypto.randomUUID()}, ${db.json(unfiled)})`
  const down = cairnClient({ baseUrl: 'https://cairn.test', key: 'k', fetch: async () => { throw new Error('connection refused') } })
  const failed = await (await reviews.refreshReview(down, 'r1')).done
  assert.equal(failed.state, 'failed')
  const [r] = await db.sql<{ status_checked_at: Date | null; status_error: string | null }[]>`select status_checked_at, status_error from review`
  assert.equal(r.status_checked_at, null)
  assert.ok(r.status_error, 'the failure is shown, not taken as a decision')
  const [entry] = await db.sql<{ cairn_status: unknown }[]>`select cairn_status from cairn_submission`
  assert.deepEqual(entry.cairn_status, unfiled, 'the last read-back stands')

  // Just after a good read, another is skipped without calling Cairn.
  await db.sql`update review set status_checked_at = now(), status_error = null`
  const skipped = await (await reviews.refreshReview(down, 'r1')).done
  assert.equal(skipped.state, 'succeeded')
  assert.deepEqual(skipped.result, { checked: false })
})
