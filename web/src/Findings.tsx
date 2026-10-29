// The Findings tab (spec §14, §6.7): each current finding with its state and both items' states, what a person still
// has to void or discard in Cairn, and for the finding opened its assertion as Cairn shows it, its package PDF, what
// IGI checked, and the actions. IGI offers no accept or reject: that is done in Cairn.
import { useEffect, useState } from 'react'
import { api, type Finding, type FindingsResponse } from './api.ts'
import { Action, Badge, Problem, useLive } from './ui.tsx'

type Row = FindingsResponse['findings'][number]
const key = (f: Finding) => `${f.run_id}/${f.id}/${f.version}`

export function Findings({ id, hasRecord, reloadOverview }: { id: string; hasRecord: boolean; reloadOverview: () => Promise<void> }) {
  const list = useLive(() => api.findings(id), [id], (d) => d.findings.some((f) => f.state === 'pending'), 5000)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const rows = list.data?.findings ?? []
  const submittable = (r: Row) => r.state === 'not_submitted' || r.state === 'incomplete'
  const opened = rows.find((r) => key(r.finding) === open)
  return (
    <div>
      <Problem>{list.error}</Problem>
      {list.data?.reconcile.length ? (
        <div className="callout">
          <h3>To do in Cairn</h3>
          <ul>{list.data.reconcile.map((x) => <li key={`${x.id}-${x.version}-${x.advice}`}>{x.advice}</li>)}</ul>
        </div>
      ) : null}
      <div className="row">
        <Action
          label={`Submit ${chosen.size || ''} to Cairn`.replace('  ', ' ')}
          primary
          disabled={!hasRecord || !chosen.size}
          title={hasRecord ? undefined : 'Open the Cairn record first'}
          run={async () => {
            const refs = rows.filter((r) => chosen.has(key(r.finding))).map((r) => ({ runId: r.finding.run_id, id: r.finding.id, version: r.finding.version }))
            await api.submit(id, refs)
            setChosen(new Set())
            setTimeout(() => void (list.reload(), reloadOverview()), 1500)
          }}
        />
        <span className="meta">Each finding is submitted as its assertion and its investigation package. A person files or discards both in Cairn.</span>
      </div>
      <table>
        <thead>
          <tr><th></th><th>Finding</th><th>Classification</th><th>Figures</th><th>State</th><th>Assertion</th><th>Package</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const f = r.finding
            return (
              <tr key={key(f)} className={open === key(f) ? 'selected' : undefined}>
                <td>
                  {submittable(r) && (
                    <input type="checkbox" checked={chosen.has(key(f))} onChange={(e) => setChosen((s) => (e.target.checked ? new Set(s).add(key(f)) : new Set([...s].filter((x) => x !== key(f)))))} />
                  )}
                </td>
                <td>
                  <button className="link" onClick={() => setOpen(open === key(f) ? null : key(f))}>{f.id} v{f.version}: {f.content.title}</button>
                  <div className="meta">run {r.runTag} · {f.content.portfolios.join(', ')}</div>
                </td>
                <td>{f.classification.replaceAll('_', ' ')}<div className="meta">{f.content.materiality} materiality</div></td>
                <td><Badge state={f.validation.state} /></td>
                <td><Badge state={r.state} /></td>
                <td><Badge state={r.items.assertion} /></td>
                <td><Badge state={r.items.file} /></td>
              </tr>
            )
          })}
          {list.data && !rows.length && <tr><td colSpan={7} className="meta">No findings yet: start an investigation.</td></tr>}
        </tbody>
      </table>
      {opened && <Detail row={opened} reload={() => list.reload()} />}
    </div>
  )
}

