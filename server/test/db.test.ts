// Runs against the local IGI database (npm run db:up), in its own igi_test database; skipped when it isn't running.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import postgres from 'postgres'

const SERVER = 'postgres://igi:igi@127.0.0.1:5434'
let skip: string | false = false
try {
  const admin = postgres(`${SERVER}/igi`, { onnotice: () => {}, connect_timeout: 3 })
  await admin`create database igi_test`.catch((e) => {
    if (e.code !== '42P04') throw e // already exists
  })
  await admin.end()
} catch (e) {
  skip = `local database not running (npm run db:up): ${(e as Error).message}`
}
process.env.DATABASE_URL = `${SERVER}/igi_test`
const db = skip ? undefined : await import('../src/db.ts')
after(() => db?.sql.end())

async function reset() {
  await db!.sql`drop schema public cascade`
  await db!.sql`create schema public`
  await db!.migrate()
  await db!.migrate() // the schema applies twice without complaint
  await db!.saveReview({ id: 'r1', periodEnd: '2026-09-30' })
}

const finding = (id: string, more: Record<string, unknown> = {}) => ({
  id,
  title: `Finding ${id}`,
  statement: 'Equity look-through exposure is above the limit.',
  classification: 'potential_exception',
  proposed_classification: 'potential_exception',
  materiality: 'high',
  portfolios: ['P1'],
  check_ids: ['C1'],
  validation: { state: 'validated', matched: ['exposure: 36.97% (C1)'], unmatched: [] },
  ...more,
})

test('db: a run saved during and after the loop reads back whole', { skip }, async () => {
  await reset()
  const at = '2026-10-28T09:00:00.000Z'
  const run = {
    id: 'run-r1-1',
    reviewId: 'r1',
    startedAt: at,
    config: { model: 'muse-spark-1.3', memory_enabled: false, knowledge_ids: [] },
    usage: { input: 10, costUsd: 0.01 },
    summary: '',
  }
  const e1 = { seq: 1, at, type: 'model_turn', turn: 1, tool_calls: ['run_python'] }
  const e2 = { seq: 2, at, type: 'tool_call', turn: 1, name: 'run_python', arguments: { code: 'x' }, result: 'a string result' }
  const executions = [
    { id: 'X1', purpose: 'p', code: 'rows', ok: true, result: ['0.3697', '1'], stdout: '', ms: 5, reads: [{ source: 'positions', returned: 3 }] },
    { id: 'X2', purpose: 'p', code: 'x', ok: false, result: undefined, stdout: 'out', error: 'TypeError', errorType: 'TypeError', ms: 2, reads: [] },
  ]
  const checks = [{ id: 'C1', args: { check: 'lookthrough_exposure', portfolio_id: 'P1' } as any, result: { exposure: '0.3697' }, rowsUsed: ['positions:1'] }]
  const notes = [{ id: 'N1', kind: 'open_question', text: 'Which source is authoritative?', related_ids: ['C1'] }]

  await db!.saveRun({ ...run, status: 'running', turns: 1, toolCalls: 1, events: [e1], state: { executions: executions.slice(0, 1), checks: [], notes: [], findings: [finding('F1')] } })
  const f1 = finding('F1', { superseded_by: 'F2' })
  const state = { executions, checks, notes, findings: [f1, finding('F2', { replaces: 'F1' })] }
  await db!.saveRun({ ...run, status: 'completed_with_uncertainties', endedAt: at, turns: 2, toolCalls: 3, summary: 'Done.', events: [e1, e2], state })

  const r = (await db!.loadRun('run-r1-1'))!
  assert.equal(r.run.status, 'completed_with_uncertainties')
  assert.equal(r.run.agent_definition_id, 'investment-governance')
  assert.deepEqual(r.run.config.knowledge_ids, [])
  assert.deepEqual(r.events.map((e) => [e.seq, e.type]), [[1, 'model_turn'], [2, 'tool_call']])
  assert.equal(r.events[1].data.result, 'a string result')
  assert.deepEqual(r.executions.map((x) => x.result), [['0.3697', '1'], null])
  assert.deepEqual(r.executions[0].reads, [{ source: 'positions', returned: 3 }])
  assert.deepEqual(r.checks[0].rows_used, ['positions:1'])
  assert.deepEqual(r.notes[0].related_ids, ['C1'])
  assert.deepEqual(r.findings.map((f) => [f.id, f.version, f.superseded_by]), [['F1', 1, 'F2'], ['F2', 1, null]])
  assert.deepEqual(r.findings[1].content.portfolios, ['P1'])
  assert.equal(r.findings[1].content.replaces, 'F1')
  assert.equal(r.findings[0].validation.state, 'validated')
})

test('db: a ledger entry starts as sending and belongs to one finding version', { skip }, async () => {
  await reset()
  const at = '2026-10-28T09:00:00.000Z'
  await db!.saveRun({ id: 'run-r1-2', reviewId: 'r1', startedAt: at, status: 'completed', config: {}, turns: 1, toolCalls: 1, usage: {}, summary: '', events: [], state: { executions: [], checks: [], notes: [], findings: [finding('F1')] } })
  const [entry] = await db!.sql`
    insert into cairn_submission (run_id, finding_id, finding_version, kind, payload_sha256, source_reference)
    values ('run-r1-2', 'F1', 1, 'assertion', 'abc', 'IGI review 2026-10, finding F1') returning outcome`
  assert.equal(entry.outcome, 'sending')
  await assert.rejects(db!.sql`
    insert into cairn_submission (run_id, finding_id, finding_version, kind, payload_sha256, source_reference)
    values ('run-r1-2', 'F1', 2, 'file', 'abc', 'r')`, /foreign key/)
  await assert.rejects(db!.sql`update finding set withdrawn_at = now() where id = 'F1'`, /check constraint/)
})
