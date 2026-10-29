// Documented layouts (spec §7.1, §7.5): how IGI reads each kind of source from an XLSX workbook, a DOCX document
// or a text-based PDF into the same canonical rows as its CSV, keeping each row's original location, the original
// text of any value it normalised (a percentage, a written date), and any formula behind a value. A sheet, table or
// document outside these layouts, a value with no unit, or a formula with no cached result is reported, never
// guessed. The layouts are bounded: these are the demo's documents, not arbitrary financial files.
import { dec, div, fmt, isDec } from './decimal.ts'
import { readDocument } from './docx.ts'
import { readPdf, type PdfLine } from './pdf.ts'
import { columnLetters, readWorkbook, type Cell } from './xlsx.ts'

// Bumped when a layout or its normalisation changes, and recorded with every source read through it.
export const EXTRACTOR = 'layouts v1'

// Where a row came from: its location in the file, where any field came from elsewhere (a period end from a column
// header, a meeting date from a paragraph), the original text of any value normalisation changed, and the formula
// behind any value that is a formula's cached result.
export type Provenance = { location: string; fields?: Record<string, string>; original?: Record<string, string>; formulas?: Record<string, string> }
// One table read from a document: its kind (a CSV kind's id), its canonical rows, each row's provenance, the
// original header label of each field, and what could not be read cleanly.
export type Table = { kind: string; rows: Record<string, string>[]; provenance: Provenance[]; labels: Record<string, string>; issues: string[] }
// A policy document read from a PDF: its title and numbered sections, each with the page it starts on.
export type PolicyDocument = { title: string; sections: { id: string; heading: string; text: string; location: string }[] }
// Everything read from one file: its tables, a policy document if it is one, and issues about the file as a whole.
export type DocumentImport = { tables: Table[]; policy?: PolicyDocument; issues: string[] }

// How a field's value is normalised: text as written; a date to ISO; a fraction from a percentage or a number; an
// amount without its currency sign or separators.
type FieldType = 'text' | 'date' | 'fraction' | 'amount'
// A column of a layout: the header label as the document writes it, the canonical field it fills (null for a
// column that is read past, such as a fund name beside its id) and how its values are normalised.
type Column = [label: string, field: string | null, type?: FieldType]

// The worksheet and DOCX table layouts, recognised by their header row: these labels, in this order, and no others.
const TABLES: { kind: string; columns: Column[] }[] = [
  { kind: 'portfolios', columns: [['Portfolio ID', 'portfolio_id'], ['Name', 'portfolio_name'], ['Objective', 'objective'], ['Benchmark', 'benchmark']] },
  { kind: 'positions', columns: [['Portfolio', 'portfolio_id'], ['Valuation date', 'period_end', 'date'], ['Instrument ID', 'instrument_id'], ['Fund', 'instrument_name'], ['Fund type', 'fund_type'], ['Market value (GBP)', 'market_value_gbp', 'amount'], ['Weight', 'reported_weight', 'fraction']] },
  { kind: 'performance', columns: [['Portfolio', 'portfolio_id'], ['Period end', 'period_end', 'date'], ['Portfolio return', 'portfolio_return', 'fraction'], ['Benchmark return', 'benchmark_return', 'fraction']] },
  { kind: 'lookthrough', columns: [['Instrument ID', 'instrument_id'], ['Fund', null], ['As at', 'as_of', 'date'], ['Asset class', 'asset_class'], ['Exposure', 'exposure_weight', 'fraction']] },
  { kind: 'fees', columns: [['Instrument ID', 'instrument_id'], ['Fund', null], ['Period end', 'period_end', 'date'], ['Ongoing charge', 'ongoing_charge', 'fraction']] },
  {
    kind: 'policy_rules',
    columns: [['Rule', 'rule_id'], ['Version', 'version'], ['Portfolio', 'portfolio_id'], ['Metric', 'metric'], ['Limit type', 'limit_type'], ['Limit', 'threshold', 'fraction'], ['Basis', 'basis'], ['Effective from', 'effective_from', 'date'], ['Effective to', 'effective_to', 'date'], ['Methodology', 'methodology'], ['Policy clause', 'document_clause']],
  },
  { kind: 'committee_actions', columns: [['Ref', 'action_id'], ['Action', 'action'], ['Owner', 'owner'], ['Due', 'due_date', 'date'], ['Status', 'status'], ['Notes', 'notes']] },
]
const label = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * A value as the canonical field needs it, from a cell or text as written. Returns the value, its original text
 * when normalising changed it, and an issue when it can't be used: a value with no unit where a percentage is
 * expected, a formula with no cached result, or a formula reading another workbook. An unusable value is blank,
 * so the import's checks report it missing and nothing depends on a guess.
 */
