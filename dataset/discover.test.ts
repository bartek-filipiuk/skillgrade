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

  it('stops after maxCandidates so a firehose adapter cannot drive unbounded fetches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ds-'))
    let fetches = 0
    const res = await runDiscovery({
      adapter: adapter([cand('a/b'), cand('c/d'), cand('e/f')]),
      fetchContent: async () => { fetches++; return good },
      dir, now: 'now', gradedHashes: new Set(), maxCandidates: 1, concurrency: 1,
    })
    expect(fetches).toBe(1) // concurrency 1 → exactly one candidate consumed (pool overshoots up to `concurrency`)
    expect(res.ready).toBe(1)
  })
})

const many = (n: number) => ({ name: 't', async *discover() {
  for (let i = 0; i < n; i++) yield { sourceUrl: `https://github.com/a/r${i}/blob/main/SKILL.md`, repo: `a/r${i}`, path: 'SKILL.md', ref: 'main', stars: i, pushedAt: '' }
} })
const goodBody = (i: number) => `---\nname: skill-${i}\ndescription: does ${i}\n---\n# S${i}\nbody`

describe('runDiscovery concurrency', () => {
  it('never exceeds `concurrency` fetches in flight and collects all survivors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ds-'))
    let inFlight = 0, maxInFlight = 0
    const fetchContent = async (c: any) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return goodBody(Number(c.repo.split('r')[1]))
    }
    const res = await runDiscovery({ adapter: many(25) as any, fetchContent, dir, now: 'now', gradedHashes: new Set(), concurrency: 4 })
    expect(maxInFlight).toBeLessThanOrEqual(4)
    expect(res.ready).toBe(25)
    expect(loadState(dir).filter((i) => i.status === 'ready')).toHaveLength(25)
  })

  it('checkpoints incrementally: candidates.json is populated before the run ends', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ds-'))
    let call = 0
    const fetchContent = async (c: any) => {
      call++
      // concurrency 1 → deterministic order; by the 3rd fetch, the saveEvery=2 checkpoint must have persisted the first 2
      if (call === 3) expect(loadState(dir).length).toBeGreaterThanOrEqual(2)
      return goodBody(Number(c.repo.split('r')[1]))
    }
    await runDiscovery({ adapter: many(4) as any, fetchContent, dir, now: 'now', gradedHashes: new Set(), concurrency: 1, saveEvery: 2 })
    expect(loadState(dir)).toHaveLength(4)
  })
})
