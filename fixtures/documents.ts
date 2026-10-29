// Writes a scenario's sources again as the documents a firm would hold (spec §7.1): the valuation report, model
// portfolios and limits, and fund look-through exposures as XLSX workbooks, the fee schedule and investment policy as
// text-based PDFs, and the committee minutes as DOCX. The rows are the CSV files' own, in the same order, so
// importing either folder gives the same values and row ids. Nothing here hints at what the scenario plants.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dec, fmt, mul } from '../server/src/decimal.ts'
import { writeDocument } from '../server/src/docx.ts'
import { renderPdf } from '../server/src/render.ts'
import { writeWorkbook, type CellIn } from '../server/src/xlsx.ts'

type Rows = Record<string, string>[]
// The scenario's rows by source, as written to its CSV files, and its policy document in Markdown.
export type ScenarioRows = { portfolios: Rows; positions: Rows; performance: Rows; lookthrough: Rows; fees: Rows; actions: Rows; rules: Rows; policy: string }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** An ISO date as people write it: 30 September 2026. */
const longDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
/** A fraction as a percentage to two places: 0.0040 is 0.40%. */
const percent = (f: string) => `${fmt(mul(dec(f), dec('100')), 2)}%`
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

// A plain document style; table cells never wrap, so each row prints on one line, as the fee schedule layout needs.
const CSS = 'body { font: 10.5pt/1.45 system-ui, sans-serif; color: #1c1c1c; } h1 { font-size: 17pt; } h2 { font-size: 13pt; margin-top: 1.4em; } table { border-collapse: collapse; } th, td { white-space: nowrap; text-align: left; padding: 3pt 14pt 3pt 0; border-bottom: 0.5pt solid #999; }'
const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`

/**
 * A rendered PDF with its creation and modification dates fixed (same length, so its cross-reference offsets still
 * hold), so regenerating an unchanged scenario gives the same bytes.
 */
async function pdf(html: string, footer: string): Promise<Uint8Array> {
  const { bytes } = await renderPdf(html, footer)
  return new Uint8Array(Buffer.from(Buffer.from(bytes).toString('latin1').replace(/D:\d{14}/g, 'D:20261002090000'), 'latin1'))
}

/** The policy document's Markdown as HTML: headings, bulleted lines and paragraphs, everything escaped. */
function policyHtml(md: string): string {
  return md
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((b) => (b.startsWith('# ') ? `<h1>${esc(b.slice(2))}</h1>` : b.startsWith('## ') ? `<h2>${esc(b.slice(3))}</h2>` : b.startsWith('- ') ? `<ul>${b.split('\n').map((l) => `<li>${esc(l.replace(/^- /, ''))}</li>`).join('')}</ul>` : `<p>${esc(b)}</p>`))
    .join('\n')
}

/** Writes the six documents into dir. */
export async function writeDocuments(dir: string, s: ScenarioRows) {
  mkdirSync(dir, { recursive: true })
  const write = (file: string, data: Uint8Array) => writeFileSync(`${dir}/${file}`, data)
  const names = new Map(s.positions.map((p) => [p.instrument_id, p.instrument_name]))

  // The valuation report: holdings with each weight as the administrator's rounded formula, and returns.
  const first = 5 // the first holding's row: a title, the preparation date, a blank row and the header come before it
  write(
    'valuation-report.xlsx',
    writeWorkbook([
      {
        name: 'Holdings',
        rows: [
          ['Model portfolio valuation report'],
          ['Prepared on 2 October 2026 by Fund Administration'],
          [],
          ['Portfolio', 'Valuation date', 'Instrument ID', 'Fund', 'Fund type', 'Market value (GBP)', 'Weight'],
          ...s.positions.map((p, i): CellIn[] => {
            const r = first + i
            return [p.portfolio_id, { date: p.period_end }, p.instrument_id, p.instrument_name, p.fund_type, { n: p.market_value_gbp, show: 'amount' }, { n: p.reported_weight, show: 'percent', formula: `ROUND(F${r}/SUMIFS(F:F,A:A,A${r},B:B,B${r}),4)` }]
          }),
        ],
      },
      { name: 'Performance', rows: [['Portfolio returns for each period'], [], ['Portfolio', 'Period end', 'Portfolio return', 'Benchmark return'], ...s.performance.map((p): CellIn[] => [p.portfolio_id, { date: p.period_end }, { n: p.portfolio_return, show: 'percent' }, { n: p.benchmark_return, show: 'percent' }])] },
    ]),
  )
  // The model portfolios and their authoritative limits.
  write(
    'model-portfolios.xlsx',
    writeWorkbook([
      { name: 'Portfolios', rows: [['Portfolio ID', 'Name', 'Objective', 'Benchmark'], ...s.portfolios.map((p) => [p.portfolio_id, p.portfolio_name, p.objective, p.benchmark])] },
      {
        name: 'Limits',
        rows: [
          ['Investment limits (authoritative for compliance testing)'],
          [],
          ['Rule', 'Version', 'Portfolio', 'Metric', 'Limit type', 'Limit', 'Basis', 'Effective from', 'Effective to', 'Methodology', 'Policy clause'],
          ...s.rules.map((r): CellIn[] => [r.rule_id, r.version, r.portfolio_id, r.metric, r.limit_type, { n: r.threshold, show: 'percent' }, r.basis, { date: r.effective_from }, r.effective_to ? { date: r.effective_to } : null, r.methodology, r.document_clause]),
        ],
      },
    ]),
  )
  // The fund managers' look-through exposures.
  write(
    'fund-exposures.xlsx',
    writeWorkbook([{ name: 'Exposures', rows: [['Look-through exposures reported by fund managers'], [], ['Instrument ID', 'Fund', 'As at', 'Asset class', 'Exposure'], ...s.lookthrough.map((l): CellIn[] => [l.instrument_id, names.get(l.instrument_id) ?? '', { date: l.as_of }, l.asset_class, { n: l.exposure_weight, show: 'percent' }])] }]),
  )

  // The fee schedule: one row per fund, a column of charges for each period.
  const periods = [...new Set(s.fees.map((f) => f.period_end))].sort()
  const funds = [...new Set(s.fees.map((f) => f.instrument_id))]
  const charge = (id: string, period: string) => s.fees.find((f) => f.instrument_id === id && f.period_end === period)?.ongoing_charge
  const feeRows = funds.map((id) => `<tr><td>${esc(id)}</td><td>${esc(names.get(id) ?? '')}</td>${periods.map((p) => `<td>${charge(id, p) ? percent(charge(id, p)!) : ''}</td>`).join('')}</tr>`).join('')
  write(
    'fee-schedule.pdf',
    await pdf(
      page('Fund charges schedule', `<h1>Fund charges schedule</h1><p>Ongoing charges as published by each fund's manager, per cent a year.</p><table><thead><tr><th>Instrument ID</th><th>Fund</th>${periods.map((p) => `<th>Ongoing charge at ${longDate(p)}</th>`).join('')}</tr></thead><tbody>${feeRows}</tbody></table>`),
      'Fund charges schedule',
    ),
  )
  // The investment policy, from the same text as the Markdown version.
  const title = /^# (.+)$/m.exec(s.policy)?.[1] ?? 'Investment policy'
  write('investment-policy.pdf', await pdf(page(title, policyHtml(s.policy)), title))

  // The previous meeting's minutes, ending with the action log.
  const meeting = s.actions[0]?.meeting_date ?? ''
  write(
    `committee-minutes-${meeting}.docx`,
    writeDocument([
      { heading: 'Investment Committee: minutes', level: 1 },
      { paragraph: `Meeting held on ${longDate(meeting)}.` },
      { heading: 'Present', level: 2 },
      { paragraph: 'Chair of the Investment Committee; Head of Investments; Investment Manager; Risk Officer.' },
      { heading: 'Matters considered', level: 2 },
      { paragraph: 'The Committee reviewed the model portfolios against the investment policy and agreed the actions below.' },
      { heading: 'Actions', level: 2 },
      { table: [['Ref', 'Action', 'Owner', 'Due', 'Status', 'Notes'], ...s.actions.map((a) => [a.action_id, a.action, a.owner, a.due_date ? longDate(a.due_date) : '', a.status, a.notes])] },
    ]),
  )
}
