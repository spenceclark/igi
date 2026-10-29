import { test } from 'node:test'
import assert from 'node:assert/strict'
import { type Cairn, cairnClient, CairnRefused, CairnUncertain } from '../src/cairn.ts'
import { type CairnFake, cairnFake } from '../src/cairn-fake.ts'

function setup(opts: Parameters<typeof cairnFake>[0] = {}) {
  const fake = cairnFake(opts)
  return { fake, cairn: cairnClient({ baseUrl: 'https://cairn.test/', key: fake.key, fetch: fake.fetch, now: opts.now }) }
}

async function startReview(cairn: Cairn, fake: CairnFake, sourceReference = 'IGI review 2026-10') {
  const [subject] = await cairn.findSubject(fake.subject.cairnReference.toLowerCase())
  const [procedure] = await cairn.listStartableProcedures(subject.cairnReference)
  return cairn.startRecord({ procedureId: procedure.id, subjectReference: subject.cairnReference, sourceReference })
}

const refused = (code: string) => (e: unknown) => e instanceof CairnRefused && e.code === code

test('cairn: a review record is started once; a repeat returns it until a person acts on it', async () => {
  const { fake, cairn } = setup()
  const first = await startReview(cairn, fake)
  assert.equal(first.repeated, false)
  assert.equal(first.steps.length, 5)
  assert.deepEqual(first.steps[0].slots.map((s) => s.allowedKinds), [['assertion'], ['document']])
  const again = await startReview(cairn, fake)
  assert.equal(again.repeated, true)
  assert.equal(again.record.cairnReference, first.record.cairnReference)
  fake.actOn(first.record.cairnReference)
  const second = await startReview(cairn, fake)
  assert.equal(second.repeated, false)
  const found = await cairn.findRecords(fake.subject.cairnReference)
  assert.deepEqual(found.map((r) => r.cairnReference), [second.record.cairnReference, first.record.cairnReference])
  assert.equal((await cairn.getRecordSteps(first.record.cairnReference)).steps.length, 5)
})

test('cairn: every candidate status the pack depends on', async () => {
  const { fake, cairn } = setup()
  const { record, steps } = await startReview(cairn, fake)
  const [statement, pkg] = steps[1].slots
  const at = (slotId: string) => ({ proposedStepId: steps[1].id, proposedSlotId: slotId })
  const a = await cairn.submitAssertion({ assertionText: 'F-01 statement', sourceReference: 'IGI review 2026-10, finding F-01', ...at(statement.id) })
  const ref = 'IGI review 2026-10, finding F-01 — 100%'
  const f = await cairn.submitFile({ filename: 'F-01 v1.md', bytes: new TextEncoder().encode('# F-01\n'), contentType: 'text/markdown', sourceReference: ref, ...at(pkg.id) })
  const wrong = await cairn.submitAssertion({ assertionText: 'in the document slot', sourceReference: 'r', ...at(pkg.id) })
  const loose = await cairn.submitAssertion({ assertionText: 'no proposal', sourceReference: 'r' })
  assert.deepEqual([a.placement, f.placement, wrong.placement, loose.placement], ['placed', 'placed', 'kind-not-allowed', null])
  assert.equal(fake.candidates[1].sourceReference, ref)
  assert.equal(fake.candidates[1].filename, 'F-01 v1.md')

  fake.file(a.candidateId)
  fake.file(f.candidateId)
  fake.discard(wrong.candidateId)
  const asked = [f.candidateId, crypto.randomUUID(), a.candidateId, f.candidateId, wrong.candidateId, loose.candidateId]
  const items = await cairn.getCandidateStatus(asked)
  assert.deepEqual(items.map((i) => i.candidateId), [f.candidateId, a.candidateId, wrong.candidateId, loose.candidateId])
  assert.deepEqual(items.map((i) => [i.status, i.evidence?.status ?? null]), [['filed', 'active'], ['filed', 'active'], ['discarded', null], ['unfiled', null]])
  assert.equal(items[0].evidence?.recordReference, record.cairnReference)
  assert.equal(items[0].evidence?.slotId, pkg.id)

  fake.voidEvidence(a.candidateId)
  assert.equal((await cairn.getCandidateStatus([a.candidateId]))[0].evidence?.status, 'voided')
  fake.restrict(record.cairnReference)
  assert.deepEqual(await cairn.getCandidateStatus([f.candidateId]), [{ candidateId: f.candidateId, status: 'filed', evidence: null }])
})

