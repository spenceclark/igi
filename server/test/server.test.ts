// The HTTP API end to end against the Cairn test double (spec §14, §15.6): sign-in, a review from upload to a filed
// pack, and the refusals. The model is never called: a seeded run stands in for an investigation. In igi_test_server.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cairnClient } from '../src/cairn.ts'
import { cairnFake } from '../src/cairn-fake.ts'
import { closeRenderer } from '../src/render.ts'
import { importReview } from '../src/sources.ts'
import { CONFIG, finding, pdfText, resetDatabase, useTestDatabase } from './helpers.ts'

const skip = await useTestDatabase('server')
const db = await import('../src/db.ts')
const { igiServer } = await import('../src/server.ts')
const { reviewDir } = await import('../src/review-sources.ts')
after(async () => {
  await closeRenderer()
  await db.sql.end()
})

// The realistic variant: workbooks, minutes and PDFs, as an operator uploads them (§7.1).
const DEV01 = fileURLToPath(new URL('../../fixtures/scenarios/dev-01-docs', import.meta.url))
type Op = { id: string; state: string; result: unknown; error: string | null }

test('server: sign in, then a review from upload to a filed pack PDF; refusals along the way', { skip }, async () => {
  await resetDatabase(db)
  const fake = cairnFake()
  const cairn = cairnClient({ baseUrl: 'https://cairn.test', key: fake.key, fetch: fake.fetch })
  process.env.CAIRN_SUBJECT_REFERENCE = fake.subject.cairnReference
  process.env.CAIRN_PROCEDURE_NAME = fake.procedure.name
  const server = igiServer({ cairn, password: 'correct horse', secureCookies: false, log: () => {} })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  let cookie = ''
  // A request to the API with the session cookie; JSON bodies as JSON, uploads as multipart.
  const api = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const form = body instanceof FormData
    const res = await fetch(base + path, { method, headers: { ...(body && !form ? { 'Content-Type': 'application/json' } : {}), cookie, ...headers }, body: form ? body : body === undefined ? undefined : JSON.stringify(body) })
    const json = res.headers.get('content-type')?.includes('json') ? ((await res.json()) as Record<string, unknown>) : null
    return { status: res.status, json, res }
  }
  // Follows an operation until it ends.
  const until = async (op: Op) => {
    for (let i = 0; i < 600 && op.state === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 50))
      op = (await api('GET', `/api/operations/${op.id}`)).json as Op
    }
    assert.equal(op.state, 'succeeded', op.error ?? '')
    return op
  }
  const operation = async (method: string, path: string, body?: unknown) => until((await api(method, path, body)).json!.operation as Op)

  try {
    // Nothing without a session, and the wrong password gets none.
    assert.equal((await api('GET', '/api/reviews')).status, 401)
    assert.equal((await api('POST', '/api/login', { password: 'wrong' })).status, 401)
    const login = await api('POST', '/api/login', { password: 'correct horse' })
    cookie = login.res.headers.get('set-cookie')!.split(';')[0]
    assert.match(login.res.headers.get('set-cookie')!, /HttpOnly; SameSite=Strict/)
    assert.deepEqual((await api('GET', '/api/session')).json, { signedIn: true })

    // A review, its sources uploaded, and the import check shown before any investigation.
    assert.equal((await api('POST', '/api/reviews', { id: 'R 1', periodEnd: '2026-09-30' })).status, 400)
    assert.equal((await api('POST', '/api/reviews', { id: 'r1', periodEnd: '2026-09-30' })).status, 200)
    const form = new FormData()
    for (const f of readdirSync(DEV01)) form.append('files', new Blob([readFileSync(join(DEV01, f))]), f)
    assert.equal((await api('POST', '/api/reviews/r1/sources', form)).status, 200)
    const overview = (await api('GET', '/api/reviews/r1')).json!
    const summary = overview.sources as { source: string; format: string; validation_issues: string[] }[]
    assert.equal(summary.length, 8, 'six files, two of them workbooks holding two sources each')
    assert.deepEqual([...new Set(summary.map((s) => s.format))].sort(), ['docx', 'pdf', 'xlsx'])
    assert.deepEqual(summary.flatMap((s) => s.validation_issues), [])
    assert.equal(overview.importError, null)
    const rows = (await api('GET', '/api/reviews/r1/sources/positions/rows?limit=3')).json! as { rows: unknown[]; provenance: Record<string, { location: string }> }
    assert.equal(rows.rows.length, 3)
    assert.equal(rows.provenance['positions:1'].location, 'sheet Holdings, row 5 (A5:G5)')

    // A seeded investigation over the uploaded sources, with one finding.
    const sources = importReview(await reviewDir('r1'), 'r1').sources.map(({ id, file, sha256 }) => ({ id, file, sha256 }))
    const at = '2026-10-28T09:00:00.000Z'
    const state = { executions: [], checks: [{ id: 'C1', args: { check: 'lookthrough_exposure', portfolio_id: 'P-CAU', asset_class: 'equity' }, result: { exposure: '0.3697', comparisons: [] }, rowsUsed: ['positions:1'] }], notes: [], findings: [finding('F1', { material_numbers: [{ label: 'Equity exposure', value: '36.97%', check_id: 'C1' }], cited_rows: ['positions:1', 'committee_actions:2'] })] }
    await db.saveRun({ id: 'run-r1-1', reviewId: 'r1', startedAt: at, endedAt: at, status: 'completed', config: { ...CONFIG, sources }, turns: 1, toolCalls: 1, usage: {}, summary: '', events: [], state })
    assert.equal(((await api('GET', '/api/runs/run-r1-1')).json!.findings as unknown[]).length, 1)

    // The record, the assertion and package previews, then submission, filing in Cairn and a refresh.
    await operation('POST', '/api/reviews/r1/record')
    const preview = (await api('GET', '/api/findings/run-r1-1/F1/1/assertion')).json!
    assert.equal(preview.sent, false)
    assert.match(String(preview.text), /^Finding F1\nFinding: potential exception/)
    const draft = await api('GET', '/api/findings/run-r1-1/F1/1/package')
    assert.equal(draft.res.headers.get('content-type'), 'application/pdf')
    assert.match(draft.res.headers.get('content-disposition')!, /PREVIEW-IGI-r1-/)
    // The package names where each cited row is in the uploaded files (§15.8).
    const located = await pdfText(new Uint8Array(await draft.res.arrayBuffer()))
    assert.match(located, /positions:1\s+\(valuation-report\.xlsx,\s+sheet\s+Holdings,\s+row\s+5\s+\(A5:G5\)\)/)
    assert.match(located, /committee_actions:2\s+\(committee-minutes-2026-07-15\.docx,\s+table\s+1,\s+row\s+3\)/)
    await operation('POST', '/api/reviews/r1/submit', { findings: [{ runId: 'run-r1-1', id: 'F1', version: 1 }] })
    assert.equal((await api('GET', '/api/findings/run-r1-1/F1/1/assertion')).json!.sent, true)
    for (const c of fake.candidates) fake.file(c.candidateId)
    await operation('POST', '/api/reviews/r1/refresh')
    const findings = (await api('GET', '/api/reviews/r1/findings')).json!.findings as { state: string }[]
    assert.deepEqual(findings.map((f) => f.state), ['publication_ready'])
    assert.ok((await api('GET', '/api/reviews/r1')).json!.review, 'the overview shows when Cairn was read')

    // Nothing blocks, so a pack is generated; its PDF and sandboxed preview are served, and it goes to Cairn.
    assert.deepEqual((await api('GET', '/api/reviews/r1/packs')).json!.blockers, [])
    const generated = await operation('POST', '/api/reviews/r1/packs')
    assert.deepEqual(generated.result, { version: 1 })
    const file = await api('GET', '/api/reviews/r1/packs/1.pdf')
    assert.equal(new TextDecoder().decode((await file.res.arrayBuffer()).slice(0, 5)), '%PDF-')
    assert.equal(file.res.headers.get('x-igi-pack-state'), 'current')
    const html = await api('GET', '/api/reviews/r1/packs/1.html')
    assert.match(html.res.headers.get('content-security-policy')!, /sandbox/)
    await operation('POST', '/api/reviews/r1/packs/submit', {})
    assert.equal(fake.candidates.at(-1)!.filename, 'IGI-r1-committee-pack-v1.pdf')

    // Opening a pack reads Cairn first. Once an included item is voided there the pack is stale, so it opens only
    // as an explicit historical copy, labelled so.
    fake.voidEvidence(fake.candidates[0].candidateId)
    const refused = await api('GET', '/api/reviews/r1/packs/1.pdf')
    assert.equal(refused.status, 409)
    assert.match(String(refused.json!.error), /^pack v1 is stale: F1 v1 assertion voided/)
    const historical = await api('GET', '/api/reviews/r1/packs/1.pdf?historical=1')
    assert.equal(historical.status, 200)
    assert.equal(historical.res.headers.get('x-igi-pack-state'), 'stale')
    assert.ok(historical.res.headers.get('x-igi-verified-at'), 'it says when the review was last verified against Cairn')

    // A form-encoded POST (what a cross-site form sends) is refused; so is an unknown route and a missing UI.
    const plain = await fetch(`${base}/api/reviews/r1/refresh`, { method: 'POST', headers: { cookie, 'Content-Type': 'text/plain' }, body: 'x=1' })
    assert.equal(plain.status, 415)
    assert.equal((await api('GET', '/api/nothing')).status, 404)
    assert.match(String((await api('GET', '/')).json!.error), /web UI is not built/)
  } finally {
    server.close()
  }
})
