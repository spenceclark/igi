// The Investigation tab (spec §14, §8.5): an explicit start, the review's runs, and one run's trace in order. Each
// model turn shows its visible message and tool calls; each call shows a one-line summary, with its arguments,
// code and result on expansion. Spark's reasoning is never shown: only what it did and said.
import { useState } from 'react'
import { api, type ReviewOverview, type TraceEvent } from './api.ts'
import { Action, Badge, Problem, useLive, when } from './ui.tsx'

// One tool call in a line: what it asked for, and what came back, from its arguments and result.
function summary(name: string, args: Record<string, unknown>, result: Record<string, unknown> | undefined): string {
  if (result?.error) return `${name}: ${String(result.error)}`
  const a = (k: string) => (args[k] === undefined ? '' : String(args[k]))
  switch (name) {
    case 'run_check':
      return `${String(result?.check_id ?? '')} ${a('check')} ${a('portfolio_id')} ${a('asset_class')}`.trim()
    case 'read_data':
      return `read ${a('source')}: ${String(result?.returned ?? '?')} of ${String(result?.matching ?? '?')} rows`
    case 'run_python':
      return `${String(result?.execution_id ?? '')} ${a('purpose')}${result?.ok === false ? ' (error)' : ''}${result?.warning ? ' (typed-in figures)' : ''}`
    case 'propose_finding':
      return `${String(result?.finding_id ?? '')} ${a('title')}: ${String(result?.classification ?? '')}, ${String((result?.validation as { state?: string } | undefined)?.state ?? '')}`
    case 'record_note':
      return `${String(result?.note_id ?? '')} ${a('kind')}: ${a('text')}`
    case 'get_policy':
      return `policy ${a('section') || a('portfolio_id') || 'all'}`
    default:
      return name
  }
}

