// The reviewed snapshot (spec §13.2) and the HTML committee pack generated from it alone (§6.8, §13.4), and
// stale marking when evidence behind a pack changes (§13.3).
import { createHash } from 'node:crypto'
import type { Cairn, Evidence, RecordSteps } from './cairn.ts'
import { runCheck, type Comparison } from './checks.ts'
import { sql, json, type CheckRow, type FindingRow, type RunRow } from './db.ts'
import { dec, fmt } from './decimal.ts'
import { putFile } from './files.ts'
import { findingState, itemState, refreshStatus, type Kind, type LedgerEntry } from './ledger.ts'
import { importReview } from './sources.ts'

// One accepted item: its candidate id, the evidence Cairn reported for it, and the SHA-256 of what IGI sent.
type Accepted = { candidateId: string; evidence: Evidence; sha256: string }
// What the pack shows of a publication-ready finding, copied out so the pack needs nothing else.
export type SnapshotFinding = {
  runId: string
  id: string
  version: number
  classification: string
  title: string
  statement: string
  explanation: string
  materiality: string
  portfolios: string[]
  periodEnd: string | null
  policyRule: { rule_id: string; version: string } | null
  materialNumbers: { label: string; value: string; check_id: string }[]
  uncertainties: string[]
  checks: { id: string; check: string; portfolio_id: string; period_end: string | null; comparisons: Comparison[] }[]
  executionIds: string[]
  assertion: Accepted
  package: Accepted
}
// The reviewed snapshot (§13.2): everything the pack shows, fixed when the pack is generated and stored with it.
export type Snapshot = {
  reviewId: string
  periodEnd: string
  periods: string[]
  generatedAt: string
  recordReference: string | null
  run: { id: string; status: string; model: string; reasoningEffort: string; montyVersion: string; igiCommit: string; instructionsSha: string; toolsSha: string }
  sources: { file: string; sha256: string; rows: number; issues: string[] }[]
  portfolios: { id: string; name: string; objective: string; benchmark: string; allocation: { period: string; assetClass: string; exposure: string }[] }[]
  rules: { rule_id: string; version: string; portfolio_id: string; metric: string; limit_type: string; threshold: string; document_clause: string }[]
  openActions: { action_id: string; action: string; owner: string; due_date: string; status: string }[]
  findings: SnapshotFinding[]
  counts: { rejected: number; withdrawn: number; notSubmitted: number }
}
// A committee_pack row. Only stale_at and stale_reason ever change.
export type PackRow = {
  review_id: string
  version: number
  generated_at: Date
  snapshot: Snapshot
  snapshot_sha256: string
  file_key: string
  file_sha256: string
  stale_at: Date | null
  stale_reason: string | null
}
// Something stopping a final pack, with the finding it concerns, if any.
export type Blocker = { finding?: { runId: string; id: string; version: number; title: string }; reason: string }

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex')
/** JSON with object keys sorted, so the snapshot hashes the same after jsonb reorders its keys. */
export const canonical = (v: unknown) =>
  JSON.stringify(v, (_, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x))

/** Every submission attempt in the review, oldest first. */
const reviewEntries = (reviewId: string) =>
  sql<LedgerEntry[]>`select s.* from cairn_submission s join analysis_run r on r.id = s.run_id where r.review_id = ${reviewId} order by s.created_at, s.id`

/** The latest version of every finding in the review that was not revised within its run, with its state (§6.7). */
export async function resolveFindings(reviewId: string, recordReference: string | null) {
  // `distinct on` keeps the first row of each (run, finding) in the order given: its highest version. A finding
  // revised within its run (superseded_by set) is left out, since its revision stands in for it.
  const [findings, entries] = await Promise.all([
    sql<FindingRow[]>`
      select distinct on (f.run_id, f.id) f.* from finding f join analysis_run r on r.id = f.run_id
      where r.review_id = ${reviewId} and f.superseded_by is null order by f.run_id, f.id, f.version desc`,
    reviewEntries(reviewId),
  ])
  // By run, then by finding number, so F2 comes before F10. Each finding's state comes from its own version's entries.
  findings.sort((a, b) => a.run_id.localeCompare(b.run_id) || a.id.length - b.id.length || a.id.localeCompare(b.id))
  return findings.map((f) => {
    const mine = entries.filter((e) => e.run_id === f.run_id && e.finding_id === f.id && e.finding_version === f.version)
    return { f, entries: mine, ...findingState(f, mine, recordReference) }
  })
}

