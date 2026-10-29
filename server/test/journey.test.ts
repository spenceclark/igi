// The end-to-end journey against the Cairn test double (spec §12.6, §15.6), through the HTTP API: sign in, create a
// review, upload its sources, run a real investigation (the agent loop and its tools, with the model replaced by a
// scripted one served over HTTP), submit the finding, file only its assertion (the pack is blocked), file its
// package, generate the pack, read the PDF, then void evidence (the pack is stale). In igi_test_journey.
// The sources are CSV and Markdown; XLSX, PDF and DOCX uploads join this journey when their importers do.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCheck } from '../src/checks.ts'
import type { FindingRow } from '../src/db.ts'
import type { InputItem, ModelResponse } from '../src/model.ts'
import { importReview } from '../src/sources.ts'
import { pdfText, resetDatabase, useTestDatabase } from './helpers.ts'

const DEV01 = fileURLToPath(new URL('../../fixtures/scenarios/dev-01', import.meta.url))
const skip = await useTestDatabase('journey')

// The portfolio whose equity exposure breaches its limit, found in the data, for the scripted model to look at.
const review = importReview(DEV01, 'r')
const portfolio = review.sources.find((s) => s.id === 'portfolios')!.rows.map((p) => p.portfolio_id).find((p) =>
  (runCheck(review, { check: 'lookthrough_exposure', portfolio_id: p, asset_class: 'equity' }).result.comparisons as { status: string }[]).some((c) => c.status === 'breach'))!

type CheckOut = { check_id: string; facts: Record<string, string>; comparisons: { rule_id: string; version: string; status: string }[] }
const call = (id: string, name: string, args: unknown) => ({ type: 'function_call' as const, call_id: id, name, arguments: JSON.stringify(args) })
/**
 * The scripted model: first it runs the look-through check, then it proposes the breach the check shows, claiming each
 * figure from the facts the check returned, then it writes its summary. Each answer depends only on the tool results
 * in the conversation it is sent, as a real model's would.
 */
function answer(input: InputItem[]): ModelResponse {
  const outputs = input.flatMap((i) => ('type' in i && i.type === 'function_call_output' ? [i.output] : []))
  const usage = { input_tokens: 2000, output_tokens: 200 }
  if (!outputs.length) return { status: 'completed', usage, output: [call('c1', 'run_check', { check: 'lookthrough_exposure', portfolio_id: portfolio, asset_class: 'equity' })] }
  if (outputs.length === 1) {
    const c = JSON.parse(outputs[0]) as CheckOut
    const rule = c.comparisons.find((x) => x.status === 'breach')!
    const fact = (key: string) => `${c.check_id}:${key}`
    const value = (key: string) => c.facts[fact(key)].split(' ')[0]
    const [exposure, limit, excess] = [value('exposure'), value(`rule:${rule.rule_id}:limit`), value(`rule:${rule.rule_id}:breach`)]
    return {
      status: 'completed',
      usage,
      output: [
        call('c2', 'propose_finding', {
          title: 'Equity exposure above its maximum',
          statement: `Look-through equity exposure was ${exposure}, above the ${limit} maximum by ${excess}.`,
          classification: 'potential_exception',
          review_area: 'allocation_risk',
          materiality: 'high',
          portfolios: [portfolio],
          policy_rule: { rule_id: rule.rule_id, version: rule.version },
          check_ids: [c.check_id],
          claims: [
            { key: 'exposure', label: 'Equity exposure', value: exposure, measure: 'exposure', asset_class: 'equity', source: { fact: fact('exposure') } },
            { key: 'limit', label: 'Equity maximum', value: limit, measure: 'policy_limit', source: { rule: rule.rule_id, version: rule.version } },
            { key: 'excess', label: 'Excess over the limit', value: excess, measure: 'limit_breach', source: { fact: fact(`rule:${rule.rule_id}:breach`) } },
          ],
          explanation: 'The structured rule in force at the period end sets the maximum.',
        }),
      ],
    }
  }
  return { status: 'completed', usage, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Examined look-through equity; proposed F1.' }] }] }
}
const requests: { input: InputItem[] }[] = []
const model = createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  const sent = JSON.parse(body) as { input: InputItem[] }
  requests.push(sent)
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(answer(sent.input)))
})
await new Promise<void>((r) => model.listen(0, '127.0.0.1', r))
// The model client reads these when it loads, so they are set before the server's modules are imported.
process.env.META_BASE_URL = `http://127.0.0.1:${(model.address() as AddressInfo).port}`
process.env.MODEL_API_KEY = 'test-key'

const db = await import('../src/db.ts')
const { igiServer } = await import('../src/server.ts')
const { cairnClient } = await import('../src/cairn.ts')
const { cairnFake } = await import('../src/cairn-fake.ts')
const { closeRenderer } = await import('../src/render.ts')
const { closeSandbox } = await import('../src/sandbox.ts')
after(async () => {
  model.close()
  await closeRenderer()
  await closeSandbox()
  await db.sql.end()
})
type Op = { id: string; state: string; result: Record<string, unknown> | null; error: string | null }

