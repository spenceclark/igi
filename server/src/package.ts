// What IGI submits to Cairn for a finding version (spec §6.5, §12.3): a structured plain-text assertion and a PDF
// investigation package. Both are rendered from one presentation payload, frozen at the version's first submission
// from IGI's records of the run; nothing here calls the model or recalculates a figure. Cairn shows an agent's
// assertion as plain text with its line breaks, so the assertion uses labelled lines and "- " bullets, no Markdown.
import { createHash } from 'node:crypto'
import type { CheckRow, ExecutionRow, FindingRow, RunRow } from './db.ts'
import { COVERAGE, factsOf, show, type ClaimResult, type Fact, type Validation } from './evidence.ts'

// Cairn's limit on assertion text. An assertion that won't fit is refused, never cut.
export const ASSERTION_LIMIT = 4000

/** A short tag for a run, the first six hex digits of its id's SHA-256, so two runs' F1 can be told apart. */
export const runTag = (runId: string) => createHash('sha256').update(runId).digest('hex').slice(0, 6)

/** The label Cairn shows with both of a finding's candidates: review, run tag, finding and version. At most 200 characters. */
export const sourceReference = (reviewId: string, f: Pick<FindingRow, 'run_id' | 'id' | 'version'>) => `IGI ${reviewId}, run ${runTag(f.run_id)}, ${f.id} v${f.version}`.slice(0, 200)

/** The package's file name in Cairn: review, run tag, finding and version. */
export const packageFileName = (reviewId: string, f: Pick<FindingRow, 'run_id' | 'id' | 'version'>) => `IGI-${reviewId}-${runTag(f.run_id)}-${f.id}-v${f.version}.pdf`

// potential_exception reads as "potential exception".
const label = (classification: string) => classification.replaceAll('_', ' ')
// The validation in words. A finding that states no figures has nothing to validate, which is not a failed check.
const checked = (v: Validation) => (!v.matched.length && !v.unmatched.length ? 'no figures to validate' : v.state === 'validated' ? 'figures validated' : 'figures not validated')
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
          : (r.evidence ?? '')
// What IGI's validation covers, said wherever a finding's checks are shown.
export const CHECKED_SCOPE = 'IGI checked the figures and population statements listed against the analysis run’s evidence. The explanation and conclusion are the agent’s interpretation and were not checked by IGI.'

// Everything the assertion and the package show for one finding version, copied out of the run's records when the
// version is first submitted and stored with its hash, so both can be produced again exactly as they were.
// legacyFigures are the material numbers of a finding from before claims existed.
export type FindingPayload = {
  reviewId: string
  run: { id: string; tag: string; model: string; reasoningEffort: string; montyVersion: string; igiCommit: string; instructionsSha: string; toolsSha: string; startedAt: string }
  finding: {
    id: string
    version: number
    title: string
    classification: string
    proposedClassification: string
    materiality: string
    portfolios: string[]
    periodEnd: string | null
    statement: string
    explanation: string
    policyRule: { rule_id: string; version: string } | null
    assumptions: string[]
    uncertainties: string[]
    citedRows: string[]
    // Where each cited row is in its source file (positions.csv, line 6; a workbook's sheet, row and cells); absent
    // from payloads frozen before locations were recorded, and for a row whose source is no longer retained.
    citedRowLocations?: Record<string, string>
    revisionOf: string | null
  }
  validation: Validation
  legacyFigures: { label: string; value: string; check_id: string }[]
  checks: { id: string; check: string; args: Record<string, unknown>; result: Record<string, unknown>; rowsUsed: string[]; facts: Fact[] }[]
  executions: { id: string; purpose: string; code: string; ok: boolean; result: unknown; stdout: string; error: string | null; errorType: string | null }[]
  sources: { id: string; file: string; sha256: string; key: string }[]
  earlier: { id: string; title: string; classification: string; state: string; statement: string; unsupported: string[] }[]
  packageName: string
}

/**
 * The payload for a finding version, from the run's records: the finding, its validation, the checks and executions
 * it cites (through a claim's fact, a coverage claim or directly), the run's sources and versions, and the earlier
 * findings of the run it revised, following each accepted revision back.
 */
