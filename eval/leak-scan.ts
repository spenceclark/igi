// The isolation check run before every evaluation (spec §15.2). Fails if what the agent is told (the instructions,
// the tool definitions and the sources' schema descriptions) contains anything from an answer key: a planted figure,
// a fund, rule, action or portfolio id, or a fund name. Also fails if a scenario's file names give an issue away, or
// if anything under server/ imports eval/ or the generator.
// Run from the repository root: node eval/leak-scan.ts
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { INSTRUCTIONS } from '../server/src/agent.ts'
import { dec, fmt, mul } from '../server/src/decimal.ts'
import { importReview } from '../server/src/sources.ts'
import { TOOLS } from '../server/src/tools.ts'
import { ROOT, answerKeys, scenarioDir, type AnswerKey } from './answer-keys.ts'

// Words that would tell the agent what a file holds before it looks.
const REVEALING = /breach|exception|anomal|overdue|planted|expected|answer|issue|error|wrong|stale|mismatch|disagree|fault|problem/i
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** What may not appear, as [what it is, pattern] pairs. Figures match at a number's boundaries, names as words. */
function tokens(key: AnswerKey): [string, RegExp][] {
  const out: [string, RegExp][] = []
  const word = (what: string, s: string) => out.push([what, new RegExp(`(?<![\\w-])${escape(s)}(?![\\w-])`)])
  // A figure with decimals is caught bare (36.97 or 0.3697); a whole percentage only with its unit, since small
  // whole numbers turn up innocently in limits and examples.
  const figure = (what: string, n: string, unit = '') =>
    out.push([what, /\./.test(n) ? new RegExp(`(?<![\\d.])${escape(n)}(?!\\d)`) : new RegExp(`(?<![\\d.])${escape(n)}\\s*${unit || '(?:%|pp)'}`)])
  for (const [id, name] of Object.entries(key.instrumentIds)) {
    word('instrument id', id)
    word('fund name', name)
    word('fund name', name.split(' ')[0])
  }
  const portfolios = new Set(Object.keys(key.facts).map((k) => k.split('|')[0]))
  for (const p of portfolios) word('portfolio id', p)
  for (const b of key.expectedBreaches) word('rule id', b.split('|')[2])
  for (const i of [...key.issues, ...key.benign]) {
    if (i.rule) word('rule id', i.rule.split(' ')[0])
    if (i.action) word('action id', i.action)
  }
  // Each computed fact as a fraction and as a percentage, and each figure in the summaries.
  for (const v of Object.values(key.facts)) {
    figure('planted figure', v)
    const pct = fmt(mul(dec(v), dec('100')), 2)
    figure('planted figure', pct.endsWith('.00') ? pct.slice(0, -3) : pct, '%')
    if (!pct.endsWith('.00')) figure('planted figure', pct)
  }
  for (const s of [...key.issues, ...key.benign, ...key.distractors]) for (const m of s.summary.matchAll(/(-?\d+(?:\.\d+)?)(%|pp)/g)) figure('planted figure', m[1].replace(/^-/, ''), m[2])
  // The excess of each planted breach over its limit, in percentage points (1.23pp).
  const review = importReview(scenarioDir(key.scenario), key.scenario)
  const rules = review.sources.find((s) => s.id === 'policy_rules')?.rows ?? []
  for (const b of key.expectedBreaches) {
    const [portfolio, period, ruleId] = b.split('|')
    const rule = rules.find((r) => r.rule_id === ruleId && r.effective_from <= period && (!r.effective_to || r.effective_to >= period))
    const fact = rule && key.facts[`${portfolio}|${period}|${rule.metric}`]
    if (rule && fact) figure('planted breach margin', fmt(mul(dec(fact) - dec(rule.threshold), dec('100')), 2).replace(/^-/, ''))
  }
  return out
}

/** The problems found; none means the evaluation may run. */
export function leakScan(): string[] {
  const problems: string[] = []
  const keys = answerKeys()
  // What the agent is told about the data: each source kind's description and field descriptions, not its rows.
  const schema = keys.flatMap((k) => importReview(scenarioDir(k.scenario), k.scenario).sources.map((s) => `${s.description}\n${JSON.stringify(s.fields)}`))
  const told: [string, string][] = [['the instructions', INSTRUCTIONS], ['the tool definitions', JSON.stringify(TOOLS)], ['the source descriptions', [...new Set(schema)].join('\n')]]
  for (const key of keys)
    for (const [what, pattern] of tokens(key))
      for (const [where, text] of told) {
        const m = pattern.exec(text)
        if (m) problems.push(`${where} contain a ${what} from ${key.scenario}: "${text.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40).replace(/\s+/g, ' ')}"`)
      }
  for (const key of keys) for (const f of readdirSync(scenarioDir(key.scenario))) if (REVEALING.test(f)) problems.push(`${key.scenario} has a revealing file name: ${f}`)
  // server/ must never import eval/ or the generator, so answer keys can't reach a run (§15.2).
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.name === 'node_modules' ? [] : e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []))
  for (const file of walk(`${ROOT}server`)) {
    const text = readFileSync(file, 'utf8')
    if (/from\s+['"][^'"]*(?:\/eval\/|generate\.ts|answer-keys)/.test(text) || /answer-keys/.test(text)) problems.push(`${file.slice(ROOT.length)} refers to eval/ or the generator`)
  }
  return problems
}

if (import.meta.main) {
  const problems = leakScan()
  for (const p of problems) console.log(`LEAK ${p}`)
  console.log(problems.length ? `${problems.length} problems: fix them before evaluating.` : 'ok   no answer-key content in the instructions, tools or source descriptions; server/ is isolated from eval/')
  process.exit(problems.length ? 1 : 0)
}
