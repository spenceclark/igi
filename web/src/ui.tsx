// Small pieces shared by the pages: state badges, a button that shows it is busy, an error line, dates, and a hook
// that loads data and reloads it on a timer while something is still changing.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { SignedOut } from './api.ts'

// Colours for states, by how a reader should take them: settled, waiting, needs attention, neutral.
const TONE: Record<string, 'good' | 'wait' | 'bad' | 'plain'> = {
  publication_ready: 'good', passed: 'good', accepted: 'good', succeeded: 'good', completed: 'good', current: 'good', validated: 'good', filed: 'good', active: 'good',
  pending: 'wait', running: 'wait', unfiled: 'wait', 'not-read': 'wait', sending: 'wait', submitted: 'wait', completed_with_uncertainties: 'wait',
  incomplete: 'bad', failed: 'bad', interrupted: 'bad', stale: 'bad', voided: 'bad', uncertain: 'bad', refused: 'bad', blocked: 'bad', budget_exhausted: 'bad', unvalidated: 'bad',
  breached: 'bad', not_evaluated: 'bad', unsupported: 'bad',
}
/** A state as a coloured label; underscores and hyphens read as spaces. */
export const Badge = ({ state }: { state: string }) => <span className={`badge ${TONE[state] ?? 'plain'}`}>{state.replaceAll(/[_-]/g, ' ')}</span>

/** A date and time in the reader's locale, or a dash. */
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '–')

/** A button that runs an action, shows "…" while it runs and reports a failure next to it. */
export function Action({ label, run, disabled, primary, title }: { label: string; run: () => Promise<unknown>; disabled?: boolean; primary?: boolean; title?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <span className="action">
      <button
        className={primary ? 'primary' : undefined}
        disabled={disabled || busy}
        title={title}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            await run()
          } catch (e) {
            if (e instanceof SignedOut) location.reload()
            setError((e as Error).message)
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? `${label}…` : label}
      </button>
      {error && <span className="error">{error}</span>}
    </span>
  )
}

export const Problem = ({ children }: { children: ReactNode }) => (children ? <p className="problem">{children}</p> : null)

/**
 * Loads data, and reloads it every `everyMs` while `live(data)` says it is still changing (an operation running, a
 * candidate unfiled). Returns the data, an error, and a reload function for after an action.
 */
export function useLive<T>(load: () => Promise<T>, deps: unknown[], live: (data: T) => boolean = () => false, everyMs = 3000) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadRef = useRef(load)
  loadRef.current = load
  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current())
      setError(null)
    } catch (e) {
      if (e instanceof SignedOut) location.reload()
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => void reload(), deps)
  useEffect(() => {
    if (!data || !live(data)) return
    const t = setTimeout(() => void reload(), everyMs)
    return () => clearTimeout(t)
  })
  return { data, error, reload }
}
