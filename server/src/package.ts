// What IGI submits to Cairn for a finding version (spec §12.3): a plain-text assertion and a Markdown
// investigation package. Both are composed only from IGI's records of the run, and deterministically, so a
// resend carries the same text.
import type { CheckRow, ExecutionRow, FindingRow, RunRow } from './db.ts'
import { COVERAGE, type ClaimResult } from './evidence.ts'

// Cairn's limit on assertion text. A statement too long to fit is cut and ends with CONTINUED.
export const ASSERTION_LIMIT = 4000
const CONTINUED = ' … (continued in the investigation package)'

/** The label Cairn shows with both of a finding's candidates: review and finding, plus the version from 2 on. At most 200 characters. */
export const sourceReference = (reviewId: string, f: Pick<FindingRow, 'id' | 'version'>) =>
  `IGI review ${reviewId}, finding ${f.id}${f.version > 1 ? ` v${f.version}` : ''}`.slice(0, 200)

/** The package's file name in Cairn: review, finding and version. */
export const packageFileName = (reviewId: string, f: Pick<FindingRow, 'id' | 'version'>) => `IGI-${reviewId}-${f.id}-v${f.version}.md`

// potential_exception reads as "potential exception".
const label = (classification: string) => classification.replaceAll('_', ' ')
// The validation in words. A finding that states no figures has nothing to validate, which is not a failed check.
const checked = (v: FindingRow['validation']) => (!v.matched.length && !v.unmatched.length ? 'no figures to validate' : v.state === 'validated' ? 'figures validated' : 'figures not validated')
/** How one claim was checked, in words: the evidence it rests on, and that a quote is an extract, not a rule. */
export const basisWords = (r: ClaimResult) =>
  !r.ok
    ? `not supported: ${r.reason}`
    : r.basis === 'calculation'
      ? `IGI check ${r.evidence}`
      : r.basis === 'policy_rule'
        ? `structured ${r.evidence}`
        : r.basis === 'source_text'
          ? `${r.evidence}, an extract from text`
          : r.evidence ?? ''
// What IGI's validation covers, said wherever a finding's checks are shown.
export const CHECKED_SCOPE = 'IGI checked the figures and population statements listed against the analysis run’s evidence. The explanation and conclusion are the agent’s interpretation and were not checked by IGI.'

/** Statement, classification, key figures, policy rule and IGI's ids, in at most 4,000 characters of plain text. */
export function composeAssertion(f: FindingRow, runId: string, reviewId: string): string {
  const c = f.content
  const v = f.validation
  const head = `${c.title}\nClassification: ${label(f.classification)} (${checked(v)}), materiality ${c.materiality}. Portfolios: ${c.portfolios.join(', ')}${c.period_end ? `, period ending ${c.period_end}` : ''}.`
  // Findings with claims list each with how it was checked; older findings list their material numbers.
  const figures = v.claims
    ? v.claims.length
      ? `Key figures: ${v.claims.map((r) => `${r.label}${r.value ? ` ${r.value}` : ''} (${basisWords(r)})`).join('; ')}.`
      : ''
    : c.material_numbers?.length
      ? `Key figures: ${c.material_numbers.map((n) => `${n.label} ${n.value} (check ${n.check_id})`).join('; ')}.`
      : ''
  const tail = [
    figures,
    v.coverage?.length ? `Whole-population statements: ${v.coverage.map((x) => `${x.kind.replaceAll('_', ' ')} for ${x.portfolios.join(', ')} (${x.ok ? `checks ${x.checks.join(', ')}` : `not supported: ${x.reason ?? x.missing.join('; ')}`})`).join('; ')}.` : '',
    v.unclaimed_figures?.length ? `Figures in the text not supported: ${v.unclaimed_figures.join(', ')}.` : '',
    c.policy_rule ? `Policy rule: ${c.policy_rule.rule_id}, version ${c.policy_rule.version}.` : '',
    c.revision?.accepted ? `Revises finding ${c.revision.of} of the same run, which is kept as history.` : '',
    v.claims ? CHECKED_SCOPE : '',
    `IGI finding ${f.id} version ${f.version}, analysis run ${runId}, review ${reviewId}. Proposed by the IGI agent; not reviewed until filed in Cairn.`,
  ].filter(Boolean)
  // Only the statement is shortened: it gets the room the heading and closing lines leave, less a little for line
  // breaks, and ends with a pointer to the package. The final slice is a guard.
  const room = ASSERTION_LIMIT - head.length - tail.join('\n').length - 4
  const statement = c.statement.length > room ? c.statement.slice(0, Math.max(0, room - CONTINUED.length)) + CONTINUED : c.statement
  return [head, statement, ...tail].join('\n').slice(0, ASSERTION_LIMIT)
}

/** A code fence longer than any run of backticks in the text, so content can't close it early. */
function fence(text: string, lang = '') {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length))
  const f = '`'.repeat(longest + 1)
  return `${f}${lang}\n${text}\n${f}`
}
// Pretty-printed JSON in a fence; a bulleted list, or "None stated." when empty.
const json = (v: unknown) => fence(JSON.stringify(v, null, 2), 'json')
const list = (items: string[] | undefined) => (items?.length ? items.map((x) => `- ${x}`).join('\n') : '- None stated.')

/**
 * The investigation package: methodology, inputs and hashes, what IGI checked and how, cited checks and executed
 * code, assumptions and uncertainties, and the earlier findings of the run this one revised, kept as history.
 */
