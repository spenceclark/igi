// IGI's generated files (spec §10.3), immutable once written.
// ponytail: a local directory (FILES_DIR, default server/files/) until deployment, when this becomes the Spaces bucket.
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
