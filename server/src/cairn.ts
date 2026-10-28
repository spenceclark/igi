// Cairn candidate intake v1 client (spec §12.1, §12.5). It never retries (§12.4): a refusal that
// carries a `code` created nothing and throws CairnRefused; a timeout, a dropped connection or a
// response without a usable body may have created something and throws CairnUncertain.
// The test double (cairn-fake.ts) is a `fetch`, so the same client runs against both.

export type Placement = 'placed' | 'not-placeable' | 'record-closed' | 'step-not-open' | 'slot-not-on-step' | 'kind-not-allowed' | (string & {}) | null
export type Submitted = { candidateId: string; placement: Placement }
export type Slot = { id: string; name: string; requirement: 'required' | 'preferred' | 'optional'; allowedKinds: string[] }
export type Step = { id: string; name: string; description: string | null; guidanceMarkdown: string | null; slots: Slot[] }
export type RecordSummary = { cairnReference: string; procedureName: string; procedureVersion: number; subjectReference: string; subjectName?: string | null }
export type RecordSteps = { record: RecordSummary; steps: Step[] }
export type Evidence = {
  cairnReference: string
  status: 'active' | 'voided'
  filedUtc: string
  voidedUtc: string | null
  recordReference: string | null
  stepId: string | null
  slotId: string | null
}
export type CandidateStatus = { candidateId: string; status: 'unfiled' | 'filed' | 'discarded'; evidence: Evidence | null }
type Proposal = { proposedStepId?: string; proposedSlotId?: string }

export class CairnRefused extends Error {
  status: number
  code: string
  errors: unknown
  retryAfter: number | null
  constructor(status: number, problem: any, retryAfter: number | null) {
    super(`Cairn refused: HTTP ${status} ${problem.code}${problem.detail || problem.title ? `, ${problem.detail || problem.title}` : ''}`)
    this.status = status
    this.code = problem.code
    this.errors = problem.errors ?? null
    this.retryAfter = retryAfter
  }
}
export class CairnUncertain extends Error {}

export type Cairn = ReturnType<typeof cairnClient>

export function cairnClient(opts: { baseUrl: string; key: string; fetch?: typeof fetch; timeoutMs?: number }) {
  const base = `${opts.baseUrl.replace(/\/+$/, '')}/api/intake/v1`
  const send = opts.fetch ?? fetch

  async function call(method: string, path: string, req: { query?: string[][]; json?: unknown; bytes?: Uint8Array; headers?: Record<string, string> } = {}): Promise<any> {
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
    let body: any = null
    try {
      body = JSON.parse(text)
    } catch {}
    if (res.ok && body) return body
    if (!res.ok && typeof body?.code === 'string') {
      const retryAfter = Number(res.headers.get('retry-after'))
      throw new CairnRefused(res.status, body, retryAfter > 0 ? retryAfter : null)
    }
    throw new CairnUncertain(`${method} ${path}: HTTP ${res.status} without a usable body`)
  }

  const pair = (p: Proposal) => ({ proposedStepId: p.proposedStepId, proposedSlotId: p.proposedSlotId })

  return {
    findSubject: async (reference: string): Promise<{ cairnReference: string; name: string | null }[]> =>
      (await call('GET', '/subjects', { query: [['reference', reference], ['pageSize', '100']] })).items,
    listStartableProcedures: async (subjectReference: string): Promise<{ id: string; name: string; version: number }[]> =>
      (await call('GET', `/subjects/${encodeURIComponent(subjectReference)}/procedures`)).procedures,
    // 201 for a new record, 200 with repeated: true for the agent's untouched earlier start.
    startRecord: (r: { procedureId: string; subjectReference: string; sourceReference: string }): Promise<RecordSteps & { repeated: boolean }> =>
      call('POST', '/records', { json: r }),
    findRecords: async (reference: string): Promise<RecordSummary[]> =>
      (await call('GET', '/records', { query: [['reference', reference], ['pageSize', '100']] })).items,
    getRecordSteps: (recordReference: string): Promise<RecordSteps> => call('GET', `/records/${encodeURIComponent(recordReference)}/steps`),
    submitAssertion: (a: { assertionText: string; sourceReference: string } & Proposal): Promise<Submitted> =>
      call('POST', '/candidates/assertion', { json: { assertionText: a.assertionText, sourceReference: a.sourceReference, ...pair(a) } }),
    submitFile(f: { filename: string; bytes: Uint8Array; contentType?: string; sourceReference: string } & Proposal): Promise<Submitted> {
      const headers: Record<string, string> = {
        'Content-Disposition': /^[\w .-]+$/.test(f.filename) ? `attachment; filename="${f.filename}"` : `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
        'Cairn-Source-Reference': encodeURIComponent(f.sourceReference), // Cairn always percent-decodes it
      }
      if (f.contentType) headers['Content-Type'] = f.contentType
      if (f.proposedStepId) headers['Cairn-Proposed-Step'] = f.proposedStepId
      if (f.proposedSlotId) headers['Cairn-Proposed-Slot'] = f.proposedSlotId
      return call('POST', '/candidates', { bytes: f.bytes, headers })
    },
    // Items come back in the order asked, duplicates collapsed; ids Cairn won't report are left out.
    async getCandidateStatus(ids: string[]): Promise<CandidateStatus[]> {
      ids = [...new Set(ids)]
      const items: CandidateStatus[] = []
      for (let i = 0; i < ids.length; i += 100) items.push(...(await call('GET', '/candidates', { query: ids.slice(i, i + 100).map((id) => ['id', id]) })).items)
      return items
    },
  }
}
