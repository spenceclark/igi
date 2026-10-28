// The reviewed snapshot and committee pack (spec §6.8, §13) against the Cairn test double, in the igi_test_pack database.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { appendFileSync, cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cairnClient } from '../src/cairn.ts'
import { cairnFake } from '../src/cairn-fake.ts'
import { getFile } from '../src/files.ts'
import { importReview } from '../src/sources.ts'
import { CONFIG, finding, resetDatabase, useTestDatabase } from './helpers.ts'

const skip = await useTestDatabase('pack')
const db = await import('../src/db.ts')
const ledger = await import('../src/ledger.ts')
const pack = await import('../src/committee-pack.ts')
after(() => db.sql.end())

const DEV01 = fileURLToPath(new URL('../../fixtures/scenarios/dev-01', import.meta.url))
const RUN = 'run-r1-1'
const ref = (id: string, version = 1) => ({ runId: RUN, id, version })
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')
const reasons = (r: Awaited<ReturnType<typeof pack.generatePack>>) => ('blockers' in r ? r.blockers.map((b) => `${b.finding?.id ?? '-'} ${b.reason}`) : [])

test('pack: snapshot, final pack, supersession, stale marking and the no-findings rule', { skip }, async () => {
  await resetDatabase(db)
  await db.saveReview({ id: 'r1', periodEnd: '2026-09-30', sourceDir: DEV01 })
  const sources = importReview(DEV01, 'r1').sources.map(({ id, file, sha256 }) => ({ id, file, sha256 }))
  const at = '2026-10-28T09:00:00.000Z'
  const comparison = { rule_id: 'CAU-EQ-MAX', version: '1', limit_type: 'max', threshold: '0.3500', value: '0.3697', status: 'breach', margin: '-0.0197', document_clause: '3.1' }
  const state = {
    executions: [],
    checks: [{ id: 'C1', args: { check: 'lookthrough_exposure', portfolio_id: 'P-CAU', asset_class: 'equity' }, result: { exposure: '0.3697', comparisons: [comparison] }, rowsUsed: ['positions:1'] }],
    notes: [],
    findings: [
      finding('F1', { title: 'Equity above <script>alert(1)</script> limit', material_numbers: [{ label: 'Equity exposure', value: '36.97%', check_id: 'C1' }], policy_rule: { rule_id: 'CAU-EQ-MAX', version: '1' }, uncertainties: ['Look-through data is a month old.'] }),
      finding('F2', { classification: 'observation', proposed_classification: 'observation', title: 'Rejected matter' }),
      finding('F3', { title: 'Unsent exception' }),
      finding('F4', { title: 'Revised away', superseded_by: 'F1' }),
    ],
  }
  await db.saveRun({ id: RUN, reviewId: 'r1', startedAt: at, endedAt: at, status: 'completed', config: { ...CONFIG, sources }, turns: 1, toolCalls: 1, usage: {}, summary: '', events: [], state })

  const fake = cairnFake()
  const cairn = cairnClient({ baseUrl: 'https://cairn.test', key: fake.key, fetch: fake.fetch })
  await ledger.openRecord(cairn, 'r1', { subjectReference: fake.subject.cairnReference, procedureName: fake.procedure.name })
  const [a1, f1] = await ledger.submitFinding(cairn, ref('F1'))
  const [a2] = await ledger.submitFinding(cairn, ref('F2'))

  // Nothing filed yet: both submitted findings block, and with no findings yet the unsent exception blocks too.
  let r = await pack.generatePack(cairn, 'r1')
  assert.deepEqual(reasons(r), [
    'F1 pending: assertion unfiled, package unfiled',
    'F2 pending: assertion unfiled, package unfiled',
    'F3 a potential exception neither submitted nor withdrawn; a pack with no findings needs it rejected in Cairn or withdrawn',
  ])

  // F1 accepted, F2 rejected: version 1 holds F1 alone, F2 as a count, F3 as not submitted.
  fake.file(a1.candidate_id!)
  fake.file(f1.candidate_id!)
  fake.discard(a2.candidate_id!)
  r = await pack.generatePack(cairn, 'r1')
  assert.ok('pack' in r, reasons(r).join('\n'))
  const v1 = r.pack
  const [stored] = await db.sql<{ snapshot: unknown; snapshot_sha256: string }[]>`select snapshot, snapshot_sha256 from committee_pack where version = 1`
  assert.equal(sha256(pack.canonical(stored.snapshot)), stored.snapshot_sha256, 'the snapshot hash verifies after the jsonb round trip')
  const s = v1.snapshot
  assert.deepEqual(s.findings.map((f) => [f.id, f.assertion.candidateId, f.package.candidateId]), [['F1', a1.candidate_id, f1.candidate_id]])
  assert.equal(s.findings[0].package.sha256, f1.payload_sha256)
  assert.equal(s.findings[0].assertion.evidence.recordReference, s.recordReference)
  assert.deepEqual(s.counts, { rejected: 1, withdrawn: 0, notSubmitted: 1 })
  assert.deepEqual(s.findings[0].checks[0].comparisons, [comparison])
  assert.ok(s.portfolios.find((p) => p.id === 'P-CAU')!.allocation.some((a) => a.period === '2026-09-30' && a.assetClass === 'equity'))
  const html = new TextDecoder().decode(getFile(v1.file_key))
  assert.equal(sha256(html), v1.file_sha256)
  assert.equal(html, pack.renderPack(s, 1, v1.snapshot_sha256), 'the file is reproducible from the snapshot')
  assert.ok(html.includes('Equity above &#60;script&#62;alert(1)&#60;/script&#62; limit') && !html.includes('<script>'), 'model text is escaped')
  assert.ok(!html.includes('Rejected matter') && !html.includes('Unsent exception') && !html.includes('Revised away'), 'only accepted findings have content')
  assert.match(html, /Submitted findings not accepted in Cairn: 1\. Findings withdrawn by the operator: 0\./)
  assert.match(html, /Look-through data is a month old\./)
  assert.match(html, /A-2026-07-01: Replace Fenwick/) // an open committee action from the sources

  // A new pack supersedes the earlier one; withdrawing an included finding marks both stale.
  r = await pack.generatePack(cairn, 'r1')
  assert.ok('pack' in r)
  assert.deepEqual((await pack.listPacks('r1')).map((p) => [p.version, p.superseded, p.stale_reason]), [[1, true, null], [2, false, null]])
  await ledger.withdrawFinding(ref('F1'), 'Duplicated by a later finding.')
  await pack.markStalePacks('r1')
  assert.deepEqual((await pack.listPacks('r1')).map((p) => p.stale_reason), ['F1 v1 withdrawn: Duplicated by a later finding.', 'F1 v1 withdrawn: Duplicated by a later finding.'])

  // F1 version 2 accepted, then its assertion voided: the pack is marked stale on the next check, and blocked when regenerated.
  await ledger.newVersion({ runId: RUN, id: 'F1' })
  const [a1v2, f1v2] = await ledger.submitFinding(cairn, ref('F1', 2))
  fake.file(a1v2.candidate_id!)
  fake.file(f1v2.candidate_id!)
  r = await pack.generatePack(cairn, 'r1')
  assert.ok('pack' in r)
  assert.deepEqual(r.pack.snapshot.counts, { rejected: 1, withdrawn: 0, notSubmitted: 1 }, 'the withdrawn version 1 is history, not a withdrawn finding')
  fake.voidEvidence(a1v2.candidate_id!)
  await pack.checkPacks(cairn, 'r1')
  assert.equal((await pack.listPacks('r1'))[2].stale_reason, 'F1 v2 assertion voided')
  assert.deepEqual(reasons(await pack.generatePack(cairn, 'r1')), [
    'F1 incomplete: assertion voided, package accepted',
    'F3 a potential exception neither submitted nor withdrawn; a pack with no findings needs it rejected in Cairn or withdrawn',
  ])

  // No findings: valid once every potential exception is rejected or withdrawn, and the run completed.
  await ledger.withdrawFinding(ref('F1', 2), 'Evidence voided.')
  await ledger.withdrawFinding(ref('F3'), 'Not material.')
  await db.sql`update analysis_run set status = 'failed'`
  assert.deepEqual(reasons(await pack.generatePack(cairn, 'r1')), ['- the latest analysis run run-r1-1 ended failed; a pack with no findings needs a completed run'])
  await db.sql`update analysis_run set status = 'completed'`
  r = await pack.generatePack(cairn, 'r1')
  assert.ok('pack' in r)
  assert.deepEqual([r.pack.version, r.pack.snapshot.findings.length, r.pack.snapshot.counts], [4, 0, { rejected: 1, withdrawn: 2, notSubmitted: 0 }])
  assert.match(new TextDecoder().decode(getFile(r.pack.file_key)), /No findings\. Every potential exception the analysis proposed was rejected in Cairn or withdrawn/)

  // Sources that no longer match the latest run block the pack.
  const copy = mkdtempSync(join(tmpdir(), 'igi-sources-'))
  cpSync(DEV01, copy, { recursive: true })
  appendFileSync(join(copy, 'fees.csv'), 'ZZ4RJNDOLY80,2026-12-31,0.0006\n')
  await db.sql`update review set source_dir = ${copy}`
  assert.match(reasons(await pack.generatePack(cairn, 'r1'))[0], /the sources differ from those of the latest analysis run run-r1-1: fees\.csv/)
})
