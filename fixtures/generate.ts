// Development scenario generator (spec §7, §15.2). Writes neutral source files to
// fixtures/scenarios/<name>/ as CSV, the same rows as XLSX, PDF and DOCX documents to
// fixtures/scenarios/<name>-docs/ (documents.ts), and the answer key for each to eval/answer-keys/.
// The server never imports this file or reads eval/.
// Run from the repository root: node fixtures/generate.ts [name ...]
import { mkdirSync, writeFileSync } from 'node:fs'
import { abs, dec, div, fmt, mul, sum, type Dec } from '../server/src/decimal.ts'
import { toCsv } from '../server/src/csv.ts'
import { closeRenderer } from '../server/src/render.ts'
import { writeDocuments } from './documents.ts'

const Q2 = '2026-06-30'
const Q3 = '2026-09-30'
const PERIODS = [Q2, Q3]
const CHANGE_DATE = '2026-07-01'

type Fund = { name: string; type: string; lt: Record<string, string>; ocf: [string, string] }
const FUNDS: Record<string, Fund> = {
  F01: { name: 'Northgate UK Equity Index', type: 'Equity', lt: { equity: '0.98', cash: '0.02' }, ocf: ['0.0006', '0.0006'] },
  F02: { name: 'Harrow Global Equity', type: 'Equity', lt: { equity: '0.97', cash: '0.03' }, ocf: ['0.0015', '0.0015'] },
  F03: { name: 'Mardale Emerging Markets Equity', type: 'Equity', lt: { equity: '0.96', cash: '0.04' }, ocf: ['0.0035', '0.0035'] },
  F04: { name: 'Calder Sterling Corporate Bond', type: 'Fixed income', lt: { bonds: '0.96', cash: '0.04' }, ocf: ['0.0012', '0.0012'] },
  F05: { name: 'Ashby Gilt Index', type: 'Fixed income', lt: { bonds: '0.99', cash: '0.01' }, ocf: ['0.0010', '0.0010'] },
  F06: { name: 'Ouse Short-Dated Bond', type: 'Fixed income', lt: { bonds: '0.97', cash: '0.03' }, ocf: ['0.0014', '0.0014'] },
  F07: { name: 'Wensley Multi-Asset Income', type: 'Multi-asset', lt: { equity: '0.45', bonds: '0.40', property: '0.08', cash: '0.07' }, ocf: ['0.0055', '0.0055'] },
  F08: { name: 'Fenwick Strategic Multi-Asset', type: 'Multi-asset', lt: { equity: '0.55', bonds: '0.30', alternatives: '0.10', cash: '0.05' }, ocf: ['0.0085', '0.0085'] },
  F09: { name: 'Tarn Property Securities', type: 'Property', lt: { property: '0.95', cash: '0.05' }, ocf: ['0.0040', '0.0042'] },
  F10: { name: 'Brackley Absolute Return', type: 'Alternatives', lt: { alternatives: '0.70', bonds: '0.20', cash: '0.10' }, ocf: ['0.0075', '0.0075'] },
  F11: { name: 'Kentmere Global Equity Income', type: 'Equity', lt: { equity: '0.95', cash: '0.05' }, ocf: ['0.0045', '0.0045'] },
  F12: { name: 'Sterling Cash', type: 'Cash', lt: { cash: '1.00' }, ocf: ['0.0000', '0.0000'] },
}
const BOND_FUNDS = ['F04', 'F05', 'F06']