export function composePackage(f: FindingRow, run: RunRow, reviewId: string, executions: ExecutionRow[], checks: CheckRow[], findings: FindingRow[] = []): string {
  const c = f.content
  const v = f.validation
  // The checks the finding cites: directly, through a claim's fact (`C7:exposure`), through a coverage claim, or
  // through an older finding's material number. And the executions it cites.
  const checkIds = new Set([
    ...(c.check_ids ?? []),
    ...(c.claims ?? []).flatMap((x) => (x.source?.fact ? [x.source.fact.split(':')[0]] : [])),
    ...(c.coverage ?? []).flatMap((x) => x.checks ?? []),
    ...(c.material_numbers ?? []).map((n) => n.check_id),
  ])
  const cited = checks.filter((x) => checkIds.has(x.id))
  const ran = executions.filter((x) => c.execution_ids?.includes(x.id))
  const cfg = run.config
  // The earlier findings this one revised, newest first, following each accepted revision back through the run.
  const earlier: FindingRow[] = []
  for (let of = c.revision?.accepted ? c.revision.of : undefined; of; ) {
    const prev = findings.find((x) => x.id === of)
    if (!prev || earlier.includes(prev)) break
    earlier.push(prev)
    of = prev.content.revision?.accepted ? prev.content.revision.of : undefined
  }
  // Text the model wrote (statement, explanation, code, errors, printed output) goes inside fences, so it shows
  // verbatim and can't add headings or links. Empty parts are dropped; blocks are separated by blank lines.
  return [
    `# Investigation package: ${c.title}`,
    `IGI finding ${f.id}, version ${f.version}. Review ${reviewId}, analysis run ${run.id}. Generated by IGI from the run's records. It is agent-produced and has not been reviewed until a person files it in Cairn.`,
    `## Finding`,
    [
      `- Classification: ${label(f.classification)}${f.proposed_classification !== f.classification ? ` (proposed as ${label(f.proposed_classification)})` : ''}`,
      `- Materiality: ${c.materiality}`,
      `- Portfolios: ${c.portfolios.join(', ')}`,
      c.period_end ? `- Period end: ${c.period_end}` : '',
      c.policy_rule ? `- Policy rule: ${c.policy_rule.rule_id}, version ${c.policy_rule.version}` : '',
    ].filter(Boolean).join('\n'),
    fence(c.statement),
    `## Explanation`,
    fence(c.explanation),
    `## What IGI checked`,
    ...(v.claims
      ? [
          `State: ${v.state}. ${CHECKED_SCOPE}`,
          `Figures:\n${list(v.claims.map((r) => `${r.ok ? 'Checked' : 'Not supported'}: ${r.label}${r.value ? ` ${r.value}` : ''}, ${r.measure}${r.scope ? ` (${r.scope})` : ''}; ${basisWords(r)}${r.exact ? `; exact ${r.exact}` : ''}`))}`,
          `Whole-population statements:\n${list(v.coverage?.map((x) => `${x.ok ? 'Checked' : 'Not supported'}: ${x.kind} (${COVERAGE[x.kind as keyof typeof COVERAGE] ?? x.kind}) for ${x.portfolios.join(', ')} at ${x.period}, from ${x.checks.join(', ') || 'no checks'}${x.ok ? '' : `; ${x.reason ?? `missing: ${x.missing.join('; ')}`}`}`))}`,
          `Figures in the text that are not supported claims:\n${list(v.unclaimed_figures)}`,
          `Statements about a whole population without coverage:\n${list(v.unsupported_scope)}`,
        ]
      : [`State: ${v.state}. Every material number must appear in a trusted check result the finding cites.`, `Matched:\n${list(v.matched)}`, `Not matched:\n${list(v.unmatched)}`]),
    `## Assumptions`,
    list(c.assumptions),
    `## Uncertainties`,
    list(c.uncertainties),
    `## Methodology`,
    `The IGI agent (${cfg.model}, reasoning effort ${cfg.reasoning_effort}) investigated the review's sources with read-only tools: it read rows, ran Python in the Monty sandbox (${cfg.monty_version}) and ran trusted deterministic checks in decimal arithmetic. The checks and executions this finding cites follow, with their inputs and outputs.`,
    `## Inputs`,
    cfg.sources.map((s) => `- ${s.id}: ${s.file}, SHA-256 ${s.sha256}`).join('\n'),
    `Cited source rows: ${c.cited_rows?.length ? c.cited_rows.join(', ') : 'none'}.`,
    `## Checks`,
    ...(cited.length ? cited.flatMap((x) => [`### ${x.id}: ${x.args.check}`, `Arguments:\n${json(x.args)}`, `Result:\n${json(x.result)}`, `Rows used: ${x.rows_used.join(', ') || 'none'}.`]) : ['None cited.']),
    `## Executed code`,
    ...(ran.length
      ? ran.flatMap((x) => [
          `### ${x.id}: ${x.purpose}`,
          fence(x.code, 'python'),
          x.ok ? `Result:\n${json(x.result)}` : `Error (${x.error_type}):\n${fence(x.error ?? '')}`,
          x.stdout ? `Printed output:\n${fence(x.stdout)}` : '',
        ])
      : ['None cited.']),
    ...(earlier.length
      ? [
          `## Revision history`,
          `This finding revises ${earlier.map((x) => x.id).join(', which revised ')} from the same run. Each earlier finding is kept as it was proposed, with its own evidence, in the run's record.`,
          ...earlier.flatMap((x) => [`### ${x.id}: ${x.content.title} (${label(x.classification)}, ${x.validation.state})`, fence(x.content.statement), `Not supported:\n${list(x.validation.unmatched)}`]),
        ]
      : []),
    `## Run`,
    `IGI commit ${cfg.igi_commit}; instructions ${cfg.instructions_sha}; tools ${cfg.tools_sha}; run started ${run.started_at.toISOString()}.`,
  ]
    .filter(Boolean)
    .join('\n\n')
    .concat('\n')
}
