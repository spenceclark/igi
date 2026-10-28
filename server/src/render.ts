// PDFs from IGI's HTML templates (spec §10.4): a pinned headless Chromium, driven by Puppeteer, prints a page the
// templates built. The page runs no script and loads nothing from outside: every request but the page itself is
// refused, so text from the sources or the model can't reach the network or execute. One browser is shared by every
// render in the process; scripts close it when they finish.
import { readFileSync } from 'node:fs'
import puppeteer, { type Browser } from 'puppeteer'

const PUPPETEER = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> }).dependencies.puppeteer
// The browser, launched on first use. --no-sandbox only where Chromium's own sandbox can't run (a container as root).
let browser: Promise<Browser> | undefined
const launch = () => (browser ??= puppeteer.launch({ args: process.env.CHROMIUM_NO_SANDBOX ? ['--no-sandbox'] : [] }))

// What produced a PDF: the renderer and the template version, recorded with every output (the render manifest).
export type RenderInfo = { renderer: string; template: string }

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/**
 * Prints an HTML document to an A4 PDF, with a footer giving the document's title and "Page n of N". Returns the
 * bytes and the renderer's name and version. The PDF's creation date differs between renders, so two renders of the
 * same document match in content and layout, not byte for byte.
 */
export async function renderPdf(html: string, footer: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; renderer: string }> {
  const b = await launch()
  const page = await b.newPage()
  try {
    await page.setJavaScriptEnabled(false)
    await page.setRequestInterception(true)
    page.on('request', (r) => (r.isNavigationRequest() && r.frame() === page.mainFrame() ? r.continue() : r.abort()))
    await page.setContent(html, { waitUntil: 'load' })
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="font: 8px system-ui, sans-serif; color: #555; width: 100%; padding: 0 14mm; display: flex; justify-content: space-between"><span>${escape(footer)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
      tagged: true,
    })
    return { bytes: new Uint8Array(pdf), renderer: `${await b.version()} via Puppeteer ${PUPPETEER}` }
  } finally {
    await page.close()
  }
}

/** Closes the shared browser, if one was launched, so the process can exit. */
export async function closeRenderer() {
  if (!browser) return
  const b = browser
  browser = undefined
  await (await b).close()
}