const PORTFOLIOS = [
  { id: 'P-CAU', short: 'CAU', name: 'Cautious', section: 3, objective: 'Capital preservation with modest real growth', benchmark: 'Composite: 30% global equity, 60% sterling bonds, 10% cash', total: '42600000' },
  { id: 'P-BAL', short: 'BAL', name: 'Balanced', section: 4, objective: 'Long-term growth with moderate volatility', benchmark: 'Composite: 55% global equity, 35% sterling bonds, 10% alternatives', total: '118400000' },
  { id: 'P-GRO', short: 'GRO', name: 'Growth', section: 5, objective: 'Long-term capital growth', benchmark: 'Composite: 80% global equity, 15% sterling bonds, 5% alternatives', total: '76900000' },
]
// Limits as fractions: equity [min, max], single holding max, cash max.
const LIMITS: Record<string, { eq: [string | null, string]; single: string; cash: string }> = {
  'P-CAU': { eq: [null, '0.3500'], single: '0.2500', cash: '0.1000' },
  'P-BAL': { eq: ['0.4000', '0.6500'], single: '0.2500', cash: '0.1000' },
  'P-GRO': { eq: ['0.6000', '0.9000'], single: '0.3000', cash: '0.1000' },
}
const REL_TOLERANCE = '0.0150'

type Bp = Record<string, number>
type Action = { action: string; owner: string; due: string; status: string; notes: string; verify?: { portfolio: string; fund: string; kind: 'reduce' | 'replace'; max?: string } }
type Scenario = {
  seed: number
  holdings: Record<string, [Bp, Bp]>
  returns: Record<string, [[string, string], [string, string]]>
  policyChange: { portfolio: string; newLimit: string }
  docMismatch?: { portfolio: string; clause: string; docValue: string }
  actions: Action[]
  expectedBreaches: string[]
  answers: { issues: object[]; benign: object[]; distractors: object[] }
}

