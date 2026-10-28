// Drives one review against real Cairn (spec §12) until the UI does, one command at a time:
//   open    shows the subject the record would be for; with --start, starts the review's record and checks its
//           steps against IGI's mapping. --start writes to Cairn: a record can be cancelled there, never deleted.
//   submit  submits the latest run's findings, or the ones named, as candidates in Cairn's Tray. Writes to Cairn.
//   status  reads back every submitted candidate and shows each finding's state, what a person still has to void or
//           discard in Cairn, and each pack.
//   pack    generates the next committee pack, or lists what blocks it.
//   submit-pack  submits the latest pack as a candidate document for the committee pack step (§13.5); --resend
//           after an uncertain attempt. Writes to Cairn.
//   withdraw <review> <finding id> <reason>  withdraws the finding's current version (§6.7).
//   new-version <review> <finding ids>       puts withdrawn findings forward again; submit them next.
// Run from server/: node --env-file-if-exists=.env scripts/cairn-run.ts <command> <review> [finding ids]
// --env-file never overrides a variable already set in the environment: an older CAIRN_AGENT_KEY there wins.
import { cairnClient, type RecordSteps } from '../src/cairn.ts'
import { checkPacks, excludedItems, generatePack, listPacks, reconcileAdvice, resolveFindings, submitPack, type PackSubmission } from '../src/committee-pack.ts'
import { loadRun, migrate, sql, type FindingRow } from '../src/db.ts'
import { filePath } from '../src/files.ts'
import { closeRenderer } from '../src/render.ts'
import { ledgerEntries, newVersion, openRecord, placementGaps, submitFinding, withdrawFinding } from '../src/ledger.ts'
import { isCurrent } from '../src/evidence.ts'

const COMMANDS = ['open', 'submit', 'status', 'pack', 'submit-pack', 'withdraw', 'new-version']
const [command, reviewId, ...ids] = process.argv.slice(2)
if (!COMMANDS.includes(command) || !reviewId) {
  console.error(`usage: scripts/cairn-run.ts <${COMMANDS.join('|')}> <review> [--start | --resend | finding ids | finding id and reason]`)
  process.exit(2)
}
const missing = ['CAIRN_BASE_URL', 'CAIRN_AGENT_KEY', 'CAIRN_SUBJECT_REFERENCE', 'CAIRN_PROCEDURE_NAME'].filter((name) => !process.env[name])
if (missing.length) {
  console.error(`${missing.join(', ')} not set. Put them in server/.env (gitignored) or the environment.`)
  process.exit(2)
}
const cairn = cairnClient({ baseUrl: process.env.CAIRN_BASE_URL!, key: process.env.CAIRN_AGENT_KEY! })
await migrate()
const [review] = await sql<{ cairn_record: RecordSteps | null }[]>`select cairn_record from review where id = ${reviewId}`
if (!review) throw new Error(`no review ${reviewId}`)

if (command === 'open') {
  // A record stays with the subject it was started for, so the subject is shown first and nothing is started
  // without --start. The subject should be the one the whole review covers, not one portfolio or fund.
  const start = ids.includes('--start')
  if (!review.cairn_record) {
    const [subject] = await cairn.findSubject(process.env.CAIRN_SUBJECT_REFERENCE!)
    console.log(`Subject ${process.env.CAIRN_SUBJECT_REFERENCE}: ${subject ? subject.name : 'not found'}. Procedure: ${process.env.CAIRN_PROCEDURE_NAME}.`)
    if (!start) console.log('Nothing started. If that is the subject the whole review covers, run again with --start.')
  }
  if (review.cairn_record || start) {
    const opened = !review.cairn_record
    const r = await openRecord(cairn, reviewId, { subjectReference: process.env.CAIRN_SUBJECT_REFERENCE!, procedureName: process.env.CAIRN_PROCEDURE_NAME! })
    console.log(`${opened ? 'Started' : 'Already open:'} ${r.record.cairnReference}, ${r.record.procedureName} v${r.record.procedureVersion}, subject ${r.record.subjectReference}`)
    for (const s of r.steps) console.log(`  ${s.name}: ${s.slots.map((x) => `${x.name} [${x.allowedKinds.join(', ')}]`).join('; ')}`)
    const gaps = placementGaps(r)
    console.log(gaps.length ? `Evidence that would wait in the Tray unplaced:\n${gaps.map((g) => `  ${g}`).join('\n')}` : 'Every review area has its step, with an assertion slot and a document slot, and the pack has its document slot.')
  }
}

