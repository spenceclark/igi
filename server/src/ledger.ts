// The Cairn side of a review: opening its record (spec §6.1), the submission ledger (§12.4), the status
// read-back (§12.5), and each finding version's state, withdrawal and new versions (§6.7).
import { createHash } from 'node:crypto'
import { type Cairn, CairnRefused, CairnUncertain, type CandidateStatus, type RecordSteps } from './cairn.ts'
import { json, loadRun, sql, type FindingRow } from './db.ts'
import { getFile, putFile } from './files.ts'
import { composeAssertion, composePackage, packageFileName, sourceReference } from './package.ts'

export type Kind = 'assertion' | 'file'
export type FindingRef = { runId: string; id: string; version: number }
type ReadBack = Pick<CandidateStatus, 'status' | 'evidence'> | { status: 'not-reported'; evidence: null }
export type LedgerEntry = {
  id: string
  run_id: string
  finding_id: string
  finding_version: number
  kind: Kind
  payload_sha256: string
  source_reference: string
  proposed_step_id: string | null
  proposed_slot_id: string | null
  outcome: 'sending' | 'submitted' | 'refused' | 'uncertain' | 'abandoned'
  candidate_id: string | null
  placement: string | null
  error_code: string | null
  cairn_status: ReadBack | null
  cairn_read_at: Date | null
  created_at: Date
}

// The step each classification's evidence is proposed for, by the step names in §12.2. A step missing from
// the record means no proposal: the candidate waits in Cairn's Tray unplaced.
const STEP_FOR: Record<string, string> = {
  data_quality: 'Source data and reconciliation',
  missing_information: 'Source data and reconciliation',
  potential_exception: 'Portfolio allocation and risk review',
  policy_inconsistency: 'Portfolio allocation and risk review',
  explained_anomaly: 'Portfolio allocation and risk review',
  observation: 'Portfolio allocation and risk review',
  outstanding_action: 'Historical decisions and outstanding actions',
}

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')

/** Starts the review's Cairn record, or returns the one already started. */
export async function openRecord(cairn: Cairn, reviewId: string, config: { subjectReference: string; procedureName: string }): Promise<RecordSteps> {
  const [review] = await sql<{ cairn_record: RecordSteps | null }[]>`select cairn_record from review where id = ${reviewId}`
  if (!review) throw new Error(`no review ${reviewId}`)
  if (review.cairn_record) return review.cairn_record
  const procedures = await cairn.listStartableProcedures(config.subjectReference)
  const procedure = procedures.find((p) => p.name === config.procedureName)
  if (!procedure) throw new Error(`procedure "${config.procedureName}" can't be started for ${config.subjectReference}; startable: ${procedures.map((p) => p.name).join(', ') || 'none'}`)
  // An uncertain outcome reaches the operator. Trying again with the same source reference returns the
  // first record while nobody has acted on it (§12.4).
  const started = await cairn.startRecord({ procedureId: procedure.id, subjectReference: config.subjectReference, sourceReference: `IGI review ${reviewId}` })
  const record: RecordSteps = { record: started.record, steps: started.steps }
  await sql`update review set cairn_record = ${json(record)} where id = ${reviewId}`
  return record
}

export const ledgerEntries = (f: FindingRef) =>
  sql<LedgerEntry[]>`select * from cairn_submission where run_id = ${f.runId} and finding_id = ${f.id} and finding_version = ${f.version} order by created_at, id`

/** The package bytes for a version: composed and stored at its first submission, read back for every resend. */
async function packageBytes(f: FindingRow, reviewId: string, run: NonNullable<Awaited<ReturnType<typeof loadRun>>>) {
  if (f.package_key && f.package_sha256) {
    const bytes = getFile(f.package_key)
    if (sha256(bytes) !== f.package_sha256) throw new Error(`stored package ${f.package_key} does not match its recorded hash`)
    return bytes
  }
  const bytes = new TextEncoder().encode(composePackage(f, run.run, reviewId, run.executions, run.checks))
  const key = `packages/${f.run_id}/${f.id}-v${f.version}.md`
  putFile(key, bytes)
  await sql`update finding set package_key = ${key}, package_sha256 = ${sha256(bytes)} where run_id = ${f.run_id} and id = ${f.id} and version = ${f.version}`
  return bytes
}

