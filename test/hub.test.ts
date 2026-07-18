import { describe, it, expect } from 'vitest'
import { overallGrade, CATEGORY_IDS } from '../hub/schema.js'
import { buildCatalog } from '../hub/build-catalog.js'
import { readFileSync } from 'node:fs'

// The builder pulls real pre-check facts from disk, so these tests double as an
// integration check that the fixture sources still evaluate as expected.
const evals = JSON.parse(readFileSync('hub/evaluations.json', 'utf8')) as Parameters<typeof buildCatalog>[0]

describe('overallGrade', () => {
  it('is the worst graded dimension', () => {
    expect(overallGrade({ security: 'A', quality: 'C', hygiene: 'A' })).toBe('C')
    expect(overallGrade({ security: 'F', quality: 'A', hygiene: 'A' })).toBe('F')
  })
  it('skips not-evaluated, falls back to not-evaluated when all unevaluated', () => {
    expect(overallGrade({ security: 'F', quality: 'not-evaluated', hygiene: 'not-evaluated' })).toBe('F')
    expect(overallGrade({ security: 'not-evaluated', quality: 'not-evaluated', hygiene: 'not-evaluated' })).toBe('not-evaluated')
  })
})

describe('buildCatalog', () => {
  const catalog = buildCatalog(evals, '2026-07-16T00:00:00.000Z')

  it('validates against the schema and keeps every entry', () => {
    expect(catalog.skills.length).toBe(evals.length)
  })
  it('every category is a known taxonomy id', () => {
    for (const s of catalog.skills) expect(CATEGORY_IDS).toContain(s.category)
  })
  it('every listed skill has an online source link', () => {
    for (const s of catalog.skills) expect(s.sourceUrl).toMatch(/^https?:\/\//)
  })
  it('carries pre-supplied pre-check facts + evaluator for public skills', () => {
    const pub = catalog.skills.find((s) => s.name === 'skill-creator')!
    expect(pub.preCheck.skillMdBytes).toBeGreaterThan(25000) // supplied from the wave grade
    expect(pub.evaluator.model).toBe('claude-sonnet-5') // re-graded natively in the Anthropic official wave
    expect(pub.sourceUrl).toContain('github.com/anthropics/skills')
  })
  it('spans a range of grades (not all identical)', () => {
    const grades = new Set(catalog.skills.map((s) => s.overall))
    expect(grades).toContain('A')
    expect(grades.size).toBeGreaterThanOrEqual(3)
  })
})