const SCENARIOS: Record<string, Scenario> = {
  'dev-01': {
    seed: 101,
    holdings: {
      'P-CAU': [
        { F05: 1700, F04: 1500, F06: 1200, F01: 1000, F02: 700, F07: 1700, F08: 1700, F12: 500 },
        { F05: 1500, F04: 1200, F06: 1000, F01: 1000, F02: 600, F07: 2300, F08: 2000, F12: 400 },
      ],
      'P-BAL': [
        { F02: 2150, F01: 1400, F11: 1100, F04: 1500, F05: 1300, F07: 900, F09: 800, F10: 550, F12: 300 },
        { F02: 2250, F01: 1400, F11: 1100, F04: 1600, F05: 1350, F07: 900, F09: 550, F10: 550, F12: 300 },
      ],
      'P-GRO': [
        { F01: 2400, F02: 2600, F03: 1000, F11: 1200, F08: 800, F09: 700, F04: 800, F12: 500 },
        { F01: 2350, F02: 2550, F03: 950, F11: 1250, F08: 800, F09: 700, F04: 850, F12: 550 },
      ],
    },
    returns: {
      'P-CAU': [['0.0110', '0.0100'], ['-0.0140', '-0.0110']],
      'P-BAL': [['0.0240', '0.0220'], ['-0.0390', '-0.0350']],
      'P-GRO': [['0.0360', '0.0390'], ['-0.0870', '-0.0820']],
    },
    policyChange: { portfolio: 'P-BAL', newLimit: '0.2000' },
    actions: [
      { action: 'Replace Fenwick Strategic Multi-Asset in the Cautious portfolio with a lower-cost multi-asset fund.', owner: 'Investment Manager', due: '2026-09-30', status: 'In progress', notes: 'Shortlist of three alternatives presented.', verify: { portfolio: 'P-CAU', fund: 'F08', kind: 'replace' } },
      { action: 'Reduce Tarn Property Securities in the Balanced portfolio to no more than 6%.', owner: 'Investment Manager', due: '2026-09-30', status: 'Completed', notes: '', verify: { portfolio: 'P-BAL', fund: 'F09', kind: 'reduce', max: '0.0600' } },
      { action: 'Review provider fee schedules for all multi-asset funds held.', owner: 'Head of Investments', due: '2026-12-31', status: 'Open', notes: '' },
      { action: "Notify the Committee if any portfolio's quarterly return is below -5.0%.", owner: 'Investment Manager', due: '', status: 'Standing', notes: 'Standing instruction.' },
    ],
    expectedBreaches: ['P-CAU|2026-09-30|CAU-EQ-MAX', 'P-BAL|2026-09-30|BAL-SH'],
    answers: {
      issues: [
        { id: 'I1', type: 'lookthrough_equity_breach', portfolio: 'P-CAU', period: Q3, rule: 'CAU-EQ-MAX v1', expected: ['potential_exception'], summary: 'Look-through equity exposure exceeds 35% although only 16% is held in funds classified as equity; the multi-asset funds carry the rest.' },
        { id: 'I2', type: 'limit_breach_after_policy_change', portfolio: 'P-BAL', period: Q3, rule: 'BAL-SH v2', expected: ['potential_exception'], summary: 'Largest holding (Harrow Global Equity) exceeds the 20% single-holding limit in force from 1 July 2026; it was within the previous 25% limit.' },
        { id: 'I3', type: 'overdue_committee_action', portfolio: 'P-CAU', period: Q3, expected: ['outstanding_action', 'potential_exception', 'observation'], summary: 'Action to replace Fenwick Strategic Multi-Asset was due 30 September 2026 and is still in progress; the fund is still held, at a larger weight, and is the highest-cost fund in the portfolio.' },
      ],
      benign: [
        { id: 'B1', type: 'market_driven_fall', portfolio: 'P-GRO', period: Q3, must_not_be: ['potential_exception'], summary: 'Growth returned -8.7% in Q3, below the -5% notification level, but its benchmark returned -8.2%: within the 1.5pp tolerance and market-driven. Notify the Committee; not a breach.' },
      ],
      distractors: [
        { id: 'D1', summary: 'Tarn Property Securities reduction in Balanced is complete and consistent with Q3 holdings (5.5%).' },
        { id: 'D2', summary: 'Fee review action is not yet due.' },
        { id: 'D3', summary: 'Tarn Property Securities ongoing charge rose from 0.40% to 0.42%; no policy limit applies.' },
      ],
    },
  },
  'dev-02': {
    seed: 202,
    holdings: {
      'P-CAU': [
        { F05: 2300, F04: 2000, F06: 1500, F01: 1000, F02: 800, F07: 1200, F10: 800, F12: 400 },
        { F05: 2100, F04: 2200, F06: 2100, F01: 1100, F02: 800, F07: 1300, F12: 400 },
      ],
      'P-BAL': [
        { F01: 1800, F02: 1800, F11: 1300, F03: 400, F07: 1200, F08: 1000, F04: 1400, F05: 800, F12: 300 },
        { F01: 1900, F02: 1900, F11: 1300, F03: 500, F07: 1500, F08: 1400, F04: 900, F05: 400, F12: 200 },
      ],
      'P-GRO': [
        { F02: 2700, F01: 2100, F03: 1300, F11: 1100, F08: 800, F09: 700, F04: 800, F12: 500 },
        { F02: 2750, F01: 2050, F03: 1300, F11: 1100, F08: 800, F09: 700, F04: 800, F12: 500 },
      ],
    },
    returns: {
      'P-CAU': [['0.0090', '0.0080'], ['-0.0120', '-0.0100']],
      'P-BAL': [['0.0260', '0.0240'], ['-0.0620', '-0.0580']],
      'P-GRO': [['0.0410', '0.0380'], ['-0.0410', '-0.0380']],
    },
    policyChange: { portfolio: 'P-GRO', newLimit: '0.2500' },
    docMismatch: { portfolio: 'P-CAU', clause: 'cash', docValue: '0.0800' },
    actions: [
      { action: 'Reduce Mardale Emerging Markets Equity in the Growth portfolio to no more than 10%.', owner: 'Investment Manager', due: '2026-09-30', status: 'Open', notes: '', verify: { portfolio: 'P-GRO', fund: 'F03', kind: 'reduce', max: '0.1000' } },
      { action: 'Replace Brackley Absolute Return in the Cautious portfolio with lower-risk fixed income.', owner: 'Investment Manager', due: '2026-09-30', status: 'Completed', notes: 'Proceeds split between Calder Sterling Corporate Bond and Ouse Short-Dated Bond.', verify: { portfolio: 'P-CAU', fund: 'F10', kind: 'replace' } },
      { action: 'Review provider fee schedules for all multi-asset funds held.', owner: 'Head of Investments', due: '2026-12-31', status: 'Open', notes: '' },
      { action: "Notify the Committee if any portfolio's quarterly return is below -5.0%.", owner: 'Investment Manager', due: '', status: 'Standing', notes: 'Standing instruction.' },
    ],
    expectedBreaches: ['P-BAL|2026-09-30|BAL-EQ-MAX', 'P-GRO|2026-09-30|GRO-SH'],
    answers: {
      issues: [
        { id: 'I1', type: 'lookthrough_equity_breach', portfolio: 'P-BAL', period: Q3, rule: 'BAL-EQ-MAX v1', expected: ['potential_exception'], summary: 'Look-through equity exposure exceeds the 65% maximum although funds classified as equity are 56%; the multi-asset funds carry the rest.' },
        { id: 'I2', type: 'limit_breach_after_policy_change', portfolio: 'P-GRO', period: Q3, rule: 'GRO-SH v2', expected: ['potential_exception'], summary: 'Largest holding (Harrow Global Equity) exceeds the 25% single-holding limit in force from 1 July 2026; it was within the previous 30% limit.' },
        { id: 'I3', type: 'overdue_committee_action', portfolio: 'P-GRO', period: Q3, expected: ['outstanding_action', 'potential_exception', 'observation'], summary: 'Action to reduce Mardale Emerging Markets Equity in Growth to no more than 10% was due 30 September 2026 and is still open; the holding is 13%.' },
        { id: 'I4', type: 'policy_document_table_disagreement', portfolio: 'P-CAU', expected: ['policy_inconsistency'], summary: 'The policy document sets the Cautious cash limit at 8%; the structured rules table says 10%.' },
      ],
      benign: [
        { id: 'B1', type: 'market_driven_fall', portfolio: 'P-BAL', period: Q3, must_not_be: ['potential_exception'], summary: 'Balanced returned -6.2% in Q3, below the -5% notification level, but its benchmark returned -5.8%: within the 1.5pp tolerance and market-driven. Notify the Committee; not a breach.' },
      ],
      distractors: [
        { id: 'D1', summary: 'Brackley Absolute Return replacement in Cautious is complete; the fund is no longer held.' },
        { id: 'D2', summary: 'Fee review action is not yet due.' },
        { id: 'D3', summary: 'Tarn Property Securities ongoing charge rose from 0.40% to 0.42%; no policy limit applies.' },
      ],
    },
  },
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pct = (f: string) => `${fmt(mul(dec(f), dec('100')), 1).replace(/\.0$/, '')}%`
const assert = (ok: boolean, msg: string) => {
  if (!ok) throw new Error(`incoherent scenario: ${msg}`)
}

async function generate(name: string, s: Scenario) {
  const rng = mulberry32(s.seed)
  const ids: Record<string, string> = {}
  for (const k of Object.keys(FUNDS)) {
    const code = Array.from({ length: 9 }, () => '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'[Math.floor(rng() * 36)]).join('')
    ids[k] = `ZZ${code}${Math.floor(rng() * 10)}`
  }

  // Policy rules, with one portfolio's single-holding limit cut from 1 July 2026.
  const rules: Record<string, string>[] = []
  const rule = (rule_id: string, version: string, portfolio_id: string, metric: string, limit_type: string, threshold: string, basis: string, from: string, to: string, methodology: string, clause: string) =>
    rules.push({ rule_id, version, portfolio_id, metric, limit_type, threshold, basis, effective_from: from, effective_to: to, methodology, document_clause: clause })
  const LT = 'Sum over holdings of portfolio weight multiplied by the fund look-through exposure to the asset class, at the period end.'
  const DIRECT = 'Holding market value divided by total portfolio market value, at the period end.'
  for (const p of PORTFOLIOS) {
    const l = LIMITS[p.id]
    if (l.eq[0]) rule(`${p.short}-EQ-MIN`, '1', p.id, 'equity_exposure', 'min', l.eq[0], 'look-through', '2026-01-01', '', LT, `${p.section}.1`)
    rule(`${p.short}-EQ-MAX`, '1', p.id, 'equity_exposure', 'max', l.eq[1], 'look-through', '2026-01-01', '', LT, `${p.section}.1`)
    if (s.policyChange.portfolio === p.id) {
      rule(`${p.short}-SH`, '1', p.id, 'single_holding_weight', 'max', l.single, 'direct', '2026-01-01', '2026-06-30', DIRECT, `${p.section}.2`)
      rule(`${p.short}-SH`, '2', p.id, 'single_holding_weight', 'max', s.policyChange.newLimit, 'direct', CHANGE_DATE, '', DIRECT, `${p.section}.2`)
    } else rule(`${p.short}-SH`, '1', p.id, 'single_holding_weight', 'max', l.single, 'direct', '2026-01-01', '', DIRECT, `${p.section}.2`)
    rule(`${p.short}-CASH`, '1', p.id, 'cash_exposure', 'max', l.cash, 'look-through', '2026-01-01', '', LT, `${p.section}.3`)
  }
  rule('ALL-REL', '1', 'ALL', 'relative_return_deviation', 'max', REL_TOLERANCE, 'quarterly', '2026-01-01', '', "Absolute difference between the portfolio's quarterly return and its benchmark's quarterly return.", '6.1')

  // Positions, with a small seeded shift between two bond funds and seeded portfolio totals.
  const positions: Record<string, string>[] = []
  const weights: Record<string, Record<string, Dec>> = {}
  const totals: Record<string, Dec> = {}
  for (const p of PORTFOLIOS) {
    let total = dec(p.total) + dec(String(Math.round((rng() - 0.5) * 0.08 * Number(p.total) / 1000) * 1000))
    PERIODS.forEach((period, i) => {
      if (i === 1) total = mul(total, dec('1') + dec(s.returns[p.id][1][0]))
      const bp = { ...s.holdings[p.id][i] }
      assert(Object.values(bp).reduce((a, b) => a + b, 0) === 10000, `${p.id} ${period} weights do not sum to 100%`)
      const bonds = BOND_FUNDS.filter((f) => bp[f])
      if (bonds.length >= 2) {
        const m = Math.floor(rng() * 61)
        bp[bonds[0]] -= m
        bp[bonds[1]] += m
      }
      const mv = Object.entries(bp).map(([f, w]) => [f, dec(fmt(mul(total, div(dec(String(w)), dec('10000'))), 2))] as const)
      const sumMv = sum(mv.map(([, v]) => v))
      totals[`${p.id}|${period}`] = sumMv
      const w: Record<string, Dec> = {}
      for (const [f, v] of mv) {
        w[f] = div(v, sumMv)
        positions.push({ portfolio_id: p.id, period_end: period, instrument_id: ids[f], instrument_name: FUNDS[f].name, fund_type: FUNDS[f].type, market_value_gbp: fmt(v, 2), reported_weight: fmt(w[f], 4) })
      }
      weights[`${p.id}|${period}`] = w
    })
  }

  // Evaluate every rule at every period end; the breaches must be exactly the planted ones, and
  // every other result must clear its limit by a margin so the scenario has no borderline cases.
  const breaches: string[] = []
  const facts: Record<string, string> = {}
  for (const p of PORTFOLIOS) {
    PERIODS.forEach((period, i) => {
      const w = weights[`${p.id}|${period}`]
      const exposure = (cls: string) => sum(Object.entries(w).map(([f, x]) => mul(x, dec(FUNDS[f].lt[cls] ?? '0'))))
      const values: Record<string, Dec> = {
        equity_exposure: exposure('equity'),
        cash_exposure: exposure('cash'),
        single_holding_weight: Object.values(w).reduce((a, b) => (b > a ? b : a), 0n),
        relative_return_deviation: abs(dec(s.returns[p.id][i][0]) - dec(s.returns[p.id][i][1])),
      }
      for (const [k, v] of Object.entries(values)) facts[`${p.id}|${period}|${k}`] = fmt(v, 4)
      for (const r of rules) {
        if ((r.portfolio_id !== p.id && r.portfolio_id !== 'ALL') || r.effective_from > period || (r.effective_to && r.effective_to < period)) continue
        const v = values[r.metric]
        const margin = r.limit_type === 'max' ? dec(r.threshold) - v : v - dec(r.threshold)
        const minMargin = dec(r.metric === 'relative_return_deviation' ? '0.0050' : '0.0100')
        if (margin < 0n) {
          breaches.push(`${p.id}|${period}|${r.rule_id}`)
          assert(-margin >= minMargin, `${p.id} ${period} ${r.rule_id} breached by only ${fmt(-margin, 4)}`)
        } else assert(margin >= minMargin, `${p.id} ${period} ${r.rule_id} within limit by only ${fmt(margin, 4)}`)
      }
    })
  }
  assert(JSON.stringify(breaches.sort()) === JSON.stringify([...s.expectedBreaches].sort()), `breaches ${breaches} differ from planted ${s.expectedBreaches}`)

  // Committee actions must be consistent with the holdings they describe.
  const actions = s.actions.map((a, i) => {
    if (a.verify) {
      const w = weights[`${a.verify.portfolio}|${Q3}`][a.verify.fund]
      const done = a.verify.kind === 'replace' ? w === undefined : w !== undefined && w <= dec(a.verify.max!)
      assert(done === (a.status === 'Completed'), `action ${i + 1} status ${a.status} contradicts Q3 holdings`)
    }
    return { action_id: `A-2026-07-${String(i + 1).padStart(2, '0')}`, meeting_date: '2026-07-15', action: a.action, owner: a.owner, due_date: a.due, status: a.status, notes: a.notes }
  })

  const lookthrough: Record<string, string>[] = []
  const fees: Record<string, string>[] = []
  const held = new Set(Object.values(weights).flatMap((w) => Object.keys(w)))
  for (const f of Object.keys(FUNDS).filter((k) => held.has(k)))
    PERIODS.forEach((period, i) => {
      for (const [cls, x] of Object.entries(FUNDS[f].lt)) lookthrough.push({ instrument_id: ids[f], as_of: period, asset_class: cls, exposure_weight: fmt(dec(x), 4) })
      fees.push({ instrument_id: ids[f], period_end: period, ongoing_charge: FUNDS[f].ocf[i] })
    })

  const dir = `fixtures/scenarios/${name}`
  mkdirSync(dir, { recursive: true })
  mkdirSync('eval/answer-keys', { recursive: true })
  const write = (file: string, text: string) => writeFileSync(`${dir}/${file}`, text)
  write('portfolios.csv', toCsv(['portfolio_id', 'portfolio_name', 'objective', 'benchmark'], PORTFOLIOS.map((p) => ({ portfolio_id: p.id, portfolio_name: p.name, objective: p.objective, benchmark: p.benchmark }))))
  write('positions.csv', toCsv(Object.keys(positions[0]), positions))
  write('lookthrough.csv', toCsv(Object.keys(lookthrough[0]), lookthrough))
  write('performance.csv', toCsv(['portfolio_id', 'period_end', 'portfolio_return', 'benchmark_return'], PORTFOLIOS.flatMap((p) => PERIODS.map((period, i) => ({ portfolio_id: p.id, period_end: period, portfolio_return: s.returns[p.id][i][0], benchmark_return: s.returns[p.id][i][1] })))))
  write('fees.csv', toCsv(Object.keys(fees[0]), fees))
  write('committee_actions.csv', toCsv(Object.keys(actions[0]), actions))
  write('policy_rules.csv', toCsv(Object.keys(rules[0]), rules))
  write('investment_policy.md', policyDocument(s))
  const performance = PORTFOLIOS.flatMap((p) => PERIODS.map((period, i) => ({ portfolio_id: p.id, period_end: period, portfolio_return: s.returns[p.id][i][0], benchmark_return: s.returns[p.id][i][1] })))
  const portfolios = PORTFOLIOS.map((p) => ({ portfolio_id: p.id, portfolio_name: p.name, objective: p.objective, benchmark: p.benchmark }))
  await writeDocuments(`${dir}-docs`, { portfolios, positions, performance, lookthrough, fees, actions, rules, policy: policyDocument(s) })
  // The same answer key for both folders: they hold the same data.
  for (const scenario of [name, `${name}-docs`]) {
    const key = { scenario, seed: s.seed, instrumentIds: Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, FUNDS[k].name])), expectedBreaches: s.expectedBreaches, facts, ...s.answers }
    writeFileSync(`eval/answer-keys/${scenario}.json`, JSON.stringify(key, null, 2) + '\n')
  }
  console.log(`${name}: ${positions.length} positions, breaches ${breaches.join(', ')}`)
}