/** One finding opened: its assertion as Cairn will show it, the package, what IGI checked, and the actions. */
function Detail({ row, reload }: { row: Row; reload: () => Promise<void> }) {
  const f = row.finding
  const v = f.validation
  const [assertion, setAssertion] = useState<{ text: string | null; sent: boolean; error?: string } | null>(null)
  useEffect(() => void api.assertion(f).then(setAssertion), [f])
  const uncertain = row.entries.filter((e) => e.outcome === 'uncertain' || e.outcome === 'sending')
  return (
    <div className="detail-panel">
      <h2>{f.id} v{f.version}: {f.content.title}</h2>
      {f.content.revision?.accepted && <p className="meta">Revises {f.content.revision.of} of the same run, kept as history.</p>}
      <div className="cols">
        <div>
          <h3>Assertion {assertion?.sent ? '(as sent)' : '(preview: not yet sent)'}</h3>
          {assertion?.text ? <pre className="assertion">{assertion.text}</pre> : <Problem>{assertion?.error}</Problem>}
          <p><a href={api.packageUrl(f)} target="_blank" rel="noreferrer">Investigation package {f.artifacts ? '(as sent)' : '(preview PDF)'}</a></p>
        </div>
        <div>
          <h3>What IGI checked</h3>
          {v.claims ? (
            <table className="small">
              <thead><tr><th>Figure</th><th>Value</th><th>Checked against</th></tr></thead>
              <tbody>
                {v.claims.map((c) => (
                  <tr key={c.key} className={c.ok ? undefined : 'failed'}>
                    <td>{c.label}</td>
                    <td>{c.value ?? ''}</td>
                    <td>{c.ok ? `${c.evidence}${c.scope ? ` (${c.scope})` : ''}` : `Not supported: ${c.reason}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <ul>{(f.content.material_numbers ?? []).map((n) => <li key={n.label}>{n.label}: {n.value} ({n.check_id})</li>)}</ul>
          )}
          {v.coverage?.map((c) => <p key={c.kind} className={c.ok ? 'meta' : 'problem'}>{c.kind.replaceAll('_', ' ')} for {c.portfolios.join(', ')}: {c.ok ? 'every member covered' : c.reason ?? c.missing.join('; ')}</p>)}
          {[...(v.unclaimed_figures ?? []), ...(v.unsupported_scope ?? [])].length > 0 && <p className="problem">Not supported in the text: {[...(v.unclaimed_figures ?? []), ...(v.unsupported_scope ?? [])].join(', ')}</p>}
          <p className="meta">The explanation and conclusion are Spark’s interpretation; IGI checked the figures and population statements only.</p>
          <h3>Unresolved</h3>
          <ul>{(f.content.uncertainties?.length ? f.content.uncertainties : ['None recorded.']).map((u) => <li key={u}>{u}</li>)}</ul>
        </div>
      </div>
      <h3>Submissions</h3>
      <table className="small">
        <thead><tr><th>Item</th><th>Sent</th><th>Placement</th><th>In Cairn</th><th>Candidate</th></tr></thead>
        <tbody>
          {row.entries.map((e) => (
            <tr key={e.id}>
              <td>{e.kind}</td>
              <td><Badge state={e.outcome} />{e.error_code ? ` ${e.error_code}` : ''}</td>
              <td>{e.placement ?? '–'}</td>
              <td>{e.cairn_status ? (e.cairn_status.evidence ? <>{e.cairn_status.evidence.cairnReference} <Badge state={e.cairn_status.evidence.status} /></> : <Badge state={e.cairn_status.status} />) : '–'}</td>
              <td><code>{e.candidate_id ?? '–'}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        {uncertain.map((e) => (
          <Action key={e.id} label={`Abandon uncertain ${e.kind}`} title="Only after checking Cairn's Tray: the next submit sends it again" run={async () => (await api.abandon(e.id), reload())} />
        ))}
        {!f.withdrawn_at && (
          <Action
            label="Withdraw"
            run={async () => {
              const reason = prompt(`Why withdraw ${f.id} v${f.version}? This is final for this version.`)
              if (reason?.trim()) (await api.withdraw(f, reason), await reload())
            }}
          />
        )}
        {f.withdrawn_at && <Action label="Put forward as a new version" run={async () => (await api.newVersion(f), reload())} />}
      </div>
      {f.withdrawn_at && <p className="meta">Withdrawn: {f.withdrawal_reason}</p>}
    </div>
  )
}
