// Contradictions, revisions and durable review (spec §15.7): the cases the validation, ledger and pack tests leave
// open. Revision references and claim scope run on dev-01 with no database; the rest run against the Cairn test
// double in the igi_test_contradictions database, with a fetch that can hold or act on a status read.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cairnClient } from '../src/cairn.ts'
import { cairnFake } from '../src/cairn-fake.ts'
import type { FindingArtifacts } from '../src/db.ts'
import { isCurrent } from '../src/evidence.ts'
import { filePath, putFile } from '../src/files.ts'
import { closeRenderer } from '../src/render.ts'
import { importReview } from '../src/sources.ts'
import { callTool, type FindingArgs, type RunState } from '../src/tools.ts'
import { CONFIG, finding, resetDatabase, useTestDatabase } from './helpers.ts'

const skip = await useTestDatabase('contradictions')
const db = await import('../src/db.ts')
const ledger = await import('../src/ledger.ts')
const pack = await import('../src/committee-pack.ts')
after(async () => {
  await closeRenderer()
  await db.sql.end()
})

const DEV01 = fileURLToPath(new URL('../../fixtures/scenarios/dev-01', import.meta.url))
type Proposed = { finding_id: string; validation: { state: string }; current: boolean }
const runOn = (): RunState => ({ review: importReview(DEV01, 'r'), now: new Date(), executions: [], checks: [], notes: [], findings: [], maxPython: 0 })
const propose = async (s: RunState, a: Partial<FindingArgs>) =>
  (await callTool(s, 'propose_finding', { title: 'Case', classification: 'observation', review_area: 'allocation_risk', materiality: 'low', explanation: 'For the record.', statement: 'Equity looks high.', ...a })) as Proposed

test('revisions: a finding cannot name itself, another run’s finding or a revised one, so no chain forks or loops', async () => {
  const s = runOn()
  const p = s.review.sources.find((x) => x.id === 'portfolios')!.rows[0].portfolio_id
  const { check_id } = (await callTool(s, 'run_check', { check: 'lookthrough_exposure', portfolio_id: p, asset_class: 'equity' })) as { check_id: string }
  const first = await propose(s, { portfolios: [p], check_ids: [check_id] })
  // The id it would get (its own), and run- or review-qualified ids: replaces names a finding of this run only.
  for (const id of ['F2', `run-elsewhere:${first.finding_id}`, `other-review/${first.finding_id}`]) await assert.rejects(propose(s, { portfolios: [p], check_ids: [check_id], replaces: id }), new RegExp(`unknown finding ${id}`))
  const second = await propose(s, { portfolios: [p], check_ids: [check_id], replaces: first.finding_id })
  // Going back to the revised finding would fork the chain, and the chain can only run forwards, so it can't loop.
  await assert.rejects(propose(s, { portfolios: [p], check_ids: [check_id], replaces: first.finding_id }), /already revised/)
  const third = await propose(s, { portfolios: [p], check_ids: [check_id], replaces: second.finding_id })
  assert.deepEqual(s.findings.filter(isCurrent).map((f) => f.id), [third.finding_id], 'one current finding, whatever was attempted')
  assert.equal(s.findings.length, 3, 'refused attempts are not stored')
})

test('validation: a holding’s weight claimed for another instrument is rejected, though the number is right', async () => {
  const s = runOn()
  const p = s.review.sources.find((x) => x.id === 'portfolios')!.rows[0].portfolio_id
  const c = (await callTool(s, 'run_check', { check: 'holding_concentration', portfolio_id: p })) as { check_id: string; holdings: { instrument_id: string; weight: string }[] }
  const [a, b] = c.holdings
  const weight = `${(Number(a.weight) * 100).toFixed(2)}%`
  const claim = (instrument: string) => ({ key: 'w', label: 'Weight of the fund', value: weight, measure: 'holding_weight', instrument, source: { fact: `${c.check_id}:${a.instrument_id}:weight` } })
  const wrong = await propose(s, { portfolios: [p], statement: `The fund is ${weight} of the portfolio.`, claims: [claim(b.instrument_id)] })
  assert.equal(wrong.validation.state, 'unvalidated')
  assert.match(s.findings.at(-1)!.validation.claims![0].reason!, new RegExp(`is for instrument ${a.instrument_id}`))
  assert.equal((await propose(s, { portfolios: [p], statement: `The fund is ${weight} of the portfolio.`, claims: [claim(a.instrument_id)] })).validation.state, 'validated')
})

