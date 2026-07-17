import { describe, it, expect } from 'vitest'
import { buildIndex } from './index-build.js'
import type { Catalog, CatalogEntry } from '../hub/schema.js'

function entry(name: string, hash: string | null): CatalogEntry {
  return {
    name, source: 's', kind: 'skill', category: 'workflow', tagline: 't',
    badges: { security: 'A', quality: 'A', hygiene: 'A', effectiveness: 'not-evaluated' },
    overall: 'A', highlights: [],
    preCheck: { frontmatterValid: true, fileCount: 1, skillMdBytes: 1, criticalFlags: 0, majorFlags: 0 },
    rubricVersion: '0.1.2', evaluatedAt: 'now', evaluator: { mode: 'm', model: 'x' },
    skillMdHash: hash,
  }
}

const catalog: Catalog = {
  generatedAt: 'now', rubricVersion: '0.1.2', taxonomy: [],
  skills: [
    entry('skill-creator', 'hash-a'),
    entry('skill-creator', 'hash-b'), // name collision, different hash
    entry('orphan', null),            // no resolved source
  ],
}

describe('buildIndex', () => {
  it('maps each non-null hash to its entry', () => {
    const idx = buildIndex(catalog)
    expect(idx.byHash.get('hash-a')?.skillMdHash).toBe('hash-a')
    expect(idx.byHash.get('hash-b')?.skillMdHash).toBe('hash-b')
    expect(idx.byHash.size).toBe(2)
  })
  it('excludes null-hash entries from the hash index', () => {
    expect(buildIndex(catalog).byHash.has('null')).toBe(false)
  })
  it('groups all entries by name including collisions', () => {
    const idx = buildIndex(catalog)
    expect(idx.byName.get('skill-creator')).toHaveLength(2)
    expect(idx.byName.get('orphan')).toHaveLength(1)
  })
})
