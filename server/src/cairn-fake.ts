// In-process Cairn test double (spec §12.6): a `fetch` that answers the intake v1 routes IGI uses with
// Cairn's shapes, problem codes and limits. Seeded with the §12.2 setup: one subject and a five-step
// procedure with an assertion slot and a document slot on each step. The hooks stand in for what
// people do in Cairn (file, discard, void, restrict or act on a record) and for a lost response.
import type { CandidateStatus, Evidence, RecordSummary, Step } from './cairn.ts'

const WINDOW_MS = 10 * 60_000
const PER_WINDOW = 60
const MAX_UNFILED = 100
const MAX_UNTOUCHED = 25
const MAX_JSON_BODY = 65_536
const STEP_NAMES = [
  'Source data and reconciliation',
  'Portfolio allocation and risk review',
  'Fund, manager and fee oversight',
  'Historical decisions and outstanding actions',
  'Committee pack preparation',
]
// A subset of Cairn's in-app file types, by the slot kind they satisfy.
const KINDS: Record<string, string> = { pdf: 'document', html: 'document', htm: 'document', md: 'document', txt: 'document', csv: 'document', json: 'data', png: 'image', jpg: 'image', jpeg: 'image' }
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const cairnRef = (prefix: string) =>
  `${prefix}-${[4, 4, 4, 1].map((n) => Array.from({ length: n }, () => ALPHABET[Math.floor(Math.random() * 32)]).join('')).join('-')}`
const norm = (ref: string) => ref.toUpperCase().replaceAll('-', '')
const shortLine = (s: unknown): s is string | null | undefined => s == null || (typeof s === 'string' && s.length <= 200 && !/[\x00-\x1f\x7f]/.test(s))
// A proposed placement is a step and a slot together, or neither.
const proposal = (stepId: unknown, slotId: unknown) =>
  stepId == null && slotId == null ? { stepId: null, slotId: null } : typeof stepId === 'string' && typeof slotId === 'string' ? { stepId, slotId } : undefined

type FakeRecord = { summary: RecordSummary; steps: Step[]; procedureId: string; sourceReference: string | null; actedOn: boolean; restricted: boolean }
type FakeCandidate = {
  candidateId: string
  kind: 'assertion' | 'file'
  text?: string
  filename?: string
  bytes?: Uint8Array
  sourceReference: string | null
  proposedStepId: string | null
  proposedSlotId: string | null
  placement: string | null
  status: CandidateStatus['status']
  evidence: Evidence | null
}

function problem(status: number, code: string, title: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  return Response.json({ title, status, code, ...extra }, { status, headers: { 'Content-Type': 'application/problem+json', ...headers } })
}
const invalid = (errors: Record<string, string[]>) => problem(400, 'validation.failed', 'Validation error', { errors })
const page = (items: unknown[]) => Response.json({ items, page: 1, pageSize: 100, totalCount: items.length })

// Cairn percent-decodes the source reference header and leaves a malformed escape as it is.
function unescapeLikeCairn(s: string) {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function fileName(disposition: string | null) {
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition ?? '')
  if (star) return decodeURIComponent(star[1]).trim()
  return /filename="?([^";]*)"?/i.exec(disposition ?? '')?.[1].trim() ?? ''
}

export type CairnFake = ReturnType<typeof cairnFake>

