// Operator-started work that outlives a request (spec §6.10): an investigation, submissions, pack generation, a
// Cairn status read. Each is a row in `operation`, written before the work starts, refreshed while it runs and
// closed with its result or error. At most one of each kind runs per review, enforced by the database, so a repeated
// click or a second worker gets the running one back instead of starting another. Nothing here calls the model on
// its own: only an operator's request starts an investigation.
import { json, sql } from './db.ts'

// One operation as stored. result is the work's return value, error its message if it threw.
export type Operation = {
  id: string
  review_id: string
  kind: 'investigate' | 'open_record' | 'submit_findings' | 'refresh_status' | 'generate_pack' | 'submit_pack'
  state: 'running' | 'succeeded' | 'failed' | 'interrupted'
  started_at: Date
  heartbeat_at: Date
  finished_at: Date | null
  result: unknown
  error: string | null
}

// How often a running operation proves it is alive, and how long without that before it counts as interrupted.
const HEARTBEAT_MS = 20_000
const STALE_MS = 90_000

/** Thrown when an operation of the same kind is already running for the review; carries that operation. */
export class AlreadyRunning extends Error {
  readonly running: Operation
  constructor(running: Operation) {
    super(`a ${running.kind.replaceAll('_', ' ')} is already running for review ${running.review_id}`)
    this.running = running
  }
}

/**
 * Starts work as an operation and returns at once with its row and a promise of its end. The row is inserted first;
 * if one of the same kind is running for the review, AlreadyRunning is thrown and nothing starts. While the work
 * runs its heartbeat is refreshed, and when it ends the row records the result or the error.
 */
export async function startOperation(reviewId: string, kind: Operation['kind'], work: (op: Operation) => Promise<unknown>): Promise<{ op: Operation; done: Promise<Operation> }> {
  let op: Operation
  try {
    ;[op] = await sql<Operation[]>`insert into operation (review_id, kind) values (${reviewId}, ${kind}) returning *`
  } catch (e) {
    // 23505 is a unique violation: the partial index found one of this kind already running for the review.
    if ((e as { code?: string }).code !== '23505') throw e
    const [running] = await sql<Operation[]>`select * from operation where review_id = ${reviewId} and kind = ${kind} and state = 'running'`
    throw new AlreadyRunning(running)
  }
  const beat = setInterval(() => void sql`update operation set heartbeat_at = now() where id = ${op.id} and state = 'running'`.catch(() => {}), HEARTBEAT_MS)
  const done = work(op).then(
    async (result) => (await sql<Operation[]>`update operation set state = 'succeeded', finished_at = now(), result = ${json(result ?? null)} where id = ${op.id} returning *`)[0],
    async (e: unknown) => (await sql<Operation[]>`update operation set state = 'failed', finished_at = now(), error = ${e instanceof Error ? e.message : String(e)} where id = ${op.id} returning *`)[0],
  )
  void done.finally(() => clearInterval(beat))
  return { op, done }
}

/**
 * Marks interrupted every running operation whose heartbeat has stopped, as after a restart, and fails any analysis
 * run left running with no live investigation behind it and no trace activity for ten minutes (a run started from
 * the command line has no operation, but writes its trace every turn), saying so in its summary. A model
 * conversation can't be resumed; the operator starts a new run (§6.10, §8.4). Returns how many of each it marked.
 */
export async function recoverOperations(staleMs = STALE_MS, idleRunMs = 600_000) {
  const ops = await sql`
    update operation set state = 'interrupted', finished_at = now(), error = 'Interrupted: the service stopped while this was running.'
    where state = 'running' and heartbeat_at < now() - ${`${staleMs} milliseconds`}::interval returning id`
  const runs = await sql`
    update analysis_run r set status = 'failed', ended_at = now(), summary = 'Interrupted: the service stopped during this run. Start a new investigation.'
    where r.status = 'running'
      and not exists (select 1 from operation o where o.review_id = r.review_id and o.kind = 'investigate' and o.state = 'running')
      and coalesce((select max(t.at) from trace_event t where t.run_id = r.id), r.started_at) < now() - ${`${idleRunMs} milliseconds`}::interval
    returning id`
  return { operations: ops.length, runs: runs.length }
}

/** The review's operations, newest first. */
export const listOperations = (reviewId: string) => sql<Operation[]>`select * from operation where review_id = ${reviewId} order by started_at desc limit 50`
