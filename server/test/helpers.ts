// Shared by the tests that need the local IGI database (npm run db:up). Each test file gets its own database,
// igi_test_<name>, because node --test runs files in parallel; the tests skip when the container isn't running.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'
import type { RunConfig } from '../src/db.ts'
import type { Finding } from '../src/tools.ts'

const SERVER = 'postgres://igi:igi@127.0.0.1:5434'

/**
 * Points the server's modules at this file's test database and a temporary files directory. Call it before
 * importing anything that imports db.ts, which connects to DATABASE_URL when loaded. Returns why to skip, if so.
 */
export async function useTestDatabase(name: string): Promise<string | false> {
  const database = `igi_test_${name}`
  try {
    const admin = postgres(`${SERVER}/igi`, { onnotice: () => {}, connect_timeout: 3 })
    await admin`create database ${admin(database)}`.catch((e) => {
      if (e.code !== '42P04') throw e // already exists
    })
    await admin.end()
  } catch (e) {
    return `local database not running (npm run db:up): ${(e as Error).message}`
  }
  process.env.DATABASE_URL = `${SERVER}/${database}`
  process.env.FILES_DIR = mkdtempSync(join(tmpdir(), 'igi-files-'))
  return false
}

export async function resetDatabase(db: typeof import('../src/db.ts')) {
  await db.sql`drop schema public cascade`
  await db.sql`create schema public`
  await db.migrate()
  await db.migrate() // the schema applies twice without complaint
}

export const CONFIG: RunConfig = {
  model: 'muse-spark-1.3',
  reasoning_effort: 'medium',
  igi_commit: 'abc1234',
  monty_version: '1.4.0',
  instructions_sha: 'i',
  tools_sha: 't',
  budget: { maxTurns: 60, maxToolCalls: 150, maxPython: 40, maxCostUsd: 3, maxMinutes: 25, maxOutputTokens: 16000, effort: 'medium' },
  sources: [{ id: 'positions', file: 'positions.csv', sha256: 'f00d' }],
  memory_enabled: false,
  knowledge_ids: [],
}

/** A PDF's text as a reader extracting it would get it, pages joined by line breaks (spec §15.8). */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((x) => ('str' in x ? x.str : '')).join(' '))
  await doc.cleanup()
  return pages.join('\n')
}

export const finding = (id: string, more: Partial<Finding> = {}): Finding => ({
  id,
  title: `Finding ${id}`,
  statement: 'Equity look-through exposure is above the limit.',
  classification: 'potential_exception',
  proposed_classification: 'potential_exception',
  materiality: 'high',
  portfolios: ['P1'],
  check_ids: ['C1'],
  explanation: 'The limit is 35%.',
  validation: { state: 'validated', matched: ['exposure: 36.97% (C1)'], unmatched: [] },
  ...more,
})