export function cairnFake(opts: { key?: string; lookup?: boolean; start?: boolean; now?: () => number } = {}) {
  const key = opts.key ?? 'cairn_ak_fake'
  const lookup = opts.lookup ?? true
  const start = opts.start ?? true
  const now = opts.now ?? Date.now
  const subject = { cairnReference: cairnRef('SUB'), name: 'Investment governance programme' }
  const procedure = { id: crypto.randomUUID(), name: 'Committee preparation cycle', version: 1 }
  const records: FakeRecord[] = []
  const candidates: FakeCandidate[] = []
  let window = { start: -Infinity, count: 0 }
  let dropNext = false
  let requests = 0

  const findRecord = (ref: string) => records.find((r) => norm(r.summary.cairnReference) === norm(ref))
  const view = (r: FakeRecord) => ({ record: r.summary, steps: r.steps })
  const notPermitted = (what: 'lookup' | 'start' | 'search') => problem(403, `agent.${what}-not-permitted`, `The agent may not ${what}.`)

  function placement(stepId: string | null, slotId: string | null, kind: string) {
    if (!stepId) return null
    const step = records.find((r) => !r.restricted && r.steps.some((s) => s.id === stepId))?.steps.find((s) => s.id === stepId)
    if (!step) return 'not-placeable'
    const slot = step.slots.find((s) => s.id === slotId)
    if (!slot) return 'slot-not-on-step'
    return slot.allowedKinds.includes(kind) ? 'placed' : 'kind-not-allowed'
  }

  function submit(c: Pick<FakeCandidate, 'kind' | 'text' | 'filename' | 'bytes' | 'sourceReference' | 'proposedStepId' | 'proposedSlotId'>, kind: string) {
    if (candidates.filter((x) => x.status === 'unfiled').length >= MAX_UNFILED) return problem(409, 'candidate-intake.too-many-unfiled', 'Too many candidates waiting.')
    const candidate: FakeCandidate = { ...c, candidateId: crypto.randomUUID(), placement: placement(c.proposedStepId, c.proposedSlotId, kind), status: 'unfiled', evidence: null }
    candidates.push(candidate)
    return Response.json({ candidateId: candidate.candidateId, placement: candidate.placement }, { status: 201 })
  }

  function statusOf(c: FakeCandidate): CandidateStatus {
    const evidence = c.evidence && !findRecord(c.evidence.recordReference!)?.restricted ? { ...c.evidence } : null
    if (evidence && !lookup) Object.assign(evidence, { recordReference: null, stepId: null, slotId: null })
    return { candidateId: c.candidateId, status: c.status, evidence }
  }

  function route(method: string, path: string, q: URLSearchParams, headers: Headers, body: Uint8Array): Response {
    const json = (): Record<string, unknown> => {
      try {
        const v: unknown = JSON.parse(new TextDecoder().decode(body))
        if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
      } catch {}
      return {}
    }
    let m: RegExpMatchArray | null
    if (method === 'GET' && path === '/subjects') {
      if (!start) return notPermitted('start')
      if (q.has('name')) return notPermitted('search')
      const ref = q.get('reference')
      if (!ref) return invalid({ reference: ['Give a reference.'] })
      return page(norm(ref) === norm(subject.cairnReference) ? [{ cairnReference: subject.cairnReference, name: null }] : [])
    }
    if (method === 'GET' && (m = path.match(/^\/subjects\/([^/]+)\/procedures$/))) {
      if (!start) return notPermitted('start')
      if (norm(decodeURIComponent(m[1])) !== norm(subject.cairnReference)) return problem(404, 'subject.not-found', 'No such subject.')
      return Response.json({ procedures: [procedure] })
    }
    if (method === 'POST' && path === '/records') {
      if (!start) return notPermitted('start')
      const { procedureId, subjectReference, sourceReference } = json()
      if (typeof procedureId !== 'string') return invalid({ procedureId: ['Required.'] })
      if (typeof subjectReference !== 'string') return invalid({ subjectReference: ['Required.'] })
      if (!shortLine(sourceReference)) return invalid({ sourceReference: ['At most 200 characters on one line.'] })
      if (procedureId !== procedure.id || norm(subjectReference) !== norm(subject.cairnReference)) return problem(404, 'candidate-intake.not-startable', 'Cannot start that record.')
      const untouched = records.filter((x) => !x.actedOn && !x.restricted)
      const first = sourceReference && untouched.find((x) => x.procedureId === procedureId && x.sourceReference === sourceReference)
      if (first) return Response.json({ ...view(first), repeated: true })
      if (untouched.length >= MAX_UNTOUCHED) return problem(409, 'candidate-intake.too-many-untouched-records', 'Too many untouched records.')
      const record: FakeRecord = {
        summary: { cairnReference: cairnRef('CAI'), procedureName: procedure.name, procedureVersion: procedure.version, subjectReference: subject.cairnReference },
        steps: STEP_NAMES.map((name) => ({
          id: crypto.randomUUID(),
          name,
          description: null,
          guidanceMarkdown: null,
          slots: [
            { id: crypto.randomUUID(), name: 'Finding statement', requirement: 'optional', allowedKinds: ['assertion'] },
            { id: crypto.randomUUID(), name: 'Investigation package', requirement: 'optional', allowedKinds: ['document'] },
          ],
        })),
        procedureId: procedure.id,
        sourceReference: sourceReference ?? null,
        actedOn: false,
        restricted: false,
      }
      records.push(record)
      return Response.json({ ...view(record), repeated: false }, { status: 201 })
    }
    if (method === 'GET' && path === '/records') {
      if (!lookup) return notPermitted('lookup')
      if (q.has('subjectName')) return notPermitted('search')
      const ref = q.get('reference')
      if (!ref) return invalid({ reference: ['Give a reference.'] })
      const hits = records.filter((r) => !r.restricted && [r.summary.cairnReference, r.summary.subjectReference].some((x) => norm(x) === norm(ref)))
      return page(hits.reverse().map((r) => r.summary))
    }
    if (method === 'GET' && (m = path.match(/^\/records\/([^/]+)\/steps$/))) {
      if (!lookup) return notPermitted('lookup')
      const record = findRecord(decodeURIComponent(m[1]))
      return record && !record.restricted ? Response.json(view(record)) : problem(404, 'process-instance.not-found', 'No such record.')
    }
    if (method === 'POST' && path === '/candidates/assertion') {
      if (body.length > MAX_JSON_BODY) return problem(413, 'http.413', 'Request body too large.')
      const { assertionText, sourceReference, proposedStepId, proposedSlotId } = json()
      if (typeof assertionText !== 'string' || !assertionText.trim() || assertionText.length > 4000) return invalid({ assertionText: ['Required, at most 4000 characters.'] })
      if (!shortLine(sourceReference)) return invalid({ sourceReference: ['At most 200 characters on one line.'] })
      const at = proposal(proposedStepId, proposedSlotId)
      if (!at) return invalid({ proposedSlotId: ['Send a step and a slot together.'] })
      return submit({ kind: 'assertion', text: assertionText, sourceReference: sourceReference ?? null, proposedStepId: at.stepId, proposedSlotId: at.slotId }, 'assertion')
    }
    if (method === 'POST' && path === '/candidates') {
      const filename = fileName(headers.get('content-disposition'))
      if (!filename) return problem(400, 'stored-file.file-name.empty', 'Name the file.')
      const kind = KINDS[/\.([^.]+)$/.exec(filename)?.[1].toLowerCase() ?? '']
      if (!kind) return problem(400, 'stored-file.file-type.unsupported', 'That type of file is not accepted.')
      const raw = headers.get('cairn-source-reference')
      const sourceReference = raw === null ? null : unescapeLikeCairn(raw)
      if (!shortLine(sourceReference)) return invalid({ sourceReference: ['At most 200 characters on one line, percent-encoded.'] })
      const at = proposal(headers.get('cairn-proposed-step'), headers.get('cairn-proposed-slot'))
      if (!at) return invalid({ proposedSlotId: ['Send a step and a slot together.'] })
      return submit({ kind: 'file', filename, bytes: body, sourceReference, proposedStepId: at.stepId, proposedSlotId: at.slotId }, kind)
    }
    if (method === 'GET' && path === '/candidates') {
      const ids = q.getAll('id')
      if (ids.length < 1 || ids.length > 100 || !ids.every((id) => GUID.test(id))) return invalid({ id: ['Give 1 to 100 candidate ids.'] })
      const items = [...new Set(ids.map((id) => id.toLowerCase()))].flatMap((id) => {
        const c = candidates.find((x) => x.candidateId === id)
        return c ? [statusOf(c)] : []
      })
      return Response.json({ items })
    }
    return new Response('Not found', { status: 404 })
  }

  async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const req = new Request(input, init)
    const body = new Uint8Array(await req.arrayBuffer())
    requests++
    let res: Response
    if (req.headers.get('authorization') !== `Bearer ${key}`) {
      res = problem(401, 'agent-key.invalid', 'The agent key is not valid.', {}, { 'WWW-Authenticate': 'Bearer' })
    } else {
      const t = now()
      if (t - window.start >= WINDOW_MS) window = { start: t, count: 0 }
      const url = new URL(req.url)
      res =
        ++window.count > PER_WINDOW
          ? problem(429, 'rate-limited', 'Too many requests.', {}, { 'Retry-After': String(Math.ceil((window.start + WINDOW_MS - t) / 1000)) })
          : route(req.method, url.pathname.replace(/^\/api\/intake\/v1/, ''), url.searchParams, req.headers, body)
    }
    if (dropNext) {
      dropNext = false // the request was handled; only its response is lost
      throw new TypeError('fetch failed')
    }
    return res
  }

  function candidate(id: string) {
    const c = candidates.find((x) => x.candidateId === id)
    if (!c) throw new Error(`no candidate ${id}`)
    return c
  }
  function record(ref: string) {
    const r = findRecord(ref)
    if (!r) throw new Error(`no record ${ref}`)
    return r
  }

  return {
    fetch: fakeFetch as typeof fetch,
    key,
    subject,
    procedure,
    records,
    candidates,
    get requests() {
      return requests
    },
    // A person files the candidate where it was placed, or where they choose. Returns the evidence reference.
    file(id: string, at?: { stepId: string; slotId: string }) {
      const c = candidate(id)
      if (c.status !== 'unfiled') throw new Error(`candidate ${id} is ${c.status}`)
      const stepId = at?.stepId ?? (c.placement === 'placed' ? c.proposedStepId : null)
      const rec = records.find((r) => r.steps.some((s) => s.id === stepId))
      if (!rec) throw new Error(`candidate ${id} has no placement; say where to file it`)
      c.status = 'filed'
      c.evidence = {
        cairnReference: cairnRef('EVI'),
        status: 'active',
        filedUtc: new Date(now()).toISOString(),
        voidedUtc: null,
        recordReference: rec.summary.cairnReference,
        stepId,
        slotId: at?.slotId ?? c.proposedSlotId,
      }
      rec.actedOn = true
      return c.evidence.cairnReference
    },
    discard(id: string) {
      const c = candidate(id)
      if (c.status !== 'unfiled') throw new Error(`candidate ${id} is ${c.status}`)
      c.status = 'discarded'
    },
    voidEvidence(id: string) {
      const e = candidate(id).evidence
      if (e?.status !== 'active') throw new Error(`candidate ${id} has no active evidence`)
      e.status = 'voided'
      e.voidedUtc = new Date(now()).toISOString()
    },
    // Restricting a record to named people hides it and its evidence from the agent, and counts as acting on it.
    restrict(recordReference: string) {
      record(recordReference).restricted = true
    },
    // Any person's action on the record (rename, accept) ends repeated starts.
    actOn(recordReference: string) {
      record(recordReference).actedOn = true
    },
    // The next request is handled, but its response never arrives.
    dropNextResponse() {
      dropNext = true
    },
  }
}
