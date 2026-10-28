// Read-only check of the Cairn connection: asks the status of one random candidate id, which needs
// no permission beyond submitting, creates nothing, and should answer 200 with no items (spec §12.5).
// Run: node --env-file-if-exists=.env scripts/cairn-probe.ts   (needs CAIRN_BASE_URL and CAIRN_AGENT_KEY)
import { cairnClient } from '../src/cairn.ts'

const missing = ['CAIRN_BASE_URL', 'CAIRN_AGENT_KEY'].filter((name) => !process.env[name])
if (missing.length) {
  console.error(`${missing.join(' and ')} not set. Put them in server/.env (gitignored) or the environment.`)
  process.exit(2)
}
const cairn = cairnClient({ baseUrl: process.env.CAIRN_BASE_URL!, key: process.env.CAIRN_AGENT_KEY! })
const started = performance.now()
const items = await cairn.getCandidateStatus([crypto.randomUUID()])
console.log(`Cairn answered in ${Math.round(performance.now() - started)} ms with ${items.length} items (expected 0).`)
process.exit(items.length === 0 ? 0 : 1)
