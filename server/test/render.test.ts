// Rendering checks (spec §15.8) on the real pipeline. Findings are proposed through the tools on a copy of dev-01
// made to stress the layout (a very long fund name, a figures table longer than a page, hundreds of cited rows, an
// unbroken 300-character code line, negative figures, an unresolved downgraded exception), submitted and filed in
// the Cairn test double. Their package PDFs and the committee pack PDF, with findings and then with none, are parsed:
// every value shown must come from the frozen payload or the snapshot, and every page must lay out cleanly.
// IGI_RENDER_OUT=<dir> also writes the PDFs there, for scripts/pdf-pages.ts to turn into page images for inspection.
// In the igi_test_render database.
import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cairnClient } from '../src/cairn.ts'
import { cairnFake } from '../src/cairn-fake.ts'
import type { FindingArtifacts } from '../src/db.ts'
import type { Claim } from '../src/evidence.ts'
import { getFile } from '../src/files.ts'
import type { FindingPayload } from '../src/package.ts'
import { closeRenderer, renderPdf } from '../src/render.ts'
import { closeSandbox } from '../src/sandbox.ts'
import { importReview, type Review, type Row } from '../src/sources.ts'
import { callTool, type FindingArgs, type RunState } from '../src/tools.ts'
import { CONFIG, resetDatabase, useTestDatabase } from './helpers.ts'

const skip = await useTestDatabase('render')
const db = await import('../src/db.ts')
const ledger = await import('../src/ledger.ts')
const pack = await import('../src/committee-pack.ts')
after(async () => {
  await closeRenderer()
  await closeSandbox()
  await db.sql.end()
})

const DEV01 = fileURLToPath(new URL('../../fixtures/scenarios/dev-01', import.meta.url))
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
type CheckOut = { check_id: string; facts: Record<string, string>; comparisons?: { rule_id: string; version: string; status: string }[] } & Record<string, unknown>
const rows = (review: Review, id: string): Row[] => review.sources.find((s) => s.id === id)?.rows ?? []

// One text run on a page: its string, its box in points from the bottom left, and its font size.
type Item = { str: string; x: number; y: number; w: number; size: number }
/** Each page's size, text runs and number of links, as pdf.js reads them. */
async function pdfPages(bytes: Uint8Array) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise
  const pages: { width: number; height: number; items: Item[]; links: number }[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const [, , width, height] = page.view
    const items = (await page.getTextContent()).items.flatMap((t) => ('str' in t && t.str.trim() ? [{ str: t.str, x: t.transform[4], y: t.transform[5], w: t.width, size: Math.hypot(t.transform[0], t.transform[1]) }] : []))
    pages.push({ width, height, items, links: (await page.getAnnotations()).filter((a: { subtype?: string }) => a.subtype === 'Link').length })
  }
  await doc.cleanup()
  return pages
}
/** All the text, whitespace collapsed, so wrapped lines read as the sentence they came from. */
const flat = (pages: Awaited<ReturnType<typeof pdfPages>>) => pages.map((p) => p.items.map((i) => i.str).join(' ')).join(' ').replace(/\s+/g, ' ')

/**
 * What a reader would find wrong with the layout: a page without "Page n of N", text running off the page, text
 * smaller than 6pt, two runs of text drawn over each other, or a document shrunk to fit. Chromium doesn't clip
 * content wider than the page: it scales the whole document down, so overflow shows as a paragraph of body text
 * (`body`, whose first line is looked for) below the 10pt it is set in.
 */
