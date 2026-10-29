// The IGI API as the UI uses it: the shapes of what the server returns, and one function per request. A 401 means
// the session has ended; every other failure carries the server's message.

export type OpState = 'running' | 'succeeded' | 'failed' | 'interrupted'
export type Operation = { id: string; review_id: string; kind: string; state: OpState; started_at: string; finished_at: string | null; result: unknown; error: string | null }

export type ReviewListItem = {
  id: string
  period_end: string
  created_at: string
  record_reference: string | null
  status_checked_at: string | null
  latest_run: { id: string; status: string; started_at: string } | null
  latest_pack: number | null
}
export type SourceSummary = { source: string; file: string; sha256: string; description: string; rows?: number; sections?: string[]; fields?: Record<string, string>; validation_issues: string[] }
export type Upload = { file: string; sha256: string; uploaded_at: string }
export type RunSummary = { id: string; status: string; started_at: string; ended_at: string | null; turns: number; tool_calls: number; usage: { costUsd?: number } | null; summary: string | null }
export type CairnRecord = { cairnReference: string; procedureName: string; procedureVersion: number; subjectReference: string; subjectName?: string | null }
export type ReviewOverview = {
  review: { id: string; periodEnd: string; createdAt: string; record: CairnRecord | null; statusCheckedAt: string | null; statusError: string | null; cairnAppUrl: string | null }
  uploads: Upload[]
  sources: SourceSummary[]
  importError: string | null
  runs: RunSummary[]
  operations: Operation[]
}

// How IGI checked one figure, one whole-population statement, and the finding as a whole (spec §6.4).
export type ClaimResult = { key: string; label: string; value: string | null; measure: string; basis: string; ok: boolean; reason?: string; evidence?: string; scope?: string }
export type CoverageResult = { kind: string; portfolios: string[]; period: string; checks: string[]; ok: boolean; missing: string[]; reason?: string }
export type Validation = { state: string; matched: string[]; unmatched: string[]; claims?: ClaimResult[]; coverage?: CoverageResult[]; unclaimed_figures?: string[]; unsupported_scope?: string[] }
export type Finding = {
  run_id: string
  id: string
  version: number
  classification: string
  proposed_classification: string
  validation: Validation
  content: {
    title: string
    statement: string
    explanation: string
    materiality: string
    portfolios: string[]
    period_end?: string
    review_area?: string
    uncertainties?: string[]
    assumptions?: string[]
    revision?: { of: string; accepted: boolean; reason?: string }
    material_numbers?: { label: string; value: string; check_id: string }[]
  }
  superseded_by: string | null
  withdrawn_at: string | null
  withdrawal_reason: string | null
  artifacts: { package: { name: string; mediaType: string } } | null
}
// One submission attempt, with what Cairn last said about its candidate (status, and the evidence once filed).
export type LedgerEntry = {
  id: string
  kind: 'assertion' | 'file'
  outcome: string
  candidate_id: string | null
  placement: string | null
  error_code: string | null
  created_at: string
  cairn_status: { status: string; evidence: { cairnReference: string; status: string } | null } | null
}
export type FindingState = 'not_submitted' | 'pending' | 'publication_ready' | 'rejected' | 'incomplete' | 'withdrawn'
export type FindingsResponse = {
  findings: { finding: Finding; runTag: string; state: FindingState; items: { assertion: string; file: string }; entries: LedgerEntry[] }[]
  reconcile: { id: string; version: number; advice: string }[]
}
export type Blocker = { finding?: { runId: string; id: string; version: number; title: string }; reason: string }
export type Pack = {
  review_id: string
  version: number
  generated_at: string
  file_key: string
  pdf_key: string | null
  stale_at: string | null
  stale_reason: string | null
  superseded: boolean
  submission: { outcome: string; candidateId: string | null; status: { status: string; evidence: { cairnReference: string; status: string } | null } | null } | null
  findings: string[]
  counts: { rejected: number; withdrawn: number; notSubmitted: number }
}
export type PacksResponse = { blockers: Blocker[]; blockError: string | null; packs: Pack[] }

