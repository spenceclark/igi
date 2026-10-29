// A review's uploaded sources (spec §6.2, §10.3). Every upload is kept as an immutable version in the file store
// under sources/<sha256>/<file>; the review's current sources are the latest upload of each file name. The importer
// reads a folder, so the current set is copied into a temporary folder named after it, rebuilt whenever it's missing.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from './db.ts'
import { filePath, getFile, putFile } from './files.ts'

// File names IGI accepts, by extension (§7.5), and the largest upload. Legacy and macro-enabled Office files are
// refused by name with a reason; a file of an accepted type that isn't in a documented layout is reported on import.
const FILE_NAME = /^[\w][\w .()-]{0,120}\.(csv|md|xlsx|docx|pdf)$/i
const LEGACY = /\.(xls|xlsm|xlsb|doc|docm)$/i
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex')

// One current source of a review: its file name, the SHA-256 of the version in use, and when it was uploaded.
export type CurrentSource = { file: string; sha256: string; uploaded_at: Date }

/**
 * Stores an uploaded source file as a new version for the review. The name must be a plain file name of an accepted
 * type, so it can't reach outside the review's folder; an empty or oversized file is refused. Uploading the same
 * bytes again makes that version current again.
 */
export async function uploadSource(reviewId: string, file: string, bytes: Uint8Array): Promise<CurrentSource> {
  if (LEGACY.test(file)) throw new Error(`${file}: legacy and macro-enabled Office files are not supported; save it as .xlsx or .docx`)
  if (!FILE_NAME.test(file)) throw new Error(`"${file}" is not an accepted source file: CSV, XLSX, DOCX, a text-based PDF or the Markdown policy document, with a plain file name`)
  if (!bytes.length) throw new Error(`${file} is empty`)
  if (bytes.length > MAX_SOURCE_BYTES) throw new Error(`${file} is over ${MAX_SOURCE_BYTES / 1024 / 1024} MB`)
  const sha = sha256(bytes)
  putFile(`sources/${sha}/${file}`, bytes)
  const [row] = await sql<CurrentSource[]>`
    insert into review_source (review_id, file, sha256) values (${reviewId}, ${file}, ${sha})
    on conflict (review_id, file, sha256) do update set uploaded_at = now(), removed_at = null returning file, sha256, uploaded_at`
  return row
}

/**
 * Removes a file from the review's current sources, so a stray or conflicting file can be taken out (§6.2). Its
 * versions stay in the file store and in the runs that analysed them; uploading the file again makes it current.
 */
export async function removeSource(reviewId: string, file: string) {
  const removed = await sql`update review_source set removed_at = now() where review_id = ${reviewId} and file = ${file} and removed_at is null`
  if (!removed.count) throw new Error(`${file} is not a current source of review ${reviewId}`)
}

/** The review's current sources: the latest upload of each file name, unless the file was removed since. */
export const currentSources = (reviewId: string) =>
  sql<CurrentSource[]>`
    select file, sha256, uploaded_at from (
      select distinct on (file) file, sha256, uploaded_at, removed_at from review_source where review_id = ${reviewId} order by file, uploaded_at desc
    ) latest where removed_at is null order by file`

/** The review's period end as an ISO date (§6.1), which the importer analyses the sources for. */
export async function reviewPeriod(reviewId: string): Promise<string> {
  const [r] = await sql<{ period_end: string }[]>`select period_end::text from review where id = ${reviewId}`
  if (!r) throw new Error(`no review ${reviewId}`)
  return r.period_end
}

/**
 * The folder the importer reads for the review. With uploaded sources it is a temporary folder holding exactly the
 * current versions (assemble). A review made on the command line from a scenario folder has no uploads and uses
 * that folder.
 */
export async function reviewDir(reviewId: string): Promise<string> {
  const files = await currentSources(reviewId)
  if (!files.length) {
    const [r] = await sql<{ source_dir: string | null }[]>`select source_dir from review where id = ${reviewId}`
    if (!r?.source_dir) throw new Error(`review ${reviewId} has no sources; upload them first`)
    return r.source_dir
  }
  return assemble(reviewId, files)
}

/** The review's current source files and their hashes: the uploads in use, or the files in its command-line folder. */
export async function sourceSet(reviewId: string): Promise<{ file: string; sha256: string }[]> {
  const files = await currentSources(reviewId)
  if (files.length) return files.map(({ file, sha256 }) => ({ file, sha256 }))
  const dir = await reviewDir(reviewId)
  return readdirSync(dir).sort().map((file) => ({ file, sha256: sha256(readFileSync(join(dir, file))) }))
}

/**
 * A folder holding exactly the given source versions from the file store, for the importer: a review's current
 * uploads, or the sources an earlier analysis run recorded. Named by their hashes and written to a sibling folder
 * then renamed, so a reader never sees it half-written. Throws if a version isn't retained.
 */
export function assemble(reviewId: string, files: { file: string; sha256: string }[]): string {
  const dir = join(tmpdir(), 'igi-reviews', reviewId, sha256(files.map((f) => `${f.file} ${f.sha256}`).join('\n')).slice(0, 16))
  if (existsSync(dir)) return dir
  const partial = `${dir}.${process.pid}.partial`
  rmSync(partial, { recursive: true, force: true })
  mkdirSync(partial, { recursive: true })
  for (const f of files) {
    const key = `sources/${f.sha256}/${f.file}`
    if (!existsSync(filePath(key))) throw new Error(`${f.file} (SHA-256 ${f.sha256.slice(0, 12)}) is not retained in IGI's file store`)
    writeFileSync(join(partial, f.file), getFile(key))
  }
  try {
    renameSync(partial, dir)
  } catch (e) {
    // Another request assembled the same folder first: theirs is identical, so use it.
    if (!existsSync(dir)) throw e
    rmSync(partial, { recursive: true, force: true })
  }
  return dir
}
