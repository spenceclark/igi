// Finding states (spec §6.7), and the ledger and read-back against the Cairn test double in the igi_test_ledger database.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cairnClient } from '../src/cairn.ts'
import { cairnFake } from '../src/cairn-fake.ts'
import type { FindingRow } from '../src/db.ts'
import type { LedgerEntry } from '../src/ledger.ts'
import { ASSERTION_LIMIT, composeAssertion } from '../src/package.ts'
import { CONFIG, finding, resetDatabase, useTestDatabase } from './helpers.ts'

const skip = await useTestDatabase('ledger')
const db = await import('../src/db.ts')
const ledger = await import('../src/ledger.ts')
after(() => db.sql.end())

const REC = 'CAI-AAAA-BBBB-CCCC-D'
type ReadBack = LedgerEntry['cairn_status']
const filed = (status: 'active' | 'voided' = 'active', recordReference: string | null = REC): ReadBack => ({
  status: 'filed',
  evidence: { cairnReference: 'EVI-1', status, filedUtc: '2026-10-28T10:00:00Z', voidedUtc: null, recordReference, stepId: null, slotId: null },
})
const entry = (kind: 'assertion' | 'file', outcome: LedgerEntry['outcome'], cairnStatus: ReadBack = null): LedgerEntry => ({
  id: crypto.randomUUID(),
  run_id: 'run',
  finding_id: 'F1',
  finding_version: 1,
  kind,
  payload_sha256: '',
  source_reference: '',
  proposed_step_id: null,
  proposed_slot_id: null,
  outcome,
  candidate_id: outcome === 'submitted' ? crypto.randomUUID() : null,
  placement: null,
  error_code: null,
  cairn_status: cairnStatus,
  cairn_read_at: null,
  created_at: new Date(),
})
const a = (outcome: LedgerEntry['outcome'], s: ReadBack = null) => entry('assertion', outcome, s)
const f = (outcome: LedgerEntry['outcome'], s: ReadBack = null) => entry('file', outcome, s)
const unfiled: ReadBack = { status: 'unfiled', evidence: null }
const discarded: ReadBack = { status: 'discarded', evidence: null }

test('ledger: finding states follow §6.7, first match in its order', () => {
  const cases: [string, LedgerEntry[], string, boolean?][] = [
    ['nothing sent', [], 'not_submitted'],
    ['withdrawn before sending', [], 'withdrawn', true],
    ['withdrawn although accepted', [a('submitted', filed()), f('submitted', filed())], 'withdrawn', true],
    ['assertion discarded', [a('submitted', discarded), f('submitted', filed())], 'rejected'],
    ['assertion discarded beats a voided file', [a('submitted', discarded), f('submitted', filed('voided'))], 'rejected'],
    ['both filed and active on the record', [a('submitted', filed()), f('submitted', filed())], 'publication_ready'],
    ['the file still waiting', [a('submitted', filed()), f('submitted', unfiled)], 'pending'],
    ['submitted, not yet read', [a('submitted'), f('submitted')], 'pending'],
    ['assertion uncertain', [a('uncertain'), f('submitted', filed())], 'pending'],
    ['a send that never finished', [a('sending'), f('submitted', unfiled)], 'pending'],
    ['the file discarded', [a('submitted', filed()), f('submitted', discarded)], 'incomplete'],
    ['voided beats waiting', [a('submitted', filed('voided')), f('submitted', unfiled)], 'incomplete'],
    ['unverifiable', [a('submitted', { status: 'filed', evidence: null }), f('submitted', filed())], 'incomplete'],
    ['filed on another record', [a('submitted', filed('active', 'CAI-OTHER')), f('submitted', filed())], 'incomplete'],
    ['not reported by Cairn', [a('submitted', { status: 'not-reported', evidence: null }), f('submitted', filed())], 'incomplete'],
    ['the file refused', [a('submitted', unfiled), f('refused')], 'incomplete'],
    ['the file abandoned', [a('submitted', filed()), f('abandoned')], 'incomplete'],
    ['the file never sent', [a('submitted', filed())], 'incomplete'],
    ['the latest entry counts', [a('refused'), f('submitted', filed()), a('submitted', filed())], 'publication_ready'],
  ]
  for (const [name, entries, expected, withdrawn] of cases) {
    assert.equal(ledger.findingState({ withdrawn_at: withdrawn ? new Date() : null }, entries, REC).state, expected, name)
  }
})

test('ledger: the assertion fits in 4,000 characters, with the ids at the end', () => {
  const { id, classification, proposed_classification, validation, superseded_by, ...content } = finding('F9', { statement: 'x'.repeat(5000) })
  const row: FindingRow = { run_id: 'run', id, version: 1, classification, proposed_classification, validation, content, superseded_by: null, package_key: null, package_sha256: null, withdrawn_at: null, withdrawal_reason: null }
  const text = composeAssertion(row, 'run-1', 'r1')
  assert.ok(text.length <= ASSERTION_LIMIT, String(text.length))
  assert.match(text, /continued in the investigation package\)/)
  assert.match(text, /IGI finding F9 version 1, analysis run run-1, review r1\./)
})