/** Every excluded item a person still has to void or discard in Cairn, from the latest read-back. */
async function printReconciliation(only?: { id: string; version: number }) {
  for (const x of await excludedItems(reviewId, review.cairn_record?.record.cairnReference ?? null)) {
    if (only && (x.id !== only.id || x.version !== only.version)) continue
    const advice = reconcileAdvice(x)
    if (advice) console.log(`To reconcile: ${advice}`)
  }
}

/** A pack's submission to Cairn in words, from its latest read-back. */
function packSubmission(s: PackSubmission) {
  if (s.outcome !== 'submitted') return `${s.outcome}${s.errorCode ? ` (${s.errorCode})` : ''}`
  const e = s.status?.evidence
  return `candidate ${s.candidateId}, ${s.status ? (e ? `filed as ${e.cairnReference}, ${e.status}` : s.status.status) : 'not read back yet'}`
}

/** The latest version of each finding in the review's latest run, checking the ids asked for exist. */
async function currentFindings(asked: string[]) {
  const [latest] = await sql<{ id: string }[]>`select id from analysis_run where review_id = ${reviewId} order by started_at desc limit 1`
  const run = latest && (await loadRun(latest.id))
  if (!run) throw new Error(`review ${reviewId} has no analysis run`)
  const current = new Map<string, FindingRow>()
  for (const f of run.findings) if (isCurrent(f) && f.version > (current.get(f.id)?.version ?? 0)) current.set(f.id, f)
  const unknown = asked.filter((id) => !current.has(id))
  if (unknown.length) throw new Error(`not in ${run.run.id}: ${unknown.join(', ')}`)
  return current
}

if (command === 'withdraw') {
  const [id, ...reason] = ids
  if (!id) throw new Error('name the finding to withdraw, then the reason')
  const f = (await currentFindings([id])).get(id)!
  await withdrawFinding({ runId: f.run_id, id, version: f.version }, reason.join(' '))
  await checkPacks(cairn, reviewId)
  console.log(`Withdrew ${id} v${f.version}.`)
  await printReconciliation({ id, version: f.version })
}

if (command === 'new-version') {
  const current = await currentFindings(ids)
  for (const id of ids) console.log(`${id} v${await newVersion({ runId: current.get(id)!.run_id, id })} created; submit it next.`)
}

if (command === 'submit') {
  const current = await currentFindings(ids)
  for (const f of current.values()) {
    if ((ids.length && !ids.includes(f.id)) || f.withdrawn_at) continue
    const ref = { runId: f.run_id, id: f.id, version: f.version }
    // Resubmitting sends only what has no live submission, so running this again is safe.
    const before = (await ledgerEntries(ref)).length
    const entries = await submitFinding(cairn, ref)
    console.log(`${f.id} v${f.version} ${f.classification}: ${f.content.title}`)
    for (const e of entries.slice(before)) console.log(`  ${e.kind} ${e.outcome}${e.placement ? `, ${e.placement}` : ''}${e.error_code ? `, ${e.error_code}` : ''}`)
    if (entries.length === before) console.log('  nothing to send')
  }
}

if (command === 'status') {
  await checkPacks(cairn, reviewId)
  const resolved = await resolveFindings(reviewId, review.cairn_record?.record.cairnReference ?? null)
  for (const r of resolved.filter((x) => x.state !== 'not_submitted'))
    console.log(`${r.f.run_id} ${r.f.id} v${r.f.version} ${r.state}: assertion ${r.items.assertion}, package ${r.items.file}`)
  console.log(`${resolved.filter((x) => x.state === 'not_submitted').length} findings not submitted.`)
  await printReconciliation()
  for (const p of await listPacks(reviewId))
    console.log(`Pack v${p.version}${p.superseded ? ', superseded' : ''}${p.stale_reason ? `, stale: ${p.stale_reason}` : ''}${p.submission ? `; in Cairn: ${packSubmission(p.submission)}` : ''}`)
}

if (command === 'pack') {
  const r = await generatePack(cairn, reviewId)
  if ('blockers' in r) for (const b of r.blockers) console.log(`Blocked: ${b.finding && !b.reason.startsWith(`${b.finding.id} v`) ? `${b.finding.id} v${b.finding.version} ` : ''}${b.reason}`)
  else console.log(`Pack v${r.pack.version} with ${r.pack.snapshot.findings.length} findings: ${filePath(r.pack.pdf_key!)} (preview ${filePath(r.pack.file_key)})`)
}

if (command === 'submit-pack') {
  const p = await submitPack(cairn, reviewId, { resend: ids.includes('--resend') })
  console.log(`Pack v${p.version}: ${packSubmission(p.submission!)}${p.submission!.placement ? `, ${p.submission!.placement}` : ''}. A person files or discards it in Cairn.`)
}
await closeRenderer() // submitting and generating print PDFs in a shared browser
await sql.end()
