// The IGI operator UI (spec §14): sign-in, the reviews, and one review in four tabs (Sources, Investigation,
// Findings, Pack). The address bar holds where you are (#/r/<review>/<tab>), so a reload or a link keeps it. When the
// window comes back into view (after filing in Cairn, say) the review's Cairn status is read again; that never
// starts an investigation.
import { useEffect, useState } from 'react'
import { api, SignedOut, type ReviewListItem } from './api.ts'
import { Findings } from './Findings.tsx'
import { Investigation } from './Investigation.tsx'
import { Pack } from './Pack.tsx'
import { Sources } from './Sources.tsx'
import { Action, Badge, Problem, useLive, when } from './ui.tsx'

const TABS = ['sources', 'investigation', 'findings', 'pack'] as const
type Tab = (typeof TABS)[number]
/** Where the address bar says we are: the reviews list, or a review and one of its tabs. */
const parse = (): { review: string | null; tab: Tab } => {
  const [, r, id, tab] = location.hash.split('/')
  return r === 'r' && id ? { review: id, tab: TABS.includes(tab as Tab) ? (tab as Tab) : 'sources' } : { review: null, tab: 'sources' }
}

export function App() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [at, setAt] = useState(parse)
  useEffect(() => {
    api.session().then((s) => setSignedIn(s.signedIn), () => setSignedIn(false))
    const onHash = () => setAt(parse())
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])
  if (signedIn === null) return null
  if (!signedIn) return <Login onIn={() => setSignedIn(true)} />
  return (
    <div className="app">
      <header className="top">
        <a href="#/" className="brand">
          IGI <span>Investment Governance Intelligence</span>
        </a>
        <Action label="Sign out" run={async () => (await api.logout(), setSignedIn(false))} />
      </header>
      <main>{at.review ? <Review id={at.review} tab={at.tab} /> : <Reviews />}</main>
    </div>
  )
}

/** The single operator's sign-in. */
function Login({ onIn }: { onIn: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="login"
      onSubmit={async (e) => {
        e.preventDefault()
        try {
          await api.login(password)
          onIn()
        } catch (err) {
          setError((err as Error).message)
        }
      }}
    >
      <h1>IGI</h1>
      <p className="meta">Investment Governance Intelligence</p>
      <input type="password" autoFocus placeholder="Operator password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button className="primary">Sign in</button>
      <Problem>{error}</Problem>
    </form>
  )
}

/** The reviews, newest first, and a form to create one for a period end. */
function Reviews() {
  const { data, error, reload } = useLive(() => api.reviews(), [])
  const [id, setId] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  return (
    <section>
      <h1>Reviews</h1>
      <Problem>{error}</Problem>
      <table>
        <thead>
          <tr><th>Review</th><th>Period end</th><th>Latest investigation</th><th>Cairn record</th><th>Last read from Cairn</th><th>Packs</th></tr>
        </thead>
        <tbody>
          {data?.map((r: ReviewListItem) => (
            <tr key={r.id}>
              <td><a href={`#/r/${r.id}/sources`}>{r.id}</a></td>
              <td>{r.period_end.slice(0, 10)}</td>
              <td>{r.latest_run ? <Badge state={r.latest_run.status} /> : '–'}</td>
              <td>{r.record_reference ?? '–'}</td>
              <td>{when(r.status_checked_at)}</td>
              <td>{r.latest_pack ? `v${r.latest_pack}` : '–'}</td>
            </tr>
          ))}
          {data && !data.length && <tr><td colSpan={6} className="meta">No reviews yet.</td></tr>}
        </tbody>
      </table>
      <h2>New review</h2>
      <div className="row">
        <input placeholder="review id, e.g. 2026-q4" value={id} onChange={(e) => setId(e.target.value.trim().toLowerCase())} />
        <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        <Action label="Create review" primary disabled={!id || !periodEnd} run={async () => (await api.createReview(id, periodEnd), (location.hash = `#/r/${id}/sources`), reload())} />
      </div>
    </section>
  )
}

/** One review: its header with the Cairn record and status, and the four tabs. */
function Review({ id, tab }: { id: string; tab: Tab }) {
  const overview = useLive(() => api.review(id), [id], (d) => d.operations.some((o) => o.state === 'running'))
  const r = overview.data?.review
  // Back from Cairn: read the record's status again, then show what changed.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !r?.record) return
      api.refresh(id).then(() => setTimeout(() => void overview.reload(), 1500), (e) => e instanceof SignedOut && location.reload())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [id, r?.record, overview])
  if (!overview.data) return <Problem>{overview.error ?? 'Loading…'}</Problem>
  const running = overview.data.operations.filter((o) => o.state === 'running')
  return (
    <section>
      <p className="crumbs"><a href="#/">Reviews</a> / {id}</p>
      <div className="review-head">
        <div>
          <h1>Review {id}</h1>
          <p className="meta">Period ending {r!.periodEnd.slice(0, 10)}</p>
        </div>
        <div className="cairn">
          {r!.record ? (
            <>
              <div>
                Cairn record <strong>{r!.record.cairnReference}</strong> {r!.cairnAppUrl && <a href={`${r!.cairnAppUrl}/records`} target="_blank" rel="noreferrer">open Cairn</a>}
              </div>
              <div className="meta">
                {r!.record.procedureName} v{r!.record.procedureVersion} · {r!.record.subjectName ?? r!.record.subjectReference}
              </div>
              <div className="meta">Last read {when(r!.statusCheckedAt)}{r!.statusError && <span className="error"> · last read failed: {r!.statusError}</span>}</div>
              <Action label="Refresh Cairn status" run={async () => (await api.refresh(id), setTimeout(() => void overview.reload(), 1200))} />
            </>
          ) : (
            <>
              <div className="meta">No Cairn record yet. It is started for the subject configured on the server, and can't be moved later.</div>
              <Action label="Open Cairn record" run={async () => (await api.openRecord(id), setTimeout(() => void overview.reload(), 1500))} />
            </>
          )}
        </div>
      </div>
      {running.length > 0 && <p className="running">Running: {running.map((o) => o.kind.replaceAll('_', ' ')).join(', ')}…</p>}
      <nav className="tabs">
        {TABS.map((t) => (
          <a key={t} href={`#/r/${id}/${t}`} className={t === tab ? 'on' : undefined}>{t[0].toUpperCase() + t.slice(1)}</a>
        ))}
      </nav>
      {tab === 'sources' && <Sources id={id} overview={overview.data} reload={overview.reload} />}
      {tab === 'investigation' && <Investigation id={id} overview={overview.data} reload={overview.reload} />}
      {tab === 'findings' && <Findings id={id} hasRecord={!!r!.record} reloadOverview={overview.reload} />}
      {tab === 'pack' && <Pack id={id} hasRecord={!!r!.record} />}
    </section>
  )
}
