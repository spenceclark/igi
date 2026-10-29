// The investigation loop's final status (spec §8.4), with the model replaced by a scripted stub, in the
// igi_test_agent database. No request leaves the process.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import type { ModelResponse } from '../src/model.ts'
import { importReview } from '../src/sources.ts'
import { resetDatabase, useTestDatabase } from './helpers.ts'

const skip = await useTestDatabase('agent')
const db = await import('../src/db.ts')
const { investigate } = await import('../src/agent.ts')
after(() => db.sql.end())

const DEV01 = fileURLToPath(new URL('../../fixtures/scenarios/dev-01', import.meta.url))

/** Replaces fetch with a model that answers each request with the next scripted response, and counts requests. */
function scriptedModel(responses: ModelResponse[]) {
  const real = globalThis.fetch
  const sent: unknown[] = []
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify(responses[sent.length - 1] ?? responses.at(-1)), { status: 200 })
  }) as typeof fetch
  return { sent, restore: () => (globalThis.fetch = real) }
}

test('budget: a run that hit a budget ends budget_exhausted, even when the model then writes its summary', { skip }, async () => {
  await resetDatabase(db)
  const review = importReview(DEV01, 'r1')
  await db.saveReview({ id: 'r1', periodEnd: review.periodEnd })
  process.env.MODEL_API_KEY = 'test-key'
  const call = (id: string) => ({ type: 'function_call' as const, call_id: id, name: 'list_sources', arguments: '{}' })
  const model = scriptedModel([
    { status: 'completed', output: [call('c1'), call('c2')] },
    { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Summary.' }] }] },
  ])
  try {
    const r = await investigate(review, { budget: { maxToolCalls: 1 } })
    assert.equal(model.sent.length, 2)
    assert.equal(r.toolCalls, 2)
    assert.equal(r.summary, 'Summary.')
    assert.equal(r.status, 'budget_exhausted', 'a refused call means the review was cut short, never completed')
    const [row] = await db.sql<{ status: string }[]>`select status from analysis_run where id = ${r.runId}`
    assert.equal(row.status, 'budget_exhausted')
  } finally {
    model.restore()
  }
})

test('budget: a Python execution refused by its budget also ends the run budget_exhausted', { skip }, async () => {
  await resetDatabase(db)
  const review = importReview(DEV01, 'r1')
  await db.saveReview({ id: 'r1', periodEnd: review.periodEnd })
  process.env.MODEL_API_KEY = 'test-key'
  const model = scriptedModel([
    { status: 'completed', output: [{ type: 'function_call', call_id: 'c1', name: 'run_python', arguments: JSON.stringify({ purpose: 'p', code: '1' }) }] },
    { status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Summary.' }] }] },
  ])
  try {
    const r = await investigate(review, { budget: { maxPython: 0 } })
    assert.equal(r.state.executions.length, 0, 'the refused code never ran')
    assert.equal(r.status, 'budget_exhausted')
  } finally {
    model.restore()
  }
})