const RUN = 'run-r1-1'
const ref = (id: string, version = 1) => ({ runId: RUN, id, version })
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

test('ledger: submit, read back and follow findings through Cairn', { skip }, async () => {
  await resetDatabase(db)
  await db.saveReview({ id: 'r1', periodEnd: '2026-09-30' })
  const at = '2026-10-28T09:00:00.000Z'
  const findings = [
    finding('F1', { execution_ids: ['X1'], material_numbers: [{ label: 'Equity exposure', value: '36.97%', check_id: 'C1' }], policy_rule: { rule_id: 'R-EQ', version: '2' } }),
    finding('F2', { classification: 'outstanding_action', proposed_classification: 'outstanding_action', title: 'Overdue action' }),
    finding('F3', { classification: 'observation', proposed_classification: 'observation' }),
    finding('F4', { superseded_by: 'F1' }),
  ]
  const state = {
    executions: [{ id: 'X1', purpose: 'Weights', code: 'print("```")', ok: true, result: '0.3697', stdout: '```\n', ms: 1, reads: [] }],
    checks: [{ id: 'C1', args: { check: 'lookthrough_exposure', portfolio_id: 'P1' }, result: { exposure: '0.3697' }, rowsUsed: ['positions:1'] }],
    notes: [],
    findings,
  }
  await db.saveRun({ id: RUN, reviewId: 'r1', startedAt: at, endedAt: at, status: 'completed', config: CONFIG, turns: 1, toolCalls: 1, usage: {}, summary: '', events: [], state })

  let t = 0
  const fake = cairnFake({ now: () => t })
  const cairn = cairnClient({ baseUrl: 'https://cairn.test', key: fake.key, fetch: fake.fetch })
  const config = { subjectReference: fake.subject.cairnReference, procedureName: fake.procedure.name }
  const stateOf = async (id: string, version = 1) => {
    const [row] = await db.sql<FindingRow[]>`select * from finding where run_id = ${RUN} and id = ${id} and version = ${version}`
    return ledger.findingState(row, await ledger.ledgerEntries(ref(id, version)), record.record.cairnReference)
  }

  // Opening the record.
  await assert.rejects(ledger.submitFinding(cairn, ref('F1')), /open the Cairn record/)
  await assert.rejects(ledger.openRecord(cairn, 'r1', { ...config, procedureName: 'Something else' }), /can't be started/)
  const record = await ledger.openRecord(cairn, 'r1', config)
  const opened = fake.requests
  assert.deepEqual(await ledger.openRecord(cairn, 'r1', config), record)
  assert.equal(fake.requests, opened)
  assert.deepEqual(ledger.placementGaps(record), [])
  const withoutDocuments = record.steps.slice(1).map((s) => ({ ...s, slots: s.slots.filter((x) => !x.allowedKinds.includes('document')) }))
  assert.deepEqual(ledger.placementGaps({ record: record.record, steps: withoutDocuments }), [
    'no step "Source data and reconciliation" (for data_quality, missing_information)',
    'step "Portfolio allocation and risk review" has no document slot (for potential_exception, policy_inconsistency, explained_anomaly, observation)',
    'step "Historical decisions and outstanding actions" has no document slot (for outstanding_action)',
  ])

  await assert.rejects(ledger.submitFinding(cairn, ref('F4')), /revised as F1/)

  // F1: both items placed on the step for its classification, then filed, then the package voided.
  const sent = await ledger.submitFinding(cairn, ref('F1'))
  assert.deepEqual(sent.map((e) => [e.kind, e.outcome, e.placement]), [['assertion', 'submitted', 'placed'], ['file', 'submitted', 'placed']])
  const allocation = record.steps.find((s) => s.name === 'Portfolio allocation and risk review')!
  assert.deepEqual(fake.candidates.map((c) => c.proposedStepId), [allocation.id, allocation.id])
  assert.deepEqual(fake.candidates.map((c) => c.proposedSlotId), allocation.slots.map((s) => s.id))
  const [assertion, file] = fake.candidates
  assert.match(assertion.text!, /Equity exposure 36\.97% \(check C1\)/)
  assert.match(assertion.text!, /IGI finding F1 version 1, analysis run run-r1-1, review r1/)
  assert.equal(assertion.sourceReference, 'IGI review r1, finding F1')
  assert.equal(file.filename, 'IGI-r1-F1-v1.md')
  const pkg = new TextDecoder().decode(file.bytes)
  assert.match(pkg, /### C1: lookthrough_exposure/)
  assert.ok(pkg.includes('````\n```\n\n````'), 'the fence is longer than the backticks in the output')
  const [f1] = await db.sql<FindingRow[]>`select * from finding where id = 'F1'`
  assert.equal(sha256(file.bytes!), f1.package_sha256)
  assert.equal(sent[1].payload_sha256, f1.package_sha256)

  assert.deepEqual(await stateOf('F1'), { state: 'pending', items: { assertion: 'not-read', file: 'not-read' } })
  await ledger.refreshStatus(cairn, 'r1')
  assert.deepEqual(await stateOf('F1'), { state: 'pending', items: { assertion: 'unfiled', file: 'unfiled' } })
  fake.file(assertion.candidateId)
  fake.file(file.candidateId)
  await ledger.refreshStatus(cairn, 'r1')
  assert.equal((await stateOf('F1')).state, 'publication_ready')
  fake.voidEvidence(file.candidateId)
  await ledger.refreshStatus(cairn, 'r1')
  assert.deepEqual(await stateOf('F1'), { state: 'incomplete', items: { assertion: 'accepted', file: 'voided' } })
  assert.equal((await ledger.submitFinding(cairn, ref('F1'))).length, 2) // a voided item is not resent within a version

  // F2: the assertion's response is lost. It is never resent automatically; once abandoned, it is resent.
  const before = fake.candidates.length
  fake.dropNextResponse()
  let entries = await ledger.submitFinding(cairn, ref('F2'))
  assert.deepEqual(entries.map((e) => [e.kind, e.outcome]), [['assertion', 'uncertain'], ['file', 'submitted']])
  assert.equal(fake.candidates.length, before + 2) // the lost one landed in the Tray anyway
  assert.equal(fake.candidates[before].proposedStepId, record.steps.find((s) => s.name === 'Historical decisions and outstanding actions')!.id)
  assert.equal((await ledger.submitFinding(cairn, ref('F2'))).length, 2)
  assert.equal((await stateOf('F2')).state, 'pending')
  await ledger.abandonEntry(entries[0].id)
  assert.equal((await stateOf('F2')).state, 'incomplete')
  entries = await ledger.submitFinding(cairn, ref('F2'))
  assert.deepEqual(entries.map((e) => [e.kind, e.outcome]), [['assertion', 'abandoned'], ['file', 'submitted'], ['assertion', 'submitted']])
  await assert.rejects(ledger.abandonEntry(entries[2].id), /not uncertain/)
  fake.discard(entries[2].candidate_id!)
  await ledger.refreshStatus(cairn, 'r1')
  assert.equal((await stateOf('F2')).state, 'rejected')

  // F3: the rate limit refuses the package; resending sends only the package, with the same bytes.
  while (fake.requests < 59) await cairn.getCandidateStatus([crypto.randomUUID()])
  entries = await ledger.submitFinding(cairn, ref('F3'))
  assert.deepEqual(entries.map((e) => [e.kind, e.outcome, e.error_code]), [['assertion', 'submitted', null], ['file', 'refused', 'rate-limited']])
  assert.equal((await stateOf('F3')).state, 'incomplete')
  t = 600_000
  const sends = fake.requests
  entries = await ledger.submitFinding(cairn, ref('F3'))
  assert.equal(fake.requests - sends, 1)
  assert.deepEqual(entries.map((e) => [e.kind, e.outcome]), [['assertion', 'submitted'], ['file', 'refused'], ['file', 'submitted']])
  assert.equal(entries[2].payload_sha256, entries[1].payload_sha256)

  // Withdrawal, and putting F1 forward again as version 2.
  await assert.rejects(ledger.newVersion({ runId: RUN, id: 'F1' }), /not withdrawn/)
  await assert.rejects(ledger.withdrawFinding(ref('F1'), '  '), /reason is required/)
  await ledger.withdrawFinding(ref('F1'), 'The package was voided in Cairn.')
  assert.equal((await stateOf('F1')).state, 'withdrawn')
  await assert.rejects(ledger.withdrawFinding(ref('F1'), 'again'), /already withdrawn/)
  await assert.rejects(ledger.submitFinding(cairn, ref('F1')), /withdrawn/)
  assert.equal(await ledger.newVersion({ runId: RUN, id: 'F1' }), 2)
  assert.equal((await stateOf('F1', 2)).state, 'not_submitted')
  entries = await ledger.submitFinding(cairn, ref('F1', 2))
  assert.deepEqual(entries.map((e) => [e.source_reference, e.outcome]), [['IGI review r1, finding F1 v2', 'submitted'], ['IGI review r1, finding F1 v2', 'submitted']])
  assert.equal(fake.candidates.at(-1)!.filename, 'IGI-r1-F1-v2.md')
})
