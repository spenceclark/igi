// Fixed-point decimal arithmetic on BigInt (spec §9.6). Values carry 12 decimal places internally and
// round half away from zero (Python's ROUND_HALF_UP). They enter and leave as decimal strings, never
// as JavaScript numbers.
export type Dec = bigint

const DP = 12
const SCALE = 10n ** BigInt(DP)
export const ZERO: Dec = 0n
export const ONE: Dec = SCALE

function divRound(n: bigint, d: bigint): bigint {
  if (d < 0n) [n, d] = [-n, -d]
  const q = n / d
  const r = n % d
  return 2n * (r < 0n ? -r : r) >= d ? q + (n < 0n ? -1n : 1n) : q
}

export function isDec(s: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(s.trim())
}

export function dec(s: string): Dec {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s.trim())
  if (!m) throw new Error(`not a decimal string: ${JSON.stringify(s)}`)
  const frac = m[3] ?? ''
  const digits = BigInt(m[2] + frac)
  const v = frac.length <= DP ? digits * 10n ** BigInt(DP - frac.length) : divRound(digits, 10n ** BigInt(frac.length - DP))
  return m[1] ? -v : v
}

/** Formats to exactly `dp` decimal places, rounding half away from zero. */
export function fmt(x: Dec, dp = 4): string {
  const v = divRound(x, 10n ** BigInt(DP - dp))
  const a = (v < 0n ? -v : v).toString().padStart(dp + 1, '0')
  const out = dp ? `${a.slice(0, -dp)}.${a.slice(-dp)}` : a
  return v < 0n ? `-${out}` : out
}

export const mul = (a: Dec, b: Dec): Dec => divRound(a * b, SCALE)
export const sum = (xs: Dec[]): Dec => xs.reduce((s, x) => s + x, 0n)
export const abs = (x: Dec): Dec => (x < 0n ? -x : x)

export function div(a: Dec, b: Dec): Dec {
  if (b === 0n) throw new Error('division by zero')
  return divRound(a * SCALE, b)
}