/** Marks stale every pack whose included evidence is no longer filed and active on the record, or whose finding was withdrawn. */
export async function markStalePacks(reviewId: string) {
  const packs = await sql<PackRow[]>`select * from committee_pack where review_id = ${reviewId} and stale_at is null`
  if (!packs.length) return
  const [entries, withdrawn] = await Promise.all([
    reviewEntries(reviewId),
    sql<Pick<FindingRow, 'run_id' | 'id' | 'version' | 'withdrawal_reason'>[]>`
      select f.run_id, f.id, f.version, f.withdrawal_reason from finding f join analysis_run r on r.id = f.run_id
      where r.review_id = ${reviewId} and f.withdrawn_at is not null`,
  ])
  // For each pack not yet stale, every included finding gives a reason if it has been withdrawn since, or else for
  // each of its two items that is no longer accepted on the pack's record.
  for (const p of packs) {
    const reasons = p.snapshot.findings.flatMap((f) => {
      const w = withdrawn.find((x) => x.run_id === f.runId && x.id === f.id && x.version === f.version)
      if (w) return [`${f.id} v${f.version} withdrawn: ${w.withdrawal_reason}`]
      return (['assertion', 'package'] as const).flatMap((k) => {
        const state = itemState(entries.find((e) => e.candidate_id === f[k].candidateId), p.snapshot.recordReference)
        return state === 'accepted' ? [] : [`${f.id} v${f.version} ${k} ${state}`]
      })
    })
    if (reasons.length) await sql`update committee_pack set stale_at = now(), stale_reason = ${reasons.join('; ')} where review_id = ${reviewId} and version = ${p.version} and stale_at is null`
  }
}

/** What polling and opening a pack do: read back every candidate, then re-check every pack (§13.3). */
export async function checkPacks(cairn: Cairn, reviewId: string) {
  await refreshStatus(cairn, reviewId)
  await markStalePacks(reviewId)
}

/**
 * Every pack of the review, oldest first; each but the latest is superseded. `max(version) over ()` is the
 * highest version across all the rows returned, computed alongside each row.
 */
export const listPacks = (reviewId: string) =>
  sql<(PackRow & { superseded: boolean })[]>`select *, version < max(version) over () as superseded from committee_pack where review_id = ${reviewId} order by version`

/**
 * Generates the next final committee pack (§6.8), from a status read-back made now. Returns what blocks it
 * instead when a submitted finding is pending or incomplete, when a pack with no findings isn't allowed, or
 * when the sources no longer match the latest run. A Cairn read that fails throws: no pack from an old read-back.
 */
