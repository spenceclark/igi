// Monty adapter (spec §9). One pool per process; a fresh session per execution, so every execution is
// reproducible from its source and the review's data alone.
import { readFileSync } from 'node:fs'
import { Monty, MontyCrashedError, MontyError, MontyRuntimeError, MontySyntaxError } from '@pydantic/monty'

export const MONTY_VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> }).dependencies['@pydantic/monty']
export const LIMITS = {
  maxMemory: 128 * 1024 * 1024,
  maxFeedDurationSecs: 10,
  maxTurnDurationSecs: 10,
  maxRecursionDepth: 200,
  maxSuspensions: 200, // every host-function call is a suspension
  maxTotalSleepSecs: 0,
}
const POOL = { minProcesses: 1, maxProcesses: 2, checkoutTimeout: 30, requestTimeout: 30 }
const STDOUT_CHARS = 8_000
const ERROR_CHARS = 4_000

let pool: Promise<Monty> | undefined
export async function closeSandbox() {
  if (pool) await (await pool).close()
  pool = undefined
}

/** Python dicts arrive as Map, big ints as bigint, Decimal and dates as tagged objects: make plain JSON. */
export function normalise(v: unknown): unknown {
  if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [String(k), normalise(x)]))
  if (Array.isArray(v)) return v.map(normalise)
  if (typeof v === 'bigint') return v.toString()
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (o.__monty_type__ === 'Decimal') return String(o.value)
    if (o.__monty_type__ === 'Date') return `${o.year}-${String(o.month).padStart(2, '0')}-${String(o.day).padStart(2, '0')}`
    return Object.fromEntries(Object.entries(o).filter(([k]) => k !== '__monty_type__').map(([k, x]) => [k, normalise(x)]))
  }
  return v
}

/**
 * Wraps a host function so Python can call it with positional or keyword arguments. Monty passes
 * keyword arguments as a trailing null-prototype object; Python dicts arrive as Map. A thrown Error
 * becomes a RuntimeError the sandboxed code can catch.
 */
export function hostFunction(names: string[], fn: (args: Record<string, unknown>) => unknown) {
  return (...raw: unknown[]) => {
    const last = raw.at(-1)
    const kwargs = last && typeof last === 'object' && !(last instanceof Map) && !Array.isArray(last) && Object.getPrototypeOf(last) === null ? (raw.pop() as Record<string, unknown>) : {}
    if (raw.length > names.length) throw new Error(`too many positional arguments; parameters are ${names.join(', ')}`)
    const args: Record<string, unknown> = {}
    raw.forEach((v, i) => (args[names[i]] = normalise(v)))
    for (const [k, v] of Object.entries(kwargs)) {
      if (!names.includes(k)) throw new Error(`unexpected keyword argument '${k}'; parameters are ${names.join(', ')}`)
      args[k] = normalise(v)
    }
    return fn(args)
  }
}

export type PythonResult = { ok: boolean; result?: unknown; stdout: string; stdoutTruncated: boolean; error?: string; errorType?: string; workerLost?: boolean; ms: number }

export async function runPython(code: string, host: Record<string, unknown>, now: Date): Promise<PythonResult> {
  pool ??= Monty.create(POOL)
  const started = performance.now()
  let stdout = ''
  let stdoutTruncated = false
  const printCallback = (_stream: 'stdout' | 'stderr', text: string) => {
    if (stdout.length + text.length > STDOUT_CHARS) {
      stdout += text.slice(0, STDOUT_CHARS - stdout.length)
      stdoutTruncated = true
    } else stdout += text
  }
  const session = await (await pool).checkout({ limits: LIMITS, osPolicy: { datetime: now, sleep: 'zero', randomStart: { seed: 0 } } })
  const ms = () => Math.round(performance.now() - started)
  try {
    const result = normalise(await session.feedRun(code, { externalLookup: host, printCallback }))
    return { ok: true, result, stdout, stdoutTruncated, ms: ms() }
  } catch (e) {
    if (!(e instanceof MontyError)) throw e
    const text = e instanceof MontyRuntimeError || e instanceof MontySyntaxError ? e.display('traceback') : e.display('type-msg')
    return {
      ok: false,
      stdout,
      stdoutTruncated,
      error: text.length > ERROR_CHARS ? `${text.slice(0, ERROR_CHARS)}\n... (truncated)` : text,
      errorType: e instanceof MontyCrashedError ? (e.timedOut ? 'WorkerTimeout' : 'WorkerCrashed') : e.exception.typeName,
      workerLost: e instanceof MontyCrashedError,
      ms: ms(),
    }
  } finally {
    await session.close().catch(() => {})
  }
}
