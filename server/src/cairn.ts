// Cairn candidate intake v1 client (spec §12.1, §12.5). It never retries (§12.4): a refusal that
// carries a `code` created nothing and throws CairnRefused; a timeout, a dropped connection or a
// response without a usable body may have created something and throws CairnUncertain.
// The test double (cairn-fake.ts) is a `fetch`, so the same client runs against both.

// The shapes of Cairn's responses, as its intake API documents them. A Placement is where a proposed candidate
// landed: `placed`, or the reason it waits in the Tray unplaced.
export type Placement = 'placed' | 'not-placeable' | 'record-closed' | 'step-not-open' | 'slot-not-on-step' | 'kind-not-allowed' | (string & {}) | null
export type Submitted = { candidateId: string; placement: Placement }
export type Slot = { id: string; name: string; requirement: 'required' | 'preferred' | 'optional'; allowedKinds: string[] }
export type Step = { id: string; name: string; description: string | null; guidanceMarkdown: string | null; slots: Slot[] }
export type RecordSummary = { cairnReference: string; procedureName: string; procedureVersion: number; subjectReference: string; subjectName?: string | null }
export type RecordSteps = { record: RecordSummary; steps: Step[] }
// What a filed candidate became: evidence on a record, step and slot, which a person may later void.
export type Evidence = {
  cairnReference: string
  status: 'active' | 'voided'
  filedUtc: string
  voidedUtc: string | null
  recordReference: string | null
  stepId: string | null
  slotId: string | null
}
// The status read-back for one candidate (§12.5): still unfiled, filed (with its evidence) or discarded.
export type CandidateStatus = { candidateId: string; status: 'unfiled' | 'filed' | 'discarded'; evidence: Evidence | null }
export type Subject = { cairnReference: string; name: string | null }
export type Procedure = { id: string; name: string; version: number }
type Proposal = { proposedStepId?: string; proposedSlotId?: string }
type Problem = { code: string; title?: string; detail?: string; errors?: unknown }

/** Cairn refused with a problem code: nothing was created, so the request can be corrected and sent again. */
export class CairnRefused extends Error {
  status: number
  code: string
  errors: unknown
  retryAfter: number | null
  constructor(status: number, problem: Problem, retryAfter: number | null) {
    super(`Cairn refused: HTTP ${status} ${problem.code}${problem.detail || problem.title ? `, ${problem.detail || problem.title}` : ''}`)
    this.status = status
    this.code = problem.code
    this.errors = problem.errors ?? null
    this.retryAfter = retryAfter
  }
}
/** No usable answer: the request may or may not have taken effect, so it must not be resent blindly. */
export class CairnUncertain extends Error {}

export type Cairn = ReturnType<typeof cairnClient>

/**
 * A client for Cairn's agent intake API at baseUrl, sending the agent key. `fetch` can be the test double's, and
 * `now` its clock.
 */
