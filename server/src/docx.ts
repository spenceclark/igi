// Reading and writing DOCX documents (spec §7.5): the body's paragraphs and tables in order, with the locators a
// reader can find again (paragraph n, table n row n cell n) rather than page numbers, which depend on rendering.
// Fields, macros and embedded objects are never run. Writing is for the fixture generator and tests.
import { readZip, writeZip, xmlAttr, xmlEscape, xmlText } from './zip.ts'

// A body paragraph, with its style (Heading1, Normal) and 1-based position among the body's paragraphs; or a
// table, with its 1-based position among the tables and its cells' text by row.
export type Block = { kind: 'paragraph'; index: number; style: string; text: string } | { kind: 'table'; index: number; rows: string[][] }

/** The text of a paragraph's runs: text, tabs and line breaks. */
const paragraphText = (xml: string) =>
  [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)].map((m) => (m[0].startsWith('<w:tab') ? '\t' : m[0].startsWith('<w:br') ? '\n' : xmlText(m[1]))).join('')

// ponytail: parsed in the server process, like workbooks (see xlsx.ts); the PDF worker is the upgrade path.
/** Reads a document's body. Throws Error for a file that isn't a DOCX; an encrypted one is refused by its first bytes. */
export function readDocument(data: Uint8Array): Block[] {
  if (data[0] === 0xd0 && data[1] === 0xcf && data[2] === 0x11 && data[3] === 0xe0) throw new Error('an encrypted or legacy binary Office file; save it as an unprotected .docx')
  const xml = readZip(data).text('word/document.xml')
  if (!xml) throw new Error('not a DOCX document (no word/document.xml)')
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? ''
  const blocks: Block[] = []
  let paragraphs = 0
  let tables = 0
  // The body's children in order: a table (one level; documented layouts have no nested tables), an empty
  // paragraph, or a paragraph. A table's paragraphs belong to its cells, so they are not counted as body paragraphs.
  for (const m of body.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[\s\S]*?<\/w:p>/g)) {
    if (m[0].startsWith('<w:tbl')) {
      const rows = [...m[0].matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)].map((r) => [...r[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map((c) => [...c[0].matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((p) => paragraphText(p[0])).join('\n')))
      blocks.push({ kind: 'table', index: ++tables, rows })
    } else {
      const style = /<w:pStyle\b([^>]*)\/>/.exec(m[0])
      blocks.push({ kind: 'paragraph', index: ++paragraphs, style: (style && xmlAttr(style[1], 'w:val')) || 'Normal', text: paragraphText(m[0]) })
    }
  }
  return blocks
}

// ---- Writing, for the fixture generator and tests ----

// What to write: a heading at level 1 or 2, a paragraph, or a table whose first row is its header.
export type BlockIn = { heading: string; level: 1 | 2 } | { paragraph: string } | { table: string[][] }

/** A document of the given blocks, with heading styles defined so Word shows them as headings. */
export function writeDocument(blocks: BlockIn[]): Uint8Array {
  const ns = 'http://schemas.openxmlformats.org'
  const run = (text: string) => `<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`
  const para = (text: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${run(text)}</w:p>`
  const body = blocks
    .map((b) =>
      'heading' in b
        ? para(b.heading, `Heading${b.level}`)
        : 'paragraph' in b
          ? para(b.paragraph)
          : `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>${b.table.map((r) => `<w:tr>${r.map((c) => `<w:tc>${para(c)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`,
    )
    .join('')
  const heading = (n: number, size: number) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`
  return writeZip([
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
    },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    {
      name: 'word/styles.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="${ns}/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${heading(1, 32)}${heading(2, 26)}<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr></w:style></w:styles>`,
    },
    { name: 'word/document.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="${ns}/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>` },
  ])
}