function policyDocument(s: Scenario): string {
  const change = PORTFOLIOS.find((p) => p.id === s.policyChange.portfolio)!
  const cashLimit = (id: string) => (s.docMismatch?.portfolio === id && s.docMismatch.clause === 'cash' ? s.docMismatch.docValue : LIMITS[id].cash)
  const section = (p: (typeof PORTFOLIOS)[number]) => {
    const l = LIMITS[p.id]
    const eq = l.eq[0] ? `Equity exposure must be at least ${pct(l.eq[0])} and no more than ${pct(l.eq[1])}.` : `Equity exposure must not exceed ${pct(l.eq[1])}.`
    const single = p.id === change.id
      ? `No single holding may exceed ${pct(s.policyChange.newLimit)} of the portfolio (${pct(l.single)} until 30 June 2026).`
      : `No single holding may exceed ${pct(l.single)} of the portfolio.`
    return `## ${p.section}. ${p.name} portfolio\n\nObjective: ${p.objective.toLowerCase()}.\n\n${p.section}.1 ${eq}\n\n${p.section}.2 ${single}\n\n${p.section}.3 Cash exposure must not exceed ${pct(cashLimit(p.id))}.\n`
  }
  return `# Investment Governance Policy: Model Portfolios

Approved by the Investment Committee. Amended with effect from 1 July 2026.

## 1. Purpose

This policy sets the limits that apply to the firm's three model portfolios and how compliance with them is measured. The Investment Committee reviews compliance at each quarter end.

## 2. Measurement

2.1 Asset-class exposures are measured on a look-through basis: each holding's weight in the portfolio is multiplied by the underlying fund's exposure to the asset class, using the fund's look-through data at the period end, and the results are summed across holdings.

2.2 Single-holding weights are measured directly: the holding's market value divided by the portfolio's total market value.

2.3 Limits are tested at each quarter end against the version of this policy in force on that date.

2.4 Where a limit is exceeded, the Investment Manager reports it to the Committee with a remediation plan.

${PORTFOLIOS.map(section).join('\n')}
## 6. Performance monitoring

6.1 Each portfolio's quarterly return should be within ${fmt(mul(dec(REL_TOLERANCE), dec('100')), 1)} percentage points of its benchmark's quarterly return. A larger difference is reported to the Committee with an explanation.

## 7. Amendments

- 1 July 2026: the single-holding limit for the ${change.name} portfolio was reduced from ${pct(LIMITS[change.id].single)} to ${pct(s.policyChange.newLimit)} (section ${change.section}.2).
`
}

const names = process.argv.slice(2)
for (const name of names.length ? names : Object.keys(SCENARIOS)) await generate(name, SCENARIOS[name])
await closeRenderer()
