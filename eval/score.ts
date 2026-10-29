// Scores saved investigation runs against the answer keys (spec §15.3, §15.4). Reads runs from IGI's database and
// never changes them. A finding is matched to a planted issue by the evidence it cites (the rule version, committee
// action or check the answer key names) and the portfolio, never by its wording; the classification then decides
// whether the issue counts as found. Every check is re-run, and every successful Python execution re-executed, on the
// same sources to show the calculations reproduce.
// Run from the repository root: node eval/score.ts [run id ...]   (no ids: every saved run of a known scenario)
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { igiBuild } from '../server/src/build.ts'
import { runCheck } from '../server/src/checks.ts'
import { canonical } from '../server/src/committee-pack.ts'
import { loadRun, sql, type CheckRow, type FindingRow, type RunRow } from '../server/src/db.ts'
import { dec } from '../server/src/decimal.ts'
import { factsOf, isCurrent } from '../server/src/evidence.ts'
import { closeSandbox } from '../server/src/sandbox.ts'
import { importReview, type Review } from '../server/src/sources.ts'
import { callTool, type RunState } from '../server/src/tools.ts'
import { ROOT, answerKeys, scenarioDir, type AnswerKey, type Benign, type Issue } from './answer-keys.ts'

// Classifications that assert something is wrong: one matching no planted issue is a false positive.
const ASSERTING = ['potential_exception', 'policy_inconsistency']
// Classifications a person must act on; each needs validated evidence (§15.4).
const MATERIAL = ['potential_exception', 'policy_inconsistency', 'outstanding_action']

// What one run scored. Issue and benign outcomes name the findings that matched.
export type RunScore = {
  runId: string
  scenario: string
  status: string
  config: { model: string; effort: string; commit: string; instructions: string; tools: string; memoryEnabled: boolean; knowledge: number }
  issues: { id: string; type: string; outcome: 'found' | 'misclassified' | 'missed'; findings: string[] }[]
  benign: { id: string; outcome: 'explained' | 'flagged' | 'not_addressed'; findings: string[] }[]
  falsePositives: { id: string; classification: string; title: string }[]
  unsupportedBreaches: string[] // current potential exceptions that are not validated; downgrading should leave none
  downgraded: number // proposed as potential exceptions, stored as observations because their figures did not validate
  material: { total: number; validated: number }
  numbers: { checked: number; agree: number; disagree: string[] } // claimed facts against the generator's figures
  // sameCode: the run's analysis used the committed code being scored now, so a difference is a failure to reproduce;
  // otherwise the calculations were re-run on newer code and a difference may just be a change to a check.
  reproduced: { sameCode: boolean; checks: number; checksSame: number; executions: number; executionsSame: number; differ: string[] }
  openQuestions: number
  findings: number // current findings
  costUsd: number
  minutes: number | null
  turns: number
  toolCalls: number
}

const sha = (b: string | Uint8Array) => createHash('sha256').update(b).digest('hex')

/**
 * The SHA-256 of each scenario file as it may have been imported: as written, or with LF or CRLF line endings
 * (a Windows checkout converts them), so a run is recognised whichever checkout it ran from.
 */
function scenarioHashes(key: AnswerKey): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const f of readdirSync(scenarioDir(key.scenario))) {
    const bytes = readFileSync(`${scenarioDir(key.scenario)}/${f}`)
    const lf = bytes.toString('utf8').replace(/\r\n/g, '\n')
    out.set(f, new Set([sha(bytes), sha(lf), sha(lf.replace(/\n/g, '\r\n'))]))
  }
  return out
}

/** The scenario whose files a run analysed, by the source hashes in its config, or undefined. */
function scenarioOf(run: RunRow, keys: { key: AnswerKey; hashes: Map<string, Set<string>> }[]) {
  return keys.find(({ hashes }) => run.config.sources.length === hashes.size && run.config.sources.every((s) => hashes.get(s.file)?.has(s.sha256)))?.key
}

// What a finding cites, gathered from its policy rule, claims, coverage, cited rows and text.
type Cited = { rules: Set<string>; actions: Set<string>; checks: { check: string; portfolio: string }[] }

