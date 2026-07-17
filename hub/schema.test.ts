import { describe, it, expect } from 'vitest'
import { CatalogEntrySchema, CatalogIndexEntrySchema, slugify } from './schema.js'

const base = {
  name: 'x', source: 's', kind: 'skill' as const, category: 'workflow' as const,
  tagline: 't', slug: 'x',
  badges: { security: 'A', quality: 'A', hygiene: 'A', effectiveness: 'not-evaluated' } as const,
  overall: 'A' as const, highlights: [],
  preCheck: { frontmatterValid: true, fileCount: 1, skillMdBytes: 1, criticalFlags: 0, majorFlags: 0 },
  rubricVersion: '0.1.2', evaluatedAt: 'now', evaluator: { mode: 'm', model: 'x' },
}

describe('skillMdHash', () => {
  it('accepts a hex hash', () => {
    expect(CatalogEntrySchema.parse({ ...base, skillMdHash: 'abc123' }).skillMdHash).toBe('abc123')
  })
  it('accepts null', () => {
    expect(CatalogEntrySchema.parse({ ...base, skillMdHash: null }).skillMdHash).toBeNull()
  })
  it('rejects a missing key', () => {
    expect(() => CatalogEntrySchema.parse(base)).toThrow()
  })
})

describe('provenance + index', () => {
  it('carries popularity/mirrors/discoveredVia/slug on an entry', () => {
    const e = CatalogEntrySchema.parse({ ...base, skillMdHash: 'h', popularity: 42, mirrors: ['https://x'], discoveredVia: 'github', slug: 'foo' })
    expect(e.popularity).toBe(42)
    expect(e.mirrors).toEqual(['https://x'])
    expect(e.slug).toBe('foo')
  })
  it('slugify lowercases, strips unsafe chars, collapses dashes', () => {
    expect(slugify('Foo Bar!!')).toBe('foo-bar')
    expect(slugify('a/../b')).toBe('a-b')
  })
  it('index entry is the compact shape', () => {
    const i = CatalogIndexEntrySchema.parse({ slug: 'foo', name: 'foo', overall: 'A', badges: { security: 'A', quality: 'A', hygiene: 'A' }, category: 'workflow', tagline: 't', popularity: 1, sourceUrl: 'https://x', skillMdHash: 'h' })
    expect(i.slug).toBe('foo')
  })
})