test('cairn: a refusal carries a code and created nothing; a lost or unusable response is uncertain', async () => {
  const { fake, cairn } = setup()
  const wrongKey = cairnClient({ baseUrl: 'https://cairn.test', key: 'cairn_ak_wrong', fetch: fake.fetch })
  await assert.rejects(wrongKey.getCandidateStatus([crypto.randomUUID()]), refused('agent-key.invalid'))
  await assert.rejects(cairn.submitAssertion({ assertionText: 'x'.repeat(4001), sourceReference: 'r' }), refused('validation.failed'))
  await assert.rejects(cairn.submitAssertion({ assertionText: 'x', sourceReference: 'two\nlines' }), refused('validation.failed'))
  await assert.rejects(cairn.submitFile({ filename: 'package.exe', bytes: new Uint8Array(1), sourceReference: 'r' }), refused('stored-file.file-type.unsupported'))
  await assert.rejects(cairn.getCandidateStatus(['not-an-id']), refused('validation.failed'))
  await assert.rejects(cairn.getRecordSteps('CAI-0000-0000-0000-0'), refused('process-instance.not-found'))
  assert.equal(fake.candidates.length, 0)

  fake.dropNextResponse()
  await assert.rejects(cairn.submitAssertion({ assertionText: 'x', sourceReference: 'r' }), CairnUncertain)
  assert.equal(fake.candidates.length, 1) // it landed: an uncertain submission is never resent automatically

  const answering = (res: Response) => cairnClient({ baseUrl: 'https://cairn.test', key: 'k', fetch: (async () => res) as unknown as typeof fetch })
  const send = { assertionText: 'x', sourceReference: 'r' }
  await assert.rejects(answering(new Response('<html>Bad gateway</html>', { status: 502 })).submitAssertion(send), CairnUncertain)
  await assert.rejects(answering(new Response('', { status: 201 })).submitAssertion(send), CairnUncertain)

  const noLookup = cairnFake({ lookup: false })
  const limited = cairnClient({ baseUrl: 'https://cairn.test', key: noLookup.key, fetch: noLookup.fetch })
  await assert.rejects(limited.findRecords('anything'), refused('agent.lookup-not-permitted'))
})

test('cairn: 60 requests per 10 minutes, then Retry-After, which the client waits out without sending', async () => {
  let t = 0
  const { fake, cairn } = setup({ now: () => t })
  const id = crypto.randomUUID()
  for (let i = 0; i < 60; i++) await cairn.getCandidateStatus([id])
  await assert.rejects(cairn.getCandidateStatus([id]), (e) => refused('rate-limited')(e) && (e as CairnRefused).retryAfter === 600)
  // Until Retry-After ends, every route is refused at once and nothing reaches Cairn.
  const sent = fake.requests
  t = 300_000
  await assert.rejects(cairn.findRecords('anything'), (e) => refused('rate-limited')(e) && (e as CairnRefused).retryAfter === 300)
  assert.equal(fake.requests, sent)
  t = 600_000
  assert.deepEqual(await cairn.getCandidateStatus([id]), [])
})

test('cairn: 100 unfiled candidates, 25 untouched records, status asked 100 ids at a time', async () => {
  let t = 0
  const { fake, cairn } = setup({ now: () => (t += 10_000) }) // each look at the clock, the fake's or the client's, moves it 10 s: under the rate limit
  for (let i = 0; i < 100; i++) await cairn.submitAssertion({ assertionText: `a${i}`, sourceReference: 'r' })
  await assert.rejects(cairn.submitAssertion({ assertionText: 'one more', sourceReference: 'r' }), refused('candidate-intake.too-many-unfiled'))
  fake.discard(fake.candidates[0].candidateId)
  await cairn.submitAssertion({ assertionText: 'room again', sourceReference: 'r' })

  const before = fake.requests
  const ids = [...fake.candidates.map((c) => c.candidateId), ...Array.from({ length: 49 }, () => crypto.randomUUID())]
  assert.equal((await cairn.getCandidateStatus(ids)).length, 101)
  assert.equal(fake.requests - before, 2)
  assert.deepEqual(await cairn.getCandidateStatus([]), [])
  assert.equal(fake.requests - before, 2)

  for (let i = 0; i < 25; i++) await startReview(cairn, fake, `review ${i}`)
  await assert.rejects(startReview(cairn, fake, 'review 25'), refused('candidate-intake.too-many-untouched-records'))
  assert.equal((await startReview(cairn, fake, 'review 0')).repeated, true) // a repeat is never refused
})
