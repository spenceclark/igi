// The Pack tab (spec §14, §6.8, §13): what still blocks a final pack, Generate committee PDF when nothing does, and
// every version with its state, PDF, preview and Cairn submission. A stale or superseded pack is labelled as such.
import { api, type Pack as PackRow } from './api.ts'
import { Action, Badge, Problem, useLive, when } from './ui.tsx'

/** A pack's state for the reader: stale (its evidence changed), superseded (a later one exists), or current. */
const packState = (p: PackRow) => (p.stale_reason ? 'stale' : p.superseded ? 'superseded' : 'current')
/** Where a pack's own submission to Cairn stands, in words. */
const inCairn = (p: PackRow) => {
  const s = p.submission
  if (!s) return '–'
  if (s.outcome !== 'submitted') return s.outcome
  const e = s.status?.evidence
  return e ? `filed ${e.cairnReference}, ${e.status}` : (s.status?.status ?? 'not read yet')
}

export function Pack({ id, hasRecord }: { id: string; hasRecord: boolean }) {
  const data = useLive(() => api.packs(id), [id], (d) => d.packs.some((p) => p.submission?.outcome === 'submitted' && !p.submission.status?.evidence), 5000)
  const d = data.data
  const latest = d?.packs.at(-1)
  return (
    <div>
      <Problem>{data.error ?? d?.blockError}</Problem>
      <h2>Committee PDF</h2>
      {d && (d.blockers.length ? (
        <div className="callout">
          <h3>What blocks a final pack</h3>
          <ul>{d.blockers.map((b, i) => <li key={i}>{b.finding ? <strong>{b.finding.id} v{b.finding.version} </strong> : null}{b.reason}</li>)}</ul>
          <p className="meta">From the last read of Cairn. Refresh Cairn status after filing or voiding there.</p>
        </div>
      ) : (
        <p className="meta">Nothing blocks a final pack. Generating reads Cairn again first, and builds the pack only from findings both of whose items are filed and active.</p>
      ))}
      <div className="row">
        <Action label="Generate committee PDF" primary disabled={!d || d.blockers.length > 0 || !!d.blockError} run={async () => (await api.generatePack(id), setTimeout(() => void data.reload(), 2500))} />
        {latest && !latest.stale_reason && hasRecord && (
          <Action
            label={latest.submission ? 'Submitted to Cairn' : `Submit pack v${latest.version} to Cairn`}
            disabled={!!latest.submission && latest.submission.outcome !== 'refused'}
            run={async () => (await api.submitPack(id), setTimeout(() => void data.reload(), 2000))}
          />
        )}
      </div>

      <h2>Versions</h2>
      <table>
        <thead><tr><th>Version</th><th>Generated</th><th>State</th><th>Findings</th><th>Files</th><th>In Cairn</th></tr></thead>
        <tbody>
          {d?.packs.slice().reverse().map((p) => (
            <tr key={p.version}>
              <td>v{p.version}</td>
              <td>{when(p.generated_at)}</td>
              <td><Badge state={packState(p)} />{p.stale_reason && <div className="meta">{p.stale_reason}</div>}</td>
              <td>{p.findings.join(', ') || 'none'}<div className="meta">{p.counts.rejected} rejected, {p.counts.withdrawn} withdrawn, {p.counts.notSubmitted} not submitted</div></td>
              <td>
                {p.pdf_key ? <a href={api.packUrl(id, p.version, 'pdf')} target="_blank" rel="noreferrer">PDF</a> : 'no PDF'} · <a href={api.packUrl(id, p.version, 'html')} target="_blank" rel="noreferrer">preview</a>
              </td>
              <td>{inCairn(p)}</td>
            </tr>
          ))}
          {d && !d.packs.length && <tr><td colSpan={6} className="meta">No pack yet.</td></tr>}
        </tbody>
      </table>
      <p className="meta">A stale pack's evidence changed after it was generated: it stays in the history, and a new pack supersedes it. A file already downloaded or filed in Cairn can't be changed from here.</p>
    </div>
  )
}