/**
 * Sends whichever of the version's assertion and package have no live submission: never sent, refused, or
 * abandoned by the operator. An uncertain or in-flight entry is never resent; the operator abandons it first.
 * Each ledger row is written before its request, outside any transaction, so it survives a crash mid-send.
 */
export async function submitFinding(cairn: Cairn, ref: FindingRef): Promise<LedgerEntry[]> {
  const run = await loadRun(ref.runId)
  const f = run?.findings.find((x) => x.id === ref.id && x.version === ref.version)
  if (!run || !f) throw new Error(`no finding ${ref.id} v${ref.version} in ${ref.runId}`)
  if (f.withdrawn_at) throw new Error(`${f.id} v${f.version} is withdrawn; submit a new version`)
  if (f.superseded_by) throw new Error(`${f.id} was revised as ${f.superseded_by}; submit that instead`)
  const reviewId = run.run.review_id
  const [review] = await sql<{ cairn_record: RecordSteps | null }[]>`select cairn_record from review where id = ${reviewId}`
  const record = review?.cairn_record
  if (!record) throw new Error(`open the Cairn record for review ${reviewId} first`)

  const entries = await ledgerEntries(ref)
  const latest = (kind: Kind) => entries.filter((e) => e.kind === kind).at(-1)
  const due = (['assertion', 'file'] as const).filter((k) => [undefined, 'refused', 'abandoned'].includes(latest(k)?.outcome))
  const step = record.steps.find((s) => s.name === STEP_FOR[f.classification])
  const sourceRef = sourceReference(reviewId, f)

  for (const kind of due) {
    const slot = step?.slots.find((s) => s.allowedKinds.includes(kind === 'assertion' ? 'assertion' : 'document'))
    const proposal = step && slot ? { proposedStepId: step.id, proposedSlotId: slot.id } : {}
    const text = kind === 'assertion' ? composeAssertion(f, run.run.id, reviewId) : undefined
    const bytes = kind === 'file' ? await packageBytes(f, reviewId, run) : undefined
    const [entry] = await sql<{ id: string }[]>`
      insert into cairn_submission (run_id, finding_id, finding_version, kind, payload_sha256, source_reference, proposed_step_id, proposed_slot_id)
      values (${f.run_id}, ${f.id}, ${f.version}, ${kind}, ${sha256(text ?? bytes!)}, ${sourceRef}, ${proposal.proposedStepId ?? null}, ${proposal.proposedSlotId ?? null})
      returning id`
    try {
      const r =
        text !== undefined
          ? await cairn.submitAssertion({ assertionText: text, sourceReference: sourceRef, ...proposal })
          : await cairn.submitFile({ filename: packageFileName(reviewId, f), bytes: bytes!, contentType: 'text/markdown', sourceReference: sourceRef, ...proposal })
      await sql`update cairn_submission set outcome = 'submitted', candidate_id = ${r.candidateId}, placement = ${r.placement} where id = ${entry.id}`
    } catch (e) {
      if (e instanceof CairnRefused) await sql`update cairn_submission set outcome = 'refused', error_code = ${e.code} where id = ${entry.id}`
      else if (e instanceof CairnUncertain) await sql`update cairn_submission set outcome = 'uncertain' where id = ${entry.id}`
      else throw e // the entry stays 'sending', which reads as uncertain
    }
  }
  return ledgerEntries(ref)
}

/** The operator gives up on an uncertain entry, after checking Cairn's Tray; the next submit sends that item again. */
export async function abandonEntry(entryId: string) {
  const rows = await sql`update cairn_submission set outcome = 'abandoned' where id = ${entryId} and outcome in ('sending', 'uncertain') returning id`
  if (!rows.length) throw new Error(`entry ${entryId} is not uncertain`)
}