/** The rule versions ("ID vN"), committee actions and checks a finding cites. */
export function cited(f: FindingRow, checks: CheckRow[], review: Review): Cited {
  const c = f.content
  const rules = new Set<string>()
  const actions = new Set<string>()
  if (c.policy_rule) rules.add(`${c.policy_rule.rule_id} v${c.policy_rule.version}`)
  const checkIds = new Set([...(c.check_ids ?? []), ...(c.coverage ?? []).flatMap((x) => x.checks ?? [])])
  const actionRows = review.sources.find((s) => s.id === 'committee_actions')?.rows ?? []
  for (const claim of c.claims ?? []) {
    const s = claim.source ?? {}
    if (s.rule) rules.add(`${s.rule} v${s.version}`)
    if (s.row) actions.add(actionRows.find((r) => r.row_id === s.row)?.action_id ?? '')
    if (s.fact) {
      const [checkId, ...rest] = s.fact.split(':')
      checkIds.add(checkId)
      // A rule fact (C7:rule:ID:breach) names the rule version the check compared, in force at its period.
      const check = checks.find((x) => x.id === checkId)
      if (rest[0] === 'rule' && check) {
        const fact = factsOf({ id: check.id, args: check.args, result: check.result }).find((x) => x.id === s.fact)
        if (fact?.rule) rules.add(`${fact.rule.id} v${fact.rule.version}`)
      }
    }
  }
  const text = `${c.title}\n${c.statement}\n${c.explanation}`
  for (const r of actionRows) if ((c.cited_rows ?? []).includes(r.row_id) || text.includes(r.action_id)) actions.add(r.action_id)
  const ofChecks = checks.filter((x) => checkIds.has(x.id)).map((x) => ({ check: x.args.check, portfolio: x.args.portfolio_id }))
  return { rules, actions, checks: ofChecks }
}

/**
 * Whether a finding is about an issue: it concerns the issue's portfolio, doesn't name another period, and cites
 * at least one piece of evidence the answer key names for it (the rule version, the action, or a check of that
 * kind on that portfolio).
 */
export function about(f: FindingRow, c: Cited, i: Issue | Benign): boolean {
  if (i.portfolio && !f.content.portfolios.includes(i.portfolio)) return false
  if (i.period && f.content.period_end && f.content.period_end !== i.period) return false
  return (!!i.rule && c.rules.has(i.rule)) || (!!i.action && c.actions.has(i.action)) || (!!i.check && c.checks.some((x) => x.check === i.check && (!i.portfolio || x.portfolio === i.portfolio)))
}

// The answer key's metric for a fact the agent claimed, where the generator computed one independently.
const METRIC: Record<string, (asset?: string) => string | undefined> = {
  exposure: (a) => (a === 'equity' || a === 'cash' ? `${a}_exposure` : undefined),
  largest_holding_weight: () => 'single_holding_weight',
  return_deviation: () => 'relative_return_deviation',
}

