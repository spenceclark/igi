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

  // F1 version 2 accepted, and version 1's evidence voided in Cairn (until then it blocks: see the next test). Then
  // version 2's assertion voided: the pack is marked stale on the next check, and blocked when regenerated.
  await ledger.newVersion({ runId: RUN, id: 'F1' })
  const [a1v2, f1v2] = await ledger.submitFinding(cairn, ref('F1', 2))
  fake.file(a1v2.candidate_id!)
  fake.file(f1v2.candidate_id!)
  fake.voidEvidence(a1.candidate_id!)
  fake.voidEvidence(f1.candidate_id!)
  r = await pack.generatePack(cairn, 'r1')
  assert.ok('pack' in r, reasons(r).join('\n'))
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
  fake.voidEvidence(f1v2.candidate_id!) // its package too, so nothing of the withdrawn version stands on the record
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

test('pack: evidence of a withdrawn or rejected version must not stand on the record; what the pack shows', { skip }, async () => {
  await resetDatabase(db)
  process.env.FILES_DIR = mkdtempSync(join(tmpdir(), 'igi-files-')) // the same run id as above: a file store of its own
  await db.saveReview({ id: 'r1', periodEnd: '2026-09-30', sourceDir: DEV01 })
  const sources = importReview(DEV01, 'r1').sources.map(({ id, file, sha256 }) => ({ id, file, sha256 }))
  const at = '2026-10-28T09:00:00.000Z'
  // C1 compares the equity exposure with two rules; only CAU-EQ-MAX is the one F1 names.
  const breach = { rule_id: 'CAU-EQ-MAX', version: '1', limit_type: 'max', threshold: '0.3500', value: '0.3697', status: 'breach', margin: '-0.0197', document_clause: '3.1' }
  const other = { rule_id: 'CAU-SH', version: '1', limit_type: 'max', threshold: '0.2500', value: '0.2300', status: 'within', margin: '0.0200', document_clause: '3.2' }
  const state = {
    executions: [],
    checks: [{ id: 'C1', args: { check: 'lookthrough_exposure', portfolio_id: 'P-CAU', asset_class: 'equity' }, result: { exposure: '0.3697', comparisons: [breach, other] }, rowsUsed: ['positions:1'] }],
    notes: [
      { id: 'N1', kind: 'observation', text: 'Weights reconcile.' },
      { id: 'N2', kind: 'open_question', text: 'Whether the manager reported the breach is not recorded; it affects F1.' },
    ],
    findings: [
      finding('F1', { review_area: 'allocation_risk', policy_rule: { rule_id: 'CAU-EQ-MAX', version: '1' }, material_numbers: [{ label: 'Equity exposure', value: '36.97%', check_id: 'C1' }] }),
      finding('F2', { classification: 'observation', proposed_classification: 'observation', review_area: 'allocation_risk', title: 'Rejected matter' }),
      finding('F3', { classification: 'observation', proposed_classification: 'observation', review_area: 'source_data', title: 'Withdrawn matter' }),
      finding('F4', { classification: 'outstanding_action', proposed_classification: 'outstanding_action', review_area: 'committee_actions', title: 'Overdue action', cited_rows: ['committee_actions:1'], material_numbers: [{ label: 'Equity exposure', value: '36.97%', check_id: 'C1' }] }),
      finding('F5', { classification: 'observation', proposed_classification: 'observation', review_area: 'funds_fees', title: 'Fee change' }),
    ],
  }
  await db.saveRun({ id: RUN, reviewId: 'r1', startedAt: at, endedAt: at, status: 'completed_with_uncertainties', config: { ...CONFIG, sources }, turns: 1, toolCalls: 1, usage: {}, summary: '', events: [], state })
  const fake = cairnFake()
  const cairn = cairnClient({ baseUrl: 'https://cairn.test', key: fake.key, fetch: fake.fetch })
  const record = await ledger.openRecord(cairn, 'r1', { subjectReference: fake.subject.cairnReference, procedureName: fake.procedure.name })
  const stepOf = (name: string) => record.steps.find((s) => s.name === name)!
  const fileAll = (...entries: { candidate_id: string | null }[]) => entries.forEach((e) => fake.file(e.candidate_id!))
  const latestPack = async () => (await pack.listPacks('r1')).at(-1)!
  const evi = (id: string | null) => fake.candidates.find((c) => c.candidateId === id)!.evidence!.cairnReference

  // Each finding's evidence is proposed for the step of its review area.
  const [a1, p1] = await ledger.submitFinding(cairn, ref('F1'))
  const [a4, p4] = await ledger.submitFinding(cairn, ref('F4'))
  const [a5, p5] = await ledger.submitFinding(cairn, ref('F5'))
  const steps = ['Portfolio allocation and risk review', 'Historical decisions and outstanding actions', 'Fund, manager and fee oversight']
  assert.deepEqual([a1, a4, a5].map((e) => e.proposed_step_id), steps.map((n) => stepOf(n).id))
  fileAll(a1, p1, a4, p4, a5, p5)
  let r = await pack.generatePack(cairn, 'r1')
  assert.ok('pack' in r, reasons(r).join('\n'))

  // F1 revised: v1 withdrawn and v2 filed, while both of v1's items stay active. That blocks the pack, naming each
  // item a person has to void (IGI voids nothing), and the earlier pack is stale.
  await ledger.withdrawFinding(ref('F1'), 'Restated with a clearer explanation.')
  await ledger.newVersion({ runId: RUN, id: 'F1' })
  const [a1v2, p1v2] = await ledger.submitFinding(cairn, ref('F1', 2))
  fileAll(a1v2, p1v2)
  r = await pack.generatePack(cairn, 'r1')
  const advice = (item: string, ref: string) =>
    `F1 F1 v1 was withdrawn and replaced by v2, but its ${item} ${ref} is still filed and active on the record. IGI cannot void evidence: a person voids it in Cairn, giving a reason such as "Superseded by IGI finding F1 v2".`
  assert.deepEqual(reasons(r), [advice('assertion', evi(a1.candidate_id)), advice('investigation package', evi(p1.candidate_id))])
  assert.equal((await latestPack()).stale_reason, 'F1 v1 withdrawn: Restated with a clearer explanation.')
  // Partly voided, as when only the package is voided: the assertion still blocks.
  fake.voidEvidence(p1.candidate_id!)
  assert.deepEqual(reasons(await pack.generatePack(cairn, 'r1')), [advice('assertion', evi(a1.candidate_id))])
  fake.voidEvidence(a1.candidate_id!)
  r = await pack.generatePack(cairn, 'r1')
  assert.ok('pack' in r, reasons(r).join('\n'))
  // The pack references exactly v2's accepted items, and lists v1's as voided.
  const f1 = r.pack.snapshot.findings.find((f) => f.id === 'F1')!
  assert.deepEqual([f1.version, f1.assertion.evidence.cairnReference, f1.package.evidence.cairnReference], [2, evi(a1v2.candidate_id), evi(p1v2.candidate_id)])
  assert.deepEqual(r.pack.snapshot.excluded.map((x) => [x.id, x.version, x.why, x.kind, x.evidenceReference, x.state]), [
    ['F1', 1, 'withdrawn and replaced by v2', 'assertion', evi(a1.candidate_id), 'voided'],
    ['F1', 1, 'withdrawn and replaced by v2', 'file', evi(p1.candidate_id), 'voided'],
  ])

  // Rejected in Cairn, but its package filed: the record holds evidence for a rejected finding, so the latest pack
  // goes stale and a new one is blocked until the package is voided.
  const [a2, p2] = await ledger.submitFinding(cairn, ref('F2'))
  fake.discard(a2.candidate_id!)
  fake.file(p2.candidate_id!)
  r = await pack.generatePack(cairn, 'r1')
  assert.match(reasons(r)[0], /^F2 F2 v1 was rejected in Cairn, but its investigation package EVI-[\w-]+ is still filed and active on the record\..*"IGI finding F2 v1 rejected"/)
  assert.match((await latestPack()).stale_reason!, /^F2 v1 file EVI-[\w-]+ active on the record although rejected in Cairn$/)
  fake.voidEvidence(p2.candidate_id!)

  // Withdrawn while its items wait in the Tray: no block, but the operator is told to discard them.
  const [a3, p3] = await ledger.submitFinding(cairn, ref('F3'))
  await ledger.withdrawFinding(ref('F3'), 'Not material.')
  r = await pack.generatePack(cairn, 'r1')
  assert.ok('pack' in r, reasons(r).join('\n'))
  const tray = (item: string, id: string | null) => `F3 v1 was withdrawn, but its ${item} ${id} is still waiting in Cairn's Tray. A person discards it there, so it is never filed.`
  const leftovers = (await pack.excludedItems('r1', record.record.cairnReference)).map(pack.reconcileAdvice).filter(Boolean)
  assert.deepEqual(leftovers, [tray('assertion', a3.candidate_id), tray('investigation package', p3.candidate_id)])

  // What the pack shows: findings grouped in the overview, the unresolved matter in a section of its own, only the
  // comparison with the rule F1 names, in words, and for the outstanding action its committee action instead.
  const s = r.pack.snapshot
  const html = new TextDecoder().decode(getFile(r.pack.file_key))
  assert.deepEqual(s.unresolved, ['Whether the manager reported the breach is not recorded; it affects F1.'])
  assert.match(html, /<h3>Policy exceptions<\/h3><ul><li><a href="#F1-v2">F1<\/a>/)
  assert.match(html, /<h3>Actions outstanding or newly triggered<\/h3><ul><li><a href="#F4-v1">F4<\/a>/)
  assert.match(html, /<h3>Lower-priority observations<\/h3><ul><li><a href="#F5-v1">F5<\/a>/)
  assert.match(html, /left 1 matter unresolved/)
  assert.match(html, /<h2>Matters the analysis could not resolve<\/h2>[\s\S]*Whether the manager reported the breach is not recorded/)
  const article = (id: string) => html.slice(html.indexOf(`<article id="${id}"`), html.indexOf('</article>', html.indexOf(`<article id="${id}"`)))
  assert.match(article('F1-v2'), /<td>CAU-EQ-MAX v1<\/td><td>Maximum 35\.00%<\/td><td>2026-09-30<\/td><td>36\.97%<\/td><td><span class="breach">Exceeded by 1\.97 percentage points<\/span><\/td>/)
  assert.ok(!article('F1-v2').includes('CAU-SH'), 'a comparison on a measure other than the named rule is left out')
  assert.ok(!article('F4-v1').includes('Comparison with policy'), 'an outstanding action shows no comparison table')
  assert.ok(!article('F5-v1').includes('Comparison with policy'), 'nor does a finding that names no rule, whatever its checks compare')
  assert.match(article('F4-v1'), /Committee action, as the action log records it[\s\S]*A-2026-07-01: Replace Fenwick/)
  assert.match(html, /\+3\.38 pp/) // the change in Cautious equity, in percentage points
  assert.match(html, /Portfolio allocation and risk review \/ /) // the manifest names steps and slots
  assert.match(html, /<td>F1 v1<\/td><td>withdrawn and replaced by v2<\/td><td>assertion<\/td><td>EVI-[\w-]+<\/td><td>voided<\/td>/)
  assert.match(html, /IGI code commit abc1234;/)
  assert.ok(s.sources.every((x) => x.key === `sources/${x.sha256}/${x.file}`) && getFile(s.sources[0].key).length > 0, 'every source is retained')

  // The pack itself goes to Cairn as a candidate document for the pack step; a person files it.
  const sent = await pack.submitPack(cairn, 'r1')
  const candidate = fake.candidates.at(-1)!
  assert.deepEqual([sent.submission!.outcome, candidate.filename, candidate.proposedStepId], ['submitted', `IGI-r1-committee-pack-v${sent.version}.html`, stepOf('Committee pack preparation').id])
  assert.equal(sha256(candidate.bytes!), sent.file_sha256)
  await assert.rejects(pack.submitPack(cairn, 'r1'), /already submitted/)
  fake.file(candidate.candidateId)
  await pack.checkPacks(cairn, 'r1')
  assert.equal((await latestPack()).submission!.status!.evidence!.status, 'active')

  // A Tray leftover filed later contradicts the pack, which goes stale; a stale pack can't be submitted.
  fake.file(a3.candidate_id!)
  await pack.checkPacks(cairn, 'r1')
  assert.match((await latestPack()).stale_reason!, /^F3 v1 assertion EVI-[\w-]+ active on the record although withdrawn$/)
  await assert.rejects(pack.submitPack(cairn, 'r1'), /is stale/)
})
