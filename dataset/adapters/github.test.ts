import { describe, it, expect } from 'vitest'
import { parseRepoSearch, parseTree, githubAdapter, paginateRepos, TOPIC_QUERIES } from './github.js'
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

describe('TOPIC_QUERIES', () => {
  it('drops the in:readme noise query and keeps topic queries', () => {
    expect(TOPIC_QUERIES).not.toContain('claude code skills in:name,description,readme')
    expect(TOPIC_QUERIES).toContain('topic:claude-skills')
    expect(TOPIC_QUERIES.every((q) => q.startsWith('topic:'))).toBe(true)
  })
})

describe('paginateRepos', () => {
  it('follows pages until a short page and respects maxRepos', async () => {
    const pages: Record<number, unknown> = {
      1: { items: Array.from({ length: 100 }, (_, i) => ({ full_name: `a/r${i}`, default_branch: 'main' })) },
      2: { items: [{ full_name: 'a/last', default_branch: 'main' }] }, // short page → stop
    }
    const apiGet = async (path: string) => pages[Number(new URL('http://x' + path).searchParams.get('page'))] ?? { items: [] }
    const seen: string[] = []
    for await (const m of paginateRepos(apiGet, 'topic:x', 1000)) seen.push(m.repo)
    expect(seen).toHaveLength(101)
    expect(seen[seen.length - 1]).toBe('a/last')
  })
})

describe('githubAdapter tree timeout', () => {
  it('skips a repo whose tree fetch exceeds treeTimeoutMs', async () => {
    const apiGet = async (path: string) => {
      if (path.includes('/search/repositories')) return { items: [{ full_name: 'a/slow', default_branch: 'main' }] }
      return new Promise(() => {}) // tree call hangs forever
    }
    const out: unknown[] = []
    for await (const c of githubAdapter(apiGet, { treeTimeoutMs: 20, codeSearch: false }).discover()) out.push(c)
    expect(out).toEqual([]) // hung repo skipped, no candidates, no throw
  })
})

import { sizeShards, parseCodeSearch } from './github.js'

describe('sizeShards', () => {
  it('partitions file sizes into non-overlapping, exhaustive byte ranges', () => {
    const s = sizeShards()
    expect(s[0]).toBe('size:0..799')
    expect(s.some((x) => x.startsWith('size:>='))).toBe(true) // an open-ended top shard
    // boundaries do not overlap: each `..` upper bound is one below the next lower bound
    expect(s).toContain('size:800..1599')
  })
})

describe('parseCodeSearch', () => {
  it('extracts {repo, path} for SKILL.md hits, skipping non-SKILL.md and repoless items', () => {
    const json = { items: [
      { path: 'skills/foo/SKILL.md', repository: { full_name: 'a/b' } },
      { path: 'docs/NOTSKILL.md', repository: { full_name: 'a/b' } },
      { path: 'SKILL.md', repository: {} }, // no full_name → skip
    ] }
    expect(parseCodeSearch(json)).toEqual([{ repo: 'a/b', path: 'skills/foo/SKILL.md' }])
  })
})

describe('githubAdapter code-search mode', () => {
  it('yields code-search candidates (topics off), resolving repo meta once', async () => {
    let repoCalls = 0
    const apiGet = async (path: string) => {
      if (path.includes('/search/code')) {
        // only the first shard returns a hit; others empty
        return path.includes('0..799')
          ? { items: [{ path: 'x/SKILL.md', repository: { full_name: 'c/d' } }] }
          : { items: [] }
      }
      if (path.startsWith('/repos/c/d')) { repoCalls++; return { stargazers_count: 5, default_branch: 'main' } }
      return { items: [] }
    }
    const out: any[] = []
    for await (const c of githubAdapter(apiGet, { topics: false, codeSearch: true }).discover()) out.push(c)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ repo: 'c/d', path: 'x/SKILL.md', stars: 5, sourceUrl: 'https://github.com/c/d/blob/main/x/SKILL.md' })
    expect(repoCalls).toBe(1)
  })
})