function normalise(type: FieldType, cell: Pick<Cell, 'value' | 'kind' | 'format' | 'formula'>, where: string): { value: string; original?: string; issue?: string } {
  if (cell.formula && /\[\d+\]/.test(cell.formula)) return { value: '', issue: `${where}: the formula =${cell.formula} reads another workbook; its value is not used` }
  if (cell.value === null) return cell.formula ? { value: '', issue: `${where}: the formula =${cell.formula} has no cached result; the value is not used` } : { value: '' }
  const raw = cell.value.replace(/\s+/g, ' ').trim()
  const text = cell.kind === 'text'
  if (!raw) return { value: '' }
  if (type === 'date' && text) {
    const m = /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/.exec(raw)
    const month = m ? MONTHS.indexOf(m[2].toLowerCase()) + 1 : 0
    return month ? { value: `${m![3]}-${String(month).padStart(2, '0')}-${m![1].padStart(2, '0')}`, original: raw } : { value: raw }
  }
  if (type === 'date' && cell.format !== 'date') return { value: raw, issue: `${where}: ${raw} is a number where a date is expected` }
  if (type === 'fraction' && text) {
    const m = /^([+\-−]?\d+(?:\.\d+)?)\s?%$/.exec(raw)
    if (m) {
      const n = m[1].replace('−', '-')
      return { value: fmt(div(dec(n), dec('100')), (n.split('.')[1]?.length ?? 0) + 2), original: raw }
    }
    return { value: '', issue: `${where}: "${raw}" has no unit; a percentage is written with %` }
  }
  if (type === 'amount' && text) {
    const n = raw.replace(/^£\s?/, '').replaceAll(',', '').replace('−', '-')
    return isDec(n) ? { value: n, original: raw } : { value: raw }
  }
  return { value: raw }
}

/**
 * Rows of one table in a recognised layout: each row's cells by column, normalised into canonical fields, with
 * where each came from. Rows stop at the first entirely blank row.
 */
function tableRows(kind: string, columns: Column[], body: { cells: (Cell | undefined)[]; location: string; refs: string[] }[]): Table {
  const t: Table = { kind, rows: [], provenance: [], labels: Object.fromEntries(columns.filter((c) => c[1]).map(([l, f]) => [f!, l])), issues: [] }
  for (const r of body) {
    if (r.cells.every((c) => !c?.value?.trim() && !c?.formula)) break
    const row: Record<string, string> = {}
    const p: Provenance = { location: r.location }
    columns.forEach(([, field, type = 'text'], i) => {
      if (!field) return
      const cell: Cell = r.cells[i] ?? { ref: '', value: null, kind: 'text', format: 'general' }
      const n = normalise(type, cell, r.refs[i])
      row[field] = n.value
      if (n.original !== undefined && n.original !== n.value) (p.original ??= {})[field] = n.original
      if (cell.formula) (p.formulas ??= {})[field] = `=${cell.formula}`
      if (n.issue) t.issues.push(n.issue)
    })
    t.rows.push(row)
    t.provenance.push(p)
  }
  return t
}

/** The layout whose header labels these cells are, exactly and in order. */
const layoutOf = (cells: string[]) => TABLES.find((l) => l.columns.length === cells.length && l.columns.every(([lab], i) => label(lab) === label(cells[i] ?? '')))

/**
 * Reads one XLSX, DOCX or PDF file into tables (and, for a policy PDF, its sections). A file that can't be read
 * at all throws Error with the reason; a readable file with nothing in a documented layout says so in its issues.
 */
export function importDocument(file: string, data: Uint8Array, sha256: string): DocumentImport {
  const ext = file.toLowerCase().split('.').pop()
  if (ext === 'xlsx') return workbookTables(data)
  if (ext === 'docx') return documentTables(data)
  if (ext === 'pdf') return pdfContent(data, sha256)
  throw new Error(`.${ext} files are not a supported format`)
}

