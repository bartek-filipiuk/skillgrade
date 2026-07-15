// Thin entrypoint for the Claude Code skill-frontend: run deterministic
// pre-checks on a skill dir and print the PreCheckReport as JSON on stdout.
// Usage: pnpm tsx checks/run.ts <skill-dir>
import { runPreChecks } from './prechecks.js'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: tsx checks/run.ts <skill-dir>')
  process.exit(1)
}
try {
  console.log(JSON.stringify(runPreChecks(dir)))
} catch (e) {
  console.error(`pre-checks failed: ${(e as Error).message}`)
  process.exit(1)
}
