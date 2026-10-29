// Runs in a child process started by pdf.ts: reads one PDF from standard input and writes its text items as JSON
// to standard output. Kept apart so a hostile or broken PDF can only fail this process, under its time and memory
// limits (spec §16). pdfjs runs with font loading and console output off.
import { readFileSync } from 'node:fs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const MAX_PAGES = 50
const data = new Uint8Array(readFileSync(0))
// One text item: its page, position (x from the left, y from the bottom), width, font size and text.
type Item = { page: number; x: number; y: number; width: number; size: number; str: string }
try {
  const doc = await getDocument({ data, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise
  if (doc.numPages > MAX_PAGES) throw new Error(`the PDF has ${doc.numPages} pages; at most ${MAX_PAGES} are read`)
  const items: Item[] = []
  for (let page = 1; page <= doc.numPages; page++) {
    const content = await (await doc.getPage(page)).getTextContent()
    for (const i of content.items) if ('str' in i && i.str.trim()) items.push({ page, x: i.transform[4], y: i.transform[5], width: i.width, size: Math.hypot(i.transform[2], i.transform[3]), str: i.str })
  }
  done({ pages: doc.numPages, items })
} catch (e) {
  // An encrypted PDF is reported by name; anything else by its message.
  const err = e as Error
  done({ error: err.name === 'PasswordException' ? 'the PDF is encrypted; encrypted files are not supported' : `the PDF could not be read: ${err.message}` })
}

/** Writes the result and exits once it is flushed, whatever pdfjs still holds open. */
function done(result: unknown) {
  process.stdout.write(JSON.stringify(result), () => process.exit(0))
}
