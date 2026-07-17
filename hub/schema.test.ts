import { describe, it, expect } from 'vitest'
import { CatalogEntrySchema } from './schema.js'

const base = {
  name: 'x', source: 's', kind: 'skill' as const, category: 'workflow' as const,
  tagline: 't',
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