/**
 * Each worksheet's table: its header row is the first of its first ten rows whose cells are a layout's labels,
 * and its rows follow until a blank row. A row's location is its sheet, row and cell range.
 */
function workbookTables(data: Uint8Array): DocumentImport {
  const out: DocumentImport = { tables: [], issues: [] }
  const sheets = readWorkbook(data)
  for (const s of sheets) {
    let found = false
    for (let r = 1; r <= 10 && !found; r++) {
      const cells = s.rows.get(r)
      if (!cells?.size) continue
      const first = Math.min(...cells.keys())
      const header = [...Array(Math.max(...cells.keys()) - first + 1)].map((_, i) => cells.get(first + i)?.value ?? '')
      const layout = layoutOf(header)
      if (!layout) continue
      found = true
      const n = layout.columns.length
      const body = []
      for (let row = r + 1; row <= r + 20000 && s.rows.has(row); row++) {
        const rc = s.rows.get(row)!
        body.push({ cells: [...Array(n)].map((_, i) => rc.get(first + i)), location: `sheet ${s.name}, row ${row} (${columnLetters(first)}${row}:${columnLetters(first + n - 1)}${row})`, refs: [...Array(n)].map((_, i) => `sheet ${s.name} ${columnLetters(first + i)}${row}`) })
      }
      out.tables.push(tableRows(layout.kind, layout.columns, body))
    }
  }
  if (!out.tables.length) out.issues.push(`no worksheet is in a documented layout (sheets: ${sheets.map((s) => s.name).join(', ')})`)
  return out
}

/**
 * The committee action log from minutes: the table whose header row is the action layout's, and the meeting date
 * from the paragraph that states it ("Meeting held on 15 July 2026."), which every row shares.
 */
function documentTables(data: Uint8Array): DocumentImport {
  const out: DocumentImport = { tables: [], issues: [] }
  const blocks = readDocument(data)
  const meeting = blocks.find((b) => b.kind === 'paragraph' && /^Meeting held on (.+?)\.?$/i.test(b.text.trim()))
  const date = meeting?.kind === 'paragraph' ? normalise('date', { value: /^Meeting held on (.+?)\.?$/i.exec(meeting.text.trim())![1], kind: 'text', format: 'general' }, `paragraph ${meeting.index}`) : undefined
  for (const b of blocks) {
    if (b.kind !== 'table') continue
    const layout = layoutOf(b.rows[0] ?? [])
    if (!layout) continue
    const text = (v: string | undefined): Cell => ({ ref: '', value: v ?? null, kind: 'text', format: 'general' })
    const t = tableRows(layout.kind, layout.columns, b.rows.slice(1).map((r, i) => ({ cells: r.map(text), location: `table ${b.index}, row ${i + 2}`, refs: r.map((_, j) => `table ${b.index}, row ${i + 2}, cell ${j + 1}`) })))
    // Every action takes the meeting's date, drawn from a paragraph outside the table.
    if (layout.kind === 'committee_actions') {
      if (!date || !meeting) t.issues.push('the minutes do not state the meeting date ("Meeting held on …")')
      t.rows.forEach((r, i) => {
        r.meeting_date = date?.value ?? ''
        if (meeting) t.provenance[i].fields = { meeting_date: `paragraph ${meeting.index}` }
        if (date?.original) (t.provenance[i].original ??= {}).meeting_date = date.original
      })
      t.labels.meeting_date = 'Meeting held on'
    }
    if (b.rows.slice(1).some((r) => r.length !== layout.columns.length)) t.issues.push(`table ${b.index}: a row has a different number of cells from the header; check merged cells`)
    out.tables.push(t)
  }
  if (!out.tables.length) out.issues.push('no table in the document is in a documented layout')
  return out
}

/**
 * A text-based PDF: a fee schedule (a table headed Instrument ID, Fund, then "Ongoing charge at <date>" for each
 * period), or a policy document (a title and numbered sections). Page footers ("Page 1 of 2") are left out.
 */
