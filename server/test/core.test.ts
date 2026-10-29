import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dec, div, fmt, mul, sum } from '../src/decimal.ts'
import { parseCsv, toCsv } from '../src/csv.ts'
import { importReview, periodProblem } from '../src/sources.ts'
import { runCheck } from '../src/checks.ts'
import { callTool, type RunState } from '../src/tools.ts'
import { parseFigure, proseFigures, sameFigure, type Unit } from '../src/evidence.ts'
import { route, useVessel } from '../src/model.ts'

const SCENARIO = new URL('../../fixtures/scenarios/dev-01', import.meta.url)

test('import: a generated scenario validates clean', () => {
  const r = importReview(SCENARIO.pathname.replace(/^\/(\w:)/, '$1'), 'dev-01')
  assert.deepEqual(r.sources.flatMap((s) => s.issues), [])
  assert.equal(r.periodEnd, '2026-09-30')
})

test('import: the sources are read for the review’s own period end, never the latest date in them', () => {
  const dir = SCENARIO.pathname.replace(/^\/(\w:)/, '$1')
  const latest = importReview(dir, 'r')
  // A later period than the data holds: nothing to investigate, and said so.
  const later = importReview(dir, 'r', '2026-12-31')
  assert.equal(later.periodEnd, '2026-12-31')
  assert.match(periodProblem(later)!, /no positions at the review's period end 2026-12-31/)
  assert.match(later.sources.flatMap((s) => s.issues).join('\n'), /no positions at the review's period end/)
  // An earlier period: that period is analysed, and positions after it are reported.
  const earlier = importReview(dir, 'r', latest.periods.at(-2))
  assert.equal(periodProblem(earlier), undefined)
  assert.deepEqual(earlier.periods, latest.periods.slice(0, -1))
  assert.match(earlier.sources.flatMap((s) => s.issues).join('\n'), new RegExp(`is after the review's period end ${latest.periods.at(-2)}`))
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

test('import and checks: an asset class labelled differently from its rule is reported, never measured as zero', () => {
  const dir = mkdtempSync(join(tmpdir(), 'igi-'))
  cpSync(SCENARIO, dir, { recursive: true })
  const file = join(dir, 'lookthrough.csv')
  writeFileSync(file, readFileSync(file, 'utf8').replaceAll(',equity,', ',Equity,'))
  const review = importReview(dir, 'relabelled')
  assert.match(review.sources.flatMap((s) => s.issues).join('\n'), /equity_exposure names asset class equity, which no look-through row at \S+ has \(classes: .*Equity/)
  const portfolio = review.sources.find((s) => s.id === 'portfolios')!.rows[0].portfolio_id
  assert.throws(() => runCheck(review, { check: 'lookthrough_exposure', portfolio_id: portfolio, asset_class: 'equity' }), /no look-through row at \S+ has asset class "equity"; the classes there are .*Equity/)
  assert.throws(() => runCheck(review, { check: 'lookthrough_exposure', portfolio_id: portfolio, asset_class: 'equities' }), /asset class "equities"/)
})

test('findings: a stated figure matches an exact value in its unit, at the precision stated', () => {
  const matches = (s: string, exact: string, unit: Unit, ignoreSign = false) => {
    const f = parseFigure(s)
    return !!f && sameFigure(f, dec(exact), unit, ignoreSign)
  }
  for (const [s, exact, unit] of [['36.97%', '0.3697', 'fraction'], ['37%', '0.3697', 'fraction'], ['0.3697', '0.3697', 'fraction'], ['£42,148,542', '42148542.00', 'gbp'], ['-0.5pp', '-0.0050', 'points'], ['-0.50 percentage points', '-0.0050', 'points'], ['2 bps', '0.0002', 'points'], ['-8.70%', '-0.0870', 'fraction'], ['−8.70%', '-0.0870', 'fraction'], ['0.42%', '0.0042', 'fraction']] as const)
    assert.ok(matches(s, exact, unit), s)
  // A percentage is not a percentage-point difference, a sign counts, and other units are not figures.
  for (const [s, exact, unit] of [['-0.50%', '-0.0050', 'points'], ['0.50pp', '0.0050', 'fraction'], ['38%', '0.3697', 'fraction'], ['8.70%', '-0.0870', 'fraction'], ['£42,148,000', '42148542.00', 'gbp'], ['92 days', '92', 'count']] as const)
    assert.ok(!matches(s, exact, unit), s)
  assert.ok(matches('8.70%', '-0.0870', 'fraction', true), 'unsigned prose may describe a negative value in words')
  // In prose, dates, identifiers, clause references and plain counts are not material figures.
  assert.deepEqual(proseFigures('On 30 September 2026 (A-2026-07-04, C7, clause 2.4, s4.2, per policy 2.4 and 7.1) 3 portfolios were 36.97%, −1.97pp and £1,000.00; 0.3697 too.').map((f) => f.text), ['36.97%', '−1.97pp', '£1,000.00', '0.3697'])
})

test('findings: each names the review area that decides its step in Cairn', async () => {
  const review = importReview(SCENARIO.pathname.replace(/^\/(\w:)/, '$1'), 'dev-01')
  const state: RunState = { review, now: new Date(), executions: [], checks: [], notes: [], findings: [], maxPython: 0 }
  await callTool(state, 'run_check', { check: 'holding_concentration', portfolio_id: 'P-CAU' })
  const args = { title: 'Largest holding', statement: 'Within its limit.', classification: 'observation', materiality: 'low', portfolios: ['P-CAU'], explanation: 'For completeness.', check_ids: ['C1'] }
  await assert.rejects(callTool(state, 'propose_finding', args), /review_area must be one of source_data, allocation_risk, funds_fees, committee_actions/)
  await assert.rejects(callTool(state, 'propose_finding', { ...args, review_area: 'fees' }), /review_area must be one of/)
  await callTool(state, 'propose_finding', { ...args, review_area: 'funds_fees' })
  assert.deepEqual(state.findings.map((f) => [f.id, f.review_area]), [['F1', 'funds_fees']])
})

test('model: requests go to Meta directly, or through Vessel with a tag and session only once asked', () => {
  // Direct by default, with no Vessel headers; useVessel switches the base URL and the headers together.
  assert.deepEqual(route('spark', 'run-1').headers, {})
  assert.doesNotMatch(route('spark').base, /\/b\/meta\//)
  useVessel('http://127.0.0.1:4550/')
  assert.deepEqual(route('spark', 'run-1'), { base: 'http://127.0.0.1:4550/b/meta/v1', headers: { 'X-Vessel-Tags': 'spark', 'X-Vessel-Session': 'run-1' } })
  assert.deepEqual(route('probe').headers, { 'X-Vessel-Tags': 'probe' })
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
