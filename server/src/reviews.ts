// The operator's actions on a review (spec §6.10, §14), each run as an operation so it survives the request that
// started it and can't be started twice at once: investigate, open the Cairn record, submit findings, read Cairn,
// generate the pack and submit it. Also the status poller, which reads Cairn while anything there is unsettled.
// Only an operator's request starts an investigation; reading Cairn never does.
import { investigate } from './agent.ts'
import type { Cairn } from './cairn.ts'
import { checkPacks, generatePack, submitPack } from './committee-pack.ts'
import { saveReview, sql } from './db.ts'
import { retainSources } from './files.ts'
import { openRecord, submitFinding, type FindingRef } from './ledger.ts'
import { AlreadyRunning, recoverOperations, startOperation } from './operations.ts'
import { reviewDir } from './review-sources.ts'
import { importReview } from './sources.ts'

// A review id is short and safe in a URL, a file name and a Cairn source reference.
const REVIEW_ID = /^[a-z0-9][a-z0-9-]{1,40}$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Creates a review for a period end. Refuses an id that isn't short lowercase letters, digits and hyphens, or one in use. */
export async function createReview(id: string, periodEnd: string) {
  if (!REVIEW_ID.test(id)) throw new Error('a review id is 2 to 41 lowercase letters, digits or hyphens, starting with a letter or digit')
  if (!ISO_DATE.test(periodEnd)) throw new Error('the period end is an ISO date, e.g. 2026-09-30')
  const [existing] = await sql`select 1 from review where id = ${id}`
  if (existing) throw new Error(`review ${id} already exists`)
  await saveReview({ id, periodEnd })
}

/**
 * Starts an investigation of the review's current sources. They are imported and retained first, so a source the
 * importer can't read is reported before any model call; the run then proceeds in the background as an operation.
 */
export async function investigateReview(reviewId: string, opts: { effort?: string } = {}) {
  const dir = await reviewDir(reviewId)
  const review = importReview(dir, reviewId)
  if (!review.sources.length) throw new Error(`review ${reviewId} has no sources to investigate`)
  retainSources(dir, review.sources)
  return startOperation(reviewId, 'investigate', async () => {
    const r = await investigate(review, { budget: opts.effort ? { effort: opts.effort } : {} })
    return { runId: r.runId, status: r.status, costUsd: Number(r.usage.costUsd.toFixed(4)) }
  })
}

// The Cairn subject and procedure a review's record is started for, from the environment (§12.2).
const recordConfig = () => {
  const subjectReference = process.env.CAIRN_SUBJECT_REFERENCE
  const procedureName = process.env.CAIRN_PROCEDURE_NAME
  if (!subjectReference || !procedureName) throw new Error('CAIRN_SUBJECT_REFERENCE and CAIRN_PROCEDURE_NAME are not set')
  return { subjectReference, procedureName }
}

/** Starts the review's Cairn record, or returns the one already started. */
export const openReviewRecord = (cairn: Cairn, reviewId: string) =>
  startOperation(reviewId, 'open_record', async () => {
    const r = await openRecord(cairn, reviewId, recordConfig())
    return { recordReference: r.record.cairnReference }
  })

/**
 * Submits the findings named, one after another, each sending only what has no live submission. A finding that
 * can't be prepared (an assertion over Cairn's limit, say) is reported and the rest still go.
 */
export const submitReviewFindings = (cairn: Cairn, reviewId: string, refs: FindingRef[]) =>
  startOperation(reviewId, 'submit_findings', async () => {
    const results = []
    for (const ref of refs) {
      try {
        const entries = await submitFinding(cairn, ref)
        results.push({ ...ref, outcomes: entries.map((e) => `${e.kind} ${e.outcome}`) })
      } catch (e) {
        results.push({ ...ref, error: (e as Error).message })
      }
    }
    return results
  })

/**
 * Reads back every candidate of the review and re-checks its packs (checkPacks), recording when Cairn was read,
 * or why the read failed. A failed read changes no candidate's state: it is uncertainty, not a decision. Reads
 * within 15 seconds of the last good one are skipped, so returning to the window repeatedly stays within Cairn's
 * rate limit (§14).
 */
export const refreshReview = (cairn: Cairn, reviewId: string) =>
  startOperation(reviewId, 'refresh_status', async () => {
    const [recent] = await sql`select 1 from review where id = ${reviewId} and status_checked_at > now() - interval '15 seconds'`
    if (recent) return { checked: false }
    try {
      await checkPacks(cairn, reviewId)
      await sql`update review set status_checked_at = now(), status_error = null where id = ${reviewId}`
      return { checked: true }
    } catch (e) {
      await sql`update review set status_error = ${(e as Error).message} where id = ${reviewId}`
      throw e
    }
  })

/** Generates the next committee pack from a fresh read-back, or records what blocks it. */
export const generateReviewPack = (cairn: Cairn, reviewId: string) =>
  startOperation(reviewId, 'generate_pack', async () => {
    const r = await generatePack(cairn, reviewId)
    return 'pack' in r ? { version: r.pack.version } : { blockers: r.blockers }
  })

/** Submits the latest pack's PDF to Cairn; resend only after checking Cairn's Tray for an uncertain attempt. */
export const submitReviewPack = (cairn: Cairn, reviewId: string, resend = false) =>
  startOperation(reviewId, 'submit_pack', async () => {
    const p = await submitPack(cairn, reviewId, { resend })
    return { version: p.version, outcome: p.submission?.outcome, candidateId: p.submission?.candidateId }
  })

/**
 * Every minute: marks interrupted work, then reads Cairn for each review with something unsettled there (a
 * candidate unread or unfiled, or a submitted pack not yet filed). With nothing unsettled it reads nothing, so a
 * later void is found when the operator refreshes, opens or downloads (§12.5). Returns a function that stops it.
 */
export function startStatusPoller(cairn: Cairn, everyMs = 60_000, log: (line: string) => void = () => {}) {
  const tick = async () => {
    try {
      await recoverOperations()
      const due = await sql<{ id: string }[]>`
        select r.id from review r where r.cairn_record is not null and (
          exists (select 1 from cairn_submission s join analysis_run a on a.id = s.run_id
                  where a.review_id = r.id and s.outcome = 'submitted' and coalesce(s.cairn_status->>'status', 'unfiled') = 'unfiled')
          or exists (select 1 from committee_pack p where p.review_id = r.id and p.submission->>'outcome' = 'submitted'
                  and coalesce(p.submission->'status'->>'status', 'unfiled') = 'unfiled'))`
      for (const r of due) {
        try {
          await (await refreshReview(cairn, r.id)).done
        } catch (e) {
          if (!(e instanceof AlreadyRunning)) log(`status read for ${r.id} failed: ${(e as Error).message}`)
        }
      }
    } catch (e) {
      log(`status poller: ${(e as Error).message}`)
    }
  }
  const timer = setInterval(() => void tick(), everyMs)
  void tick()
  return () => clearInterval(timer)
}