function pdfContent(data: Uint8Array, sha256: string): DocumentImport {
  const lines = readPdf(data, sha256).lines.filter((l) => !/\bPage \d+ of \d+\b/.test(l.text))
  const charge = /^Ongoing charge at (.+)$/i
  const header = lines.findIndex((l) => l.cells.length >= 3 && label(l.cells[0].text) === 'instrument id' && label(l.cells[1].text) === 'fund' && l.cells.slice(2).every((c) => charge.test(c.text)))
  if (header >= 0) return { tables: [feeTable(lines, header)], issues: [] }
  const policy = policyDocument(lines)
  return policy ? { tables: [], policy, issues: [] } : { tables: [], issues: ['the PDF is not in a documented layout: neither a fee schedule nor a policy document with numbered sections'] }
}

/**
 * The fee schedule's rows, one per fund and period: each body line with as many cells as the header gives one row
 * per period column, the period end taken from that column's header. The table ends at the first line that isn't
 * a full row; a repeated header on a later page is skipped.
 */
function feeTable(lines: PdfLine[], at: number): Table {
  const head = lines[at]
  const periods = head.cells.slice(2).map((c) => normalise('date', { value: /^Ongoing charge at (.+)$/i.exec(c.text)![1], kind: 'text', format: 'general' }, `header "${c.text}"`))
  const t: Table = { kind: 'fees', rows: [], provenance: [], labels: { instrument_id: 'Instrument ID', period_end: 'Ongoing charge at <date> (column header)', ongoing_charge: 'Ongoing charge at <date>' }, issues: [] }
  let n = 0
  for (const l of lines.slice(at + 1)) {
    if (l.text === head.text) continue
    if (l.cells.length !== head.cells.length) {
      if (l.cells.length > 1) t.issues.push(`page ${l.page}: "${l.text}" could not be split into the fee table's columns; it was not read`)
      if (n && l.cells.length < 2) break
      continue
    }
    n++
    periods.forEach((period, i) => {
      const where = `page ${l.page}, fee table row ${n}, column ${i + 3}`
      const v = normalise('fraction', { value: l.cells[i + 2].text, kind: 'text', format: 'general' }, where)
      if (v.issue) t.issues.push(v.issue)
      t.rows.push({ instrument_id: l.cells[0].text, period_end: period.value, ongoing_charge: v.value })
      t.provenance.push({ location: `page ${l.page}, fee table row ${n}`, fields: { period_end: `column ${i + 3} header "${head.cells[i + 2].text}"` }, original: { ...(period.original ? { period_end: period.original } : {}), ...(v.original ? { ongoing_charge: v.original } : {}) } })
    })
  }
  return t
}

/**
 * A policy document: its title (the largest text on the first page) and sections, each starting at a heading line
 * set larger than the body text and numbered "3. Name". A section's text is its paragraphs, a paragraph ending at
 * a gap of more than 1.6 lines or a page break; a word broken at a hyphen across lines is joined back up.
 */
function policyDocument(lines: PdfLine[]): PolicyDocument | undefined {
  if (!lines.length) return undefined
  const sizes = lines.map((l) => Math.round(l.size * 2) / 2)
  const body = [...sizes].sort((a, b) => sizes.filter((x) => x === b).length - sizes.filter((x) => x === a).length)[0]
  const title = lines.filter((l) => l.page === lines[0].page).reduce((a, b) => (b.size > a.size ? b : a)).text
  const sections: PolicyDocument['sections'] = []
  let paragraphs: string[] = []
  let prev: PdfLine | undefined
  const close = () => {
    if (sections.length) sections.at(-1)!.text = paragraphs.join('\n\n')
    paragraphs = []
  }
  for (const l of lines) {
    const heading = l.size > body * 1.15 && /^(\d+)\.\s+\S/.exec(l.text)
    if (heading) {
      close()
      sections.push({ id: heading[1], heading: l.text, text: '', location: `page ${l.page}` })
    } else if (sections.length && l.size <= body * 1.15) {
      const sameParagraph = prev && paragraphs.length && prev.page === l.page && prev.y - l.y <= l.size * 1.6
      if (sameParagraph) paragraphs[paragraphs.length - 1] += /\p{L}-$/u.test(paragraphs.at(-1)!) && /^\p{L}/u.test(l.text) ? l.text : ` ${l.text}`
      else paragraphs.push(l.text)
    }
    prev = l
  }
  close()
  return sections.length ? { title, sections } : undefined
}
