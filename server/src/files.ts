// IGI's generated files (spec §10.3), immutable once written.
// ponytail: a local directory (FILES_DIR, default server/files/) until deployment, when this becomes the Spaces bucket.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = () => process.env.FILES_DIR ?? fileURLToPath(new URL('../files/', import.meta.url))

/** Writes a file once. Writing the same bytes again is a no-op; different bytes under the same key are refused. */
export function putFile(key: string, bytes: Uint8Array) {
  const path = join(root(), key)
  if (existsSync(path)) {
    if (!Buffer.from(readFileSync(path)).equals(bytes)) throw new Error(`${key} already exists with different content`)
    return
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes)
}

export const getFile = (key: string) => new Uint8Array(readFileSync(join(root(), key)))
