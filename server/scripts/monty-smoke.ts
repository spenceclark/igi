// Gate B smoke test for @pydantic/monty (spec §9). Confirms installation, value transfer, host
// functions, limits, the supported subset and isolation against the installed version.
// Run: node scripts/monty-smoke.ts   (exit code 1 if any required check fails)
import {
  CollectString,
  Monty,
  MontyCrashedError,
  MontyError,
  MontyRuntimeError,
  type MontySession,
  type FeedOptions,
} from '@pydantic/monty'

const LIMITS = {
  maxMemory: 64 * 1024 * 1024,
  maxFeedDurationSecs: 2,
  maxTurnDurationSecs: 2,
  maxRecursionDepth: 200,
  maxSuspensions: 1000,
  maxTotalSleepSecs: 0,
}
const OS_POLICY = { datetime: new Date('2026-10-27T09:00:00Z'), sleep: 'zero' as const, randomStart: { seed: 0 } }

type Outcome = { ok: true; value: unknown } | { ok: false; kind: string; type: string; text: string }
type Expect = (o: Outcome) => boolean
type Case = { name: string; code: string; expect?: Expect; opts?: FeedOptions }

// Python dicts arrive as Map, ints beyond 2^53 as bigint.
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (x instanceof Map ? Object.fromEntries(x) : typeof x === 'bigint' ? `${x}n` : x))
const value = (v: unknown): Expect => (o) => o.ok && json(o.value) === json(v)
const raises = (type?: string): Expect => (o) => !o.ok && (type === undefined || o.type === type)
let failed = 0

async function feed(session: MontySession, code: string, opts?: FeedOptions): Promise<Outcome> {
  try {
    return { ok: true, value: await session.feedRun(code, opts) }
  } catch (e) {
    if (!(e instanceof MontyError)) throw e
    const text = e instanceof MontyRuntimeError ? e.display('traceback') : e.display('type-msg')
    return { ok: false, kind: e.constructor.name, type: e.exception.typeName, text }
  }
}

function show(o: Outcome): string {
  const kind = o.ok && o.value instanceof Map ? 'Map' : typeof (o.ok && o.value)
  const s = o.ok ? `${kind} ${json(o.value)}` : `${o.kind} ${o.text.trim().split('\n').at(-1)}`
  return s.length > 110 ? s.slice(0, 107) + '...' : s
}

function report(name: string, pass: boolean | undefined, detail: string, ms: number) {
  if (pass === false) failed++
  const tag = pass === undefined ? 'INFO' : pass ? 'PASS' : 'FAIL'
  console.log(`${tag}  ${name.padEnd(34)} ${String(ms).padStart(5)}ms  ${detail}`)
}

async function runCases(session: MontySession, title: string, cases: Case[]) {
  console.log(`\n-- ${title}`)
  for (const c of cases) {
    const t = Date.now()
    const o = await feed(session, c.code, c.opts)
    report(c.name, c.expect?.(o), show(o), Date.now() - t)
  }
}

const rows = [
  { portfolio: 'P1', holding: 'Fund A', weight: '0.1250' },
  { portfolio: 'P1', holding: 'Fund B', weight: '0.3333' },
  { portfolio: 'P1', holding: 'Fund C', weight: '0.5417' },
]
const host = {
  read_rows: (source: string, limit: number) => {
    if (source !== 'holdings') throw new Error(`unknown source: ${source}`)
    return rows.slice(0, limit)
  },
}

let t = Date.now()
const pool = await Monty.create({ minProcesses: 1, maxProcesses: 2, checkoutTimeout: 10, requestTimeout: 30 })
report('pool create (1 worker)', true, `${process.platform}-${process.arch} node ${process.version}`, Date.now() - t)
t = Date.now()
const session = await pool.checkout({ limits: LIMITS, osPolicy: OS_POLICY })
report('checkout', true, `worker pid ${session.workerPid}`, Date.now() - t)

