// Reading and writing XLSX workbooks (spec §7.5): the cells of each worksheet as stored, with the provenance a
// reader needs: whether a value came from a formula's cached result, and the number format that says a number is a
// percentage or a date. Formulas are never evaluated and external links never followed. Writing is for the fixture
// generator and tests.
import { readZip, writeZip, xmlAttr, xmlEscape, xmlText } from './zip.ts'

// One cell as stored. value is the cell's content as text: a number as a plain decimal (to Excel's 15 significant
// digits), a date as an ISO date, text as written; null when there is none, as for a formula with no cached result.
// formula is the formula's text when the value is its cached result; format says how Excel displays a number.
export type Cell = { ref: string; value: string | null; kind: 'number' | 'text' | 'bool' | 'error'; format: 'percent' | 'date' | 'general'; formula?: string }
// A worksheet: its name and its cells by row and column (1-based), only those present.
export type Sheet = { name: string; rows: Map<number, Map<number, Cell>> }

// Built-in number formats that display dates (Excel's ids 14 to 22 and 45 to 47).
const DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])
// A sheet's first rows and columns are all a documented layout uses; a sheet past these limits is refused.
const MAX_ROWS = 20000
const MAX_COLUMNS = 100

/** A1-style column letters as a 1-based number: A is 1, Z is 26, AA is 27. */
const columnNumber = (letters: string) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0)
/** A 1-based column number as letters. */
export const columnLetters = (n: number): string => (n > 26 ? columnLetters(Math.floor((n - 1) / 26)) : '') + String.fromCharCode(65 + ((n - 1) % 26))

/**
 * A number as Excel holds it, written as a plain decimal: Excel keeps 15 significant digits, though its files may
 * store 17 (0.17299999999999999 for 0.173), so the value is rounded to 15 and trailing zeros dropped.
 */
export function plainNumber(stored: string): string {
  const n = Number(stored)
  if (!Number.isFinite(n)) return stored
  const [mantissa, exp] = n.toPrecision(15).split('e')
  const [whole, frac = ''] = mantissa.replace('-', '').split('.')
  const digits = whole + frac
  const point = whole.length + Number(exp ?? 0)
  const padded = point <= 0 ? `0.${'0'.repeat(-point)}${digits}` : point >= digits.length ? digits + '0'.repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`
  const trimmed = padded.includes('.') ? padded.replace(/0+$/, '').replace(/\.$/, '') : padded
  const clean = trimmed.replace(/^0+(?=\d)/, '') || '0'
  return n < 0 && clean !== '0' ? `-${clean}` : clean
}

/** An Excel date serial as an ISO date, in the workbook's date system (1900, or 1904 when the workbook says so). */
export function serialDate(serial: number, date1904 = false): string {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
  return new Date(epoch + Math.floor(serial) * 86_400_000).toISOString().slice(0, 10)
}

// ponytail: parsed in the server process, so a hostile workbook built to make these patterns backtrack could
// stall it; run importDocument in the PDF worker's child process if sources ever come from outside the operator.
/**
 * Reads every worksheet of a workbook, in the workbook's order. Throws Error for a file that isn't a workbook;
 * an encrypted or legacy binary file (a compound document, not a zip) is refused by its first bytes.
 */
export function readWorkbook(data: Uint8Array): Sheet[] {
  if (data[0] === 0xd0 && data[1] === 0xcf && data[2] === 0x11 && data[3] === 0xe0) throw new Error('an encrypted or legacy binary Office file; save it as an unprotected .xlsx')
  const zip = readZip(data)
  const workbook = zip.text('xl/workbook.xml')
  if (!workbook) throw new Error('not an XLSX workbook (no xl/workbook.xml)')
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(?:1|true)"/.test(workbook)

  // Shared strings: each <si> is plain text or rich-text runs, whose texts join; phonetic guides are left out.
  const shared = [...(zip.text('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    [...m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => xmlText(t[1])).join(''),
  )
  // Number formats by cell style index: a format code with % is a percentage; a date code, or a built-in date id.
  const styles = zip.text('xl/styles.xml') ?? ''
  const codes = new Map([...styles.matchAll(/<numFmt\b([^>]*)\/?>/g)].map((m) => [Number(xmlAttr(m[1], 'numFmtId')), xmlAttr(m[1], 'formatCode') ?? '']))
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? ''
  const formats = [...xfs.matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)].map((m): Cell['format'] => {
    const id = Number(xmlAttr(m[1], 'numFmtId') ?? 0)
    const code = (codes.get(id) ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')
    return id === 9 || id === 10 || code.includes('%') ? 'percent' : DATE_FORMATS.has(id) || /[dmy]/i.test(code) ? 'date' : 'general'
  })

  // Sheets in the workbook's order, each found through the workbook's relationships.
  const rels = zip.text('xl/_rels/workbook.xml.rels') ?? ''
  const targets = new Map([...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => [xmlAttr(m[1], 'Id'), xmlAttr(m[1], 'Target') ?? '']))
  return [...workbook.matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => {
    const name = xmlAttr(m[1], 'name') ?? ''
    const target = targets.get(xmlAttr(m[1], 'r:id')) ?? ''
    const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`
    const xml = zip.text(path)
    if (xml === undefined) throw new Error(`sheet ${name} is missing from the workbook`)
    const rows = new Map<number, Map<number, Cell>>()
    for (const c of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = xmlAttr(c[1], 'r') ?? ''
      const at = /^([A-Z]+)(\d+)$/.exec(ref)
      if (!at) continue
      const [row, col] = [Number(at[2]), columnNumber(at[1])]
      if (row > MAX_ROWS || col > MAX_COLUMNS) throw new Error(`sheet ${name} goes past row ${MAX_ROWS} or column ${MAX_COLUMNS}`)
      const inner = c[2] ?? ''
      const type = xmlAttr(c[1], 't') ?? 'n'
      const format = formats[Number(xmlAttr(c[1], 's') ?? 0)] ?? 'general'
      const formula = /<f\b[^>]*?(?:\/>|>([\s\S]*?)<\/f>)/.exec(inner)
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]
      // The value by cell type: a shared string, inline text, a formula's text result, a boolean, an error, or a
      // number, which a date format turns into a date.
      let cell: Cell
      if (type === 's') cell = { ref, value: v === undefined ? null : (shared[Number(v)] ?? null), kind: 'text', format }
      else if (type === 'inlineStr') cell = { ref, value: [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => xmlText(t[1])).join(''), kind: 'text', format }
      else if (type === 'str') cell = { ref, value: v === undefined ? null : xmlText(v), kind: 'text', format }
      else if (type === 'b') cell = { ref, value: v === undefined ? null : v === '1' ? 'TRUE' : 'FALSE', kind: 'bool', format }
      else if (type === 'e') cell = { ref, value: v === undefined ? null : xmlText(v), kind: 'error', format }
      else if (type === 'd') cell = { ref, value: v === undefined ? null : xmlText(v).slice(0, 10), kind: 'number', format: 'date' }
      else cell = { ref, value: v === undefined ? null : format === 'date' ? serialDate(Number(v), date1904) : plainNumber(v), kind: 'number', format }
      if (formula) cell.formula = xmlText(formula[1] ?? '(shared formula)')
      if (!rows.has(row)) rows.set(row, new Map())
      rows.get(row)!.set(col, cell)
    }
    return { name, rows }
  })
}

