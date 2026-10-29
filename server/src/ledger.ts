// The Cairn side of a review: opening its record (spec §6.1), the submission ledger (§12.4), the status
// read-back (§12.5), and each finding version's state, withdrawal and new versions (§6.7).
import { createHash } from 'node:crypto'
import { type Cairn, CairnRefused, CairnUncertain, type CandidateStatus, type RecordSteps } from './cairn.ts'
import { json, loadRun, sql, type FindingArtifacts, type FindingRow, type StoredFile } from './db.ts'
import { getFile, putFile } from './files.ts'
import { igiBuild } from './build.ts'
import { composeAssertion, findingPayload, packageHtml, sourceReference } from './package.ts'
import { renderPdf } from './render.ts'
import { isCurrent } from './evidence.ts'
import { assemble } from './review-sources.ts'
import { importReview } from './sources.ts'

// The two items submitted for every finding version: its assertion and its investigation package file.
// (The committee pack's own submission is recorded on the pack: see submitPack in committee-pack.ts.)
export type Kind = 'assertion' | 'file'
// A finding version: findings are numbered per run, and a finding put forward again gets a new version.
export type FindingRef = { runId: string; id: string; version: number }
// What the last status read-back said about a candidate; not-reported when Cairn left it out of the answer.
type ReadBack = Pick<CandidateStatus, 'status' | 'evidence'> | { status: 'not-reported'; evidence: null }
// One submission attempt (§12.4), written before its request is sent. outcome: sending until Cairn answers, then
// submitted (with the candidate id and placement), refused (with the error code) or uncertain; abandoned when the
// operator gives up on an uncertain one.
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

// The step each review area's evidence is proposed for, by the step names in §12.2, and the step for the committee
// pack itself. A step missing from the record means no proposal: the candidate waits in Cairn's Tray unplaced.
export const AREA_STEP: Record<string, string> = {
  source_data: 'Source data and reconciliation',
  allocation_risk: 'Portfolio allocation and risk review',
  funds_fees: 'Fund, manager and fee oversight',
  committee_actions: 'Historical decisions and outstanding actions',
}
export const PACK_STEP = 'Committee pack preparation'
// The step by classification, for findings recorded before they named a review area.
const STEP_FOR: Record<string, string> = {
  data_quality: AREA_STEP.source_data,
  missing_information: AREA_STEP.source_data,
  potential_exception: AREA_STEP.allocation_risk,
  policy_inconsistency: AREA_STEP.allocation_risk,
  explained_anomaly: AREA_STEP.allocation_risk,
  observation: AREA_STEP.allocation_risk,
  outstanding_action: AREA_STEP.committee_actions,
}

/** The step a finding's evidence is proposed for: its review area's, or its classification's when it names none. */
export const stepFor = (f: Pick<FindingRow, 'classification' | 'content'>) => (f.content.review_area ? AREA_STEP[f.content.review_area] : STEP_FOR[f.classification])

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')

/** Where the record doesn't fit those steps: what would wait in the Tray unplaced, and why. */
export function placementGaps(record: RecordSteps): string[] {
  const needs: [string, ('assertion' | 'document')[], string][] = [
    ...Object.entries(AREA_STEP).map(([area, name]): [string, ('assertion' | 'document')[], string] => [name, ['assertion', 'document'], `findings in ${area.replaceAll('_', ' ')}`]),
    [PACK_STEP, ['document'], 'the committee pack'],
  ]
  return needs.flatMap(([name, kinds, what]) => {
    const step = record.steps.find((s) => s.name === name)
    const gaps = step ? kinds.filter((k) => !step.slots.some((s) => s.allowedKinds.includes(k))).map((k) => `step "${name}" has no ${k} slot`) : [`no step "${name}"`]
    return gaps.map((g) => `${g} (for ${what})`)
  })
}

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

/** Every submission attempt for a finding version, oldest first. */
export const ledgerEntries = (f: FindingRef) =>
  sql<LedgerEntry[]>`select * from cairn_submission where run_id = ${f.runId} and finding_id = ${f.id} and finding_version = ${f.version} order by created_at, id`

/** A stored file's bytes, refused if they no longer match the hash recorded for them. */
function readStored(s: StoredFile) {
  const bytes = getFile(s.key)
  if (sha256(bytes) !== s.sha256) throw new Error(`stored file ${s.key} does not match its recorded hash`)
  return bytes
}

/**
 * Where each row of a run's sources is in its file, named with the file (fees.csv, line 3), from the sources the run
 * analysed as IGI retains them (§7.5). Empty when they can't be read back; the package then lists row ids alone.
 */
export function rowLocations(reviewId: string, sources: { file: string; sha256: string }[]): Record<string, string> {
  try {
    const review = importReview(assemble(reviewId, sources), reviewId)
    return Object.fromEntries(review.sources.flatMap((s) => Object.entries(s.provenance ?? {}).map(([id, p]) => [id, `${s.file}, ${p.location}`])))
  } catch {
    return {}
  }
}

