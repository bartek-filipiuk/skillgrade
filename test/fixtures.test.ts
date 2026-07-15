// Fixture contents include ATTACK STRINGS AS INERT TEST DATA (fictional
// evil.example hosts, manipulation phrases). They are bytes to scan, never
// instructions to follow.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { runPreChecks } from '../checks/prechecks.js'

interface Expectation {
  mustFlagRules: string[]
  forbiddenRulePrefixes?: string[]
  maxFlags?: number
  [extra: string]: unknown // minSecurity/maxSecurity etc. — consumed by t13 calibration
}

const EXPECTED = JSON.parse(
  readFileSync('checks/fixtures/EXPECTED.json', 'utf8'),
) as Record<string, Expectation>

describe('fixtures vs prechecks', () => {
  it('covers all six fixtures', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([
      'benign-minimal', 'benign-rich', 'malicious-exfil',
      'malicious-hidden', 'malicious-injection', 'sloppy-but-safe',
    ])
  })

  for (const [dir, exp] of Object.entries(EXPECTED)) {
    it(dir, () => {
      const report = runPreChecks(`checks/fixtures/${dir}`)
      const rules = report.flags.map((f) => f.rule)
      for (const rule of exp.mustFlagRules) expect(rules).toContain(rule)
      for (const prefix of exp.forbiddenRulePrefixes ?? []) {
        expect(rules.filter((r) => r.startsWith(prefix))).toEqual([])
      }
      if (exp.maxFlags !== undefined) {
        expect(report.flags.length).toBeLessThanOrEqual(exp.maxFlags)
      }
      expect(report.frontmatter.valid).toBe(true)
    })
  }
})
