import { describe, it, expect } from 'vitest'
import { buildIndex } from './index-build.js'
import { lookupSkill, auditSkills, searchSkills } from './lookup.js'
import type { Catalog, CatalogEntry } from '../hub/schema.js'

function entry(over: Partial<CatalogEntry> & { name: string; skillMdHash: string | null }): CatalogEntry {
  return {
    source: 's', sourceUrl: 'https://clawhub.ai/x/skills/' + over.name, kind: 'skill',
    category: 'workflow', tagline: 't',
    badges: { security: 'A', quality: 'B', hygiene: 'C', effectiveness: 'not-evaluated' },
    overall: 'C',
    highlights: [
      { check: 'S04', status: 'fail', summary: 'can delete files' },
      { check: 'Q03', status: 'warning', summary: 'doc slip' },
      { check: 'H05', status: 'pass', summary: 'fine' },
    ],
    preCheck: { frontmatterValid: true, fileCount: 1, skillMdBytes: 1, criticalFlags: 0, majorFlags: 0 },
    rubricVersion: '0.1.2', evaluatedAt: 'now', evaluator: { mode: 'm', model: 'x' },
    verdict: 'a verdict', ...over,
  } as CatalogEntry
}

const catalog: Catalog = {
  generatedAt: 'now', rubricVersion: '0.1.2', taxonomy: [],
  skills: [entry({ name: 'foo', skillMdHash: 'hash-foo' })],
}
const idx = buildIndex(catalog)

describe('lookupSkill', () => {
  it('verified: hash matches', () => {
    const r = lookupSkill(idx, { hash: 'hash-foo', name: 'foo' })
    expect(r.status).toBe('verified')
    if (r.status === 'verified') {
      expect(r.gradedHash).toBe('hash-foo')
      expect(r.findings.map((f) => f.check)).toEqual(['S04', 'Q03']) // fail/warning only, pass dropped
      expect(r.findings[0].dimension).toBe('security')
      expect(r.badges).not.toHaveProperty('effectiveness')
    }
  })
  it('drift: name matches, hash does not', () => {
    const r = lookupSkill(idx, { hash: 'other', name: 'foo' })
    expect(r.status).toBe('drift')
    if (r.status === 'drift') {
      expect(r.gradedHash).toBe('hash-foo')
      expect(r.yourHash).toBe('other')
    }
  })
  it('reference: only a name', () => {
    expect(lookupSkill(idx, { name: 'foo' }).status).toBe('reference')
  })
  it('unknown: nothing matches', () => {
    expect(lookupSkill(idx, { hash: 'x', name: 'nope' }).status).toBe('unknown')
  })
})

describe('auditSkills', () => {
  it('summarizes per-skill results', () => {
    const rep = auditSkills(idx, [
      { name: 'foo', hash: 'hash-foo' }, // verified (overall C)
      { name: 'foo', hash: 'other' },    // drift
      { name: 'nope', hash: 'z' },       // unknown
    ])
    expect(rep.summary).toMatchObject({ total: 3, verified: 1, drifted: 1, unknown: 1 })
    expect(rep.summary.gradeCounts).toEqual({ C: 1 })
  })
})

describe('searchSkills', () => {
  it('matches by name substring, case-insensitive', () => {
    expect(searchSkills(idx, 'FO').map((h) => h.name)).toEqual(['foo'])
    expect(searchSkills(idx, 'zzz')).toEqual([])
  })
})
