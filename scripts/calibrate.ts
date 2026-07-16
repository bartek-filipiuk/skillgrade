// Calibrate a model against the fixture corpus before trusting it in production.
// Runs a FULL evaluation of every fixture in checks/fixtures/EXPECTED.json with
// the given model and checks each result against the expected bounds. Needs an
// API key (real LLM calls).
//
//   pnpm tsx scripts/calibrate.ts openrouter:anthropic/claude-3.5-haiku
//   pnpm tsx scripts/calibrate.ts anthropic:claude-haiku-4-5-20251001
//
// Exit 0 = the model honors every expectation; exit 1 = at least one violation
// (the model is too weak or the rubric drifted — investigate before switching).
import { readFileSync } from 'node:fs'
import { evaluate } from '../src/cli.js'
import type { Report } from '../src/types.js'

const ORDER = ['A', 'B', 'C', 'D', 'F'] as const
type Letter = (typeof ORDER)[number]
const idx = (g: string) => ORDER.indexOf(g as Letter)

export interface Expectation {
  minSecurity?: string // worst acceptable security grade
  maxSecurity?: string // best acceptable security grade
  maxQuality?: string // quality must be no better than this
  maxHygiene?: string // hygiene must be no better than this
  mustFailChecks?: string[]
}

// Pure conformance check — unit-tested offline, no network.
export function checkExpectation(
  exp: Expectation,
  badges: Report['badges'],
  verdicts: Report['verdicts'],
): string[] {
  const fail: string[] = []
  const graded = (g: string) => idx(g) >= 0

  if (exp.maxSecurity || exp.minSecurity) {
    const g = badges.security
    if (!graded(g)) fail.push(`security is ${g}, expected a letter grade`)
    else {
      if (exp.maxSecurity && idx(g) < idx(exp.maxSecurity)) fail.push(`security ${g} better than allowed ${exp.maxSecurity}`)
      if (exp.minSecurity && idx(g) > idx(exp.minSecurity)) fail.push(`security ${g} worse than allowed ${exp.minSecurity}`)
    }
  }
  for (const [dim, cap] of [
    ['quality', exp.maxQuality],
    ['hygiene', exp.maxHygiene],
  ] as const) {
    if (!cap) continue
    const g = badges[dim]
    if (!graded(g)) fail.push(`${dim} is ${g}, expected no better than ${cap}`)
    else if (idx(g) < idx(cap)) fail.push(`${dim} ${g} better than allowed ${cap} (too lenient)`)
  }
  for (const id of exp.mustFailChecks ?? []) {
    const v = verdicts.find((x) => x.check === id)
    if (!v) fail.push(`missing verdict for ${id} (expected fail)`)
    else if (v.status !== 'fail') fail.push(`${id} is ${v.status}, expected fail`)
  }
  return fail
}

async function main() {
  const model = process.argv[2] ?? process.env.TRUST_SKILL_MODEL
  if (!model) {
    console.error('usage: tsx scripts/calibrate.ts <provider:model-id>')
    process.exit(1)
  }
  const expected = JSON.parse(readFileSync('checks/fixtures/EXPECTED.json', 'utf8')) as Record<string, Expectation>
  console.log(`Calibrating ${model} against ${Object.keys(expected).length} fixtures\n`)

  let violations = 0
  for (const [name, exp] of Object.entries(expected)) {
    let line: string
    try {
      const { report } = await evaluate({ source: `checks/fixtures/${name}`, model, runs: 1, noLlm: false })
      const fails = checkExpectation(exp, report.badges, report.verdicts)
      const b = report.badges
      const tag = fails.length === 0 ? 'PASS' : 'FAIL'
      if (fails.length) violations++
      line = `[${tag}] ${name.padEnd(22)} S=${b.security} Q=${b.quality} H=${b.hygiene}`
      if (fails.length) line += '\n        ' + fails.join('\n        ')
    } catch (e) {
      violations++
      line = `[ERR ] ${name.padEnd(22)} ${(e as Error).message}`
    }
    console.log(line)
  }

  console.log(`\n${violations === 0 ? 'OK' : violations + ' fixture(s) violated expectations'} — model ${violations === 0 ? 'is safe to use' : 'needs review before production use'}`)
  process.exit(violations === 0 ? 0 : 1)
}

// Only run main when invoked directly (not when imported by the test).
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  void main()
}
