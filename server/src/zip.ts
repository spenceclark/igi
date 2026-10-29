// The zip container under XLSX and DOCX files (spec §7.5, §16). Reading is bounded: an archive may hold at most
// MAX_ENTRIES entries and expand to at most MAX_EXPANDED bytes in all, enforced while inflating, so a small file
// that declares small sizes but expands hugely is refused rather than filling memory. Encrypted entries, ZIP64 and
// compression methods other than stored and deflate are refused. Writing is for the fixture generator and tests.
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib'

export const MAX_ENTRIES = 2000
export const MAX_EXPANDED = 50 * 1024 * 1024

// One readable archive: its entry names, and each entry's bytes or text on demand (undefined when absent).
export type Zip = { names: string[]; bytes: (name: string) => Uint8Array | undefined; text: (name: string) => string | undefined }

/** Opens a zip archive, reading its central directory. Throws Error with a reason a person can act on. */
export function readZip(data: Uint8Array): Zip {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  // The end-of-central-directory record is the last 22 bytes, unless a comment of up to 65,535 bytes follows it.
  let end = -1
  for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 65535); i--)
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i
      break
    }
  if (end < 0) throw new Error('not a zip archive')
  const count = view.getUint16(end + 10, true)
  const dirOffset = view.getUint32(end + 16, true)
  if (count === 0xffff || dirOffset === 0xffffffff) throw new Error('ZIP64 archives are not supported')
  if (count > MAX_ENTRIES) throw new Error(`the archive has ${count} entries; at most ${MAX_ENTRIES} are read`)

  // Each central directory entry: flags, method, sizes, name, and where its local header is.
  const entries = new Map<string, { method: number; compressed: number; size: number; offset: number }>()
  let p = dirOffset
  for (let i = 0; i < count; i++) {
    if (p + 46 > data.length || view.getUint32(p, true) !== 0x02014b50) throw new Error('the archive directory is damaged')
    const flags = view.getUint16(p + 8, true)
    const nameLength = view.getUint16(p + 28, true)
    const name = new TextDecoder().decode(data.subarray(p + 46, p + 46 + nameLength))
    if (flags & 1) throw new Error(`${name} is encrypted; encrypted files are not supported`)
    entries.set(name, { method: view.getUint16(p + 10, true), compressed: view.getUint32(p + 20, true), size: view.getUint32(p + 24, true), offset: view.getUint32(p + 42, true) })
    p += 46 + nameLength + view.getUint16(p + 30, true) + view.getUint16(p + 32, true)
  }

  // Inflating draws on one budget for the whole archive, so many modest entries can't add up past the limit.
  let budget = MAX_EXPANDED
  const bytes = (name: string) => {
    const e = entries.get(name)
    if (!e) return undefined
    if (view.getUint32(e.offset, true) !== 0x04034b50) throw new Error(`${name}: damaged entry`)
    const start = e.offset + 30 + view.getUint16(e.offset + 26, true) + view.getUint16(e.offset + 28, true)
    const raw = data.subarray(start, start + e.compressed)
    let out: Uint8Array
    if (e.method === 0) out = raw
    else if (e.method === 8) {
      try {
        out = new Uint8Array(inflateRawSync(raw, { maxOutputLength: Math.max(1, budget) }))
      } catch {
        throw new Error(`${name} expands past the ${MAX_EXPANDED / 1024 / 1024} MB limit, or is damaged`)
      }
    } else throw new Error(`${name} uses compression method ${e.method}, which is not supported`)
    if (out.length > budget) throw new Error(`the archive expands past the ${MAX_EXPANDED / 1024 / 1024} MB limit`)
    budget -= out.length
    return out
  }
  return { names: [...entries.keys()], bytes, text: (name) => { const b = bytes(name); return b && new TextDecoder().decode(b) } }
}

/** Writes a zip archive of deflated entries with fixed timestamps, so the same content gives the same bytes. */
export function writeZip(files: { name: string; data: Uint8Array | string }[]): Uint8Array {
  const parts: Uint8Array[] = []
  const directory: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const data = typeof f.data === 'string' ? new TextEncoder().encode(f.data) : f.data
    const packed = deflateRawSync(data)
    const name = new TextEncoder().encode(f.name)
    const crc = crc32(data)
    // Local header then data; the central directory entry repeats the sizes and points back at the header.
    // 0x0021 is 1 January 1980 in DOS date format, the earliest a zip can record.
    const local = new DataView(new ArrayBuffer(30))
    ;[[0, 0x04034b50, 4], [4, 20, 2], [8, 8, 2], [12, 0x0021, 2], [14, crc, 4], [18, packed.length, 4], [22, data.length, 4], [26, name.length, 2]].forEach(([at, v, n]) => (n === 4 ? local.setUint32(at, v, true) : local.setUint16(at, v, true)))
    const central = new DataView(new ArrayBuffer(46))
    ;[[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [10, 8, 2], [14, 0x0021, 2], [16, crc, 4], [20, packed.length, 4], [24, data.length, 4], [28, name.length, 2], [42, offset, 4]].forEach(([at, v, n]) => (n === 4 ? central.setUint32(at, v, true) : central.setUint16(at, v, true)))
    parts.push(new Uint8Array(local.buffer), name, packed)
    directory.push(new Uint8Array(central.buffer), name)
    offset += 30 + name.length + packed.length
  }
  const dirSize = directory.reduce((n, b) => n + b.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  ;[[0, 0x06054b50, 4], [8, files.length, 2], [10, files.length, 2], [12, dirSize, 4], [16, offset, 4]].forEach(([at, v, n]) => (n === 4 ? end.setUint32(at, v, true) : end.setUint16(at, v, true)))
  return Buffer.concat([...parts, ...directory, new Uint8Array(end.buffer)])
}

// ---- The XML inside: only the five predefined entities and character references are decoded; any DTD is ignored ----

/** Text from XML content with its entities decoded. */
export const xmlText = (s: string) =>
  s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (_, hex: string | undefined, num: string | undefined, name: string | undefined) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : num ? String.fromCodePoint(Number(num)) : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name!.toLowerCase() as 'amp']!,
  )
/** Text escaped for XML content or a quoted attribute. */
export const xmlEscape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
/** An attribute's value from an element's attribute text, decoded; undefined when absent. */
export const xmlAttr = (attrs: string, name: string) => {
  const m = new RegExp(`(?:^|\\s)${name.replace(':', '\\:')}="([^"]*)"`).exec(attrs)
  return m ? xmlText(m[1]) : undefined
}