export function cairnClient(opts: { baseUrl: string; key: string; fetch?: typeof fetch; timeoutMs?: number; now?: () => number }) {
  const base = `${opts.baseUrl.replace(/\/+$/, '')}/api/intake/v1`
  const send = opts.fetch ?? fetch
  const now = opts.now ?? Date.now
  // When Cairn's last Retry-After ends. The agent's allowance is shared by every route and review, so until then
  // every request is refused here, unsent, as Cairn would refuse it (§12.5).
  // ponytail: kept in memory, so a restart forgets it and the first request after one learns it again from Cairn.
  let waitUntil = 0

  // One request: JSON or bytes in, parsed JSON out, T being the response shape Cairn documents for the route.
  // A success with a JSON body is returned; an error with a problem code throws CairnRefused; anything else
  // (no response, a timeout, an unreadable body) throws CairnUncertain.
  async function call<T>(method: string, path: string, req: { query?: string[][]; json?: unknown; bytes?: Uint8Array<ArrayBuffer>; headers?: Record<string, string> } = {}): Promise<T> {
    if (now() < waitUntil) throw new CairnRefused(429, { code: 'rate-limited', detail: 'waiting for Retry-After; not sent' }, Math.ceil((waitUntil - now()) / 1000))
    const url = base + path + (req.query?.length ? `?${new URLSearchParams(req.query)}` : '')
    const headers: Record<string, string> = { Authorization: `Bearer ${opts.key}`, ...req.headers }
    if (req.json !== undefined) headers['Content-Type'] = 'application/json'
    let res: Response
    let text: string
    try {
      // A byte body, never a stream: Cairn requires an exact Content-Length.
      res = await send(url, { method, headers, body: req.json !== undefined ? JSON.stringify(req.json) : req.bytes, signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000) })
      text = await res.text()
    } catch (e) {
      throw new CairnUncertain(`${method} ${path}: no response (${(e as Error).message})`, { cause: e })
    }
    let body: unknown = null
    try {
      body = JSON.parse(text)
    } catch {}
    if (res.ok && body) return body as T
    const problem = body as Partial<Problem> | null
    if (!res.ok && typeof problem?.code === 'string') {
      const retryAfter = Number(res.headers.get('retry-after'))
      if (retryAfter > 0) waitUntil = now() + retryAfter * 1000
      throw new CairnRefused(res.status, { ...problem, code: problem.code }, retryAfter > 0 ? retryAfter : null)
    }
    throw new CairnUncertain(`${method} ${path}: HTTP ${res.status} without a usable body`)
  }

  // Only the proposal's two fields, so nothing else on the argument reaches Cairn.
  const pair = (p: Proposal) => ({ proposedStepId: p.proposedStepId, proposedSlotId: p.proposedSlotId })

  return {
    // Active subjects with exactly this reference.
    findSubject: async (reference: string) =>
      (await call<{ items: Subject[] }>('GET', '/subjects', { query: [['reference', reference], ['pageSize', '100']] })).items,
    // Procedures this agent may start a record on for the subject; an unknown subject is refused (subject.not-found).
    listStartableProcedures: async (subjectReference: string) =>
      (await call<{ procedures: Procedure[] }>('GET', `/subjects/${encodeURIComponent(subjectReference)}/procedures`)).procedures,
    // Starts a record on a procedure for a subject and returns its steps and slots: 201 for a new record, 200 with
    // repeated: true for the agent's untouched earlier start.
    startRecord: (r: { procedureId: string; subjectReference: string; sourceReference: string }) => call<RecordSteps & { repeated: boolean }>('POST', '/records', { json: r }),
    // Open records matching a record or subject reference.
    findRecords: async (reference: string) =>
      (await call<{ items: RecordSummary[] }>('GET', '/records', { query: [['reference', reference], ['pageSize', '100']] })).items,
    // A record's incomplete steps and their slots.
    getRecordSteps: (recordReference: string) => call<RecordSteps>('GET', `/records/${encodeURIComponent(recordReference)}/steps`),
    // Submits an assertion candidate to the Tray, optionally proposing a step and slot for it.
    submitAssertion: (a: { assertionText: string; sourceReference: string } & Proposal) =>
      call<Submitted>('POST', '/candidates/assertion', { json: { assertionText: a.assertionText, sourceReference: a.sourceReference, ...pair(a) } }),
    // Submits a file candidate: the raw bytes as the body, everything else in headers. A plain file name goes in
    // quotes; any other is percent-encoded (filename*=UTF-8'').
    submitFile(f: { filename: string; bytes: Uint8Array<ArrayBuffer>; contentType?: string; sourceReference: string } & Proposal) {
      const headers: Record<string, string> = {
        'Content-Disposition': /^[\w .-]+$/.test(f.filename) ? `attachment; filename="${f.filename}"` : `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
        'Cairn-Source-Reference': encodeURIComponent(f.sourceReference), // Cairn always percent-decodes it
      }
      if (f.contentType) headers['Content-Type'] = f.contentType
      if (f.proposedStepId) headers['Cairn-Proposed-Step'] = f.proposedStepId
      if (f.proposedSlotId) headers['Cairn-Proposed-Slot'] = f.proposedSlotId
      return call<Submitted>('POST', '/candidates', { bytes: f.bytes, headers })
    },
    // The status of each candidate, asking 100 ids per request. Items come back in the order asked, duplicates
    // collapsed; ids Cairn won't report are left out.
    async getCandidateStatus(ids: string[]): Promise<CandidateStatus[]> {
      ids = [...new Set(ids)]
      const items: CandidateStatus[] = []
      for (let i = 0; i < ids.length; i += 100) items.push(...(await call<{ items: CandidateStatus[] }>('GET', '/candidates', { query: ids.slice(i, i + 100).map((id) => ['id', id]) })).items)
      return items
    },
  }
}