try {
  await runCases(session, 'value transfer (§9.6)', [
    { name: 'decimal string in, string out', code: 'from decimal import Decimal\nstr(Decimal(w) * 3)', opts: { inputs: { w: '1.10' } }, expect: value('3.30') },
    { name: 'JS number types', code: '[type(a).__name__, type(b).__name__, type(big).__name__]', opts: { inputs: { a: 21, b: 21.5, big: 2 ** 53 + 2 } } },
    { name: 'JS floats into Decimal', code: 'from decimal import Decimal\nstr(Decimal(x) + Decimal(y))', opts: { inputs: { x: 0.1, y: 0.2 } } },
    { name: 'bare Decimal returned', code: 'from decimal import Decimal\nDecimal("1.10") * 3' },
    { name: 'dict and tuple returned', code: '{"a": 1, "t": (1, "x"), "n": None}' },
    { name: 'date returned', code: 'from datetime import date\ndate(2026, 10, 27)' },
    { name: 'osPolicy fixed clock', code: 'from datetime import date\ndate.today().isoformat()', expect: value('2026-10-27') },
  ])

  await runCases(session, 'host functions (§9.3)', [
    {
      name: 'host rows summed as Decimal',
      code: 'from decimal import Decimal\nrows = read_rows("holdings", 3)\nstr(sum([Decimal(r["weight"]) for r in rows], Decimal("0")))',
      opts: { externalLookup: host },
      expect: value('1.0000'),
    },
  ])

  await runCases(session, 'supported subset (§9.2)', [
    {
      name: 'dataclass frozen + __post_init__',
      code: 'from dataclasses import dataclass, field\n@dataclass(frozen=True)\nclass H:\n    name: str\n    weight: str\n    tags: list = field(default_factory=list)\n    def __post_init__(self):\n        assert self.weight\nh = H("A", "0.5")\nf"{h.name}:{h.weight}:{len(h.tags)}"',
      expect: value('A:0.5:0'),
    },
    { name: 'f-string float specs', code: 'f"{1234.5:,.2f}|{0.125:.1%}"', expect: value('1,234.50|12.5%') },
    { name: 'f-string Decimal spec', code: 'from decimal import Decimal\nf"{Decimal(\'1234.5\'):,.2f}"', expect: value('1,234.50') },
    { name: 'decimal ROUND_HALF_UP', code: 'from decimal import Decimal, ROUND_HALF_UP\nstr(Decimal("2.675").quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))', expect: value('2.68') },
    { name: 'collections', code: 'from collections import defaultdict, Counter\nd = defaultdict(list)\nd["x"].append(1)\nc = Counter(["a", "b", "a"])\n[d["x"], c["a"], c.most_common(1)[0][0]]', expect: value([[1], 2, 'a']) },
    { name: 'itertools.groupby', code: 'from itertools import groupby\n[[k, len(list(g))] for k, g in groupby(sorted(["b", "a", "b"]))]', expect: value([['a', 1], ['b', 2]]) },
    { name: 'datetime arithmetic', code: 'from datetime import date, timedelta\n(date(2026, 10, 27) + timedelta(days=5)).isoformat()', expect: value('2026-11-01') },
    { name: 'json', code: 'import json\njson.dumps({"b": 1, "a": [1, 2]}, sort_keys=True)', expect: value('{"a": [1, 2], "b": 1}') },
    { name: 're', code: 'import re\nre.findall(r"\\d+", "a1b22c333")', expect: value(['1', '22', '333']) },
    { name: 'math', code: 'import math\nmath.isclose(0.1 + 0.2, 0.3)', expect: value(true) },
    { name: 'generator expression', code: 'sum(x * x for x in range(4))', expect: value(14) },
    { name: 'statistics module', code: 'import statistics\nstatistics.mean([1, 2, 3])' },
  ])

  await runCases(session, 'unsupported subset (§9.2)', [
    { name: 'class inheritance', code: 'class A:\n    pass\nclass B(A):\n    pass\nB()', expect: raises() },
    { name: '@property', code: 'class A:\n    @property\n    def x(self):\n        return 1\nA().x', expect: raises() },
    { name: '@staticmethod', code: 'class A:\n    @staticmethod\n    def f():\n        return 1\nA.f()', expect: raises() },
    { name: 'yield', code: 'def g():\n    yield 1\nlist(g())', expect: raises() },
    { name: 'user-defined exception', code: 'class MyErr(Exception):\n    pass\nraise MyErr("x")', expect: raises() },
  ])

  await runCases(session, 'errors returned to Spark', [
    { name: 'syntax error', code: 'def f(:\n    pass', expect: (o) => !o.ok && o.kind === 'MontySyntaxError' },
    { name: 'runtime error with traceback', code: 'def f(x):\n    return 1 / x\nf(0)', expect: (o) => !o.ok && o.type === 'ZeroDivisionError' && /line 2/.test(o.text) },
    { name: 'host function throws', code: 'try:\n    read_rows("missing", 1)\n    r = "no error"\nexcept Exception as e:\n    r = type(e).__name__ + ": " + str(e)\nr', opts: { externalLookup: host } },
    { name: 'session usable after errors', code: '1 + 1', expect: value(2) },
  ])

  await runCases(session, 'limits (§9.4)', [
    { name: 'maxFeedDurationSecs (2s loop)', code: 'while True:\n    pass', expect: raises('TimeoutError') },
    { name: 'maxMemory (64 MB)', code: 'x = "a" * (200 * 1024 * 1024)\nlen(x)', expect: raises('MemoryError') },
    { name: 'maxRecursionDepth (200)', code: 'def f(n):\n    return f(n + 1)\nf(0)', expect: raises('RecursionError') },
    { name: 'session usable after limits', code: '1 + 1', expect: value(2) },
  ])

  const out = new CollectString()
  const capped = new CollectString(1024)
  await runCases(session, 'stdout capture and cap', [
    { name: 'print captured', code: 'print("hello")', opts: { printCallback: out } },
    { name: 'print over 1 KB cap', code: 'for i in range(100):\n    print("x" * 100)', opts: { printCallback: capped }, expect: raises('MemoryError') },
  ])
  report('captured output', out.output === 'hello\n', json(out.output), 0)
  report('captured before cap', undefined, `${capped.output.length} chars kept`, 0)

  await runCases(session, 'isolation (§9.5)', [
    { name: 'open() host file', code: 'open("/etc/hosts").read()', expect: raises() },
    { name: 'Path.read_text host file', code: 'from pathlib import Path\nPath("C:/Windows/win.ini").read_text()', expect: raises() },
    { name: 'os.environ', code: 'import os\nos.environ.get("PATH")', expect: (o) => !o.ok || o.value === null || o.value === undefined },
    { name: 'os.getenv', code: 'import os\nos.getenv("MODEL_API_KEY")', expect: (o) => !o.ok || o.value === null || o.value === undefined },
    { name: 'import socket', code: 'import socket', expect: raises() },
    { name: 'import subprocess', code: 'import subprocess', expect: raises() },
    { name: 'import urllib.request', code: 'import urllib.request', expect: raises() },
    { name: 'import pandas', code: 'import pandas', expect: raises() },
  ])

  t = Date.now()
  try {
    await session.installDependencies(['requests'])
    report('installDependencies refused', false, 'installed: this is not the pure-Monty worker', Date.now() - t)
  } catch (e) {
    report('installDependencies refused', e instanceof MontyRuntimeError, `${(e as Error).constructor.name}`, Date.now() - t)
  }
} finally {
  await session.close().catch(() => {})
}

