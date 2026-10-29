// The answer keys (eval/answer-keys/*.json) as fixtures/generate.ts writes them, and the scenario each belongs to.
// Only eval/ reads them; the server never does (spec §15.2).
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// A planted issue: what a finding about it would cite (rule 'ID vN', committee action id, check name), and the
// classifications that count as finding it. A benign anomaly lists instead the classifications it must not get.
export type Issue = { id: string; type: string; portfolio?: string; period?: string; rule?: string; action?: string; check?: string; expected: string[]; summary: string }
export type Benign = Omit<Issue, 'expected'> & { must_not_be: string[] }
export type AnswerKey = {
  scenario: string
  seed: number
  instrumentIds: Record<string, string>
  expectedBreaches: string[]
  facts: Record<string, string> // `portfolio|period|metric` to a fraction, computed by the generator independently
  issues: Issue[]
  benign: Benign[]
  distractors: { id: string; summary: string }[]
}

export const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const scenarioDir = (name: string) => `${ROOT}fixtures/scenarios/${name}`

/** Every answer key, or the ones named. */
export function answerKeys(names?: string[]): AnswerKey[] {
  const files = readdirSync(`${ROOT}eval/answer-keys`).filter((f) => f.endsWith('.json'))
  const keys = files.map((f) => JSON.parse(readFileSync(`${ROOT}eval/answer-keys/${f}`, 'utf8')) as AnswerKey)
  return names?.length ? names.map((n) => keys.find((k) => k.scenario === n) ?? missing(n)) : keys
}
const missing = (n: string): never => {
  throw new Error(`no answer key for scenario ${n}`)
}
