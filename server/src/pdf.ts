// Text from a text-based PDF (spec §7.5): lines in reading order, each with its page, position and font size, and
// split into cells where a wide gap separates its text, as in a table. pdfjs runs in a child process (pdf-worker.ts)
// under a time and memory limit, which also keeps this synchronous for the importer. Results are kept per file hash.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// One line of text: its page, height on the page (from the bottom), font size, text, and cells with their x.
export type PdfLine = { page: number; y: number; size: number; text: string; cells: { x: number; text: string }[] }
export type PdfText = { pages: number; lines: PdfLine[] }
type Item = { page: number; x: number; y: number; width: number; size: number; str: string }

const WORKER = fileURLToPath(new URL('./pdf-worker.ts', import.meta.url))
const cache = new Map<string, PdfText>()

/**
 * Reads a PDF's text, refusing an encrypted PDF, one whose parsing fails or takes over 30 seconds, and one with no
 * text at all (a scanned or image-only PDF, which would need OCR). Throws Error with the reason.
 */
export function readPdf(data: Uint8Array, sha256: string): PdfText {
  const known = cache.get(sha256)
  if (known) return known
  let out: string
  try {
    out = execFileSync(process.execPath, ['--max-old-space-size=256', WORKER], { input: data, timeout: 30_000, maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] }).toString()
  } catch {
    throw new Error('the PDF could not be read within the time and memory allowed')
  }
  const r = JSON.parse(out) as { error: string } | { pages: number; items: Item[] }
  if ('error' in r) throw new Error(r.error)
  const text = { pages: r.pages, lines: lines(r.items) }
  if (!text.lines.length) throw new Error('the PDF has no text layer; scanned or image-only PDFs are not supported')
  cache.set(sha256, text)
  return text
}

/**
 * Groups text items into lines: by page, top to bottom, items whose baselines are within 40% of the font size
 * being one line. Within a line, a gap wider than the font size starts a new cell; a smaller visible gap is a space.
 */
function lines(items: Item[]): PdfLine[] {
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)
  const out: PdfLine[] = []
  let current: Item[] = []
  const flush = () => {
    if (!current.length) return
    current.sort((a, b) => a.x - b.x)
    const cells: { x: number; text: string }[] = []
    let prev: Item | undefined
    for (const i of current) {
      const gap = prev ? i.x - (prev.x + prev.width) : Infinity
      if (gap > i.size) cells.push({ x: i.x, text: i.str })
      else cells.at(-1)!.text += (gap > i.size * 0.15 && !/\s$/.test(cells.at(-1)!.text) && !/^\s/.test(i.str) ? ' ' : '') + i.str
      prev = i
    }
    for (const c of cells) c.text = c.text.replace(/\s+/g, ' ').trim()
    out.push({ page: current[0].page, y: current[0].y, size: Math.max(...current.map((i) => i.size)), text: cells.map((c) => c.text).join(' '), cells })
    current = []
  }
  for (const i of sorted) {
    const first = current[0]
    if (first && (i.page !== first.page || Math.abs(i.y - first.y) > first.size * 0.4)) flush()
    current.push(i)
  }
  flush()
  return out
}
