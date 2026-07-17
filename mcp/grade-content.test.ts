import { describe, it, expect } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gradeContent } from './grade-content.js'

const RUBRIC = join(dirname(fileURLToPath(import.meta.url)), '../rubric/skill')
const good = '---\nname: foo\ndescription: does a thing\n---\n# Foo\n\nBody.'

// Inject a fake evaluateDimension so no LLM is called.
const fakeEval = async ({ dimension }: any) =>
  dimension.checks.map((c: any) => ({ check: c.id, status: 'pass', note: 'ok' }))

describe('gradeContent', () => {
  it('grades a SKILL.md string to badges + hash without network', async () => {
    const r = await gradeContent(good, { rubricDir: RUBRIC, model: 'x', evaluateDimension: fakeEval as any })
    expect(r.skillMdHash).toMatch(/^[0-9a-f]{64}$/)
    expect(r.badges.security).toBe('A') // all pass -> A
    expect(['A', 'B', 'C', 'D', 'F']).toContain(r.overall)
    expect(Array.isArray(r.findings)).toBe(true)
  })
  it('a security fail yields security F and surfaces the finding', async () => {
    const failSec = async ({ dimension }: any) =>
      dimension.checks.map((c: any) => ({ check: c.id, status: c.id === 'S04' ? 'fail' : 'pass', note: 'x' }))
    const r = await gradeContent(good, { rubricDir: RUBRIC, model: 'x', evaluateDimension: failSec as any })
    expect(r.badges.security).toBe('F')
    expect(r.findings.some((f) => f.check === 'S04' && f.status === 'fail')).toBe(true)
  })
})
