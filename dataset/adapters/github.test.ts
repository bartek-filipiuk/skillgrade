import { describe, it, expect } from 'vitest'
import { parseRepoSearch, parseTree } from './github.js'

describe('parseRepoSearch', () => {
  it('extracts repo, stars, branch, pushedAt', () => {
    const json = { items: [{ full_name: 'a/b', stargazers_count: 12, pushed_at: '2026-01-01T00:00:00Z', default_branch: 'main' }] }
    expect(parseRepoSearch(json)).toEqual([{ repo: 'a/b', stars: 12, pushedAt: '2026-01-01T00:00:00Z', defaultBranch: 'main' }])
  })
})

describe('parseTree', () => {
  const meta = { repo: 'a/b', ref: 'main', stars: 12, pushedAt: '2026-01-01T00:00:00Z' }
  it('keeps only SKILL.md blobs and builds candidates', () => {
    const json = { tree: [
      { path: 'skills/foo/SKILL.md', type: 'blob' },
      { path: 'skills/foo/ref.md', type: 'blob' },
      { path: 'skills/bar', type: 'tree' },
      { path: 'SKILL.md', type: 'blob' },
    ] }
    const c = parseTree(json, meta)
    expect(c.map((x) => x.path)).toEqual(['skills/foo/SKILL.md', 'SKILL.md'])
    expect(c[0]).toMatchObject({ repo: 'a/b', ref: 'main', stars: 12, sourceUrl: 'https://github.com/a/b/blob/main/skills/foo/SKILL.md' })
  })
})