// Every host call is a suspension; an over-budget feed is aborted. Does the session survive?
const tight = await pool.checkout({ limits: { ...LIMITS, maxSuspensions: 5 }, osPolicy: OS_POLICY })
await runCases(tight, 'maxSuspensions 5 (§9.4)', [
  { name: '10 host calls in a loop', code: 'n = 0\nfor i in range(10):\n    n += len(read_rows("holdings", 1))\nn', opts: { externalLookup: host }, expect: raises() },
  { name: 'session after suspension limit', code: '1 + 1' },
])
await tight.close().catch(() => {})

// Pool-level backstop: no in-sandbox duration limit, so only requestTimeout can stop the loop.
console.log('\n-- requestTimeout backstop (§9.4)')
t = Date.now()
const backstopPool = await Monty.create({ requestTimeout: 2, feedDurationLimitGrace: null, turnDurationLimitGrace: null })
const wedged = await backstopPool.checkout({ limits: { maxMemory: LIMITS.maxMemory, maxRecursionDepth: 200, maxSuspensions: 1000 } })
try {
  await wedged.feedRun('while True:\n    pass')
  report('requestTimeout kills worker', false, 'loop returned', Date.now() - t)
} catch (e) {
  const crashed = e instanceof MontyCrashedError && e.timedOut
  report('requestTimeout kills worker', crashed, `${(e as Error).constructor.name} timedOut=${(e as MontyCrashedError).timedOut}`, Date.now() - t)
}
await wedged.close().catch(() => {})
t = Date.now()
const fresh = await backstopPool.checkout({ limits: LIMITS })
report('pool replaces killed worker', JSON.stringify(await fresh.feedRun('1 + 1')) === '2', `new pid ${fresh.workerPid}`, Date.now() - t)
await fresh.close()
await backstopPool.close()
await pool.close()

console.log(`\n${failed === 0 ? 'All required checks passed' : `${failed} required check(s) failed`}`)
process.exit(failed === 0 ? 0 : 1)