/**
 * What a finding version is submitted as (spec §6.5, §12.3): its assertion text and its package file. At the first
 * submission the presentation payload is frozen from the run's records, and the assertion and the package PDF are
 * rendered from it; all three are stored with their hashes and the package's render record. Every resend reads them
 * back. An assertion over Cairn's limit is refused before anything is stored or sent. A version whose package was
 * stored before PDFs (a Markdown file) keeps it as it was: its bytes are what was, or will be, reviewed.
 */
async function prepareFinding(f: FindingRow, reviewId: string, run: NonNullable<Awaited<ReturnType<typeof loadRun>>>) {
  if (f.artifacts) return { text: new TextDecoder().decode(readStored(f.artifacts.assertion)), bytes: readStored(f.artifacts.package), file: f.artifacts.package }
  const payload = findingPayload(f, run.run, reviewId, run.executions, run.checks, run.findings, rowLocations(reviewId, run.run.config.sources))
  const text = composeAssertion(payload)
  const base = `findings/${f.run_id}/${f.id}-v${f.version}`
  const store = (suffix: string, bytes: Uint8Array): StoredFile => {
    putFile(`${base}${suffix}`, bytes)
    return { key: `${base}${suffix}`, sha256: sha256(bytes) }
  }
  const encode = (s: string) => new TextEncoder().encode(s)
  let file: FindingArtifacts['package']
  if (f.package_key && f.package_sha256) {
    readStored({ key: f.package_key, sha256: f.package_sha256 })
    file = { key: f.package_key, sha256: f.package_sha256, name: `IGI-${reviewId}-${f.id}-v${f.version}.md`, mediaType: 'text/markdown' }
  } else {
    const r = await renderPdf(packageHtml(payload), `${payload.packageName}: investigation package, IGI finding ${f.id} v${f.version}`)
    file = { ...store('.pdf', r.bytes), name: payload.packageName, mediaType: 'application/pdf', renderer: r.renderer, template: igiBuild() }
  }
  const artifacts: FindingArtifacts = { payload: store('.payload.json', encode(JSON.stringify(payload))), assertion: store('.assertion.txt', encode(text)), package: file }
  await sql`update finding set artifacts = ${json(artifacts)}, package_key = ${file.key}, package_sha256 = ${file.sha256} where run_id = ${f.run_id} and id = ${f.id} and version = ${f.version}`
  return { text, bytes: readStored(file), file }
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
  if (!isCurrent(f)) throw new Error(`${f.id} is a revision of ${f.content.revision?.of} that was not accepted; submit ${f.content.revision?.of} or a new revision`)
  const reviewId = run.run.review_id
  const [review] = await sql<{ cairn_record: RecordSteps | null }[]>`select cairn_record from review where id = ${reviewId}`
  const record = review?.cairn_record
  if (!record) throw new Error(`open the Cairn record for review ${reviewId} first`)

  // An item is due when its latest attempt doesn't exist, was refused or was abandoned. Both items are proposed
  // for the step of the finding's review area, each in the step's first slot that takes its kind.
  const entries = await ledgerEntries(ref)
  const latest = (kind: Kind) => entries.filter((e) => e.kind === kind).at(-1)
  const due = (['assertion', 'file'] as const).filter((k) => [undefined, 'refused', 'abandoned'].includes(latest(k)?.outcome))
  const step = record.steps.find((s) => s.name === stepFor(f))
  const sourceRef = sourceReference(reviewId, f)
  // Prepared once, and only when something is due: a preparation error (an assertion too long) sends nothing.
  const prepared = due.length ? await prepareFinding(f, reviewId, run) : undefined

  for (const kind of due) {
    const slot = step?.slots.find((s) => s.allowedKinds.includes(kind === 'assertion' ? 'assertion' : 'document'))
    const proposal = step && slot ? { proposedStepId: step.id, proposedSlotId: slot.id } : {}
    const text = kind === 'assertion' ? prepared!.text : undefined
    const bytes = kind === 'file' ? prepared!.bytes : undefined
    const [entry] = await sql<{ id: string }[]>`
      insert into cairn_submission (run_id, finding_id, finding_version, kind, payload_sha256, source_reference, proposed_step_id, proposed_slot_id)
      values (${f.run_id}, ${f.id}, ${f.version}, ${kind}, ${sha256(text ?? bytes!)}, ${sourceRef}, ${proposal.proposedStepId ?? null}, ${proposal.proposedSlotId ?? null})
      returning id`
    try {
      const r =
        text !== undefined
          ? await cairn.submitAssertion({ assertionText: text, sourceReference: sourceRef, ...proposal })
          : await cairn.submitFile({ filename: prepared!.file.name, bytes: bytes!, contentType: prepared!.file.mediaType, sourceReference: sourceRef, ...proposal })
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
  // Ids are compared in lower case. A candidate Cairn left out of its answer is recorded as not-reported.
  for (const e of entries) {
    const i = items.get(e.candidate_id.toLowerCase())
    const status: ReadBack = i ? { status: i.status, evidence: i.evidence } : { status: 'not-reported', evidence: null }
    await sql`update cairn_submission set cairn_status = ${json(status)}, cairn_read_at = now() where id = ${e.id}`
  }
}

// An item's state: its ledger outcome until Cairn has a candidate, then what the read-back says about it.
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
