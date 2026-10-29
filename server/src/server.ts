// IGI's HTTP API and the web UI's files (spec §10.1, §14): one Node service, built-in http, JSON in and out. One
// operator signs in with a password; a signed, HTTP-only cookie carries the session. Long work starts as an
// operation and returns at once; the UI polls. Generated HTML (the pack preview) is served under a sandboxing
// content security policy, so nothing in it can run.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'
import type { Cairn, RecordSteps } from './cairn.ts'
import { ruleCoverage } from './checks.ts'
import { excludedItems, listPacks, markStalePacks, packBlockers, reconcileAdvice, resolveFindings, type PackRow } from './committee-pack.ts'
import { loadRun, sql, type FindingRow, type RunRow } from './db.ts'
import { getFile } from './files.ts'
import { abandonEntry, ledgerEntries, newVersion, rowLocations, withdrawFinding } from './ledger.ts'
import { AlreadyRunning, listOperations, type Operation } from './operations.ts'
import { composeAssertion, findingPayload, packageHtml, runTag } from './package.ts'
import { renderPdf } from './render.ts'
import { assemble, currentSources, removeSource, reviewDir, reviewPeriod, uploadSource } from './review-sources.ts'
import { createReview, generateReviewPack, investigateReview, openReviewRecord, readCairn, refreshReview, submitReviewFindings, submitReviewPack } from './reviews.ts'
import { blockers, importReview, readData, sourceSummary, type ReadArgs } from './sources.ts'

// What the server needs: the Cairn client, the operator's password, a secret for signing sessions, and where the
// built web UI is. Cookies are marked Secure unless running locally over plain http.
export type ServerOptions = { cairn: Cairn; password: string; secret?: string; webDir?: string; secureCookies?: boolean; log?: (entry: Record<string, unknown>) => void }

// An error carrying an HTTP status; anything else thrown by a handler is a 400 with its message, as handlers throw
// for bad input. A handler returns a value to send as JSON, or a Reply for files and other content.
class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
type Reply = { status?: number; type: string; body: Uint8Array | string; headers?: Record<string, string> }
type Ctx = { req: IncomingMessage; params: string[]; url: URL; body: () => Promise<Record<string, unknown>> }
type Route = [method: string, pattern: RegExp, handler: (c: Ctx) => Promise<unknown>]

const SESSION_HOURS = 12
const MAX_JSON = 1024 * 1024
const MAX_UPLOAD = 60 * 1024 * 1024
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' }
// The pack preview is IGI's own HTML, but its text came from sources and the model: it may style itself, nothing more.
const PREVIEW_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox"
const APP_CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src 'self'; object-src 'self'; base-uri 'none'; form-action 'self'"

const sha = (s: string) => createHash('sha256').update(s).digest()
const isRunState = (v: unknown): v is { runId: string; id: string; version: number } => !!v && typeof v === 'object' && typeof (v as { runId?: unknown }).runId === 'string'

