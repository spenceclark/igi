// Turns PDFs into one PNG per page, at about the size a reader sees them on screen, for inspecting what IGI rendered
// (spec §15.8): `IGI_RENDER_OUT=<dir> node --test test/render.test.ts` writes the stress PDFs, and this renders any.
// Run from server/: node scripts/pdf-pages.ts <out dir> <file.pdf ...>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const [out, ...files] = process.argv.slice(2)
if (!out || !files.length) {
  console.error('usage: node scripts/pdf-pages.ts <out dir> <file.pdf ...>')
  process.exit(2)
}
mkdirSync(out, { recursive: true })
for (const file of files) {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(file)) }).promise
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    // 1.5 times the PDF's 72 points to the inch: an A4 page 893 pixels wide, as on a laptop screen at 100%.
    const viewport = page.getViewport({ scale: 1.5 })
    const canvas = createCanvas(viewport.width, viewport.height)
    // pdf.js types its canvas as the browser's; @napi-rs/canvas implements the same drawing calls.
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise
    const png = join(out, `${basename(file, '.pdf')}-p${n}.png`)
    writeFileSync(png, canvas.toBuffer('image/png'))
    console.log(png)
  }
  await doc.cleanup()
}
