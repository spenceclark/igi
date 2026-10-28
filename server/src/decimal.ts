// Fixed-point decimal arithmetic on BigInt (spec §9.6). Values carry 12 decimal places internally and
// round half away from zero (Python's ROUND_HALF_UP). They enter and leave as decimal strings, never
// as JavaScript numbers.
// A decimal as a count of 10^-12 units: 1.5 is 1_500_000_000_000n.
export type Dec = bigint

const DP = 12
const SCALE = 10n ** BigInt(DP)
export const ZERO: Dec = 0n
export const ONE: Dec = SCALE

/** Integer division rounding half away from zero: the one rounding rule every operation here uses. */
function divRound(n: bigint, d: bigint): bigint {
  // Make the divisor positive, then step the truncated quotient away from zero when the remainder is at least half.
  if (d < 0n) [n, d] = [-n, -d]
  const q = n / d
  const r = n % d
  return 2n * (r < 0n ? -r : r) >= d ? q + (n < 0n ? -1n : 1n) : q
}

/** Whether a string is a plain decimal: optional minus, digits, optional fraction. No exponent, comma or plus sign. */
export function isDec(s: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(s.trim())
}

/** Parses a decimal string, rounding digits beyond 12 places. Throws on anything isDec rejects. */
export function dec(s: string): Dec {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s.trim())
  if (!m) throw new Error(`not a decimal string: ${JSON.stringify(s)}`)
  const frac = m[3] ?? ''
  // All the digits as one integer, then shifted to 12 places: padded with zeros, or rounded when longer.
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

// A product carries 24 places (12 from each factor), so it is scaled back and rounded; sums and absolute values
// need no rescaling.
export const mul = (a: Dec, b: Dec): Dec => divRound(a * b, SCALE)
export const sum = (xs: Dec[]): Dec => xs.reduce((s, x) => s + x, 0n)
export const abs = (x: Dec): Dec => (x < 0n ? -x : x)

/** a / b to 12 places, rounded: a is scaled up first so the quotient keeps its places. Throws on division by zero. */
export function div(a: Dec, b: Dec): Dec {
  if (b === 0n) throw new Error('division by zero')
  return divRound(a * SCALE, b)
}