test('journey: upload, investigate, submit, partial and full filing, pack PDF, then voided evidence', { skip }, async () => {
  await resetDatabase(db)
  const fake = cairnFake()
  const cairn = cairnClient({ baseUrl: 'https://cairn.test', key: fake.key, fetch: fake.fetch })
  process.env.CAIRN_SUBJECT_REFERENCE = fake.subject.cairnReference
  process.env.CAIRN_PROCEDURE_NAME = fake.procedure.name
  const server = igiServer({ cairn, password: 'correct horse', secureCookies: false, log: () => {} })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  let cookie = ''
  const api = async (method: string, path: string, body?: unknown) => {
    const form = body instanceof FormData
    const res = await fetch(base + path, { method, headers: { ...(body && !form ? { 'Content-Type': 'application/json' } : {}), cookie }, body: form ? body : body === undefined ? undefined : JSON.stringify(body) })
    const json = res.headers.get('content-type')?.includes('json') ? ((await res.json()) as Record<string, unknown>) : null
    return { status: res.status, json, res }
  }
  // Starts an operation and follows it until it ends; it must succeed.
  const operation = async (method: string, path: string, body?: unknown) => {
    const started = await api(method, path, body)
    assert.equal(started.status, 200, JSON.stringify(started.json))
    let op = started.json!.operation as Op
    for (let i = 0; i < 600 && op.state === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 50))
      op = (await api('GET', `/api/operations/${op.id}`)).json as Op
    }
    assert.equal(op.state, 'succeeded', op.error ?? '')
    return op.result!
  }
  type Listed = { finding: FindingRow; state: string; items: { assertion: string; file: string } }
  const findings = async () => (await api('GET', '/api/reviews/r1/findings')).json!.findings as Listed[]

  try {
    cookie = (await api('POST', '/api/login', { password: 'correct horse' })).res.headers.get('set-cookie')!.split(';')[0]
    assert.equal((await api('POST', '/api/reviews', { id: 'r1', periodEnd: review.periodEnd })).status, 200)
    const form = new FormData()
    for (const f of readdirSync(DEV01)) form.append('files', new Blob([readFileSync(join(DEV01, f))]), f)
    assert.equal((await api('POST', '/api/reviews/r1/sources', form)).status, 200)

    // The investigation runs the real loop and tools: the finding is validated against the check the run made.
    const run = await operation('POST', '/api/reviews/r1/investigate', {})
    assert.equal(run.status, 'completed')
    assert.equal(requests.length, 3, 'check, finding, summary')
    const trace = (await api('GET', `/api/runs/${run.runId}`)).json!
    assert.deepEqual((trace.events as { type: string; data: { name?: string } }[]).filter((e) => e.type === 'tool_call').map((e) => e.data.name), ['run_check', 'propose_finding'])
    const [f1] = trace.findings as FindingRow[]
    assert.deepEqual([f1.id, f1.classification, f1.validation.state], ['F1', 'potential_exception', 'validated'])

    // Submitted: an assertion and a PDF package, both waiting in Cairn.
    await operation('POST', '/api/reviews/r1/record')
    await operation('POST', '/api/reviews/r1/submit', { findings: [{ runId: run.runId, id: 'F1', version: 1 }] })
    const assertion = fake.candidates.find((c) => c.kind === 'assertion')!
    const pkg = fake.candidates.find((c) => c.kind === 'file')!
    assert.match(assertion.text!, /^Equity exposure above its maximum\nFinding: potential exception, high materiality; figures validated\./)
    assert.match(pkg.filename!, /^IGI-r1-[0-9a-f]{6}-F1-v1\.pdf$/)

    // Only the assertion filed: the finding is pending and the pack is blocked, whether asked or attempted.
    fake.file(assertion.candidateId)
    await operation('POST', '/api/reviews/r1/refresh')
    const [partial] = await findings()
    assert.deepEqual([partial.state, partial.items], ['pending', { assertion: 'accepted', file: 'unfiled' }])
    const blockers = (await api('GET', '/api/reviews/r1/packs')).json!.blockers as { reason: string }[]
    assert.deepEqual(blockers.map((b) => b.reason), ['pending: assertion accepted, package unfiled'])
    assert.deepEqual(((await operation('POST', '/api/reviews/r1/packs')).blockers as { reason: string }[]).map((b) => b.reason), ['pending: assertion accepted, package unfiled'])

    // The package filed too: generating reads Cairn afresh, finds the finding publication-ready and makes pack v1.
    fake.file(pkg.candidateId)
    assert.deepEqual(await operation('POST', '/api/reviews/r1/packs'), { version: 1 })
    assert.equal((await findings())[0].state, 'publication_ready')
    const file = await api('GET', '/api/reviews/r1/packs/1.pdf')
    assert.equal(file.res.headers.get('x-igi-pack-state'), 'current')
    const text = (await pdfText(new Uint8Array(await file.res.arrayBuffer()))).replace(/\s+/g, ' ')
    for (const c of f1.validation.claims!) assert.ok(text.includes(c.value!), `the pack shows ${c.label} ${c.value}`)
    assert.ok(text.includes(f1.content.statement) && text.includes('IGI finding F1 version 1'))

    // A person voids the package in Cairn: opening the pack finds it stale, and a new pack is blocked.
    fake.voidEvidence(pkg.candidateId)
    const stale = await api('GET', '/api/reviews/r1/packs/1.pdf')
    assert.equal(stale.status, 409)
    assert.match(String(stale.json!.error), /^pack v1 is stale: F1 v1 package voided/)
    assert.equal((await api('GET', '/api/reviews/r1/packs/1.pdf?historical=1')).res.headers.get('x-igi-pack-state'), 'stale')
    assert.deepEqual(((await operation('POST', '/api/reviews/r1/packs')).blockers as { reason: string }[]).map((b) => b.reason), ['incomplete: assertion accepted, package voided'])
  } finally {
    server.close()
  }
})
