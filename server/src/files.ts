// IGI's generated files (spec §10.3), immutable once written.
// ponytail: a local directory (FILES_DIR, default server/files/) until deployment, when this becomes the Spaces bucket.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Where a file's key puts it on disk. */
export const filePath = (key: string) => join(process.env.FILES_DIR ?? fileURLToPath(new URL('../files/', import.meta.url)), key)

/** Writes a file once. Writing the same bytes again is a no-op; different bytes under the same key are refused. */
export function putFile(key: string, bytes: Uint8Array) {
  const path = filePath(key)
  if (existsSync(path)) {
    if (!Buffer.from(readFileSync(path)).equals(bytes)) throw new Error(`${key} already exists with different content`)
    return
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes)
}

/** A stored file's bytes. */
export const getFile = (key: string) => new Uint8Array(readFileSync(filePath(key)))

/**
 * Keeps a copy of each source file under sources/<SHA-256>/<file>, so a hash in a run or pack refers to bytes IGI
 * still holds. Returns the keys, in the order given. Refuses a file whose bytes no longer match its hash.
 */
export function retainSources(dir: string, sources: { file: string; sha256: string }[]): string[] {
  return sources.map((s) => {
    const bytes = new Uint8Array(readFileSync(join(dir, s.file)))
    if (createHash('sha256').update(bytes).digest('hex') !== s.sha256) throw new Error(`${s.file} changed since it was imported`)
    const key = `sources/${s.sha256}/${s.file}`
    putFile(key, bytes)
    return key
  })
}