/** Creates the HTTP server; the caller listens on a port. */
export function igiServer(o: ServerOptions) {
  const secret = o.secret ?? randomBytes(32).toString('hex')
  const log = o.log ?? ((e) => console.log(JSON.stringify(e)))

  // ---- Sessions: "<expiry ms>.<HMAC of it>" in an HTTP-only, same-site cookie ----
  const sign = (v: string) => createHmac('sha256', secret).update(v).digest('base64url')
  const session = () => {
    const exp = String(Date.now() + SESSION_HOURS * 3_600_000)
    return `${exp}.${sign(exp)}`
  }
  const signedIn = (req: IncomingMessage) => {
    const raw = /(?:^|;\s*)igi_session=([^;]+)/.exec(req.headers.cookie ?? '')?.[1]
    if (!raw) return false
    const [exp, mac] = raw.split('.')
    const want = sign(exp ?? '')
    return !!mac && mac.length === want.length && timingSafeEqual(Buffer.from(mac), Buffer.from(want)) && Number(exp) > Date.now()
  }
  const cookie = (value: string, maxAge: number) => `igi_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${o.secureCookies === false ? '' : '; Secure'}`

  // ---- Small helpers for handlers ----
  const findingRow = async (runId: string, id: string, version: number) => {
    const [f] = await sql<FindingRow[]>`select * from finding where run_id = ${runId} and id = ${id} and version = ${version}`
    if (!f) throw new HttpError(404, `no finding ${id} v${version} in ${runId}`)
    return f
  }
  const reviewRow = async (id: string) => {
    const [r] = await sql<{ id: string; period_end: Date; created_at: Date; cairn_record: RecordSteps | null; status_checked_at: Date | null; status_error: string | null }[]>`
      select id, period_end, created_at, cairn_record, status_checked_at, status_error from review where id = ${id}`
    if (!r) throw new HttpError(404, `no review ${id}`)
    return r
  }
  const started = (r: { op: Operation }) => ({ operation: r.op })
  const pdf = (bytes: Uint8Array, name: string): Reply => ({ type: 'application/pdf', body: bytes, headers: { 'Content-Disposition': `inline; filename="${name}"` } })
  // A pack's PDF or HTML preview, labelled with its state and when IGI last verified the review against Cairn.
  const packFile = (p: PackRow, kind: 'pdf' | 'html', state: string, verifiedAt: Date | null): Reply => {
    const key = kind === 'pdf' ? p.pdf_key : p.file_key
    if (!key) throw new HttpError(404, `pack v${p.version} has no ${kind.toUpperCase()}`)
    const labels = { 'X-IGI-Pack-State': state, 'X-IGI-Verified-At': verifiedAt?.toISOString() ?? 'never' }
    return kind === 'pdf'
      ? { ...pdf(getFile(key), `IGI-${p.review_id}-committee-pack-v${p.version}.pdf`), headers: { ...labels, 'Content-Disposition': `inline; filename="IGI-${p.review_id}-committee-pack-v${p.version}.pdf"` } }
      : { type: 'text/html; charset=utf-8', body: getFile(key), headers: { ...labels, 'Content-Security-Policy': PREVIEW_CSP } }
  }

  // ---- Routes: [method, path pattern, handler]; captured groups become params ----
  const routes: Route[] = [
    // The reviews and one review's overview: its sources and their import check, runs, record, operations and Cairn read.
    ['GET', /^\/api\/reviews$/, async () =>
      sql`select r.id, r.period_end, r.created_at, r.cairn_record->'record'->>'cairnReference' as record_reference, r.status_checked_at,
            (select json_build_object('id', a.id, 'status', a.status, 'started_at', a.started_at) from analysis_run a where a.review_id = r.id order by a.started_at desc limit 1) as latest_run,
            (select max(p.version) from committee_pack p where p.review_id = r.id) as latest_pack
          from review r order by r.created_at desc`],
    ['POST', /^\/api\/reviews$/, async (c) => {
      const b = await c.body()
      await createReview(String(b.id ?? ''), String(b.periodEnd ?? ''))
      return { id: b.id }
    }],
    ['GET', /^\/api\/reviews\/([\w-]+)$/, async (c) => {
      const r = await reviewRow(c.params[0])
      const files = await currentSources(r.id)
      // The import check of the current sources, so issues show before any investigation, with each source's format
      // and the layout version that read it, and what would stop an investigation starting (§6.2).
      let sources: (ReturnType<typeof sourceSummary>[number] & { format: string; extractor?: string })[] = []
      let investigationBlockers: string[] = []
      let importError: string | null = null
      try {
        const review = importReview(await reviewDir(r.id), r.id, await reviewPeriod(r.id))
        sources = sourceSummary(review).map((x, i) => ({ ...x, format: review.sources[i].format, extractor: review.sources[i].extractor }))
        investigationBlockers = blockers(review)
      } catch (e) {
        importError = (e as Error).message
      }
      const runs = await sql<Pick<RunRow, 'id' | 'status' | 'started_at' | 'ended_at' | 'turns' | 'tool_calls' | 'usage' | 'summary'>[]>`
        select id, status, started_at, ended_at, turns, tool_calls, usage, summary from analysis_run where review_id = ${r.id} order by started_at desc`
      return {
        review: { id: r.id, periodEnd: r.period_end, createdAt: r.created_at, record: r.cairn_record?.record ?? null, statusCheckedAt: r.status_checked_at, statusError: r.status_error, cairnAppUrl: process.env.CAIRN_APP_URL ?? null },
        uploads: files,
        sources,
        blockers: investigationBlockers,
        importError,
        runs,
        operations: await listOperations(r.id),
      }
    }],

    // Sources: upload (multipart field "files"), and the rows of one source for inspection.
    ['POST', /^\/api\/reviews\/([\w-]+)\/sources$/, async (c) => {
      await reviewRow(c.params[0])
      const length = Number(c.req.headers['content-length'] ?? 0)
      if (!length || length > MAX_UPLOAD) throw new HttpError(413, `uploads are limited to ${MAX_UPLOAD / 1024 / 1024} MB at a time`)
      const form = await new Request('http://igi/upload', { method: 'POST', headers: c.req.headers as Record<string, string>, body: Readable.toWeb(c.req) as ReadableStream, duplex: 'half' } as RequestInit).formData()
      const files = form.getAll('files').filter((f): f is File => typeof f !== 'string')
      if (!files.length) throw new Error('no files uploaded')
      const stored = []
      for (const f of files) stored.push(await uploadSource(c.params[0], f.name, new Uint8Array(await f.arrayBuffer())))
      return { uploaded: stored }
    }],
    ['DELETE', /^\/api\/reviews\/([\w-]+)\/sources\/([^/]+)$/, async (c) => {
      await reviewRow(c.params[0])
      await removeSource(c.params[0], decodeURIComponent(c.params[1]))
      return { removed: true }
    }],
    ['GET', /^\/api\/reviews\/([\w-]+)\/sources\/([\w-]+)\/rows$/, async (c) => {
      // The rows as the agent reads them, each with where it is in its file and what was normalised or computed there.
      const review = importReview(await reviewDir(c.params[0]), c.params[0], await reviewPeriod(c.params[0]))
      const read = readData(review, { source: c.params[1], limit: Number(c.url.searchParams.get('limit') ?? 50) } as ReadArgs)
      const provenance = review.sources.find((s) => s.id === read.source)?.provenance ?? {}
      return { ...read, provenance: Object.fromEntries(read.rows.map((r) => [r.row_id, provenance[r.row_id]]).filter(([, p]) => p)) }
    }],

    // Investigation: start one, and read a run with its whole trace.
    ['POST', /^\/api\/reviews\/([\w-]+)\/investigate$/, async (c) => {
      const b = await c.body()
      return started(await investigateReview(c.params[0], { effort: typeof b.effort === 'string' ? b.effort : undefined }))
    }],
    ['GET', /^\/api\/runs\/([\w-]+)$/, async (c) => {
      const run = await loadRun(c.params[0])
      if (!run) throw new HttpError(404, `no run ${c.params[0]}`)
      // How each rule version in force was evaluated by the run's checks (§6.4, §8.2), on the sources the run read,
      // for the review's period end; null with the reason when those sources can't be read back.
      let ruleStatus: ReturnType<typeof ruleCoverage> | null = null
      let ruleStatusError: string | null = null
      try {
        const review = importReview(assemble(run.run.review_id, run.run.config.sources), run.run.review_id, await reviewPeriod(run.run.review_id))
        ruleStatus = ruleCoverage(review, run.checks)
      } catch (e) {
        ruleStatusError = (e as Error).message
      }
      return { ...run, rule_coverage: ruleStatus, rule_coverage_error: ruleStatusError }
    }],

    // Findings: each current finding with its state, its two items, the ledger and the reconciliation still needed.
    ['GET', /^\/api\/reviews\/([\w-]+)\/findings$/, async (c) => {
      const r = await reviewRow(c.params[0])
      const ref = r.cairn_record?.record.cairnReference ?? null
      const resolved = await resolveFindings(r.id, ref)
      return {
        findings: resolved.map((x) => ({ finding: x.f, runTag: runTag(x.f.run_id), state: x.state, items: x.items, entries: x.entries })),
        reconcile: (await excludedItems(r.id, ref)).map((x) => ({ ...x, advice: reconcileAdvice(x) })).filter((x) => x.advice),
      }
    }],
    // The assertion as it was sent, or as it would be; the package PDF as stored, or a preview rendered now.
    ['GET', /^\/api\/findings\/([\w-]+)\/(F\d+)\/(\d+)\/assertion$/, async (c) => {
      const f = await findingRow(c.params[0], c.params[1], Number(c.params[2]))
      if (f.artifacts) return { text: new TextDecoder().decode(getFile(f.artifacts.assertion.key)), sent: true }
      const run = await loadRun(f.run_id)
      try {
        return { text: composeAssertion(findingPayload(f, run!.run, run!.run.review_id, run!.executions, run!.checks, run!.findings)), sent: false }
      } catch (e) {
        return { text: null, sent: false, error: (e as Error).message }
      }
    }],
    ['GET', /^\/api\/findings\/([\w-]+)\/(F\d+)\/(\d+)\/package$/, async (c) => {
      const f = await findingRow(c.params[0], c.params[1], Number(c.params[2]))
      if (f.artifacts) return f.artifacts.package.mediaType === 'application/pdf' ? pdf(getFile(f.artifacts.package.key), f.artifacts.package.name) : { type: 'text/markdown; charset=utf-8', body: getFile(f.artifacts.package.key) }
      const run = (await loadRun(f.run_id))!
      const payload = findingPayload(f, run.run, run.run.review_id, run.executions, run.checks, run.findings, rowLocations(run.run.review_id, run.run.config.sources))
      return pdf((await renderPdf(packageHtml(payload), `PREVIEW, not submitted: ${payload.packageName}`)).bytes, `PREVIEW-${payload.packageName}`)
    }],
    ['POST', /^\/api\/findings\/([\w-]+)\/(F\d+)\/(\d+)\/withdraw$/, async (c) => {
      const b = await c.body()
      await withdrawFinding({ runId: c.params[0], id: c.params[1], version: Number(c.params[2]) }, String(b.reason ?? ''))
      return { withdrawn: true }
    }],
    ['POST', /^\/api\/findings\/([\w-]+)\/(F\d+)\/new-version$/, async (c) => ({ version: await newVersion({ runId: c.params[0], id: c.params[1] }) })],
    ['POST', /^\/api\/entries\/([\w-]+)\/abandon$/, async (c) => {
      await abandonEntry(c.params[0])
      return { abandoned: true }
    }],
    ['GET', /^\/api\/findings\/([\w-]+)\/(F\d+)\/(\d+)\/entries$/, async (c) => ledgerEntries({ runId: c.params[0], id: c.params[1], version: Number(c.params[2]) })],

    // Cairn: open the record, submit findings, read status. Each is an operation.
    ['POST', /^\/api\/reviews\/([\w-]+)\/record$/, async (c) => started(await openReviewRecord(o.cairn, c.params[0]))],
    ['POST', /^\/api\/reviews\/([\w-]+)\/submit$/, async (c) => {
      const b = await c.body()
      const refs = Array.isArray(b.findings) ? b.findings.filter(isRunState) : []
      if (!refs.length) throw new Error('name the findings to submit')
      return started(await submitReviewFindings(o.cairn, c.params[0], refs.map((x) => ({ runId: x.runId, id: x.id, version: Number(x.version) }))))
    }],
    ['POST', /^\/api\/reviews\/([\w-]+)\/refresh$/, async (c) => started(await refreshReview(o.cairn, c.params[0]))],

    // Packs: what blocks one now, the versions, generating and submitting, and the files.
    ['GET', /^\/api\/reviews\/([\w-]+)\/packs$/, async (c) => {
      await reviewRow(c.params[0])
      let blockers: unknown[] = []
      let blockError: string | null = null
      try {
        // Packs the review has moved on from (new sources, a later run) show as stale without waiting for a Cairn read.
        await markStalePacks(c.params[0])
        blockers = await packBlockers(c.params[0])
      } catch (e) {
        blockError = (e as Error).message
      }
      const packs = (await listPacks(c.params[0])).map(({ snapshot, ...p }) => ({ ...p, findings: snapshot.findings.map((f) => `${f.id} v${f.version}`), counts: snapshot.counts, recordReference: snapshot.recordReference }))
      return { blockers, blockError, packs }
    }],
    ['POST', /^\/api\/reviews\/([\w-]+)\/packs$/, async (c) => started(await generateReviewPack(o.cairn, c.params[0]))],
    ['POST', /^\/api\/reviews\/([\w-]+)\/packs\/submit$/, async (c) => started(await submitReviewPack(o.cairn, c.params[0], (await c.body()).resend === true))],
    // Opening a pack re-checks it first (§13.3): a fresh read of Cairn, which may mark it stale. Only the latest pack,
    // verified just now and not stale, is served as current; any other is served only when asked for explicitly as
    // a historical copy (?historical=1), labelled with its state and when the review was last verified.
    ['GET', /^\/api\/reviews\/([\w-]+)\/packs\/(\d+)\.(pdf|html)$/, async (c) => {
      await reviewRow(c.params[0])
      let readError: string | null = null
      try {
        await readCairn(o.cairn, c.params[0])
      } catch (e) {
        readError = (e as Error).message
      }
      const p = (await listPacks(c.params[0])).find((x) => x.version === Number(c.params[1]))
      if (!p) throw new HttpError(404, `no pack v${c.params[1]}`)
      const { status_checked_at: verifiedAt } = await reviewRow(c.params[0])
      const state = p.stale_reason ? 'stale' : p.superseded ? 'superseded' : readError ? 'unverified' : 'current'
      if (state !== 'current' && c.url.searchParams.get('historical') !== '1') {
        const why = state === 'stale' ? `is stale: ${p.stale_reason}` : state === 'superseded' ? 'is superseded by a later pack' : `could not be verified against Cairn just now (${readError}); last verified ${verifiedAt?.toISOString() ?? 'never'}`
        throw new HttpError(409, `pack v${p.version} ${why}. Open it from the Pack tab as a historical copy.`)
      }
      return packFile(p, c.params[2] as 'pdf' | 'html', state, verifiedAt)
    }],
    ['GET', /^\/api\/operations\/([\w-]+)$/, async (c) => {
      const [op] = await sql<Operation[]>`select * from operation where id = ${c.params[0]}`
      if (!op) throw new HttpError(404, 'no such operation')
      return op
    }],
  ]

  /** Reads a JSON body of at most 1 MB; an empty body is an empty object. */
  const jsonBody = async (req: IncomingMessage) => {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length
      if (size > MAX_JSON) throw new HttpError(413, 'request body too large')
      chunks.push(chunk)
    }
    if (!size) return {}
    const v: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('the body is a JSON object')
    return v as Record<string, unknown>
  }

  /** Sends a value as JSON, or a Reply as is, with headers that stop browsers guessing types or framing the app elsewhere. */
  const send = (res: ServerResponse, status: number, value: unknown) => {
    const reply = value && typeof value === 'object' && 'type' in value && 'body' in value ? (value as Reply) : { type: 'application/json', body: JSON.stringify(value ?? null) }
    res.writeHead(reply.status ?? status, { 'Content-Type': reply.type, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Cache-Control': 'no-store', ...reply.headers })
    res.end(reply.body)
  }

  /** Serves a built UI file, or index.html for any other path (the UI routes in the browser). */
  const staticFile = (res: ServerResponse, path: string) => {
    const root = o.webDir
    if (!root || !existsSync(root)) return send(res, 404, { error: 'the web UI is not built: npm run build in web/' })
    const target = normalize(join(root, decodeURIComponent(path)))
    const file = target.startsWith(root + sep) && existsSync(target) && statSync(target).isFile() ? target : join(root, 'index.html')
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': APP_CSP, 'Cache-Control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=3600' })
    res.end(readFileSync(file))
  }

  return createServer(async (req, res) => {
    const started = performance.now()
    const url = new URL(req.url ?? '/', 'http://igi')
    let status = 200
    try {
      if (!url.pathname.startsWith('/api/')) return staticFile(res, url.pathname)
      // Signing in and out, and whether a session is live, are the only routes open without one.
      if (url.pathname === '/api/session' && req.method === 'GET') return send(res, 200, { signedIn: signedIn(req) })
      if (url.pathname === '/api/login' && req.method === 'POST') {
        const b = await jsonBody(req)
        const ok = timingSafeEqual(sha(String(b.password ?? '')), sha(o.password))
        if (!ok) throw new HttpError(401, 'wrong password')
        res.setHeader('Set-Cookie', cookie(session(), SESSION_HOURS * 3600))
        return send(res, 200, { signedIn: true })
      }
      if (url.pathname === '/api/logout' && req.method === 'POST') {
        res.setHeader('Set-Cookie', cookie('', 0))
        return send(res, 200, { signedIn: false })
      }
      if (!signedIn(req)) throw new HttpError(401, 'sign in first')
      // State-changing requests carry JSON or an upload, which a cross-site form can't send with this cookie.
      if (req.method === 'POST' && !/^(application\/json|multipart\/form-data)/.test(req.headers['content-type'] ?? '') && Number(req.headers['content-length'] ?? 0) > 0) throw new HttpError(415, 'send JSON')
      const route = routes.find(([m, p]) => m === req.method && p.test(url.pathname))
      if (!route) throw new HttpError(404, `no route ${req.method} ${url.pathname}`)
      const params = route[1].exec(url.pathname)!.slice(1)
      send(res, 200, await route[2]({ req, params, url, body: () => jsonBody(req) }))
    } catch (e) {
      // A running operation of the same kind is a conflict that names it, so the UI can follow it.
      status = e instanceof HttpError ? e.status : e instanceof AlreadyRunning ? 409 : 400
      send(res, status, { error: (e as Error).message, ...(e instanceof AlreadyRunning ? { operation: e.running } : {}) })
    } finally {
      log({ at: new Date().toISOString(), method: req.method, path: url.pathname, status: res.statusCode || status, ms: Math.round(performance.now() - started) })
    }
  })
}