/** Scores one saved run, or explains why it can't be scored. */
export async function scoreRun(runId: string, keys = answerKeys().map((key) => ({ key, hashes: scenarioHashes(key) }))): Promise<RunScore | string> {
  const loaded = await loadRun(runId)
  if (!loaded) return `${runId}: no such run`
  const { run, checks, executions, notes } = loaded
  const key = scenarioOf(run, keys)
  if (!key) return `${runId}: its sources match no scenario with an answer key`
  const [review0] = await sql<{ period_end: string }[]>`select period_end::text from review where id = ${run.review_id}`
  const review = importReview(scenarioDir(key.scenario), run.review_id, review0?.period_end)
  // The agent's own findings are version 1; later versions are the operator putting a withdrawn one forward again.
  const current = loaded.findings.filter((f) => f.version === 1 && isCurrent({ superseded_by: f.superseded_by, content: f.content }))
  const cites = new Map(current.map((f) => [f.id, cited(f, checks, review)]))
  const matching = (i: Issue | Benign) => current.filter((f) => about(f, cites.get(f.id)!, i))

  const issues = key.issues.map((i) => {
    const m = matching(i)
    const right = m.filter((f) => i.expected.includes(f.classification))
    return { id: i.id, type: i.type, outcome: right.length ? ('found' as const) : m.length ? ('misclassified' as const) : ('missed' as const), findings: (right.length ? right : m).map((f) => `${f.id} ${f.classification}`) }
  })
  const benign = key.benign.map((b) => {
    const m = matching(b)
    const wrong = m.filter((f) => b.must_not_be.includes(f.classification))
    return { id: b.id, outcome: wrong.length ? ('flagged' as const) : m.length ? ('explained' as const) : ('not_addressed' as const), findings: (wrong.length ? wrong : m).map((f) => `${f.id} ${f.classification}`) }
  })
  const matchedAny = (f: FindingRow) => [...key.issues, ...key.benign].some((i) => about(f, cites.get(f.id)!, i))
  const falsePositives = current.filter((f) => ASSERTING.includes(f.classification) && !matchedAny(f)).map((f) => ({ id: f.id, classification: f.classification, title: f.content.title }))
  const material = current.filter((f) => MATERIAL.includes(f.classification))

  // Each fact a current finding claims, where the generator computed the same figure, must equal it.
  const numbers = { checked: 0, agree: 0, disagree: [] as string[] }
  for (const f of current)
    for (const claim of f.content.claims ?? []) {
      const ok = f.validation.claims?.find((r) => r.key === claim.key)?.ok
      const [checkId] = claim.source?.fact?.split(':') ?? []
      const check = checks.find((x) => x.id === checkId)
      if (!ok || !check) continue
      const fact = factsOf({ id: check.id, args: check.args, result: check.result }).find((x) => x.id === claim.source.fact)
      const metric = fact && METRIC[fact.measure]?.(fact.asset_class)
      const expected = metric && key.facts[`${fact.portfolio}|${fact.period}|${metric}`]
      if (!fact || !expected) continue
      numbers.checked++
      if (dec(fact.exact) === dec(expected)) numbers.agree++
      else numbers.disagree.push(`${f.id} ${claim.key}: ${fact.exact}, generator ${expected}`)
    }

  // Re-run every check, and re-execute every successful Python execution, on the same sources.
  const build = igiBuild()
  const reproduced = { sameCode: !build.endsWith('-dirty') && run.config.igi_commit === build, checks: checks.length, checksSame: 0, executions: 0, executionsSame: 0, differ: [] as string[] }
  for (const c of checks) {
    let again: unknown
    try {
      again = runCheck(review, c.args).result
    } catch (e) {
      again = { error: (e as Error).message }
    }
    if (canonical(again) === canonical(c.result)) reproduced.checksSame++
    else reproduced.differ.push(c.id)
  }
  const state: RunState = { review, now: run.started_at, executions: [], checks: [], notes: [], findings: [], maxPython: Infinity }
  for (const x of executions.filter((x) => x.ok)) {
    reproduced.executions++
    const again = (await callTool(state, 'run_python', { purpose: x.purpose, code: x.code })) as { ok: boolean; result: unknown; stdout: string }
    if (again.ok && canonical(again.result ?? null) === canonical(x.result ?? null) && again.stdout.replace(/\n\.\.\. \(output truncated\)$/, '') === x.stdout) reproduced.executionsSame++
    else reproduced.differ.push(x.id)
  }

  const usage = (run.usage ?? {}) as { costUsd?: number }
  const cfg = run.config
  return {
    runId,
    scenario: key.scenario,
    status: run.status,
    config: { model: cfg.model, effort: cfg.reasoning_effort, commit: cfg.igi_commit, instructions: cfg.instructions_sha, tools: cfg.tools_sha, memoryEnabled: cfg.memory_enabled, knowledge: cfg.knowledge_ids?.length ?? 0 },
    issues,
    benign,
    falsePositives,
    unsupportedBreaches: current.filter((f) => f.classification === 'potential_exception' && f.validation.state !== 'validated').map((f) => f.id),
    downgraded: current.filter((f) => f.proposed_classification === 'potential_exception' && f.classification !== 'potential_exception').length,
    material: { total: material.length, validated: material.filter((f) => f.validation.state === 'validated').length },
    numbers,
    reproduced,
    openQuestions: notes.filter((n) => n.kind === 'open_question').length,
    findings: current.length,
    costUsd: usage.costUsd ?? 0,
    minutes: run.ended_at ? Number(((run.ended_at.getTime() - run.started_at.getTime()) / 60000).toFixed(1)) : null,
    turns: run.turns,
    toolCalls: run.tool_calls,
  }
}

// A commit as 12 hex digits, keeping the mark of a development build.
const short = (commit: string) => commit.slice(0, 12) + (commit.endsWith('-dirty') ? '-dirty' : '')

/** One line per run: issues found, the benign anomaly, false positives, validation, numbers, reproduction, cost. */
export function runLine(s: RunScore): string {
  const issues = s.issues.map((i) => `${i.id} ${i.outcome === 'found' ? 'found' : i.outcome}${i.findings.length ? ` (${i.findings.join(', ')})` : ''}`).join('; ')
  const benign = s.benign.map((b) => `${b.id} ${b.outcome}${b.findings.length ? ` (${b.findings.join(', ')})` : ''}`).join('; ')
  const r = s.reproduced
  return [
    `${s.runId} [${s.scenario}, ${s.status}]`,
    `  issues ${s.issues.filter((i) => i.outcome === 'found').length}/${s.issues.length}: ${issues}`,
    `  benign: ${benign || 'none planted'}`,
    `  false positives: ${s.falsePositives.map((f) => `${f.id} ${f.classification} "${f.title}"`).join('; ') || 'none'}; unsupported breach claims: ${s.unsupportedBreaches.join(', ') || 'none'} (${s.downgraded} downgraded)`,
    `  material findings validated ${s.material.validated}/${s.material.total} of ${s.findings} current; claimed facts equal the generator's ${s.numbers.agree}/${s.numbers.checked}${s.numbers.disagree.length ? ` (differ: ${s.numbers.disagree.join('; ')})` : ''}`,
    `  ${r.sameCode ? 'reproduced' : 're-run on the current code'}: checks ${r.checksSame}/${r.checks}, Python ${r.executionsSame}/${r.executions}${r.differ.length ? ` (differ: ${r.differ.join(', ')})` : ''}; open questions ${s.openQuestions}`,
    `  $${s.costUsd.toFixed(3)}, ${s.minutes ?? '?'} min, ${s.turns} turns, ${s.toolCalls} tool calls; ${s.config.model} ${s.config.effort}, commit ${short(s.config.commit)}, instructions ${s.config.instructions}, tools ${s.config.tools}${s.config.memoryEnabled || s.config.knowledge ? ', MEMORY SUPPLIED' : ''}`,
  ].join('\n')
}