export async function generatePack(cairn: Cairn, reviewId: string): Promise<{ pack: PackRow } | { blockers: Blocker[] }> {
  await checkPacks(cairn, reviewId)
  const [review] = await sql<{ source_dir: string | null; cairn_record: RecordSteps | null }[]>`select source_dir, cairn_record from review where id = ${reviewId}`
  if (!review) throw new Error(`no review ${reviewId}`)
  const [run] = await sql<Pick<RunRow, 'id' | 'status' | 'config'>[]>`select id, status, config from analysis_run where review_id = ${reviewId} order by started_at desc limit 1`
  if (!run) throw new Error(`review ${reviewId} has no analysis run`)
  const recordReference = review.cairn_record?.record.cairnReference ?? null
  const resolved = await resolveFindings(reviewId, recordReference)
  type Resolved = (typeof resolved)[number]
  const blocker = (r: Resolved, reason: string): Blocker => ({ finding: { runId: r.f.run_id, id: r.f.id, version: r.f.version, title: r.f.content.title }, reason })

  // What blocks, first: any submitted finding still pending or incomplete.
  const blockers = resolved
    .filter((r) => r.state === 'pending' || r.state === 'incomplete')
    .map((r) => blocker(r, `${r.state}: assertion ${r.items.assertion}, package ${r.items.file}`))
  // Second, the §6.8 rule for a pack with no findings: the latest run must have completed, and none of its
  // potential exceptions may be left unsent.
  const included = resolved.filter((r) => r.state === 'publication_ready')
  if (!included.length) {
    if (!['completed', 'completed_with_uncertainties'].includes(run.status)) blockers.push({ reason: `the latest analysis run ${run.id} ended ${run.status}; a pack with no findings needs a completed run` })
    // Spark's proposal counts, not only the stored classification: an unvalidated exception stored as an observation still blocks.
    for (const r of resolved)
      if (r.f.run_id === run.id && r.state === 'not_submitted' && [r.f.classification, r.f.proposed_classification].includes('potential_exception'))
        blockers.push(blocker(r, 'a potential exception neither submitted nor withdrawn; a pack with no findings needs it rejected in Cairn or withdrawn'))
  }

  // Third, the sources must be exactly those the latest run analysed: each side is a set of "file (hash)" strings,
  // and anything in one set but not the other is listed.
  if (!review.source_dir) throw new Error(`review ${reviewId} has no sources`)
  const data = importReview(review.source_dir, reviewId)
  const key = (s: { file: string; sha256: string }) => `${s.file} (SHA-256 ${s.sha256.slice(0, 12)})`
  const now = new Set(data.sources.map(key))
  const then = new Set(run.config.sources.map(key))
  const changed = [...now.symmetricDifference(then)]
  if (changed.length) blockers.push({ reason: `the sources differ from those of the latest analysis run ${run.id}: ${changed.join(', ')}; investigate again` })
  if (blockers.length) return { blockers }

  // Nothing blocks, so build the snapshot. The allocation covers the last two periods and every asset class in the
  // look-through data; the check results come from the runs of the included findings.
  const rows = (id: string) => data.sources.find((s) => s.id === id)?.rows ?? []
  const assetClasses = [...new Set(rows('lookthrough').map((r) => r.asset_class))].sort()
  const periods = data.periods.slice(-2)
  const runIds = [...new Set(included.map((r) => r.f.run_id))]
  const checks = runIds.length ? await sql<CheckRow[]>`select * from check_result where run_id in ${sql(runIds)}` : []
  const accepted = (r: Resolved, kind: Kind): Accepted => {
    // Publication-ready means both latest entries are submitted, filed and active, so these are present.
    const e = r.entries.filter((x) => x.kind === kind).at(-1)!
    return { candidateId: e.candidate_id!, evidence: e.cairn_status!.evidence!, sha256: e.payload_sha256 }
  }

  const snapshot: Snapshot = {
    reviewId,
    periodEnd: data.periodEnd,
    periods: data.periods,
    generatedAt: new Date().toISOString(),
    recordReference,
    run: {
      id: run.id,
      status: run.status,
      model: run.config.model,
      reasoningEffort: run.config.reasoning_effort,
      montyVersion: run.config.monty_version,
      igiCommit: run.config.igi_commit,
      instructionsSha: run.config.instructions_sha,
      toolsSha: run.config.tools_sha,
    },
    sources: data.sources.map((s) => ({ file: s.file, sha256: s.sha256, rows: s.rows.length, issues: s.issues })),
    portfolios: rows('portfolios').map((p) => ({
      id: p.portfolio_id,
      name: p.portfolio_name,
      objective: p.objective,
      benchmark: p.benchmark,
      allocation: periods.flatMap((period) =>
        assetClasses.flatMap((assetClass) => {
          try {
            return [{ period, assetClass, exposure: String(runCheck(data, { check: 'lookthrough_exposure', portfolio_id: p.portfolio_id, period_end: period, asset_class: assetClass }).result.exposure) }]
          } catch {
            return [] // no positions at that period: already a validation issue
          }
        }),
      ),
    })),
    rules: rows('policy_rules')
      .filter((r) => r.effective_from <= data.periodEnd && (!r.effective_to || r.effective_to >= data.periodEnd))
      .map(({ rule_id, version, portfolio_id, metric, limit_type, threshold, document_clause }) => ({ rule_id, version, portfolio_id, metric, limit_type, threshold, document_clause })),
    openActions: rows('committee_actions')
      .filter((a) => a.status.toLowerCase() !== 'completed')
      .map(({ action_id, action, owner, due_date, status }) => ({ action_id, action, owner, due_date, status })),
    findings: included.map((r) => {
      const c = r.f.content
      const ids = new Set([...(c.check_ids ?? []), ...(c.material_numbers ?? []).map((n) => n.check_id)])
      return {
        runId: r.f.run_id,
        id: r.f.id,
        version: r.f.version,
        classification: r.f.classification,
        title: c.title,
        statement: c.statement,
        explanation: c.explanation,
        materiality: c.materiality,
        portfolios: c.portfolios,
        periodEnd: c.period_end ?? null,
        policyRule: c.policy_rule ?? null,
        materialNumbers: c.material_numbers ?? [],
        uncertainties: c.uncertainties ?? [],
        checks: checks
          .filter((x) => x.run_id === r.f.run_id && ids.has(x.id))
          .map((x) => ({ id: x.id, check: x.args.check, portfolio_id: x.args.portfolio_id, period_end: x.args.period_end ?? null, comparisons: Array.isArray(x.result.comparisons) ? (x.result.comparisons as Comparison[]) : [] })),
        executionIds: c.execution_ids ?? [],
        assertion: accepted(r, 'assertion'),
        package: accepted(r, 'file'),
      }
    }),
    counts: {
      rejected: resolved.filter((r) => r.state === 'rejected').length,
      withdrawn: resolved.filter((r) => r.state === 'withdrawn').length,
      notSubmitted: resolved.filter((r) => r.state === 'not_submitted' && r.f.run_id === run.id).length, // earlier runs' unsent findings are history
    },
  }

  // Hash the snapshot, take the next version number, store the HTML under a key that includes the hash, then
  // record the pack.
  const snapshotSha = sha256(canonical(snapshot))
  const [{ version }] = await sql<{ version: number }[]>`select coalesce(max(version), 0) + 1 as version from committee_pack where review_id = ${reviewId}`
  const html = new TextEncoder().encode(renderPack(snapshot, version, snapshotSha))
  const fileKey = `packs/${reviewId}/v${version}-${snapshotSha.slice(0, 12)}.html`
  putFile(fileKey, html)
  const [pack] = await sql<PackRow[]>`
    insert into committee_pack (review_id, version, generated_at, snapshot, snapshot_sha256, file_key, file_sha256)
    values (${reviewId}, ${version}, ${snapshot.generatedAt}, ${json(snapshot)}, ${snapshotSha}, ${fileKey}, ${sha256(html)})
    returning *`
  return { pack }
}