export function findingPayload(f: FindingRow, run: RunRow, reviewId: string, executions: ExecutionRow[], checks: CheckRow[], findings: FindingRow[], locations: Record<string, string> = {}): FindingPayload {
  const c = f.content
  const checkIds = new Set([
    ...(c.check_ids ?? []),
    ...(c.claims ?? []).flatMap((x) => (x.source?.fact ? [x.source.fact.split(':')[0]] : [])),
    ...(c.coverage ?? []).flatMap((x) => x.checks ?? []),
    ...(c.material_numbers ?? []).map((n) => n.check_id),
  ])
  const earlier: FindingRow[] = []
  for (let of = c.revision?.accepted ? c.revision.of : undefined; of; ) {
    const prev = findings.find((x) => x.id === of)
    if (!prev || earlier.includes(prev)) break
    earlier.push(prev)
    of = prev.content.revision?.accepted ? prev.content.revision.of : undefined
  }
  const cfg = run.config
  return {
    reviewId,
    run: { id: run.id, tag: runTag(run.id), model: cfg.model, reasoningEffort: cfg.reasoning_effort, montyVersion: cfg.monty_version, igiCommit: cfg.igi_commit, instructionsSha: cfg.instructions_sha, toolsSha: cfg.tools_sha, startedAt: run.started_at.toISOString() },
    finding: {
      id: f.id,
      version: f.version,
      title: c.title,
      classification: f.classification,
      proposedClassification: f.proposed_classification,
      materiality: c.materiality,
      portfolios: c.portfolios,
      periodEnd: c.period_end ?? null,
      statement: c.statement,
      explanation: c.explanation,
      policyRule: c.policy_rule ?? null,
      assumptions: c.assumptions ?? [],
      uncertainties: c.uncertainties ?? [],
      citedRows: c.cited_rows ?? [],
      citedRowLocations: Object.fromEntries((c.cited_rows ?? []).flatMap((id) => (locations[id] ? [[id, locations[id]]] : []))),
      revisionOf: c.revision?.accepted ? c.revision.of : null,
    },
    validation: f.validation,
    legacyFigures: c.material_numbers ?? [],
    checks: checks
      .filter((x) => checkIds.has(x.id))
      .map((x) => ({ id: x.id, check: x.args.check, args: { ...x.args }, result: x.result, rowsUsed: x.rows_used, facts: factsOf({ id: x.id, args: x.args, result: x.result }) })),
    executions: executions
      .filter((x) => c.execution_ids?.includes(x.id))
      .map((x) => ({ id: x.id, purpose: x.purpose, code: x.code, ok: x.ok, result: x.result ?? null, stdout: x.stdout, error: x.error, errorType: x.error_type })),
    sources: cfg.sources.map((s) => ({ ...s, key: `sources/${s.sha256}/${s.file}` })),
    earlier: earlier.map((x) => ({ id: x.id, title: x.content.title, classification: x.classification, state: x.validation.state, statement: x.content.statement, unsupported: x.validation.unmatched })),
    packageName: packageFileName(reviewId, f),
  }
}

/**
 * The assertion as Cairn will show it, plain text in labelled sections: the finding, its key figures and how each
 * was checked, whole-population statements, anything unsupported, why it matters, what is unresolved, the evidence
 * and IGI's ids. Throws, rather than cutting anything, when it is over Cairn's 4,000 characters.
 */