/** Reads back every submitted candidate in the review and records what Cairn says, or that it said nothing. */
export async function refreshStatus(cairn: Cairn, reviewId: string) {
  const entries = await sql<{ id: string; candidate_id: string }[]>`
    select s.id, s.candidate_id from cairn_submission s join analysis_run r on r.id = s.run_id
    where r.review_id = ${reviewId} and s.outcome = 'submitted'`
  if (!entries.length) return
  const items = new Map((await cairn.getCandidateStatus(entries.map((e) => e.candidate_id))).map((i) => [i.candidateId.toLowerCase(), i]))
  for (const e of entries) {
    const i = items.get(e.candidate_id.toLowerCase())
    const status: ReadBack = i ? { status: i.status, evidence: i.evidence } : { status: 'not-reported', evidence: null }
    await sql`update cairn_submission set cairn_status = ${json(status)}, cairn_read_at = now() where id = ${e.id}`
  }
}

export type ItemState = LedgerEntry['outcome'] | 'not-sent' | 'not-read' | 'unfiled' | 'discarded' | 'not-reported' | 'accepted' | 'voided' | 'unverifiable' | 'other-record'
export type FindingState = 'not_submitted' | 'pending' | 'publication_ready' | 'rejected' | 'incomplete' | 'withdrawn'

/** One item's state, from its latest ledger entry. Accepted means filed, active, and on the review's record. */
export function itemState(e: LedgerEntry | undefined, recordReference: string | null): Exclude<ItemState, 'submitted'> {
  if (!e) return 'not-sent'
  if (e.outcome !== 'submitted') return e.outcome
  const s = e.cairn_status
  if (!s) return 'not-read'
  if (s.status !== 'filed') return s.status
  if (!s.evidence) return 'unverifiable'
  if (s.evidence.status === 'voided') return 'voided'
  return s.evidence.recordReference === recordReference ? 'accepted' : 'other-record'
}

// Items that leave a finding pending: still in flight, unread, or waiting in Cairn. A stuck 'sending' entry is uncertain.
const WAITING: ItemState[] = ['sending', 'uncertain', 'not-read', 'unfiled']

/** A finding version's state (§6.7), first match in the order withdrawn, rejected, publication-ready, incomplete, pending. */
export function findingState(f: Pick<FindingRow, 'withdrawn_at'>, entries: LedgerEntry[], recordReference: string | null) {
  const latest = (kind: Kind) => entries.filter((e) => e.kind === kind).at(-1)
  const items = { assertion: itemState(latest('assertion'), recordReference), file: itemState(latest('file'), recordReference) }
  const both = [items.assertion, items.file]
  const state: FindingState = f.withdrawn_at
    ? 'withdrawn'
    : !entries.length
      ? 'not_submitted'
      : items.assertion === 'discarded'
        ? 'rejected'
        : both.every((i) => i === 'accepted')
          ? 'publication_ready'
          : both.every((i) => i === 'accepted' || WAITING.includes(i))
            ? 'pending'
            : 'incomplete'
  return { state, items }
}

/** The operator withdraws a finding version, with a reason. Final for that version; nothing changes in Cairn. */
export async function withdrawFinding(ref: FindingRef, reason: string) {
  const why = reason.trim()
  if (!why) throw new Error('a reason is required to withdraw a finding')
  const rows = await sql`
    update finding set withdrawn_at = now(), withdrawal_reason = ${why}
    where run_id = ${ref.runId} and id = ${ref.id} and version = ${ref.version} and withdrawn_at is null returning id`
  if (!rows.length) throw new Error(`${ref.id} v${ref.version} does not exist or is already withdrawn`)
}

/** Puts a withdrawn finding forward again as the next version, with the same content and no package yet. */
export async function newVersion(ref: Omit<FindingRef, 'version'>): Promise<number> {
  const [latest] = await sql<Pick<FindingRow, 'version' | 'withdrawn_at'>[]>`
    select version, withdrawn_at from finding where run_id = ${ref.runId} and id = ${ref.id} order by version desc limit 1`
  if (!latest) throw new Error(`no finding ${ref.id} in ${ref.runId}`)
  if (!latest.withdrawn_at) throw new Error(`${ref.id} v${latest.version} is not withdrawn; withdraw it before putting it forward again`)
  await sql`
    insert into finding (run_id, id, version, classification, proposed_classification, validation, content, superseded_by)
    select run_id, id, version + 1, classification, proposed_classification, validation, content, superseded_by
    from finding where run_id = ${ref.runId} and id = ${ref.id} and version = ${latest.version}`
  return latest.version + 1
}
