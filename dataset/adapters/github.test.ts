import { describe, it, expect } from 'vitest'
import { parseRepoSearch, parseTree, githubAdapter } from './github.js'
import type { Candidate } from './types.js'

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
  it('ignores files that merely end in SKILL.md (MYSKILL.md)', () => {
    const json = { tree: [{ path: 'MYSKILL.md', type: 'blob' }, { path: 'a/SKILL.md', type: 'blob' }] }
    expect(parseTree(json, meta).map((x) => x.path)).toEqual(['a/SKILL.md'])
  })
})

describe('githubAdapter.discover', () => {
  it('skips a repo whose tree fetch throws and still yields the good repo', async () => {
    const apiGet = async (path: string): Promise<unknown> => {
      if (path.startsWith('/search')) {
        return { items: [
          { full_name: 'good/repo', stargazers_count: 5, pushed_at: '', default_branch: 'main' },
          { full_name: 'bad/repo', stargazers_count: 3, pushed_at: '', default_branch: 'main' },
        ] }
      }
      if (path.includes('bad/repo')) throw new Error('tree fetch failed')
      return { tree: [{ path: 'SKILL.md', type: 'blob' }] }
    }
    const out: Candidate[] = []
    for await (const c of githubAdapter(apiGet).discover()) out.push(c)
    expect(out.map((c) => c.repo)).toEqual(['good/repo'])
  })
})