export function composeAssertion(p: FindingPayload): string {
  const f = p.finding
  const v = p.validation
  const figures = v.claims
    ? v.claims.map((r) => `- ${r.label}${r.value ? `: ${r.value}` : ''} (${basisWords(r)}${r.ok && r.scope ? `; ${r.scope}` : ''})`)
    : p.legacyFigures.map((n) => `- ${n.label}: ${n.value} (check ${n.check_id})`)
  const unsupported = [...(v.unclaimed_figures ?? []).map((x) => `${x} appears in the text without a verified claim`), ...(v.unsupported_scope ?? []).map((x) => `"${x}" has no verified coverage`)]
  const evidence = [
    f.policyRule && `policy rule ${f.policyRule.rule_id} version ${f.policyRule.version}`,
    p.checks.length && `checks ${p.checks.map((x) => x.id).join(', ')}`,
    `investigation package ${p.packageName}`,
    f.revisionOf && `revises ${f.revisionOf} of the same run, which is kept as history`,
  ].filter(Boolean)
  const lines = [
    f.title,
    `Finding: ${label(f.classification)}, ${f.materiality} materiality; ${checked(v)}. Portfolios: ${f.portfolios.join(', ')}${f.periodEnd ? `; period ending ${f.periodEnd}` : ''}.`,
    f.statement,
    ...(figures.length ? ['', 'Key figures and how IGI checked them:', ...figures] : []),
    ...(v.coverage?.length
      ? ['', 'Statements about a whole population:', ...v.coverage.map((x) => `- ${x.kind.replaceAll('_', ' ')} for ${x.portfolios.join(', ')} at ${x.period}: ${x.ok ? `checked (${x.checks.join(', ')})` : `not supported: ${x.reason ?? x.missing.join('; ')}`}`)]
      : []),
    ...(unsupported.length ? ['', 'Not supported:', ...unsupported.map((x) => `- ${x}`)] : []),
    '',
    'Why it matters:',
    f.explanation,
    '',
    'Unresolved:',
    ...(f.uncertainties.length ? f.uncertainties.map((u) => `- ${u}`) : ['- None recorded.']),
    '',
    `Evidence: ${evidence.join('; ')}.`,
    ...(v.claims ? [CHECKED_SCOPE] : []),
    `IGI review ${p.reviewId}, run ${p.run.id}, finding ${f.id} version ${f.version}. Proposed by the IGI agent; not reviewed until filed in Cairn.`,
  ]
  const text = lines.join('\n')
  if (text.length > ASSERTION_LIMIT)
    throw new Error(`the assertion for ${f.id} v${f.version} is ${text.length} characters, over Cairn's ${ASSERTION_LIMIT}; nothing is cut to fit: shorten the finding's statement or explanation in a revision`)
  return text
}

// ---- The investigation package: an HTML document printed to PDF (render.ts) ----

