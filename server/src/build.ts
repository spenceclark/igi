// The IGI code version a run or pack was made with (spec §13.2): the full commit hash, marked -dirty when the
// working tree has uncommitted changes, so a development build is never presented as reproducible.
import { execSync } from 'node:child_process'

/** The current commit, `<hash>-dirty` with uncommitted changes, or `unknown` outside a git checkout. */
export function igiBuild(): string {
  const git = (args: string) => execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  try {
    return git('rev-parse HEAD') + (git('status --porcelain') ? '-dirty' : '')
  } catch {
    return 'unknown'
  }
}