function layoutProblems(pages: Awaited<ReturnType<typeof pdfPages>>, body: string): string[] {
  const out: string[] = []
  const sample = pages.flatMap((p) => p.items).find((i) => i.str.startsWith(body.slice(0, 24)))
  if (!sample) out.push(`no body text "${body.slice(0, 24)}"`)
  else if (Math.abs(sample.size - 10) > 0.1) out.push(`shrunk to fit: body text is ${sample.size.toFixed(1)}pt, not 10pt`)
  pages.forEach((p, n) => {
    const text = p.items.map((i) => i.str).join(' ')
    if (!text.includes(`Page ${n + 1} of ${pages.length}`)) out.push(`page ${n + 1}: no "Page ${n + 1} of ${pages.length}"`)
    for (const i of p.items) {
      if (i.x < 0 || i.x + i.w > p.width - 20 || i.y < 0 || i.y > p.height) out.push(`page ${n + 1}: "${i.str.slice(0, 40)}" runs off the page (x ${i.x.toFixed(0)}+${i.w.toFixed(0)} of ${p.width.toFixed(0)})`)
      if (i.size < 5.95) out.push(`page ${n + 1}: "${i.str.slice(0, 40)}" is ${i.size.toFixed(1)}pt`)
    }
    // Two runs overlap when their boxes (baseline to cap height, shrunk by a point for kerning) intersect.
    const box = (i: Item) => [i.x + 1, i.y, i.x + i.w - 1, i.y + i.size * 0.7]
    for (let a = 0; a < p.items.length; a++)
      for (let b = a + 1; b < p.items.length; b++) {
        const [ax0, ay0, ax1, ay1] = box(p.items[a])
        const [bx0, by0, bx1, by1] = box(p.items[b])
        if (Math.min(ax1, bx1) > Math.max(ax0, bx0) && Math.min(ay1, by1) > Math.max(ay0, by0)) out.push(`page ${n + 1}: "${p.items[a].str.slice(0, 30)}" overlaps "${p.items[b].str.slice(0, 30)}"`)
      }
  })
  return out
}

test('render: the layout check finds overlapping, tiny and overflowing text', { skip }, async () => {
  const usual = 'Body text at its usual size, as in every IGI document.'
  const check = async (more: string) => layoutProblems(await pdfPages((await renderPdf(`<!doctype html><body style="margin:0;font:10pt sans-serif"><p>${usual}</p>${more}</body>`, 'Broken')).bytes), usual)
  const drawn = await check('<p style="position:absolute;top:80px;left:40px">Overlapping words here</p><p style="position:absolute;top:82px;left:60px">Drawn on top</p><p style="font-size:5px">Too small to read</p>')
  assert.ok(drawn.some((x) => /"Overlapping words here" overlaps "Drawn on top"/.test(x)), 'overlap')
  assert.ok(drawn.some((x) => /"Too small to read" is 3\.\dpt/.test(x)), 'tiny text')
  assert.ok(!drawn.some((x) => /shrunk/.test(x)))
  assert.deepEqual(await check(`<pre style="white-space:pre">${'y'.repeat(200)}</pre>`), ['shrunk to fit: body text is 6.7pt, not 10pt'], 'a line wider than the page')
})

