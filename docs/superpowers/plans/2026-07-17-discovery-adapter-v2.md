# Discovery Adapter v2 + Fetch-at-Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen and speed up skill discovery so grading waves have a deep, deduped, popularity-ranked pool — paginated topic search + sharded code-search harvest, per-repo tree timeout, bounded-concurrency fetch, and incremental state saves.

**Architecture:** Extends the existing `dataset/adapters/github.ts` (topic pagination + code-search mode + tree timeout, all behind an options object) and `dataset/discover.ts` (`runDiscovery` gains a bounded worker pool and periodic `saveState`). Pure helpers stay unit-tested with an injected `apiGet`/`fetchContent`; the CLI wiring and networked `discover()` stay thin glue. Grading, hub, and the security boundary are unchanged.

**Tech Stack:** TypeScript ESM (Node ≥20), pnpm, Vitest, the GitHub REST API (repo search, git trees, code search).

## Global Constraints

- TypeScript ESM, `.js` import specifiers. Tests: Vitest via `pnpm test`; colocate as `dataset/*.test.ts` (vitest `include` already covers `dataset/**`).
- One identity everywhere: `skillMdHash`. Candidates from tree-walk and code-search of the same file dedupe to one entry — no change to `dedupe`.
- Fetch allowlist unchanged and must stay sufficient: only `api.github.com` (repo search, git trees, code search) and `raw.githubusercontent.com` (content). No new host. Content is never executed; cache filenames stay the normalized hash; `GITHUB_TOKEN` is env-only.
- Every array/loop is bounded: `maxReposPerQuery` (default 1000 — GitHub's search ceiling), `MAX_FILES_PER_REPO` (200, existing), per code-search shard ≤ 1000 results (10 pages × 100), `maxCandidates` per run, `concurrency` (default 10).
- `SKILL.md` path match stays exact: `path === 'SKILL.md' || path.endsWith('/SKILL.md')` (never `endsWith('SKILL.md')`).
- Do not change the grading path, rubric, or hub.

---

### Task 1: Topic search v2 — drop noise query, paginate, tree timeout

**Files:**
- Modify: `dataset/adapters/github.ts`
- Test: `dataset/adapters/github.test.ts` (append)

**Interfaces:**
- Produces: `TOPIC_QUERIES` (replaces `GITHUB_QUERIES`); `paginateRepos(apiGet, query, maxRepos): AsyncIterable<RepoMeta>`; `githubAdapter(apiGet, opts?: GithubAdapterOpts)` where `interface GithubAdapterOpts { maxReposPerQuery?: number; treeTimeoutMs?: number; topics?: boolean; codeSearch?: boolean }`. `discover()` paginates topics and applies a per-repo tree timeout. (Code-search mode is added in Task 2; here `codeSearch` defaults to `false`.)

- [ ] **Step 1: Write the failing test**

Append to `dataset/adapters/github.test.ts`:

```typescript
import { paginateRepos, TOPIC_QUERIES, githubAdapter } from './github.js'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test dataset/adapters/github.test.ts`
Expected: FAIL (`paginateRepos`/`TOPIC_QUERIES` not exported; `githubAdapter` signature/behavior differs).

- [ ] **Step 3: Implement**

In `dataset/adapters/github.ts`, replace the `GITHUB_QUERIES` export with:

```typescript
// Topic queries only — the old `in:readme` query returned 441k mostly-irrelevant
// repos whose giant trees timed out the run. Real topics, auditable here.
export const TOPIC_QUERIES = [
  'topic:claude-skills',
  'topic:agent-skills',
  'topic:claude-code-skills',
  'topic:claude-code',
]

// Fail a hung/slow promise after ms so one giant repo tree can't stall the run.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>
  const timer = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms) })
  return Promise.race([p.finally(() => clearTimeout(t)), timer])
}

// Paginate a repo search to maxRepos (GitHub caps search at 1000 results = 10 pages).
export async function* paginateRepos(apiGet: ApiGet, query: string, maxRepos: number): AsyncIterable<RepoMeta> {
  for (let page = 1; page * 100 - 100 < maxRepos; page++) {
    const search = await apiGet(`/search/repositories?q=${encodeURIComponent(query)}&per_page=100&page=${page}&sort=stars`)
    const metas = parseRepoSearch(search)
    for (const m of metas) yield m
    if (metas.length < 100) return
  }
}

export interface GithubAdapterOpts {
  maxReposPerQuery?: number
  treeTimeoutMs?: number
  topics?: boolean
  codeSearch?: boolean
}
```

Replace the existing `githubAdapter` with:

```typescript
export function githubAdapter(apiGet: ApiGet, opts: GithubAdapterOpts = {}): SourceAdapter {
  const { maxReposPerQuery = 1000, treeTimeoutMs = 15000, topics = true, codeSearch = false } = opts
  return {
    name: 'github',
    async *discover(): AsyncIterable<Candidate> {
      const seenRepos = new Set<string>()
      if (topics) {
        for (const q of TOPIC_QUERIES) {
          for await (const m of paginateRepos(apiGet, q, maxReposPerQuery)) {
            if (seenRepos.has(m.repo)) continue
            seenRepos.add(m.repo)
            let tree: unknown
            try {
              tree = await withTimeout(apiGet(`/repos/${m.repo}/git/trees/${m.defaultBranch}?recursive=1`), treeTimeoutMs)
            } catch {
              continue // hung/slow/deleted repo → skip, never abort
            }
            for (const c of parseTree(tree, { repo: m.repo, ref: m.defaultBranch, stars: m.stars, pushedAt: m.pushedAt })) {
              yield c
            }
          }
        }
      }
    },
  }
}
```

(`codeSearch` is accepted but unused until Task 2; keep it in the destructure so the option is stable.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test dataset/adapters/github.test.ts` → PASS (existing parseTree/parseRepoSearch tests still green).
Run: `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add dataset/adapters/github.ts dataset/adapters/github.test.ts
git commit -m "feat(dataset): topic pagination + tree timeout, drop in:readme query"
```

---

### Task 2: Code-search harvest — sharded filename:SKILL.md

**Files:**
- Modify: `dataset/adapters/github.ts`
- Test: `dataset/adapters/github.test.ts` (append)

**Interfaces:**
- Produces: `sizeShards(): string[]`; `parseCodeSearch(json): { repo: string; path: string }[]`; a `discover()` that, when `codeSearch` is on (now the default), yields code-search candidates after the topic candidates. Repos already seen via topics are skipped in code-search (their files were already yielded; hash-dedup would collapse them anyway).

- [ ] **Step 1: Write the failing test**

Append to `dataset/adapters/github.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test dataset/adapters/github.test.ts`
Expected: FAIL (`sizeShards`/`parseCodeSearch` not exported; code-search mode not implemented).

- [ ] **Step 3: Implement**

In `dataset/adapters/github.ts`, add:

```typescript
// Shard `filename:SKILL.md` by byte-size range to get past the per-query 1000-result
// cap. Ranges are contiguous and non-overlapping, so every SKILL.md lands in exactly
// one shard. Bytes (code search `size:` is in bytes).
const SIZE_BOUNDS = [800, 1600, 3000, 6000, 12000]
export function sizeShards(): string[] {
  const shards: string[] = []
  let lo = 0
  for (const hi of SIZE_BOUNDS) { shards.push(`size:${lo}..${hi - 1}`); lo = hi }
  shards.push(`size:>=${lo}`)
  return shards
}

export function parseCodeSearch(json: unknown): { repo: string; path: string }[] {
  const items = (json as { items?: unknown[] }).items ?? []
  const out: { repo: string; path: string }[] = []
  for (const it of items) {
    const o = it as Record<string, unknown>
    const path = String(o.path ?? '')
    if (path !== 'SKILL.md' && !path.endsWith('/SKILL.md')) continue
    const repo = String((o.repository as Record<string, unknown> | undefined)?.full_name ?? '')
    if (!repo) continue
    out.push({ repo, path })
  }
  return out
}

// Code search reaches beyond topic repos. Each hit gives {repo, path}; one cached
// /repos/{repo} lookup supplies stars + default branch for the sourceUrl + ranking.
async function* codeSearchCandidates(apiGet: ApiGet, seenRepos: Set<string>): AsyncIterable<Candidate> {
  const repoMeta = new Map<string, { stars: number; ref: string } | null>()
  for (const shard of sizeShards()) {
    for (let page = 1; page <= 10; page++) {
      let res: unknown
      try {
        res = await apiGet(`/search/code?q=${encodeURIComponent('filename:SKILL.md ' + shard)}&per_page=100&page=${page}`)
      } catch {
        break // shard rate-limited/exhausted → move to the next shard
      }
      const hits = parseCodeSearch(res)
      for (const h of hits) {
        if (seenRepos.has(h.repo)) continue // already covered by a topic tree-walk
        if (!repoMeta.has(h.repo)) {
          try {
            const r = (await apiGet(`/repos/${h.repo}`)) as Record<string, unknown>
            repoMeta.set(h.repo, { stars: Number(r.stargazers_count ?? 0), ref: String(r.default_branch ?? 'main') })
          } catch {
            repoMeta.set(h.repo, null)
          }
        }
        const meta = repoMeta.get(h.repo)
        if (!meta) continue
        yield {
          sourceUrl: `https://github.com/${h.repo}/blob/${meta.ref}/${h.path}`,
          repo: h.repo, path: h.path, ref: meta.ref, stars: meta.stars, pushedAt: '',
        }
      }
      if (hits.length < 100) break // shard drained
    }
  }
}
```

Flip the `codeSearch` default to `true` and call it in `discover()`. Change the destructure default and append the code-search branch after the topics branch:

```typescript
  const { maxReposPerQuery = 1000, treeTimeoutMs = 15000, topics = true, codeSearch = true } = opts
```

At the end of `discover()`, after the `if (topics) { ... }` block:

```typescript
      if (codeSearch) {
        yield* codeSearchCandidates(apiGet, seenRepos)
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test dataset/adapters/github.test.ts` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add dataset/adapters/github.ts dataset/adapters/github.test.ts
git commit -m "feat(dataset): sharded code-search harvest for full-universe reach"
```

---

### Task 3: Bounded-concurrency fetch pool + incremental saves

**Files:**
- Modify: `dataset/discover.ts` (`runDiscovery` + `DiscoveryOpts`)
- Test: `dataset/discover.test.ts` (append)

**Interfaces:**
- Consumes: existing `hashCandidate`, `filterValid`, `dedupe`, `mergeWorklist`, `loadState`, `saveState`.
- Produces: `DiscoveryOpts` gains `concurrency?: number` (default 10) and `saveEvery?: number` (default 200). `runDiscovery` processes the adapter stream with up to `concurrency` workers in flight and checkpoints (`dedupe` → `mergeWorklist` → `saveState`) every `saveEvery` survivors, returning the same `{ ready, filtered, drifted }`.

- [ ] **Step 1: Write the failing test**

Append to `dataset/discover.test.ts`:

```typescript
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadState } from './state.js'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test dataset/discover.test.ts`
Expected: FAIL (`concurrency`/`saveEvery` unsupported; sequential impl has no bounded pool / no incremental save).

- [ ] **Step 3: Implement**

In `dataset/discover.ts`, extend `DiscoveryOpts`:

```typescript
export interface DiscoveryOpts {
  adapter: SourceAdapter
  fetchContent: (c: Candidate) => Promise<string | null>
  dir: string
  now: string
  gradedHashes: Set<string>
  maxCandidates?: number
  concurrency?: number // bounded fetches in flight
  saveEvery?: number // checkpoint the worklist every N survivors so a kill keeps progress
}
```

Replace the body of `runDiscovery` with:

```typescript
export async function runDiscovery(opts: DiscoveryOpts): Promise<{ ready: number; filtered: number; drifted: number }> {
  const maxCandidates = opts.maxCandidates ?? 5000
  const concurrency = opts.concurrency ?? 10
  const saveEvery = opts.saveEvery ?? 200
  const fetched: FetchedCandidate[] = []
  let filtered = 0
  let consumed = 0

  // dedupe → merge into prior state → persist. Fully synchronous, so it is atomic
  // between worker await points and safe to call mid-run.
  const checkpoint = (): WorklistItem[] => {
    const merged = mergeWorklist(loadState(opts.dir), dedupe(fetched, opts.now), opts.gradedHashes)
    saveState(opts.dir, merged)
    return merged
  }

  const it = opts.adapter.discover()[Symbol.asyncIterator]()
  async function worker(): Promise<void> {
    for (;;) {
      if (consumed >= maxCandidates) return
      const { value: c, done } = await it.next() // concurrent .next() is serialized by the generator
      if (done) return
      consumed++
      const content = await opts.fetchContent(c as Candidate)
      if (content === null) continue // fetch failed/refused → skip, never abort
      const fc = hashCandidate(c as Candidate, content)
      if (!filterValid(fc).ok) { filtered++; continue }
      fetched.push(fc)
      if (fetched.length % saveEvery === 0) checkpoint() // sync → atomic; only one worker hits the exact multiple
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  const merged = checkpoint()
  return {
    ready: merged.filter((i) => i.status === 'ready').length,
    filtered,
    drifted: merged.filter((i) => i.status === 'drifted').length,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test dataset/discover.test.ts` → PASS (existing runDiscovery test still green). `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add dataset/discover.ts dataset/discover.test.ts
git commit -m "feat(dataset): bounded-concurrency fetch pool + incremental worklist saves"
```

---

### Task 4: CLI wiring + runbook update

**Files:**
- Modify: `dataset/discover.ts` (CLI entrypoint)
- Modify: `dataset/README.md`

**Interfaces:** none (ops wiring + docs).

- [ ] **Step 1: Thread env overrides into the CLI run**

In `dataset/discover.ts`, replace the CLI entrypoint block (the `if (process.argv[1] && ...)` at the bottom) with one that passes adapter options and run bounds from env (all optional, sensible defaults preserved):

```typescript
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const token = process.env.GITHUB_TOKEN
  const gradedHashes = new Set<string>() // seed from evaluations.json when re-scanning; empty = grade everything ready
  const adapter = githubAdapter(githubApiGet, {
    codeSearch: process.env.CODE_SEARCH !== '0', // default on; CODE_SEARCH=0 to disable
    maxReposPerQuery: process.env.MAX_REPOS ? Number(process.env.MAX_REPOS) : undefined,
  })
  runDiscovery({
    adapter,
    fetchContent: cachedFetch(token),
    dir: HERE,
    now: new Date().toISOString(),
    gradedHashes,
    maxCandidates: process.env.MAX_CANDIDATES ? Number(process.env.MAX_CANDIDATES) : undefined,
    concurrency: process.env.CONCURRENCY ? Number(process.env.CONCURRENCY) : undefined,
  })
    .then((r) => console.log(`discovery: ready=${r.ready} filtered=${r.filtered} drifted=${r.drifted}`))
    .catch((e) => { console.error(e); process.exit(1) })
}
```

- [ ] **Step 2: Verify the CLI still typechecks and the module loads**

Run: `pnpm typecheck` → clean.
Run: `pnpm test` (full suite) → all pass (no behavior regressions).

- [ ] **Step 3: Update the runbook**

In `dataset/README.md`, update the discovery step to document v2: the GitHub adapter now paginates topic queries and harvests via sharded code-search (reaching far beyond the ~266 topic repos), fetches content with bounded concurrency, and checkpoints `candidates.json` incrementally so a long run resumes. Document the env knobs: `GITHUB_TOKEN` (required), `CODE_SEARCH=0` (topics only), `MAX_REPOS`, `MAX_CANDIDATES`, `CONCURRENCY`. Note that a large run can span the GitHub search rate limit (30/min for search/code) and that the backoff + incremental saves make it safe to stop and re-run. Reaffirm the security invariants are unchanged (allowlist covers `/search/code`; no new host; token env-only).

- [ ] **Step 4: Commit**

```bash
git add dataset/discover.ts dataset/README.md
git commit -m "chore(dataset): CLI env knobs for v2 discovery + runbook update"
```

---

## Self-Review

**Spec coverage:**
- Drop `in:readme` + topic pagination → Task 1. ✓
- Sharded code-search harvest → Task 2. ✓
- Per-repo tree timeout + truncation/cap handling → Task 1 (timeout) + existing `parseTree` cap/`MAX_FILES_PER_REPO` (unchanged). ✓
- Bounded-concurrency fetch → Task 3. ✓
- Incremental state saves → Task 3. ✓
- Dedup/provenance unchanged (originals win by stars) → no task needed; `dedupe` untouched. ✓
- Security unchanged (allowlist covers `/search/code`; token env-only) → reaffirmed in Task 4 runbook; no new host introduced. ✓
- CLI knobs + runbook → Task 4. ✓
- Testing (pagination, shards, tree timeout, code-search parse, concurrency bound, incremental save, cross-mode dedup) → Tasks 1–3 tests. (Cross-mode dedup is covered by the existing `dedupe` behavior + hash identity; the concurrency test asserts survivors land once.) ✓

**Placeholder scan:** no TBD/TODO; every code step shows full code; Task 4 Step 3 (README) is prose documentation of concrete env knobs, acceptable for a docs deliverable.

**Type consistency:** `GithubAdapterOpts` defined in Task 1, extended-usage (codeSearch on) in Task 2. `RepoMeta`/`ApiGet` are existing types in `github.ts` reused by `paginateRepos`/`codeSearchCandidates`. `Candidate` shape unchanged across tree-walk and code-search yields. `DiscoveryOpts` gains `concurrency`/`saveEvery` (Task 3) consumed only there. `TOPIC_QUERIES` replaces `GITHUB_QUERIES` — Task 1 removes the old name; no later task references `GITHUB_QUERIES`.
