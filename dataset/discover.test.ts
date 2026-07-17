import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDiscovery } from './discover.js'
import { loadState } from './state.js'
import type { Candidate, SourceAdapter } from './adapters/types.js'

const cand = (repo: string): Candidate => ({ sourceUrl: `https://github.com/${repo}/blob/main/SKILL.md`, repo, path: 'SKILL.md', ref: 'main', stars: 1, pushedAt: '' })
const adapter = (cands: Candidate[]): SourceAdapter => ({ name: 't', async *discover() { for (const c of cands) yield c } })
const good = '---\nname: foo\ndescription: d\n---\n# Foo\nbody'
const junk = '# no frontmatter'

describe('runDiscovery', () => {
  it('fetches, filters junk, dedupes, and persists ready items', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ds-'))
    const content: Record<string, string> = { 'a/b': good, 'c/d': good, 'e/f': junk }
    const res = await runDiscovery({
      adapter: adapter([cand('a/b'), cand('c/d'), cand('e/f')]),
      fetchContent: async (c) => content[c.repo] ?? null,
      dir, now: 'now', gradedHashes: new Set(),
    })
    expect(res).toEqual({ ready: 1, filtered: 1, drifted: 0 }) // a/b and c/d dedupe to 1; e/f filtered
    const state = loadState(dir)
    expect(state.filter((i) => i.status === 'ready')).toHaveLength(1)
    expect(state.find((i) => i.status === 'ready')?.mirrors).toHaveLength(1)
  })
})
