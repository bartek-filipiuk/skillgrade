import { describe, it, expect } from 'vitest'
import { buildIndex } from './index-build.js'
import { makeHandlers } from './handlers.js'
import type { Catalog } from '../hub/schema.js'

const catalog = {
  generatedAt: 'now', rubricVersion: '0.1.2', taxonomy: [],
  skills: [{
    name: 'foo', source: 's', kind: 'skill', category: 'workflow', tagline: 't',
    badges: { security: 'A', quality: 'A', hygiene: 'A', effectiveness: 'not-evaluated' },
    overall: 'A', highlights: [],
    preCheck: { frontmatterValid: true, fileCount: 1, skillMdBytes: 1, criticalFlags: 0, majorFlags: 0 },
    rubricVersion: '0.1.2', evaluatedAt: 'now', evaluator: { mode: 'm', model: 'x' },
    skillMdHash: 'hash-foo',
  }],
} as unknown as Catalog

const h = makeHandlers(buildIndex(catalog))

describe('handlers', () => {
  it('lookup returns MCP content + structuredContent', async () => {
    const res = await h.lookup({ hash: 'hash-foo', name: 'foo' })
    expect(res.structuredContent.status).toBe('verified')
    expect(res.content[0].type).toBe('text')
    expect(JSON.parse(res.content[0].text).status).toBe('verified')
  })
  it('audit summarizes', async () => {
    const res = await h.audit({ skills: [{ name: 'foo', hash: 'hash-foo' }] })
    expect(res.structuredContent.summary.total).toBe(1)
  })
  it('search finds by name', async () => {
    const res = await h.search({ query: 'foo' })
    expect(res.structuredContent.results[0].name).toBe('foo')
  })
})
