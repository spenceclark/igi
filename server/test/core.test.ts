import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dec, div, fmt, mul, sum } from '../src/decimal.ts'
import { parseCsv, toCsv } from '../src/csv.ts'
import { importReview } from '../src/sources.ts'
import { figureMatches } from '../src/tools.ts'

const SCENARIO = new URL('../../fixtures/scenarios/dev-01', import.meta.url)

test('import: a generated scenario validates clean', () => {
  const r = importReview(SCENARIO.pathname.replace(/^\/(\w:)/, '$1'), 'dev-01')
  assert.deepEqual(r.sources.flatMap((s) => s.issues), [])
  assert.equal(r.periodEnd, '2026-09-30')
})

test('import: tampered data is reported, never repaired', () => {
  const dir = mkdtempSync(join(tmpdir(), 'igi-'))
  cpSync(SCENARIO, dir, { recursive: true })
  const file = join(dir, 'positions.csv')
  const lines = readFileSync(file, 'utf8').split('\n')
  const cells = lines[1].split(',')
  cells[6] = '17.30' // percentage instead of fraction
  lines[1] = cells.join(',')
  lines.push(lines[2]) // duplicate row
  writeFileSync(file, lines.join('\n'))
  const issues = importReview(dir, 'tampered').sources.flatMap((s) => s.issues).join('\n')
  assert.match(issues, /possibly a percentage/)
  assert.match(issues, /duplicate/)
  assert.match(issues, /reported weights sum/)
})

test('findings: stated figures match check results at the stated precision', () => {
  const c = ['0.3697', '42148542.00', '-0.0050', '-0.0870', '0.0042', '92']
  for (const s of ['0.3697', '36.97%', '37%', '£42,148,542', '42,148,542.00', '-0.5pp', '-0.50 percentage points', '-8.70%', '0.42%', '92']) assert.ok(figureMatches(s, c), s)
  // Other units go in the label: '92 days' is not a figure.
  for (const s of ['38%', '0.38', '£42,148,000', '0.5pp', 'about 37%', '8.70%', '42%', '92 days']) assert.ok(!figureMatches(s, c), s)
})

test('decimal: rounding half away from zero, division, formatting', () => {
  assert.equal(fmt(dec('2.675'), 2), '2.68')
  assert.equal(fmt(dec('-2.675'), 2), '-2.68')
  assert.equal(fmt(dec('-0.00001'), 2), '0.00')
  assert.equal(fmt(div(dec('1'), dec('3')), 4), '0.3333')
  assert.equal(fmt(div(dec('2'), dec('3')), 4), '0.6667')
  assert.equal(fmt(mul(dec('0.1250'), dec('0.40')), 4), '0.0500')
  assert.equal(fmt(sum([dec('0.1'), dec('0.2')]), 1), '0.3')
  assert.equal(fmt(dec('1234567.891'), 0), '1234568')
  assert.throws(() => dec('1e5'))
  assert.throws(() => div(dec('1'), dec('0')))
})

test('csv: round trip with quotes, commas and newlines', () => {
  const recs = [{ a: 'x, "y"', b: 'line1\nline2' }, { a: '', b: 'z' }]
  const rows = parseCsv(toCsv(['a', 'b'], recs))
  assert.deepEqual(rows, [['a', 'b'], ['x, "y"', 'line1\nline2'], ['', 'z']])
})