export function Investigation({ id, overview, reload }: { id: string; overview: ReviewOverview; reload: () => Promise<void> }) {
  const [effort, setEffort] = useState('medium')
  const [selected, setSelected] = useState<string | null>(null)
  const runId = selected ?? overview.runs[0]?.id ?? null
  const running = overview.operations.some((o) => o.kind === 'investigate' && o.state === 'running')
  const run = useLive(() => (runId ? api.run(runId) : Promise.resolve(null)), [runId], (d) => d?.run.status === 'running', 2500)
  const [openSeq, setOpenSeq] = useState<number | null>(null)
  const issues = overview.sources.reduce((n, s) => n + s.validation_issues.length, 0)
  return (
    <div>
      <h2>Start investigation</h2>
      <p className="meta">Spark investigates the current sources against the policies, with read-only tools, Python in a sandbox and trusted checks. It has not been told what is wrong. A run takes a few minutes and costs about $0.20.</p>
      {overview.blockers.length > 0 && <div className="problem"><p>An investigation can’t start until the sources are fixed:</p><ul>{overview.blockers.map((b) => <li key={b}>{b}</li>)}</ul></div>}
      {issues > 0 && <p className="problem">The sources have {issues} validation issue{issues === 1 ? '' : 's'}; Spark sees them, and conclusions that depend on them stay open.</p>}
      <div className="row">
        <select value={effort} onChange={(e) => setEffort(e.target.value)}>
          <option value="low">Reasoning effort: low</option>
          <option value="medium">Reasoning effort: medium</option>
          <option value="high">Reasoning effort: high</option>
        </select>
        <Action label={running ? 'Investigation running' : 'Start investigation'} primary disabled={running || !overview.sources.length || overview.blockers.length > 0} run={async () => (await api.investigate(id, effort), setSelected(null), setTimeout(() => void reload(), 1000))} />
      </div>

      <h2>Runs</h2>
      <table className="small">
        <thead><tr><th>Run</th><th>Status</th><th>Started</th><th>Turns</th><th>Tool calls</th><th>Cost</th></tr></thead>
        <tbody>
          {overview.runs.map((r) => (
            <tr key={r.id} className={r.id === runId ? 'selected' : undefined} onClick={() => setSelected(r.id)}>
              <td><a href="#" onClick={(e) => e.preventDefault()}>{r.id}</a></td>
              <td><Badge state={r.status} /></td>
              <td>{when(r.started_at)}</td>
              <td>{r.turns}</td>
              <td>{r.tool_calls}</td>
              <td>{r.usage?.costUsd !== undefined ? `$${r.usage.costUsd.toFixed(3)}` : '–'}</td>
            </tr>
          ))}
          {!overview.runs.length && <tr><td colSpan={6} className="meta">No investigation yet.</td></tr>}
        </tbody>
      </table>

      <Problem>{run.error}</Problem>
      {run.data && (
        <>
          <h2>Trace of {run.data.run.id}</h2>
          <p className="meta">
            {run.data.run.config.model}, reasoning effort {run.data.run.config.reasoning_effort}; IGI code {run.data.run.config.igi_commit}. <Badge state={run.data.run.status} />
          </p>
          {run.data.run.summary && <div className="summary"><h3>Spark’s summary</h3><p>{run.data.run.summary}</p></div>}
          <ol className="trace">
            {run.data.events.map((e: TraceEvent) => {
              const d = e.data
              if (e.type === 'model_turn')
                return (
                  <li key={e.seq} className="turn">
                    <span className="meta">Turn {String(d.turn)} · {((Number(d.ms) || 0) / 1000).toFixed(1)} s</span>
                    {typeof d.message === 'string' && <p className="said">{d.message}</p>}
                  </li>
                )
              if (e.type === 'tool_call') {
                const args = (d.arguments ?? {}) as Record<string, unknown>
                const result = d.result as Record<string, unknown> | undefined
                return (
                  <li key={e.seq} className={`call${result?.error ? ' failed' : ''}`}>
                    <button className="link" onClick={() => setOpenSeq(openSeq === e.seq ? null : e.seq)}>
                      {summary(String(d.name), args, result)}
                    </button>
                    {openSeq === e.seq && (
                      <div className="detail">
                        {typeof args.code === 'string' && <pre>{args.code}</pre>}
                        <h4>Arguments</h4>
                        <pre>{JSON.stringify(Object.fromEntries(Object.entries(args).filter(([k]) => k !== 'code')), null, 2)}</pre>
                        <h4>Result</h4>
                        <pre>{JSON.stringify(result, null, 2)}</pre>
                      </div>
                    )}
                  </li>
                )
              }
              return <li key={e.seq} className="call failed">{String(d.message ?? e.type)}</li>
            })}
          </ol>
          {run.data.notes.length > 0 && (
            <>
              <h3>Notes</h3>
              <ul>{run.data.notes.map((n) => <li key={n.id}><strong>{n.id}</strong> <Badge state={n.kind} /> {n.text}</li>)}</ul>
            </>
          )}
          <h3>Policy rules</h3>
          <p className="meta">Every structured rule version in force, for each portfolio and period, and whether a trusted check of this run evaluated it. Not evaluated and unsupported are never counted as met.</p>
          <Problem>{run.data.rule_coverage_error}</Problem>
          {run.data.rule_coverage && (
            <table className="small">
              <thead><tr><th>Period</th><th>Portfolio</th><th>Rule</th><th>Metric</th><th>Status</th><th>Check or reason</th></tr></thead>
              <tbody>
                {run.data.rule_coverage.map((r) => (
                  <tr key={`${r.period} ${r.portfolio_id} ${r.rule_id} ${r.version}`}>
                    <td>{r.period}</td><td>{r.portfolio_id}</td><td>{r.rule_id} v{r.version}</td><td>{r.metric}</td><td><Badge state={r.status} /></td><td>{[r.check_id, r.reason].filter(Boolean).join(': ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="meta">The run’s findings are on the <a href={`#/r/${id}/findings`}>Findings</a> tab.</p>
        </>
      )}
    </div>
  )
}
