// Thin entrypoint for the Claude Code skill-frontend: read one dimension's
// verdicts from stdin, let CODE (never the model) compute the letter grade.
// Usage: echo '{"dimension":"security","verdicts":[...]}' | pnpm tsx src/aggregate-cli.ts
import { readFileSync } from 'node:fs'
import { aggregate } from './aggregate.js'
import { loadRubric } from './rubric.js'
import type { DimensionKey, ReportVerdict } from './types.js'

const DIMENSIONS: DimensionKey[] = ['security', 'quality', 'hygiene']

function fail(msg: string): never {
  console.error(msg)
  process.exit(1)
}

let input: { dimension?: unknown; verdicts?: unknown }
try {
  input = JSON.parse(readFileSync(0, 'utf8'))
} catch {
  fail('invalid JSON on stdin; expected {"dimension":"security|quality|hygiene","verdicts":[...]}')
}
const { dimension, verdicts } = input!
if (!DIMENSIONS.includes(dimension as DimensionKey)) {
  fail(`unknown dimension ${JSON.stringify(dimension)}; expected one of ${DIMENSIONS.join(', ')}`)
}
if (!Array.isArray(verdicts)) fail('"verdicts" must be an array')

const dim = loadRubric('rubric/skill').dimensions.find((d) => d.key === dimension)!
console.log(JSON.stringify(aggregate(dim.checks, verdicts as ReportVerdict[])))