// One event of an investigation's trace, as stored: a model turn, a tool call or an error.
export type TraceEvent = { seq: number; at: string; type: string; data: Record<string, unknown> }
export type Execution = { id: string; purpose: string; code: string; ok: boolean; result: unknown; stdout: string; error: string | null }
export type Note = { id: string; kind: string; text: string }
export type RunDetail = { run: RunSummary & { config: { model: string; reasoning_effort: string; igi_commit: string } }; events: TraceEvent[]; executions: Execution[]; notes: Note[]; findings: Finding[] }

export class SignedOut extends Error {}

/** One request: JSON in and out (or a FormData upload); throws SignedOut on 401 and the server's message otherwise. */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const form = body instanceof FormData
  const res = await fetch(path, { method, headers: body !== undefined && !form ? { 'Content-Type': 'application/json' } : {}, body: form ? body : body === undefined ? undefined : JSON.stringify(body) })
  if (res.status === 401 && !path.endsWith('/login')) throw new SignedOut()
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`)
  return data
}

// A started operation, or the one already running when the server says so (409).
type Started = { operation: Operation }
const start = async (path: string, body: unknown = {}): Promise<Operation> => {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (res.status === 401) throw new SignedOut()
  const data = (await res.json()) as Started & { error?: string }
  if (res.ok || (res.status === 409 && data.operation)) return data.operation
  throw new Error(data.error ?? `${res.status}`)
}

export const api = {
  session: () => call<{ signedIn: boolean }>('GET', '/api/session'),
  login: (password: string) => call<{ signedIn: boolean }>('POST', '/api/login', { password }),
  logout: () => call<{ signedIn: boolean }>('POST', '/api/logout'),
  reviews: () => call<ReviewListItem[]>('GET', '/api/reviews'),
  createReview: (id: string, periodEnd: string) => call<{ id: string }>('POST', '/api/reviews', { id, periodEnd }),
  review: (id: string) => call<ReviewOverview>('GET', `/api/reviews/${id}`),
  upload: (id: string, files: FileList) => {
    const form = new FormData()
    for (const f of files) form.append('files', f, f.name)
    return call<{ uploaded: Upload[] }>('POST', `/api/reviews/${id}/sources`, form)
  },
  rows: (id: string, source: string) => call<{ rows: Record<string, string>[]; matching: number }>('GET', `/api/reviews/${id}/sources/${source}/rows?limit=50`),
  investigate: (id: string, effort: string) => start(`/api/reviews/${id}/investigate`, { effort }),
  run: (runId: string) => call<RunDetail>('GET', `/api/runs/${runId}`),
  findings: (id: string) => call<FindingsResponse>('GET', `/api/reviews/${id}/findings`),
  assertion: (f: Finding) => call<{ text: string | null; sent: boolean; error?: string }>('GET', `/api/findings/${f.run_id}/${f.id}/${f.version}/assertion`),
  packageUrl: (f: Finding) => `/api/findings/${f.run_id}/${f.id}/${f.version}/package`,
  withdraw: (f: Finding, reason: string) => call<{ withdrawn: boolean }>('POST', `/api/findings/${f.run_id}/${f.id}/${f.version}/withdraw`, { reason }),
  newVersion: (f: Finding) => call<{ version: number }>('POST', `/api/findings/${f.run_id}/${f.id}/new-version`, {}),
  abandon: (entryId: string) => call<{ abandoned: boolean }>('POST', `/api/entries/${entryId}/abandon`, {}),
  openRecord: (id: string) => start(`/api/reviews/${id}/record`),
  submit: (id: string, findings: { runId: string; id: string; version: number }[]) => start(`/api/reviews/${id}/submit`, { findings }),
  refresh: (id: string) => start(`/api/reviews/${id}/refresh`),
  packs: (id: string) => call<PacksResponse>('GET', `/api/reviews/${id}/packs`),
  generatePack: (id: string) => start(`/api/reviews/${id}/packs`),
  submitPack: (id: string, resend = false) => start(`/api/reviews/${id}/packs/submit`, { resend }),
  // A pack that isn't current opens only as an explicit historical copy; the server checks Cairn before either.
  packUrl: (id: string, version: number, kind: 'pdf' | 'html', historical = false) => `/api/reviews/${id}/packs/${version}.${kind}${historical ? '?historical=1' : ''}`,
  operation: (opId: string) => call<Operation>('GET', `/api/operations/${opId}`),
}
