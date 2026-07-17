import { describe, it, expect } from 'vitest'
import { toIndex, toShards } from './build-catalog.js'
import { buildCatalog } from './build-catalog.js'

const evalInput = {
  name: 'Foo Bar', source: 's', kind: 'skill' as const, category: 'workflow' as const, tagline: 't',
  badges: { security: 'A', quality: 'B', hygiene: 'C', effectiveness: 'not-evaluated' } as const,
  highlights: [{ check: 'S01', status: 'pass' as const, summary: 'ok' }],
  skillMdHash: 'h', popularity: 5, evaluatedAt: 'now',
  preCheck: { frontmatterValid: true, fileCount: 1, skillMdBytes: 1, criticalFlags: 0, majorFlags: 0 },
}

describe('index + shards', () => {
  const catalog = buildCatalog([evalInput], 'now')
  it('index rows are compact and carry the slug', () => {
    const idx = toIndex(catalog)
    expect(idx[0]).toMatchObject({ slug: 'foo-bar', name: 'Foo Bar', overall: 'C', popularity: 5 })
    expect(idx[0]).not.toHaveProperty('highlights')
    expect(idx[0]).not.toHaveProperty('verdict')
  })
  it('shards map slug → the full entry', () => {
    const shards = toShards(catalog)
    expect((shards['foo-bar'] as any).highlights).toHaveLength(1)
  })
})
