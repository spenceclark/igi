// IGI's own PostgreSQL (spec §10.1, §11): a local container while building (npm run db:up), the
// DigitalOcean database once deployed. Never Cairn's database.
import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import type { Budget } from './agent.ts'
import type { CheckArgs } from './checks.ts'
import type { Execution, Finding, RunState } from './tools.ts'

const LOCAL = 'postgres://igi:igi@127.0.0.1:5434/igi' // not localhost: parallel connections to it time out under Docker Desktop on Windows
export const sql = postgres(process.env.DATABASE_URL ?? LOCAL, { onnotice: () => {}, transform: { undefined: null } })

// jsonb takes any JSON value only through sql.json; a bare array or string would be sent as a Postgres array or text.
// Run state is plain JSON (strings, numbers, booleans, arrays, objects), so the cast holds.
export const json = (v: unknown) => sql.json((v ?? null) as postgres.JSONValue)

export type RunConfig = {
  model: string
  reasoning_effort: string
  igi_commit: string
  monty_version: string
  instructions_sha: string
  tools_sha: string
  budget: Budget
  sources: { id: string; file: string; sha256: string }[]
  memory_enabled: boolean
  knowledge_ids: string[]
}

type FindingContent = Omit<Finding, 'id' | 'classification' | 'proposed_classification' | 'validation' | 'superseded_by'>
export type RunRow = {
  id: string
  review_id: string
  agent_definition_id: string
  started_at: Date
  ended_at: Date | null
  status: string
  config: RunConfig
  turns: number
  tool_calls: number
  usage: Record<string, unknown> | null
  summary: string | null
}
export type TraceEventRow = { seq: number; at: Date; type: string; data: Record<string, unknown> }
export type ExecutionRow = Pick<Execution, 'id' | 'purpose' | 'code' | 'ok' | 'result' | 'stdout' | 'ms' | 'reads'> & { run_id: string; error: string | null; error_type: string | null }
export type CheckRow = { run_id: string; id: string; args: CheckArgs; result: Record<string, unknown>; rows_used: string[] }
export type NoteRow = { run_id: string; id: string; kind: string; text: string; related_ids: string[] | null }
export type FindingRow = Pick<Finding, 'id' | 'classification' | 'proposed_classification' | 'validation'> & {
  run_id: string
  version: number
  content: FindingContent
  superseded_by: string | null
  package_key: string | null
  package_sha256: string | null
  withdrawn_at: Date | null
  withdrawal_reason: string | null
}

export async function migrate() {
  await sql.unsafe(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')).simple()
}

export async function saveReview(r: { id: string; periodEnd: string; sourceDir?: string }) {
  await sql`insert into review (id, period_end, source_dir) values (${r.id}, ${r.periodEnd}, ${r.sourceDir ?? null}) on conflict (id) do nothing`
}

export type TraceEvent = { seq: number; at: string; type: string } & Record<string, unknown>
export type RunSnapshot = {
  id: string
  reviewId: string
  startedAt: string
  endedAt?: string
  status: string
  config: RunConfig
  turns: number
  toolCalls: number
  usage: Record<string, unknown>
  summary: string
  events: TraceEvent[]
  state: Pick<RunState, 'executions' | 'checks' | 'notes' | 'findings'>
}

/** Saves a run as it stands. Idempotent, so the loop calls it after every turn and once at the end. */
export async function saveRun(s: RunSnapshot) {
  const { executions, checks, notes, findings } = s.state
  await sql.begin(async (tx) => {
    await tx`
      insert into analysis_run (id, review_id, started_at, ended_at, status, config, turns, tool_calls, usage, summary)
      values (${s.id}, ${s.reviewId}, ${s.startedAt}, ${s.endedAt ?? null}, ${s.status}, ${json(s.config)}, ${s.turns}, ${s.toolCalls}, ${json(s.usage)}, ${s.summary})
      on conflict (id) do update set ended_at = excluded.ended_at, status = excluded.status, turns = excluded.turns,
        tool_calls = excluded.tool_calls, usage = excluded.usage, summary = excluded.summary`
    const insert = async (table: string, rows: Record<string, unknown>[]) => {
      if (rows.length) await tx`insert into ${tx(table)} ${tx(rows.map((r) => ({ run_id: s.id, ...r })))} on conflict do nothing`
    }
    await insert('trace_event', s.events.map(({ seq, at, type, ...data }) => ({ seq, at, type, data: json(data) })))
    await insert('code_execution', executions.map((x) => ({ id: x.id, purpose: x.purpose, code: x.code, ok: x.ok, result: json(x.result), stdout: x.stdout, error: x.error, error_type: x.errorType, ms: x.ms, reads: json(x.reads) })))
    await insert('check_result', checks.map((c) => ({ id: c.id, args: json(c.args), result: json(c.result), rows_used: json(c.rowsUsed) })))
    await insert('note', notes.map((n) => ({ id: n.id, kind: n.kind, text: n.text, related_ids: json(n.related_ids) })))
    for (const { id, classification, proposed_classification, validation, superseded_by, ...content } of findings) {
      await tx`
        insert into finding (run_id, id, classification, proposed_classification, validation, content, superseded_by)
        values (${s.id}, ${id}, ${classification}, ${proposed_classification}, ${json(validation)}, ${json(content)}, ${superseded_by ?? null})
        on conflict (run_id, id, version) do update set superseded_by = excluded.superseded_by`
    }
  })
}

export async function loadRun(id: string) {
  const [run] = await sql<RunRow[]>`select * from analysis_run where id = ${id}`
  if (!run) return undefined
  const [events, executions, checks, notes, findings] = await Promise.all([
    sql<TraceEventRow[]>`select seq, at, type, data from trace_event where run_id = ${id} order by seq`,
    sql<ExecutionRow[]>`select * from code_execution where run_id = ${id} order by length(id), id`,
    sql<CheckRow[]>`select * from check_result where run_id = ${id} order by length(id), id`,
    sql<NoteRow[]>`select * from note where run_id = ${id} order by length(id), id`,
    sql<FindingRow[]>`select * from finding where run_id = ${id} order by length(id), id, version`,
  ])
  return { run, events, executions, checks, notes, findings }
}