/**
 * A review with one saved run per id, each holding the given findings, on dev-01's sources, and a Cairn test double
 * whose status reads can be held or acted on: `onStatusRead` runs once Cairn has answered a status read and before
 * IGI gets the answer.
 */
async function setup(runs: Record<string, ReturnType<typeof finding>[]>) {
  await resetDatabase(db)
  process.env.FILES_DIR = mkdtempSync(join(tmpdir(), 'igi-files-')) // each case's files from scratch, like its database
  await db.saveReview({ id: 'r1', periodEnd: '2026-09-30', sourceDir: DEV01 })
  const sources = importReview(DEV01, 'r1').sources.map(({ id, file, sha256 }) => ({ id, file, sha256 }))
  let minute = 0
  for (const [id, findings] of Object.entries(runs)) {
    const at = `2026-10-28T09:0${minute++}:00.000Z`
    const checks = [{ id: 'C1', args: { check: 'lookthrough_exposure', portfolio_id: 'P-CAU', asset_class: 'equity' }, result: { exposure: '0.3697', comparisons: [] }, rowsUsed: ['positions:1'] }]
    await db.saveRun({ id, reviewId: 'r1', startedAt: at, endedAt: at, status: 'completed', config: { ...CONFIG, sources }, turns: 1, toolCalls: 1, usage: {}, summary: '', events: [], state: { executions: [], checks, notes: [], findings } })
  }
  const fake = cairnFake()
  const hooks: { onStatusRead?: () => void | Promise<void> } = {}
  const watched: typeof fetch = async (input, init) => {
    const res = await fake.fetch(input, init)
    if ((init?.method ?? 'GET') === 'GET' && String(input).includes('/candidates?') && hooks.onStatusRead) {
      const hook = hooks.onStatusRead
      hooks.onStatusRead = undefined
      await hook()
    }
    return res
  }
  const cairn = cairnClient({ baseUrl: 'https://cairn.test', key: fake.key, fetch: watched })
  await ledger.openRecord(cairn, 'r1', { subjectReference: fake.subject.cairnReference, procedureName: fake.procedure.name })
  return { fake, cairn, hooks }
}
const F1 = finding('F1', { material_numbers: [{ label: 'Equity exposure', value: '36.97%', check_id: 'C1' }] })
const stateOf = async (runId: string, id = 'F1') => (await pack.resolveFindings('r1', (await db.sql<{ cairn_record: { record: { cairnReference: string } } }[]>`select cairn_record from review`)[0].cairn_record.record.cairnReference)).find((r) => r.f.run_id === runId && r.f.id === id)!

test('status: a read that answers after a newer one never rolls an item back', { skip }, async () => {
  const { fake, cairn, hooks } = await setup({ 'run-a': [F1] })
  const [a, f] = await ledger.submitFinding(cairn, { runId: 'run-a', id: 'F1', version: 1 })
  fake.file(a.candidate_id!)
  fake.file(f.candidate_id!)
  await ledger.refreshStatus(cairn, 'r1')
  assert.equal((await stateOf('run-a')).state, 'publication_ready')

  // An earlier read (both active) is held after Cairn answers it; the assertion is voided; a later read sees that.
  let release!: () => void
  let answered!: () => void
  const held = new Promise<void>((r) => (release = r))
  const ready = new Promise<void>((r) => (answered = r))
  hooks.onStatusRead = async () => {
    answered()
    await held
  }
  const earlier = ledger.refreshStatus(cairn, 'r1')
  await ready
  fake.voidEvidence(a.candidate_id!)
  await ledger.refreshStatus(cairn, 'r1')
  release()
  await earlier
  const now = await stateOf('run-a')
  assert.deepEqual([now.state, now.items.assertion], ['incomplete', 'voided'], 'the earlier answer arrived last but is older, so it is ignored')
})