/**
 * The totals per scenario and configuration (model, effort, commit, instructions and tools hashes): runs with
 * different prompts or tools are never pooled. Each line ends with the §15.4 targets it meets or misses.
 */
export function summary(scores: RunScore[]): string[] {
  const groups = new Map<string, RunScore[]>()
  for (const s of scores) {
    const g = `${s.scenario} | ${s.config.model} ${s.config.effort} | commit ${short(s.config.commit)} | instructions ${s.config.instructions} | tools ${s.config.tools}`
    groups.set(g, [...(groups.get(g) ?? []), s])
  }
  return [...groups].map(([g, runs]) => {
    const n = (f: (s: RunScore) => number) => runs.reduce((a, s) => a + f(s), 0)
    const found = n((s) => s.issues.filter((i) => i.outcome === 'found').length)
    const planted = n((s) => s.issues.length)
    const explained = runs.filter((s) => s.benign.some((b) => b.outcome === 'explained')).length
    const fp = n((s) => s.falsePositives.length)
    const unsupported = n((s) => s.unsupportedBreaches.length)
    const material = n((s) => s.material.total)
    const validated = n((s) => s.material.validated)
    const isolated = runs.every((s) => !s.config.memoryEnabled && !s.config.knowledge)
    const reproducible = runs.every((s) => !s.reproduced.differ.length) && runs.every((s) => !s.numbers.disagree.length)
    const sameCode = runs.every((s) => s.reproduced.sameCode)
    const recall = planted ? found / planted : 1
    const targets = [
      `recall ${(recall * 100).toFixed(0)}% ${recall >= 0.8 ? 'meets' : 'MISSES'} 80%`,
      `${unsupported ? 'UNSUPPORTED BREACH CLAIMS' : 'no unsupported breach claims'}`,
      `${validated === material ? 'every material finding validated' : `MATERIAL FINDINGS UNVALIDATED ${material - validated}`}`,
      sameCode ? (reproducible ? 'calculations reproduce' : 'CALCULATIONS DIFFER') : `re-run on the current code, not the run's: ${reproducible ? 'same results' : 'results differ'}`,
      `${explained ? 'benign anomaly explained' : 'NO BENIGN ANOMALY EXPLAINED'} in ${explained}/${runs.length} runs`,
      `${isolated ? 'no memory supplied' : 'MEMORY SUPPLIED'}`,
    ]
    return `${g}\n  ${runs.length} run(s): ${found}/${planted} issues found, ${fp} false positives, ${validated}/${material} material findings validated, $${(n((s) => s.costUsd) / runs.length).toFixed(3)} a run\n  ${targets.join('; ')}`
  })
}

/** Writes the scores to eval/results/<name>-<timestamp>.json (gitignored) and returns the path. */
export function saveScores(name: string, scores: RunScore[], extra: Record<string, unknown> = {}): string {
  mkdirSync(`${ROOT}eval/results`, { recursive: true })
  const path = `eval/results/${name}-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}.json`
  writeFileSync(`${ROOT}${path}`, JSON.stringify({ ...extra, scores }, null, 2) + '\n')
  return path
}

if (import.meta.main) {
  const ids = process.argv.slice(2)
  const all = ids.length ? ids : (await sql<{ id: string }[]>`select id from analysis_run order by started_at`).map((r) => r.id)
  const keys = answerKeys().map((key) => ({ key, hashes: scenarioHashes(key) }))
  const scores: RunScore[] = []
  for (const id of all) {
    const s = await scoreRun(id, keys)
    if (typeof s === 'string') console.log(`skip ${s}`)
    else console.log(runLine(s)), scores.push(s)
  }
  console.log(`\n${summary(scores).join('\n\n')}`)
  if (scores.length) console.log(`\nSaved ${saveScores('score', scores)}`)
  await closeSandbox()
  await sql.end()
}
