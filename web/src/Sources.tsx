// The Sources tab (spec §14): upload the review's files, see each source the importer recognised with its rows,
// columns and validation issues, and inspect a source's rows. Issues show here before any investigation starts.
import { useState } from 'react'
import { api, type ReviewOverview } from './api.ts'
import { Problem, when } from './ui.tsx'

export function Sources({ id, overview, reload }: { id: string; overview: ReviewOverview; reload: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [rows, setRows] = useState<Record<string, string>[] | null>(null)
  const issues = overview.sources.reduce((n, s) => n + s.validation_issues.length, 0)
  return (
    <div>
      <h2>Upload sources</h2>
      <p className="meta">CSV data files and the Markdown policy document. Each upload is kept as a version; the latest of each file name is used.</p>
      <input
        type="file"
        multiple
        accept=".csv,.md"
        disabled={busy}
        onChange={async (e) => {
          if (!e.target.files?.length) return
          setBusy(true)
          setError(null)
          try {
            await api.upload(id, e.target.files)
            await reload()
          } catch (err) {
            setError((err as Error).message)
          } finally {
            setBusy(false)
            e.target.value = ''
          }
        }}
      />
      <Problem>{error}</Problem>
      <Problem>{overview.importError}</Problem>

      {overview.sources.length > 0 && (
        <>
          <h2>Import check</h2>
          <p className={issues ? 'problem' : 'meta'}>{issues ? `${issues} validation issue${issues === 1 ? '' : 's'}: nothing is repaired, and conclusions that depend on them can't be relied on.` : 'Every source was recognised and validated with no issues.'}</p>
          <table>
            <thead>
              <tr><th>Source</th><th>File</th><th>Rows</th><th>Issues</th><th>SHA-256</th><th></th></tr>
            </thead>
            <tbody>
              {overview.sources.map((s) => (
                <tr key={s.source}>
                  <td title={s.description}>{s.source}</td>
                  <td>{s.file}</td>
                  <td>{s.rows ?? (s.sections ? `${s.sections.length} sections` : '–')}</td>
                  <td>{s.validation_issues.length ? <ul className="issues">{s.validation_issues.map((i) => <li key={i}>{i}</li>)}</ul> : '–'}</td>
                  <td><code>{s.sha256.slice(0, 12)}</code></td>
                  <td>
                    {s.rows ? (
                      <button
                        onClick={async () => {
                          if (open === s.source) return setOpen(null)
                          setOpen(s.source)
                          setRows((await api.rows(id, s.source)).rows)
                        }}
                      >
                        {open === s.source ? 'Hide rows' : 'Rows'}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {open && rows && (
        <div className="scroll">
          <h3>{open}: first {rows.length} rows</h3>
          <table className="small">
            <thead><tr>{Object.keys(rows[0] ?? {}).map((k) => <th key={k}>{k}</th>)}</tr></thead>
            <tbody>{rows.map((r) => <tr key={r.row_id}>{Object.values(r).map((v, i) => <td key={i}>{v}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}

      {overview.uploads.length > 0 && (
        <>
          <h2>Uploads in use</h2>
          <table className="small">
            <thead><tr><th>File</th><th>Uploaded</th><th>SHA-256</th></tr></thead>
            <tbody>{overview.uploads.map((u) => <tr key={u.file}><td>{u.file}</td><td>{when(u.uploaded_at)}</td><td><code>{u.sha256}</code></td></tr>)}</tbody>
          </table>
        </>
      )}
    </div>
  )
}