// ---- Writing, for the fixture generator and tests ----

// A cell to write: text, or a number (as a decimal string) shown as a percentage, a date (an ISO date, stored as a
// serial), an amount or plainly, optionally as a formula's cached result. A formula with no value has no result.
export type CellIn = string | null | { n?: string; date?: string; show?: 'percent' | 'amount'; formula?: string }

/** A workbook of the given sheets, every text in the shared strings table as Excel writes it. */
export function writeWorkbook(sheets: { name: string; rows: CellIn[][] }[]): Uint8Array {
  const strings: string[] = []
  const stringIndex = (s: string) => (strings.includes(s) ? strings.indexOf(s) : strings.push(s) - 1)
  // Styles: 0 general, 1 percentage to two places, 2 a date such as 30 Sep 2026, 3 an amount with separators.
  const style = { percent: 1, date: 2, amount: 3 }
  const serial = (iso: string) => String((Date.parse(iso) - Date.UTC(1899, 11, 30)) / 86_400_000)
  const sheetXml = (rows: CellIn[][]) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
      .map((r, i) => `<row r="${i + 1}">${r.map((c, j) => cellXml(c, `${columnLetters(j + 1)}${i + 1}`)).join('')}</row>`)
      .join('')}</sheetData></worksheet>`
  const cellXml = (c: CellIn, ref: string) => {
    if (c === null || c === '') return ''
    if (typeof c === 'string') return `<c r="${ref}" t="s"><v>${stringIndex(c)}</v></c>`
    const s = c.date ? style.date : c.show ? style[c.show] : 0
    const f = c.formula ? `<f>${xmlEscape(c.formula)}</f>` : ''
    const v = c.date ? serial(c.date) : c.n
    return `<c r="${ref}"${s ? ` s="${s}"` : ''}>${f}${v === undefined ? '' : `<v>${v}</v>`}</c>`
  }
  const sheetFiles = sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows) }))
  const ns = 'http://schemas.openxmlformats.org'
  return writeZip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
    },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${ns}/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rIdS" Type="${ns}/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdT" Type="${ns}/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    },
    {
      name: 'xl/styles.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="${ns}/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="d mmm yyyy"/></numFmts><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="10" applyNumberFormat="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="4" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    },
    ...sheetFiles,
    // Written last, once every sheet has added its strings.
    { name: 'xl/sharedStrings.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="${ns}/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${xmlEscape(s)}</t></si>`).join('')}</sst>` },
  ])
}