test('pairs: the same F1 label in two runs never makes one finding of their items', { skip }, async () => {
  const { fake, cairn } = await setup({ 'run-a': [F1], 'run-b': [F1] })
  const [aa, af] = await ledger.submitFinding(cairn, { runId: 'run-a', id: 'F1', version: 1 })
  const [ba, bf] = await ledger.submitFinding(cairn, { runId: 'run-b', id: 'F1', version: 1 })
  // Run A's assertion and run B's package filed: a whole "F1" by label, but neither finding is complete.
  fake.file(aa.candidate_id!)
  fake.file(bf.candidate_id!)
  const r = await pack.generatePack(cairn, 'r1')
  assert.ok('blockers' in r)
  assert.deepEqual(r.blockers.map((b) => `${b.finding?.runId} ${b.finding?.id} ${b.reason}`), ['run-a F1 pending: assertion accepted, package unfiled', 'run-b F1 pending: assertion unfiled, package accepted'])
  assert.notEqual(aa.source_reference, ba.source_reference, 'Cairn shows the two runs’ items under different references')

  // Once each finding's own two items are filed, the pack pairs each finding with its own run's candidates only.
  fake.file(af.candidate_id!)
  fake.file(ba.candidate_id!)
  const done = await pack.generatePack(cairn, 'r1')
  assert.ok('pack' in done)
  assert.deepEqual(
    done.pack.snapshot.findings.map((x) => [x.runId, x.assertion.candidateId, x.package.candidateId]),
    [['run-a', aa.candidate_id, af.candidate_id], ['run-b', ba.candidate_id, bf.candidate_id]],
  )
})

test('pack: evidence voided while a pack is generated is caught at the next check, before it is submitted', { skip }, async () => {
  const { fake, cairn, hooks } = await setup({ 'run-a': [F1] })
  const [a, f] = await ledger.submitFinding(cairn, { runId: 'run-a', id: 'F1', version: 1 })
  fake.file(a.candidate_id!)
  fake.file(f.candidate_id!)
  // The generation's read says active; the person voids the assertion straight after, while the pack is built.
  hooks.onStatusRead = () => fake.voidEvidence(a.candidate_id!)
  const r = await pack.generatePack(cairn, 'r1')
  assert.ok('pack' in r, 'built on the read it made, which was true when made')
  // Opening, polling or submitting the pack reads Cairn first: the void is found and the pack is stale.
  await pack.checkPacks(cairn, 'r1')
  assert.equal((await pack.listPacks('r1'))[0].stale_reason, 'F1 v1 assertion voided')
  await assert.rejects(pack.submitPack(cairn, 'r1'), /pack v1 is stale/)
  assert.ok(!fake.candidates.some((c) => c.filename?.includes('committee-pack')), 'nothing was sent to Cairn')
})

test('packages: a version whose Markdown package was stored before PDFs resends that file; no PDF stands in for it', { skip }, async () => {
  const { fake, cairn } = await setup({ 'run-a': [F1] })
  // The package as an earlier IGI stored it, before PDFs: a Markdown file recorded on the version.
  const md = new TextEncoder().encode('# F1\n\nThe investigation package as first submitted.\n')
  const sha = createHash('sha256').update(md).digest('hex')
  putFile('findings/run-a/F1-v1.md', md)
  await db.sql`update finding set package_key = 'findings/run-a/F1-v1.md', package_sha256 = ${sha} where run_id = 'run-a' and id = 'F1'`
  const [, file] = await ledger.submitFinding(cairn, { runId: 'run-a', id: 'F1', version: 1 })
  const sent = fake.candidates.find((c) => c.candidateId === file.candidate_id)!
  assert.deepEqual([sent.filename, createHash('sha256').update(sent.bytes!).digest('hex'), file.payload_sha256], ['IGI-r1-F1-v1.md', sha, sha])
  const [row] = await db.sql<{ artifacts: FindingArtifacts }[]>`select artifacts from finding where run_id = 'run-a' and id = 'F1'`
  assert.deepEqual([row.artifacts.package.key, row.artifacts.package.mediaType], ['findings/run-a/F1-v1.md', 'text/markdown'])
  // A PDF of the same finding would need its own submission and acceptance, as a new version: none is made here.
  assert.ok(!existsSync(filePath('findings/run-a/F1-v1.pdf')))
})
