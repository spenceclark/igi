// Runs IGI: the API, the web UI's files and the Cairn status poller (spec §10.1, §6.10).
// Run from server/: node --env-file-if-exists=.env scripts/serve.ts   (npm start)
// Needs OPERATOR_PASSWORD, MODEL_API_KEY and the Cairn settings (CAIRN_BASE_URL, CAIRN_AGENT_KEY,
// CAIRN_SUBJECT_REFERENCE, CAIRN_PROCEDURE_NAME). Optional: PORT (8080), SESSION_SECRET (sessions then survive a
// restart), CAIRN_APP_URL (links to Cairn's records), SECURE_COOKIES=false for plain http other than localhost.
import { fileURLToPath } from 'node:url'
import { cairnClient } from '../src/cairn.ts'
import { migrate } from '../src/db.ts'
import { recoverOperations } from '../src/operations.ts'
import { startStatusPoller } from '../src/reviews.ts'
import { igiServer } from '../src/server.ts'

const missing = ['OPERATOR_PASSWORD', 'MODEL_API_KEY', 'CAIRN_BASE_URL', 'CAIRN_AGENT_KEY', 'CAIRN_SUBJECT_REFERENCE', 'CAIRN_PROCEDURE_NAME'].filter((n) => !process.env[n])
if (missing.length) {
  console.error(`${missing.join(', ')} not set. Put them in server/.env (gitignored) or the environment.`)
  process.exit(2)
}
const log = (e: Record<string, unknown>) => console.log(JSON.stringify(e))
const cairn = cairnClient({ baseUrl: process.env.CAIRN_BASE_URL!, key: process.env.CAIRN_AGENT_KEY! })

await migrate()
// One service instance: any operation still marked running belongs to a process that has stopped.
log({ at: new Date().toISOString(), event: 'recovered', ...(await recoverOperations(0)) })
startStatusPoller(cairn, 60_000, (line) => log({ at: new Date().toISOString(), event: 'poller', message: line }))

const port = Number(process.env.PORT ?? 8080)
igiServer({
  cairn,
  password: process.env.OPERATOR_PASSWORD!,
  secret: process.env.SESSION_SECRET,
  webDir: fileURLToPath(new URL('../../web/dist', import.meta.url)),
  secureCookies: process.env.SECURE_COOKIES !== 'false',
  log,
}).listen(port, () => log({ at: new Date().toISOString(), event: 'listening', port }))