// esc turns every character that could start markup into a numeric entity; list and table take cells already escaped.
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const list = (items: string[], none = 'None recorded.') => (items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : `<p>${none}</p>`)
const table = (head: string[], rows: string[][]) =>
  `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
const pre = (v: unknown) => `<pre>${esc(typeof v === 'string' ? v : JSON.stringify(v, null, 2))}</pre>`
// A fact's scope in words: portfolio, instrument, asset class, rule and period.
// Escaped text whose ISO dates are kept whole (Chromium breaks lines at hyphens).
const dated = (v: unknown) => esc(v).replace(/\d{4}-\d{2}-\d{2}/g, (d) => `<span class="nb">${d}</span>`)
const factScope = (x: Fact) => [x.portfolio, x.instrument, x.asset_class, x.rule && `${x.rule.id} v${x.rule.version}`, x.from_period ? `${x.from_period} to ${x.period}` : x.period].filter(Boolean).join(', ')

// Print styles: A4, readable tables whose header repeats on each page, code that wraps rather than overflows, and
// appendices that start on a new page. Fonts are the system's; the deployment container installs them.
const CSS = `
body { font: 10pt/1.45 system-ui, 'Segoe UI', Roboto, 'DejaVu Sans', sans-serif; color: #1c1c1c; margin: 0; }
h1 { font-size: 16pt; margin: 0 0 4pt; } h2 { font-size: 12.5pt; border-bottom: 1.5pt solid #1c1c1c; margin: 16pt 0 6pt; break-after: avoid; } h3 { font-size: 11pt; margin: 12pt 0 4pt; break-after: avoid; }
p { margin: 4pt 0; } ul { margin: 4pt 0; padding-left: 14pt; } .meta, .note { color: #555; font-size: 9pt; } .note { border-left: 2pt solid #999; padding-left: 6pt; }
table { border-collapse: collapse; width: 100%; margin: 4pt 0 8pt; font-size: 8.5pt; } th, td { text-align: left; padding: 2.5pt 4pt; border-bottom: .5pt solid #bbb; vertical-align: top; } th { white-space: nowrap; }
code { font: 7.5pt ui-monospace, Consolas, 'DejaVu Sans Mono', monospace; word-break: break-all; }
thead { display: table-header-group; } tr { break-inside: avoid; } .nb { white-space: nowrap; } .bad { color: #a02020; font-weight: 600; } .appendix { break-before: page; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 7.5pt/1.35 ui-monospace, Consolas, 'DejaVu Sans Mono', monospace; background: #f4f4f4; padding: 5pt; margin: 3pt 0 8pt; }
`

/**
 * The investigation package as an HTML document for printing: first a reviewer's summary (the finding, its figures
 * and how each was checked, population statements, why it matters, the validation boundary, what is unresolved and
 * an evidence index), then the methodology, sources with their retained copies, each cited check with its facts, the
 * revision history, and appendices with the full check results and executed code. Every string is escaped.
 */
export function packageHtml(p: FindingPayload): string {
  const f = p.finding
  const v = p.validation
  const figures = v.claims
    ? table(['Figure', 'Value', 'Checked against', 'Applies to'], v.claims.map((r) => [esc(r.label), esc(r.value ?? ''), r.ok ? esc(basisWords(r)) : `<span class="bad">${esc(basisWords(r))}</span>`, dated(r.scope ?? '')]))
    : table(['Figure', 'Value', 'Check'], p.legacyFigures.map((n) => [esc(n.label), esc(n.value), esc(n.check_id)]))
  const coverage = (v.coverage ?? []).map((x) => [
    esc(`${x.kind.replaceAll('_', ' ')}: ${COVERAGE[x.kind as keyof typeof COVERAGE] ?? ''}`),
    esc(`${x.portfolios.join(', ')} at ${x.period}`),
    esc(x.checks.join(', ')),
    x.ok ? 'Every member covered' : `<span class="bad">${esc(x.reason ?? `Not covered: ${x.missing.join('; ')}`)}</span>`,
  ])
  const unsupported = [...(v.unclaimed_figures ?? []).map((x) => `${esc(x)} appears in the text without a verified claim`), ...(v.unsupported_scope ?? []).map((x) => `“${esc(x)}” has no verified coverage`)]
  // Each cited row with its location in the source file, where recorded.
  // A payload frozen before locations were recorded has none; a newer one without a row's location says so.
  const rowRefs = f.citedRows.map((id) => (f.citedRowLocations?.[id] ? `${id} (${f.citedRowLocations[id]})` : f.citedRowLocations ? `${id} (location not retained)` : id)).join('; ')
  const index = [
    ['Checks', esc(p.checks.map((x) => `${x.id} ${x.check}`).join('; ') || 'none')],
    ['Source rows', esc(rowRefs || 'none')],
    ['Python executions', esc(p.executions.map((x) => x.id).join(', ') || 'none')],
    ['Earlier versions', esc(p.earlier.map((x) => x.id).join(', ') || 'none')],
  ]
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(`Investigation package ${f.id} v${f.version}: ${f.title}`)}</title><style>${CSS}</style></head>
<body>
<h1>Investigation package: ${esc(f.title)}</h1>
<p class="meta">Review ${esc(p.reviewId)}, analysis run ${esc(p.run.id)} (run ${esc(p.run.tag)}), IGI finding ${esc(f.id)} version ${f.version}. Generated by IGI from the run’s records. It is agent-produced and has not been reviewed until a person files it in Cairn.</p>

<h2>Summary</h2>
<p><strong>${esc(label(f.classification))}</strong>${f.proposedClassification !== f.classification ? ` (proposed as ${esc(label(f.proposedClassification))})` : ''}, ${esc(f.materiality)} materiality; ${esc(checked(v))}. Portfolios ${esc(f.portfolios.join(', '))}${f.periodEnd ? `; period ending ${esc(f.periodEnd)}` : ''}.</p>
<p>${esc(f.statement)}</p>
${f.policyRule ? `<p><strong>Policy rule:</strong> ${esc(f.policyRule.rule_id)}, version ${esc(f.policyRule.version)}.</p>` : ''}
<h3>Key figures and how IGI checked them</h3>
${figures}
${coverage.length ? `<h3>Statements about a whole population</h3>${table(['Statement', 'Population', 'Checks', 'Result'], coverage)}` : ''}
${unsupported.length ? `<h3>Not supported</h3>${list(unsupported)}` : ''}
<h3>Why it matters</h3>
<p>${esc(f.explanation)}</p>
<p class="note">${esc(v.claims ? CHECKED_SCOPE : 'The material numbers of this finding were checked only for appearing in a cited check result. The explanation and conclusion are the agent’s interpretation and were not checked by IGI.')}</p>
<h3>Unresolved</h3>
${list(f.uncertainties.map(esc))}
<h3>Assumptions</h3>
${list(f.assumptions.map(esc))}
<h3>Evidence index</h3>
${table(['Kind', 'References'], index)}

<h2>Methodology</h2>
<p>The IGI agent (${esc(p.run.model)}, reasoning effort ${esc(p.run.reasoningEffort)}) investigated the review’s sources with read-only tools: it read rows, ran Python in the Monty sandbox (${esc(p.run.montyVersion)}) and ran trusted deterministic checks in decimal arithmetic. Each check’s figures are typed facts with a measure, a unit and a scope; IGI checked the finding’s claims against them. The checks and executions this finding cites follow, with their inputs and outputs.</p>

<h2>Sources</h2>
${table(['Source', 'File', 'SHA-256', 'Retained as'], p.sources.map((s) => [esc(s.id), esc(s.file), `<code>${esc(s.sha256)}</code>`, `<code>${esc(s.key)}</code>`]))}
<p class="meta">Source rows the finding cites, with where each is in its file: ${esc(rowRefs || 'none')}.</p>

<h2>Checks</h2>
${
  p.checks.length
    ? p.checks
        .map(
          (x) =>
            `<h3>${esc(x.id)}: ${esc(x.check)}</h3><p class="meta">Arguments: ${esc(Object.entries(x.args).map(([k, a]) => `${k} ${a}`).join(', '))}. Rows used: ${esc(x.rowsUsed.length)}.</p>${table(['Fact', 'Value', 'Measure', 'Applies to'], x.facts.map((y) => [`<code>${esc(y.id)}</code>`, esc(show(y.exact, y.unit)), esc(y.measure), dated(factScope(y))]))}`,
        )
        .join('\n')
    : '<p>None cited.</p>'
}

${
  p.earlier.length
    ? `<h2>Revision history</h2><p>This finding revises ${esc(p.earlier.map((x) => x.id).join(', which revised '))} from the same run. Each earlier finding is kept as it was proposed, with its own evidence, in the run’s record.</p>${p.earlier
        .map((x) => `<h3>${esc(x.id)}: ${esc(x.title)} (${esc(label(x.classification))}, ${esc(x.state)})</h3><p>${esc(x.statement)}</p>${list(x.unsupported.map(esc), 'Nothing unsupported.')}`)
        .join('\n')}`
    : ''
}

<h2>Run</h2>
<p class="meta">Analysis run ${esc(p.run.id)}, started ${esc(p.run.startedAt)}. IGI code ${esc(p.run.igiCommit)}; instructions ${esc(p.run.instructionsSha)}; tools ${esc(p.run.toolsSha)}.</p>

${p.checks.length ? `<h2 class="appendix">Appendix A: check results in full</h2>${p.checks.map((x) => `<h3>${esc(x.id)}: ${esc(x.check)}</h3>${pre(x.result)}<p class="meta">Rows used: ${esc(x.rowsUsed.join(', ') || 'none')}.</p>`).join('\n')}` : ''}
${
  p.executions.length
    ? `<h2 class="appendix">Appendix B: executed code</h2>${p.executions
        .map((x) => `<h3>${esc(x.id)}: ${esc(x.purpose)}</h3>${pre(x.code)}${x.ok ? `<p class="meta">Result:</p>${pre(x.result)}` : `<p class="meta">Error (${esc(x.errorType)}):</p>${pre(x.error ?? '')}`}${x.stdout ? `<p class="meta">Printed output:</p>${pre(x.stdout)}` : ''}`)
        .join('\n')}`
    : ''
}
</body></html>
`
}