test('render: package and pack PDFs show the frozen figures and references, and lay out cleanly when stressed', { skip }, async () => {
  await resetDatabase(db)
  // A copy of dev-01 in which the fund an open committee action names has a very long name, everywhere it appears.
  const base = importReview(DEV01, 'r')
  const held = rows(base, 'positions')
  const open = rows(base, 'committee_actions').find((a) => !/completed/i.test(a.status) && held.some((h) => a.action.includes(h.instrument_name)))!
  const name = held.find((h) => open.action.includes(h.instrument_name))!.instrument_name
  const LONG = `${name} Accumulation Sterling Hedged Institutional Share Class Series Two Closed to New Investors`
  const dir = mkdtempSync(join(tmpdir(), 'igi-render-'))
  cpSync(DEV01, dir, { recursive: true })
  for (const f of ['positions.csv', 'committee_actions.csv']) writeFileSync(join(dir, f), readFileSync(join(dir, f), 'utf8').replaceAll(name, LONG))
  const review = importReview(dir, 'r1')
  await db.saveReview({ id: 'r1', periodEnd: review.periodEnd, sourceDir: dir })

  // The findings, through the tools as the agent would propose them.
  const s: RunState = { review, now: new Date(), executions: [], checks: [], notes: [], findings: [], maxPython: 5 }
  const check = async (args: Record<string, string>) => (await callTool(s, 'run_check', args)) as CheckOut
  const valueOf = (c: CheckOut, key: string) => c.facts[`${c.check_id}:${key}`]?.split(' ')[0]
  const propose = async (a: Partial<FindingArgs>) => (await callTool(s, 'propose_finding', { title: 'Case', classification: 'observation', review_area: 'allocation_risk', materiality: 'medium', explanation: 'For the record.', ...a })) as { finding_id: string; validation: { state: string } }
  let breach: { p: string; c: CheckOut; rule: { rule_id: string; version: string } } | undefined
  for (const p of rows(review, 'portfolios')) {
    const c = await check({ check: 'lookthrough_exposure', portfolio_id: p.portfolio_id, asset_class: 'equity' })
    const rule = c.comparisons?.find((x) => x.status === 'breach')
    if (rule) breach = { p: p.portfolio_id, c, rule }
  }
  assert.ok(breach, 'the fixture has an equity breach')
  const { p, c, rule } = breach
  const unbroken = 'x'.repeat(300)
  const code = `label = "${unbroken}"\nrows = read_data('positions', columns=['portfolio_id', 'instrument_id', 'reported_weight'])\nfor r in rows:\n    print(r['portfolio_id'], r['instrument_id'], r['reported_weight'])\nlen(rows)`
  const x = (await callTool(s, 'run_python', { purpose: 'List every holding with its reported weight.', code })) as { execution_id: string; ok: boolean }
  assert.ok(x.ok)
  // F1: the breach with a claim for every holding's weight and contribution, so its figures table runs past a page.
  const perHolding: Claim[] = Object.keys(c.facts)
    .filter((k) => /:(weight|contribution)$/.test(k))
    .map((k, i) => {
      const [, instrument, what] = k.split(':')
      return what === 'weight'
        ? { key: `w${i}`, label: `Weight of ${instrument}`, value: valueOf(c, `${instrument}:weight`), measure: 'holding_weight', instrument, source: { fact: k } }
        : { key: `c${i}`, label: `Contribution of ${instrument} to equity exposure`, value: valueOf(c, `${instrument}:contribution`), measure: 'exposure_contribution', instrument, asset_class: 'equity', source: { fact: k } }
    })
  const limit = valueOf(c, `rule:${rule.rule_id}:limit`)
  const excess = valueOf(c, `rule:${rule.rule_id}:breach`)
  const f1 = await propose({
    title: 'Look-through equity exposure above its maximum',
    classification: 'potential_exception',
    materiality: 'high',
    portfolios: [p],
    policy_rule: { rule_id: rule.rule_id, version: rule.version },
    statement: `Equity exposure was ${valueOf(c, 'exposure')}, above the ${limit} maximum by ${excess}.`,
    claims: [
      { key: 'exposure', label: 'Equity exposure', value: valueOf(c, 'exposure'), measure: 'exposure', asset_class: 'equity', source: { fact: `${c.check_id}:exposure` } },
      { key: 'limit', label: 'Equity maximum', value: limit, measure: 'policy_limit', source: { rule: rule.rule_id, version: rule.version } },
      { key: 'excess', label: 'Excess over the limit', value: excess, measure: 'limit_breach', source: { fact: `${c.check_id}:rule:${rule.rule_id}:breach` } },
      ...perHolding,
    ],
    cited_rows: [...rows(review, 'positions'), ...rows(review, 'lookthrough')].map((r) => r.row_id),
    execution_ids: [x.execution_id],
    uncertainties: ['Period-end positions do not show the trades that moved the weights.', 'Whether a remediation plan exists is not recorded.'],
  })
  assert.equal(f1.validation.state, 'validated')
  // F2: negative figures, from the portfolio with the lowest return.
  const perf = await Promise.all(rows(review, 'portfolios').map((x) => check({ check: 'relative_performance', portfolio_id: x.portfolio_id })))
  const worst = perf.reduce((a, b) => (Number(b.portfolio_return) < Number(a.portfolio_return) ? b : a))
  const [ret, bench, diff] = ['portfolio_return', 'benchmark_return', 'return_difference'].map((k) => valueOf(worst, k))
  assert.match(`${ret} ${diff}`, /^-.*% -.*pp$/, 'a negative return and a negative difference')
  const f2 = await propose({
    title: 'Return below its benchmark',
    classification: 'explained_anomaly',
    portfolios: [String(worst.portfolio_id)],
    statement: `The portfolio returned ${ret} against a benchmark return of ${bench}, a difference of ${diff}.`,
    claims: [
      { key: 'ret', label: 'Portfolio return', value: ret, measure: 'portfolio_return', source: { fact: `${worst.check_id}:portfolio_return` } },
      { key: 'bench', label: 'Benchmark return', value: bench, measure: 'benchmark_return', source: { fact: `${worst.check_id}:benchmark_return` } },
      { key: 'diff', label: 'Difference from the benchmark', value: diff, measure: 'return_difference', source: { fact: `${worst.check_id}:return_difference` } },
    ],
  })
  assert.equal(f2.validation.state, 'validated')
  // F3: an exception whose figure has no claim, stored as an observation and shown as unresolved; and an open question.
  await propose({ title: 'Unsupported exception', classification: 'potential_exception', portfolios: [p], statement: 'Equity is 99.99% of the portfolio.', check_ids: [c.check_id] })
  const question = 'Whether the Committee was notified of the fall is not recorded in any source.'
  await callTool(s, 'record_note', { kind: 'open_question', text: question })
  const at = new Date().toISOString()
  const sources = review.sources.map(({ id, file, sha256 }) => ({ id, file, sha256 }))
  await db.saveRun({ id: 'run-r1-1', reviewId: 'r1', startedAt: at, endedAt: at, status: 'completed_with_uncertainties', config: { ...CONFIG, sources }, turns: 1, toolCalls: 1, usage: {}, summary: '', events: [], state: s })

  // Submitted and filed in the test double, then the pack.
  const fake = cairnFake()
  const cairn = cairnClient({ baseUrl: 'https://cairn.test', key: fake.key, fetch: fake.fetch })
  await ledger.openRecord(cairn, 'r1', { subjectReference: fake.subject.cairnReference, procedureName: fake.procedure.name })
  const ref = (id: string) => ({ runId: 'run-r1-1', id, version: 1 })
  const sent = [...(await ledger.submitFinding(cairn, ref(f1.finding_id))), ...(await ledger.submitFinding(cairn, ref(f2.finding_id)))]
  for (const e of sent) fake.file(e.candidate_id!)
  const generated = await pack.generatePack(cairn, 'r1')
  assert.ok('pack' in generated, 'blockers' in generated ? generated.blockers.map((b) => b.reason).join('\n') : '')
  const out = process.env.IGI_RENDER_OUT
  if (out) mkdirSync(out, { recursive: true })

  // Each package: the file Cairn received is the stored file, byte for byte, named and typed as recorded, and its
  // text holds every figure, label and reference of the payload it was rendered from.
  for (const id of [f1.finding_id, f2.finding_id]) {
    const [row] = await db.sql<{ artifacts: FindingArtifacts }[]>`select artifacts from finding where run_id = 'run-r1-1' and id = ${id} and version = 1`
    const bytes = getFile(row.artifacts.package.key)
    const payload = JSON.parse(new TextDecoder().decode(getFile(row.artifacts.payload.key))) as FindingPayload
    const file = fake.candidates.find((x) => x.kind === 'file' && x.sourceReference === `IGI r1, run ${payload.run.tag}, ${id} v1`)!
    assert.equal(sha256(file.bytes!), row.artifacts.package.sha256)
    assert.equal(sha256(bytes), row.artifacts.package.sha256)
    assert.deepEqual([file.filename, row.artifacts.package.mediaType], [payload.packageName, 'application/pdf'])
    assert.equal(sent.find((e) => e.finding_id === id && e.kind === 'file')!.payload_sha256, row.artifacts.package.sha256)
    const pages = await pdfPages(bytes)
    if (out) writeFileSync(join(out, `package-${id}.pdf`), bytes)
    const text = flat(pages)
    for (const r of payload.validation.claims!) assert.ok(text.includes(r.label) && text.includes(r.value!), `${id}: ${r.label} ${r.value}`)
    for (const want of [payload.finding.statement, `IGI finding ${id} version 1`, `(run ${payload.run.tag})`, 'Summary', 'Key figures and how IGI checked them', 'Evidence index', 'Methodology', 'Sources', 'Appendix A: check results in full', ...payload.finding.uncertainties])
      assert.ok(text.includes(want), `${id}: "${want}"`)
    for (const r of payload.finding.citedRows) assert.match(text, new RegExp(`${r}(?!\\d)`), `${id}: cited row ${r}`)
    if (id === f1.finding_id) {
      assert.ok(pages.length >= 3, 'the long figures table and appendices run to several pages')
      assert.ok(text.includes('Appendix B: executed code'))
      assert.ok(text.replace(/\s/g, '').includes(`label="${unbroken}"`), 'the unbroken code line wraps without losing a character')
    }
    assert.deepEqual(layoutProblems(pages, payload.finding.statement), [], `${id} package layout`)
  }

  // The pack: its PDF is the stored file, and shows each included finding's figures, the run tag, the long fund name
  // in the open actions, and the unresolved matters.
  const v1 = generated.pack
  const pdf = getFile(v1.pdf_key!)
  assert.equal(sha256(pdf), v1.pdf_sha256)
  if (out) writeFileSync(join(out, 'pack-v1.pdf'), pdf)
  const pages = await pdfPages(pdf)
  const text = flat(pages)
  for (const f of v1.snapshot.findings) {
    assert.ok(text.includes(f.title), f.title)
    for (const r of f.claims!) assert.ok(text.includes(r.value!), `pack: ${f.id} ${r.label} ${r.value}`)
  }
  for (const want of [LONG, question, `${f1.finding_id} v1`, 'Matters the analysis could not resolve', v1.snapshot_sha256.slice(0, 12)]) assert.ok(text.includes(want), `pack: "${want}"`)
  assert.equal(pages[0].links, v1.snapshot.findings.length, 'the overview links to each finding')
  assert.deepEqual(layoutProblems(pages, v1.snapshot.findings[0].statement), [], 'pack layout')

  // With every finding withdrawn and its evidence voided, and the unsent exception withdrawn, a pack with no findings.
  for (const id of [f1.finding_id, f2.finding_id]) await ledger.withdrawFinding(ref(id), 'Withdrawn to check the empty pack.')
  for (const e of sent) fake.voidEvidence(e.candidate_id!)
  await ledger.withdrawFinding(ref('F3'), 'Not material.')
  const empty = await pack.generatePack(cairn, 'r1')
  assert.ok('pack' in empty, 'blockers' in empty ? empty.blockers.map((b) => b.reason).join('\n') : '')
  const emptyPdf = getFile(empty.pack.pdf_key!)
  if (out) writeFileSync(join(out, 'pack-v2-empty.pdf'), emptyPdf)
  const emptyPages = await pdfPages(emptyPdf)
  assert.match(flat(emptyPages), /No findings\. Every potential exception the analysis proposed was rejected in Cairn or withdrawn/)
  assert.deepEqual(layoutProblems(emptyPages, 'No findings.'), [], 'empty pack layout')
})