// ---- The HTML pack: a pure function of the snapshot, so the stored file is reproducible ----

// esc turns every character that could start markup into a numeric entity. label writes a classification as words,
// pct a fraction as a percentage to 2 places, plural a count with its noun. table escapes its headings; its cells
// and list's items arrive as HTML, already escaped.
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const label = (classification: string) => classification.replaceAll('_', ' ')
const pct = (fraction: string) => `${fmt(dec(fraction) * 100n, 2)}%`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const table = (head: string[], body: unknown[][]) =>
  `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`
const list = (items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`

// Styles inline, so the file stands alone. In print each main section after the first starts a new page.
const CSS = `
body { font: 15px/1.5 system-ui, sans-serif; color: #1c1c1c; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; }
h1 { font-size: 1.6rem; margin-bottom: .25rem; } h2 { border-bottom: 2px solid #1c1c1c; margin-top: 2.5rem; } h3 { margin-top: 1.75rem; }
table { border-collapse: collapse; width: 100%; margin: .5rem 0 1rem; font-size: .9rem; } th, td { text-align: left; padding: .3rem .5rem; border-bottom: 1px solid #ccc; vertical-align: top; }
.meta, .note { color: #555; font-size: .9rem; } .note { border-left: 3px solid #999; padding-left: .75rem; }
.bar { display: inline-block; height: .7rem; background: #4a6fa5; } .breach { color: #a02020; font-weight: 600; }
article { border-top: 1px solid #ccc; } code { font-size: .8rem; word-break: break-all; }
@media print { body { margin: 0; max-width: none; font-size: 11pt; } h2:not(:first-of-type) { break-before: page; } article, table { break-inside: avoid; } }
`

/** The pre-meeting pack (§13.4), from the snapshot alone. Every string from the snapshot is escaped. */
export function renderPack(s: Snapshot, version: number, snapshotSha: string): string {
  // Findings counted by classification, the ones to flag for attention, every validation issue, and a rule lookup.
  const types = Object.entries(Object.groupBy(s.findings, (f) => f.classification)).map(([c, fs]) => `${label(c)} ${fs!.length}`)
  const attention = s.findings.filter((f) => f.classification === 'potential_exception' || f.classification === 'policy_inconsistency')
  const issues = s.sources.flatMap((x) => x.issues.map((i) => `${x.file}: ${i}`))
  const rule = (id: string, v: string) => s.rules.find((r) => r.rule_id === id && r.version === v)

  const overview = [
    `Review period ending ${esc(s.periodEnd)}; portfolios: ${esc(s.portfolios.map((p) => p.name).join(', '))}.`,
    `Data: ${plural(s.sources.length, 'source file')}, ${issues.length ? `${plural(issues.length, 'validation issue')} (listed under outstanding items)` : 'no validation issues'}. The analysis run ended ${esc(label(s.run.status))}.`,
    `Findings accepted in Cairn: ${s.findings.length ? esc(`${s.findings.length} (${types.join(', ')})`) : 'none'}.`,
    `Submitted findings not accepted in Cairn: ${s.counts.rejected}. Findings withdrawn by the operator: ${s.counts.withdrawn}.`,
  ]
  const attentionHtml = attention.length
    ? list(attention.map((f) => `<a href="#${esc(f.id)}-v${f.version}">${esc(f.id)}</a>: ${esc(f.title)} (${esc(label(f.classification))}, ${esc(f.materiality)} materiality)`))
    : s.findings.length
      ? '<p>No potential exception or policy inconsistency was accepted.</p>'
      : '<p>No findings. Every potential exception the analysis proposed was rejected in Cairn or withdrawn by the operator.</p>'

  // One table per portfolio: each asset class's look-through exposure at the previous and current period, the
  // change, and a bar 12rem long at 100%.
  const portfolios = s.portfolios.map((p) => {
    const [prev, cur] = s.periods.length > 1 ? s.periods.slice(-2) : [undefined, s.periodEnd]
    const at = (period: string | undefined, assetClass: string) => p.allocation.find((a) => a.period === period && a.assetClass === assetClass)?.exposure
    const classes = [...new Set(p.allocation.map((a) => a.assetClass))]
    const body = classes.map((c) => {
      const before = at(prev, c)
      const now = at(cur, c)
      return [
        esc(c),
        before ? pct(before) : '–',
        now ? pct(now) : '–',
        before && now ? `${dec(now) >= dec(before) ? '+' : ''}${pct(fmt(dec(now) - dec(before), 4))}` : '–',
        now ? `<span class="bar" style="width:${(Number(now) * 12).toFixed(2)}rem"></span>` : '',
      ]
    })
    return `<h3>${esc(p.name)} (${esc(p.id)})</h3><p class="meta">${esc(p.objective)}. Benchmark: ${esc(p.benchmark)}.</p>${table(['Asset class (look-through)', prev ?? '', cur, 'Change', ''], body)}`
  })

  // One article per finding, anchored by id and version for the overview's links: statement, the rule and its
  // threshold, supporting figures, policy comparisons, explanation, uncertainties and evidence references.
  const findings = s.findings.map((f) => {
    const r = f.policyRule && rule(f.policyRule.rule_id, f.policyRule.version)
    const comparisons = f.checks.flatMap((c) => c.comparisons.map((x) => [esc(c.id), esc(`${x.rule_id} v${x.version}`), esc(`${x.limit_type} ${pct(x.threshold)}`), esc(pct(x.value)), `<span class="${x.status === 'breach' ? 'breach' : ''}">${esc(x.status)}</span>`, esc(pct(x.margin))]))
    return `<article id="${esc(f.id)}-v${f.version}">
<h3>${esc(f.id)}: ${esc(f.title)}</h3>
<p class="meta">${esc(label(f.classification))}; ${esc(f.materiality)} materiality; portfolios ${esc(f.portfolios.join(', '))}${f.periodEnd ? `; period ending ${esc(f.periodEnd)}` : ''}. IGI finding ${esc(f.id)} version ${f.version}.</p>
<p>${esc(f.statement)}</p>
${f.policyRule ? `<p><strong>Policy rule:</strong> ${esc(f.policyRule.rule_id)}, version ${esc(f.policyRule.version)}${r ? esc(`: ${r.metric} ${r.limit_type} ${pct(r.threshold)} (${r.portfolio_id}, policy clause ${r.document_clause})`) : ''}.</p>` : ''}
${f.materialNumbers.length ? `<h4>Supporting figures</h4>${table(['Figure', 'Value', 'Check'], f.materialNumbers.map((n) => [esc(n.label), esc(n.value), esc(n.check_id)]))}` : ''}
${comparisons.length ? `<h4>Comparison with policy</h4>${table(['Check', 'Rule', 'Limit', 'Value', 'Status', 'Margin'], comparisons)}` : ''}
<h4>Explanation</h4><p>${esc(f.explanation)}</p>
<h4>Uncertainties to discuss</h4>${f.uncertainties.length ? list(f.uncertainties.map(esc)) : '<p>None stated.</p>'}
<p class="meta">Evidence: assertion ${esc(f.assertion.evidence.cairnReference)} and investigation package ${esc(f.package.evidence.cairnReference)}, filed in Cairn record ${esc(s.recordReference)}.</p>
</article>`
  })

  const outstanding = [
    s.openActions.length ? `<h3>Previous committee actions not completed</h3>${table(['Action', 'Owner', 'Due', 'Status'], s.openActions.map((a) => [`${esc(a.action_id)}: ${esc(a.action)}`, esc(a.owner), esc(a.due_date || 'standing'), esc(a.status)]))}` : '<p>Every previous committee action is recorded as completed.</p>',
    issues.length ? `<h3>Data validation issues</h3>${list(issues.map(esc))}` : '',
    s.counts.notSubmitted ? `<h3>Not submitted for review</h3><p>${plural(s.counts.notSubmitted, 'finding')} from the latest analysis run ${s.counts.notSubmitted === 1 ? 'was' : 'were'} not submitted to Cairn; ${s.counts.notSubmitted === 1 ? 'it is' : 'they are'} not in this pack.</p>` : '',
  ]

  // Two manifest rows per finding: its assertion and its package.
  const manifest = s.findings.flatMap((f) =>
    (['assertion', 'package'] as const).map((k) => {
      const e = f[k].evidence
      return [esc(`${f.id} v${f.version}`), k, esc(e.cairnReference), `<code>${esc(f[k].candidateId)}</code>`, esc(e.filedUtc), `<code>${esc(e.stepId)} / ${esc(e.slotId)}</code>`, `<code>${esc(f[k].sha256)}</code>`]
    }),
  )

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Committee pack ${esc(s.reviewId)} v${version}</title><style>${CSS}</style></head>
<body>
<h1>Investment Committee pre-meeting pack</h1>
<p class="meta">Review ${esc(s.reviewId)}, period ending ${esc(s.periodEnd)}. Pack version ${version}, generated ${esc(s.generatedAt)}.</p>
<p class="note">Each finding here was proposed by the IGI agent and its evidence was filed by a named person in Cairn. Filing accepts the evidence; it is not approval of a finding, a recommendation or a committee decision.</p>

<h2>Executive overview</h2>
${list(overview)}
<h3>Areas needing committee attention</h3>
${attentionHtml}

<h2>Portfolio overview</h2>
<p class="note">Computed by IGI's deterministic checks from the source files listed in the appendix: look-through exposure at each period end. Source data is not evidence filed in Cairn.</p>
${portfolios.join('\n')}

<h2>Material findings</h2>
${findings.length ? findings.join('\n') : '<p>No findings.</p>'}

<h2>Outstanding governance items</h2>
${outstanding.join('\n')}

<h2>Appendix</h2>
<h3>Data source register</h3>
${table(['File', 'Rows', 'Issues', 'SHA-256'], s.sources.map((x) => [esc(x.file), x.rows, x.issues.length, `<code>${esc(x.sha256)}</code>`]))}
<h3>Policy rules in force at ${esc(s.periodEnd)}</h3>
${table(['Rule', 'Version', 'Portfolio', 'Metric', 'Limit', 'Clause'], s.rules.map((r) => [esc(r.rule_id), esc(r.version), esc(r.portfolio_id), esc(r.metric), esc(`${r.limit_type} ${pct(r.threshold)}`), esc(r.document_clause)]))}
<h3>Analysis method</h3>
<p>The IGI agent (${esc(s.run.model)}, reasoning effort ${esc(s.run.reasoningEffort)}) investigated the sources with read-only tools, Python in the Monty sandbox (${esc(s.run.montyVersion)}) and trusted deterministic checks in decimal arithmetic. Analysis run ${esc(s.run.id)}; IGI commit ${esc(s.run.igiCommit)}; instructions ${esc(s.run.instructionsSha)}; tools ${esc(s.run.toolsSha)}. Each finding's investigation package holds its checks and executed code in full.</p>
${s.findings.length ? table(['Finding', 'Checks', 'Python executions'], s.findings.map((f) => [esc(`${f.id} v${f.version}`), esc(f.checks.map((c) => `${c.id} ${c.check} ${c.portfolio_id}`).join('; ') || 'none'), esc(f.executionIds.join(', ') || 'none')])) : ''}
<h3>Accepted evidence manifest</h3>
${manifest.length ? table(['Finding', 'Item', 'Cairn evidence', 'Candidate', 'Filed (UTC)', 'Step / slot', 'SHA-256 submitted'], manifest) : '<p>No evidence: the pack has no findings.</p>'}
<h3>Generation</h3>
<p>Cairn record ${esc(s.recordReference ?? 'none')}. Generated ${esc(s.generatedAt)} from a status read-back made immediately before. Reviewed snapshot SHA-256 <code>${esc(snapshotSha)}</code>.</p>
</body></html>
`
}
