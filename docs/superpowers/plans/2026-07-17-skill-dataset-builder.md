# Skill Dataset Builder + Hub-at-Scale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover public Claude Code skills at scale (GitHub-native first), dedupe and filter them, grade them in native Sonnet-5 waves, and serve thousands of graded entries in a fast, static hub — all keyed by the same normalized `SKILL.md` hash the MCP already uses.

**Architecture:** A `dataset/` build workspace: pluggable discovery adapters → a security-hardened fetch layer (host allowlist, conditional requests, on-disk cache, backoff) → dedup + deterministic filter → a resumable JSON worklist. A grading bridge builds batch input for the existing `grade-skills-batch` ultracode Workflow and merges the returned per-check verdicts into `hub/evaluations.json` (scores computed in code via `src/aggregate`). `hub/build-catalog.ts` additionally emits a compact `catalog-index.json` + per-skill `skills/<slug>.json` detail shards; the hub page does vanilla client-side search/pagination over the index and lazy-loads detail. The MCP is unchanged.

**Tech Stack:** TypeScript ESM (Node ≥20), pnpm, Zod 4, Vitest, `yaml`, the GitHub REST API, native (subscription) Sonnet-5 grading via the ultracode Workflow tool, nginx static hosting on Coolify.

## Global Constraints

- TypeScript ESM, `type: module`; import local files with the `.js` extension in specifiers (e.g. `./state.js`), matching existing `src/` code.
- Node ≥ 20 (global `fetch` available). pnpm (`pnpm@10.24.0`). Zod 4.
- Tests: Vitest via `pnpm test`; colocate new tests as `*.test.ts` next to source. `vitest.config.ts` `include` must cover `dataset/**/*.test.ts` and `hub/**/*.test.ts` (it already covers `hub/**` and `mcp/**`; add `dataset/**`).
- **One identity everywhere:** the skill key is `skillMdHash` = `hashSkillMd(content)` from `mcp/normalize.ts` (normalized sha256 of the SKILL.md text). Never introduce a second identity. Reuse it for dedup, resume, and drift.
- **Security is load-bearing** (untrusted internet content):
  - Never execute fetched content — it is data passed to the grader for evaluation, never run.
  - Fetch only from an allowlist: `api.github.com`, `raw.githubusercontent.com`. Validate every URL before fetching — reject non-HTTPS, `localhost`, private IP ranges, `169.254.169.254`.
  - Cache filenames are the `skillMdHash` only — never a repo-supplied path (no traversal).
  - Cap fetched `SKILL.md` at 262144 bytes (256 KB); skip larger. Bound every array and per-run count.
  - GitHub token from `process.env.GITHUB_TOKEN` only — never logged, cached, committed, or written to the catalog.
- **Copy-free repo:** `dataset/` is gitignored (local build workspace). Fetched skill content is never committed. The committed catalog stores only evaluation + source link + hash. Every catalog entry links back to its source (attribution).
- **Scores are computed in code** by `src/aggregate.ts` (`aggregate(dimension.checks, verdicts).letter`), never by the grading model. Verdict dedup keeps the worst status per check (a trailing `pass` cannot bury a `fail`).
- Grading runs natively in a Claude Code session (ultracode Workflow, Sonnet 5). There is no headless cron — "scheduled re-scan" means an operator/night-loop session. The Workflow invocation itself is an operator step, not unit-tested; the input-builder and verdict-merger around it are pure and tested.

---

### Task 1: Extend the catalog contract for provenance + a compact index

**Files:**
- Modify: `hub/schema.ts`
- Modify: `hub/build-catalog.ts` (EvalInput + buildEntry passthrough)
- Test: `hub/schema.test.ts` (append)

**Interfaces:**
- Produces on `CatalogEntry`: `popularity: number` (default 0), `mirrors: string[]` (default `[]`), `discoveredVia: string | null` (default null), `slug: string`. New `CatalogIndexEntrySchema` + `CatalogIndexEntry` type (compact fields) and `slugify(name: string): string`.

- [ ] **Step 1: Write the failing test**

Append to `hub/schema.test.ts`:

```typescript
import { CatalogIndexEntrySchema, slugify } from './schema.js'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test hub/schema.test.ts`
Expected: FAIL (`slugify` / `CatalogIndexEntrySchema` not exported; new fields rejected/missing).

- [ ] **Step 3: Implement**

In `hub/schema.ts`, add these fields to `CatalogEntrySchema` (after `skillMdHash`):

```typescript
  skillMdHash: z.string().nullable(),
  popularity: z.number().int().nonnegative().default(0),
  mirrors: z.array(z.string().url()).default([]),
  discoveredVia: z.string().nullable().default(null),
  slug: z.string().min(1),
```

Add, at the end of the file:

```typescript
// URL-safe skill id used in reportUrl anchors and detail-shard filenames.
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'skill'
}

// The compact per-skill row the hub page loads for browse/search. No heavy fields
// (highlights/verdict/preCheck/evaluator) — those live in skills/<slug>.json.
export const CatalogIndexEntrySchema = z.object({
  slug: z.string(),
  name: z.string(),
  overall: GRADE,
  badges: z.object({ security: GRADE, quality: GRADE, hygiene: GRADE }),
  category: z.string(),
  tagline: z.string(),
  popularity: z.number().int().nonnegative(),
  sourceUrl: z.string(),
  skillMdHash: z.string().nullable(),
})
export type CatalogIndexEntry = z.infer<typeof CatalogIndexEntrySchema>
```

In `hub/build-catalog.ts`, add to `EvalInput`:

```typescript
  popularity?: number
  mirrors?: string[]
  discoveredVia?: string | null
```

In `buildEntry`, set the fields explicitly so every entry carries them:

```typescript
    skillMdHash: e.skillMdHash ?? null,
    popularity: e.popularity ?? 0,
    mirrors: e.mirrors ?? [],
    discoveredVia: e.discoveredVia ?? null,
    slug: slugify(e.name),
```

Import `slugify` in `build-catalog.ts`: add `slugify` to the existing `./schema.js` import.

- [ ] **Step 4: Run tests + rebuild**

Run: `pnpm test hub/schema.test.ts` → PASS.
Run: `pnpm tsx hub/build-catalog.ts` → prints `catalog.json: 125 skills ...`; entries now carry `slug`, `popularity:0`, `mirrors:[]`.

- [ ] **Step 5: Commit**

```bash
git add hub/schema.ts hub/build-catalog.ts hub/schema.test.ts hub/catalog.json hub/index.html
git commit -m "feat(hub): provenance fields + compact index-entry schema"
```

---

### Task 2: Discovery adapter interface + GitHub adapter parsing

**Files:**
- Create: `dataset/adapters/types.ts`
- Create: `dataset/adapters/github.ts`
- Test: `dataset/adapters/github.test.ts`
- Modify: `vitest.config.ts` (add `dataset/**/*.test.ts`)

**Interfaces:**
- Produces: `interface Candidate { sourceUrl: string; repo: string; path: string; ref: string; stars: number; pushedAt: string }`; `interface SourceAdapter { name: string; discover(): AsyncIterable<Candidate> }`; pure `parseRepoSearch(json): {repo: string; stars: number; pushedAt: string; defaultBranch: string}[]` and `parseTree(json, meta): Candidate[]`.

- [ ] **Step 1: Add the vitest glob + write the failing test**

In `vitest.config.ts`, extend `include` to `['test/**/*.test.ts', 'hub/**/*.test.ts', 'mcp/**/*.test.ts', 'dataset/**/*.test.ts']`.

Create `dataset/adapters/github.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test dataset/adapters/github.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the types**

Create `dataset/adapters/types.ts`:

```typescript
// A discoverable skill: enough to fetch its SKILL.md and rank it by popularity.
export interface Candidate {
  sourceUrl: string // canonical https link to the SKILL.md (attribution + provenance)
  repo: string // "owner/name"
  path: string // path of SKILL.md within the repo
  ref: string // branch or sha
  stars: number // popularity signal (repo-level)
  pushedAt: string // ISO recency signal
}

// A source of candidates. New sources (ClawHub, aggregators) implement this — no core change.
export interface SourceAdapter {
  name: string
  discover(): AsyncIterable<Candidate>
}
```

- [ ] **Step 4: Implement the GitHub parsing**

Create `dataset/adapters/github.ts`:

```typescript
import type { Candidate, SourceAdapter } from './types.js'

interface RepoMeta { repo: string; stars: number; pushedAt: string; defaultBranch: string }

export function parseRepoSearch(json: unknown): RepoMeta[] {
  const items = (json as { items?: unknown[] }).items ?? []
  return items.map((r) => {
    const o = r as Record<string, unknown>
    return {
      repo: String(o.full_name),
      stars: Number(o.stargazers_count ?? 0),
      pushedAt: String(o.pushed_at ?? ''),
      defaultBranch: String(o.default_branch ?? 'main'),
    }
  })
}

export function parseTree(
  json: unknown,
  meta: { repo: string; ref: string; stars: number; pushedAt: string },
): Candidate[] {
  const tree = (json as { tree?: unknown[] }).tree ?? []
  const out: Candidate[] = []
  for (const n of tree) {
    const o = n as Record<string, unknown>
    if (o.type !== 'blob') continue
    const path = String(o.path)
    if (!path.endsWith('SKILL.md')) continue
    out.push({
      sourceUrl: `https://github.com/${meta.repo}/blob/${meta.ref}/${path}`,
      repo: meta.repo,
      path,
      ref: meta.ref,
      stars: meta.stars,
      pushedAt: meta.pushedAt,
    })
  }
  return out
}

// Search queries that surface repos holding Claude Code skills. Kept explicit so
// coverage is auditable; add queries here, not magic elsewhere.
export const GITHUB_QUERIES = [
  'topic:claude-skills',
  'topic:agent-skills',
  'topic:claude-code-skills',
  'claude code skills in:name,description,readme',
]

type ApiGet = (path: string) => Promise<unknown>

// discover() drives the network via an injected apiGet (tested modules stay pure;
// the real apiGet lives in fetch.ts and is wired in discover.ts).
export function githubAdapter(apiGet: ApiGet): SourceAdapter {
  return {
    name: 'github',
    async *discover(): AsyncIterable<Candidate> {
      const seenRepos = new Set<string>()
      for (const q of GITHUB_QUERIES) {
        const search = await apiGet(`/search/repositories?q=${encodeURIComponent(q)}&per_page=100&sort=stars`)
        for (const m of parseRepoSearch(search)) {
          if (seenRepos.has(m.repo)) continue
          seenRepos.add(m.repo)
          const tree = await apiGet(`/repos/${m.repo}/git/trees/${m.defaultBranch}?recursive=1`)
          for (const c of parseTree(tree, { repo: m.repo, ref: m.defaultBranch, stars: m.stars, pushedAt: m.pushedAt })) {
            yield c
          }
        }
      }
    },
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test dataset/adapters/github.test.ts` → PASS. Run `pnpm typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add dataset/adapters/types.ts dataset/adapters/github.ts dataset/adapters/github.test.ts vitest.config.ts
git commit -m "feat(dataset): SourceAdapter interface + GitHub discovery parsing"
```

---

### Task 3: Security-hardened fetch layer

**Files:**
- Create: `dataset/fetch.ts`
- Test: `dataset/fetch.test.ts`

**Interfaces:**
- Consumes: `Candidate` from `./adapters/types.js`.
- Produces: `assertAllowedUrl(url: string): void`; `fetchSkillMd(candidate: Candidate, opts: FetchOpts): Promise<{ content: string; etag?: string } | null>` where `interface FetchOpts { fetchFn?: typeof fetch; token?: string; maxBytes?: number; etag?: string }`. `ALLOWED_HOSTS` and `MAX_BYTES` constants.

- [ ] **Step 1: Write the failing test**

Create `dataset/fetch.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { assertAllowedUrl, fetchSkillMd, MAX_BYTES } from './fetch.js'
import type { Candidate } from './adapters/types.js'

const cand = (sourceUrl: string): Candidate => ({ sourceUrl, repo: 'a/b', path: 'SKILL.md', ref: 'main', stars: 1, pushedAt: '' })

describe('assertAllowedUrl', () => {
  it('accepts github raw + api', () => {
    expect(() => assertAllowedUrl('https://raw.githubusercontent.com/a/b/main/SKILL.md')).not.toThrow()
    expect(() => assertAllowedUrl('https://api.github.com/x')).not.toThrow()
  })
  it('rejects non-https, other hosts, localhost, metadata IP', () => {
    for (const u of ['http://raw.githubusercontent.com/x', 'https://evil.example/x', 'https://localhost/x', 'https://169.254.169.254/x', 'https://127.0.0.1/x']) {
      expect(() => assertAllowedUrl(u)).toThrow()
    }
  })
})

describe('fetchSkillMd', () => {
  it('rejects an oversize body without returning content', async () => {
    const fetchFn = (async () => new Response('x'.repeat(MAX_BYTES + 1), { status: 200 })) as unknown as typeof fetch
    expect(await fetchSkillMd(cand('https://raw.githubusercontent.com/a/b/main/SKILL.md'), { fetchFn })).toBeNull()
  })
  it('returns null on 304 (caller keeps cache)', async () => {
    const fetchFn = (async () => new Response('', { status: 304 })) as unknown as typeof fetch
    expect(await fetchSkillMd(cand('https://raw.githubusercontent.com/a/b/main/SKILL.md'), { fetchFn, etag: 'W/"x"' })).toBeNull()
  })
  it('returns content + etag on 200', async () => {
    const fetchFn = (async () => new Response('# hi', { status: 200, headers: { etag: 'W/"y"' } })) as unknown as typeof fetch
    const r = await fetchSkillMd(cand('https://raw.githubusercontent.com/a/b/main/SKILL.md'), { fetchFn })
    expect(r).toEqual({ content: '# hi', etag: 'W/"y"' })
  })
  it('refuses a candidate whose sourceUrl host is not allowlisted', async () => {
    const fetchFn = (async () => new Response('x', { status: 200 })) as unknown as typeof fetch
    // github blob URLs are rewritten to raw; a non-github host must be refused
    expect(await fetchSkillMd(cand('https://evil.example/a/b/SKILL.md'), { fetchFn })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test dataset/fetch.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `dataset/fetch.ts`:

```typescript
import type { Candidate } from './adapters/types.js'

export const ALLOWED_HOSTS = new Set(['api.github.com', 'raw.githubusercontent.com'])
export const MAX_BYTES = 262144 // 256 KB — larger "SKILL.md" is junk or an attack

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|::1)/i
const PRIVATE_172 = /^172\.(1[6-9]|2\d|3[01])\./

// SSRF guard: only https, only allowlisted hosts, never a private/link-local target.
export function assertAllowedUrl(url: string): void {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new Error(`unparseable URL: ${JSON.stringify(url)}`)
  }
  if (u.protocol !== 'https:') throw new Error(`refusing non-https URL: ${url}`)
  if (!ALLOWED_HOSTS.has(u.hostname)) throw new Error(`host not allowlisted: ${u.hostname}`)
  if (PRIVATE_HOST.test(u.hostname) || PRIVATE_172.test(u.hostname)) throw new Error(`refusing private host: ${u.hostname}`)
}

// A github.com/{repo}/blob/{ref}/{path} link → the raw.githubusercontent.com URL we fetch.
function rawUrl(c: Candidate): string {
  return `https://raw.githubusercontent.com/${c.repo}/${c.ref}/${c.path}`
}

export interface FetchOpts {
  fetchFn?: typeof fetch
  token?: string
  maxBytes?: number
  etag?: string
}

// Returns {content, etag} on 200, or null on 304 / any failure (caller logs + skips).
// Enforces the allowlist BEFORE any network call and caps the body size.
export async function fetchSkillMd(c: Candidate, opts: FetchOpts = {}): Promise<{ content: string; etag?: string } | null> {
  const { fetchFn = fetch, token, maxBytes = MAX_BYTES, etag } = opts
  const url = rawUrl(c)
  try {
    assertAllowedUrl(url)
  } catch {
    return null // refused hosts are skipped, not fatal
  }
  const headers: Record<string, string> = { accept: 'text/plain' }
  if (token) headers.authorization = `Bearer ${token}`
  if (etag) headers['if-none-match'] = etag
  let res: Response
  try {
    res = await fetchFn(url, { headers })
  } catch {
    return null
  }
  if (res.status === 304) return null
  if (!res.ok) return null
  const body = await res.text()
  if (body.length > maxBytes) return null
  const newEtag = res.headers.get('etag') ?? undefined
  return { content: body, etag: newEtag }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test dataset/fetch.test.ts` → PASS (all).

- [ ] **Step 5: Commit**

```bash
git add dataset/fetch.ts dataset/fetch.test.ts
git commit -m "feat(dataset): SSRF-hardened SKILL.md fetch with size cap + conditional GET"
```

---

### Task 4: Frontmatter/size filter + hash-dedup

**Files:**
- Create: `dataset/filter.ts`
- Create: `dataset/dedup.ts`
- Test: `dataset/filter.test.ts`, `dataset/dedup.test.ts`

**Interfaces:**
- Consumes: `Candidate`; `hashSkillMd` from `../mcp/normalize.js`.
- Produces:
  - `interface FetchedCandidate extends Candidate { content: string; skillMdHash: string; name: string; size: number }`
  - `hashCandidate(c: Candidate, content: string): FetchedCandidate` (in `filter.ts`) — parses the frontmatter name and computes the hash.
  - `filterValid(fc: FetchedCandidate): { ok: boolean; reason?: string }`
  - `interface WorklistItem { skillMdHash: string; name: string; primarySourceUrl: string; mirrors: string[]; repo: string; path: string; stars: number; pushedAt: string; size: number; status: 'ready' | 'filtered-out' | 'graded' | 'drifted'; filterReason?: string; lastSeen: string; gradedAt?: string }`
  - `dedupe(fetched: FetchedCandidate[], now: string): WorklistItem[]` (in `dedup.ts`).

- [ ] **Step 1: Write the failing tests**

Create `dataset/filter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { hashCandidate, filterValid } from './filter.js'
import type { Candidate } from './adapters/types.js'

const c: Candidate = { sourceUrl: 'https://github.com/a/b/blob/main/SKILL.md', repo: 'a/b', path: 'SKILL.md', ref: 'main', stars: 3, pushedAt: '' }
const good = '---\nname: foo\ndescription: does a thing\n---\n# Foo\n\nBody.'

describe('hashCandidate', () => {
  it('extracts frontmatter name and hashes', () => {
    const fc = hashCandidate(c, good)
    expect(fc.name).toBe('foo')
    expect(fc.skillMdHash).toMatch(/^[0-9a-f]{64}$/)
    expect(fc.size).toBe(good.length)
  })
})

describe('filterValid', () => {
  it('accepts a valid skill', () => expect(filterValid(hashCandidate(c, good)).ok).toBe(true))
  it('rejects missing frontmatter', () => {
    const r = filterValid(hashCandidate(c, '# no frontmatter'))
    expect(r).toEqual({ ok: false, reason: 'no-frontmatter' })
  })
  it('rejects missing name/description', () => {
    expect(filterValid(hashCandidate(c, '---\nname: foo\n---\nx')).ok).toBe(false)
  })
  it('rejects empty body', () => {
    expect(filterValid(hashCandidate(c, '---\nname: foo\ndescription: d\n---\n')).ok).toBe(false)
  })
})
```

Create `dataset/dedup.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { dedupe } from './dedup.js'
import { hashCandidate } from './filter.js'
import type { Candidate } from './adapters/types.js'

const md = '---\nname: foo\ndescription: d\n---\n# Foo\nx'
const mk = (repo: string, stars: number): Candidate => ({ sourceUrl: `https://github.com/${repo}/blob/main/SKILL.md`, repo, path: 'SKILL.md', ref: 'main', stars, pushedAt: '' })

describe('dedupe', () => {
  it('collapses identical content to one item, primary = higher stars, others as mirrors', () => {
    const items = dedupe([hashCandidate(mk('a/b', 3), md), hashCandidate(mk('c/d', 9), md)], 'now')
    expect(items).toHaveLength(1)
    expect(items[0].primarySourceUrl).toContain('c/d')
    expect(items[0].mirrors).toEqual(['https://github.com/a/b/blob/main/SKILL.md'])
    expect(items[0].stars).toBe(9)
    expect(items[0].status).toBe('ready')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test dataset/filter.test.ts dataset/dedup.test.ts` → FAIL (modules not found).

- [ ] **Step 3: Implement the filter**

Create `dataset/filter.ts`:

```typescript
import { parse as parseYaml } from 'yaml'
import { hashSkillMd } from '../mcp/normalize.js'
import type { Candidate } from './adapters/types.js'

export interface FetchedCandidate extends Candidate {
  content: string
  skillMdHash: string
  name: string
  size: number
}

const FRONTMATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/

function frontmatter(content: string): { fm: Record<string, unknown> | null; body: string } {
  const m = content.match(FRONTMATTER)
  if (!m) return { fm: null, body: '' }
  try {
    return { fm: (parseYaml(m[1]) as Record<string, unknown>) ?? null, body: (m[2] ?? '').trim() }
  } catch {
    return { fm: null, body: '' }
  }
}

export function hashCandidate(c: Candidate, content: string): FetchedCandidate {
  const { fm } = frontmatter(content)
  const name = typeof fm?.name === 'string' && fm.name.trim() ? fm.name.trim() : (c.repo.split('/')[1] ?? 'skill')
  return { ...c, content, skillMdHash: hashSkillMd(content), name, size: content.length }
}

// Deterministic validity gate — no LLM. A real skill needs a name+description
// frontmatter and a non-empty body. Junk is dropped with a reason for the log.
export function filterValid(fc: FetchedCandidate): { ok: boolean; reason?: string } {
  const { fm, body } = frontmatter(fc.content)
  if (!fm) return { ok: false, reason: 'no-frontmatter' }
  if (typeof fm.name !== 'string' || !fm.name.trim()) return { ok: false, reason: 'no-name' }
  if (typeof fm.description !== 'string' || !fm.description.trim()) return { ok: false, reason: 'no-description' }
  if (!body) return { ok: false, reason: 'empty-body' }
  return { ok: true }
}
```

- [ ] **Step 4: Implement dedup**

Create `dataset/dedup.ts`:

```typescript
import type { FetchedCandidate } from './filter.js'

export interface WorklistItem {
  skillMdHash: string
  name: string
  primarySourceUrl: string
  mirrors: string[]
  repo: string
  path: string
  stars: number
  pushedAt: string
  size: number
  status: 'ready' | 'filtered-out' | 'graded' | 'drifted'
  filterReason?: string
  lastSeen: string
  gradedAt?: string
}

// Same content (hash) from multiple sources = one item. Primary = highest stars;
// the rest become mirrors so provenance keeps every place the skill lives.
export function dedupe(fetched: FetchedCandidate[], now: string): WorklistItem[] {
  const byHash = new Map<string, FetchedCandidate[]>()
  for (const fc of fetched) {
    const g = byHash.get(fc.skillMdHash)
    if (g) g.push(fc)
    else byHash.set(fc.skillMdHash, [fc])
  }
  const items: WorklistItem[] = []
  for (const [hash, group] of byHash) {
    const sorted = [...group].sort((a, b) => b.stars - a.stars)
    const primary = sorted[0]
    items.push({
      skillMdHash: hash,
      name: primary.name,
      primarySourceUrl: primary.sourceUrl,
      mirrors: sorted.slice(1).map((x) => x.sourceUrl),
      repo: primary.repo,
      path: primary.path,
      stars: primary.stars,
      pushedAt: primary.pushedAt,
      size: primary.size,
      status: 'ready',
      lastSeen: now,
    })
  }
  return items
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test dataset/filter.test.ts dataset/dedup.test.ts` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add dataset/filter.ts dataset/dedup.ts dataset/filter.test.ts dataset/dedup.test.ts
git commit -m "feat(dataset): frontmatter/size filter + hash dedup with mirrors"
```

---

### Task 5: Worklist state — persistence, ranking, wave selection, drift

**Files:**
- Create: `dataset/state.ts`
- Test: `dataset/state.test.ts`

**Interfaces:**
- Consumes: `WorklistItem` from `./dedup.js`.
- Produces:
  - `mergeWorklist(existing: WorklistItem[], fresh: WorklistItem[], gradedHashes: Set<string>): WorklistItem[]` — pure merge: preserves `graded` items, flips a graded item to `drifted` when a fresh item shares its `primarySourceUrl` but a different hash, keeps new `ready` items.
  - `selectWave(items: WorklistItem[], n: number): WorklistItem[]` — the next N `ready`/`drifted` items, popularity-desc.
  - `loadState(dir: string): WorklistItem[]` / `saveState(dir: string, items: WorklistItem[]): void` (JSON at `<dir>/candidates.json`).

- [ ] **Step 1: Write the failing test**

Create `dataset/state.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { mergeWorklist, selectWave } from './state.js'
import type { WorklistItem } from './dedup.js'

const item = (over: Partial<WorklistItem> & { skillMdHash: string; primarySourceUrl: string }): WorklistItem => ({
  name: 'n', mirrors: [], repo: 'a/b', path: 'SKILL.md', stars: 0, pushedAt: '', size: 1, status: 'ready', lastSeen: 'now', ...over,
})

describe('mergeWorklist', () => {
  it('keeps graded items and does not re-add them as ready', () => {
    const existing = [item({ skillMdHash: 'h1', primarySourceUrl: 'u1', status: 'graded' })]
    const fresh = [item({ skillMdHash: 'h1', primarySourceUrl: 'u1' })]
    const out = mergeWorklist(existing, fresh, new Set(['h1']))
    expect(out.filter((i) => i.status === 'graded')).toHaveLength(1)
    expect(out.filter((i) => i.status === 'ready')).toHaveLength(0)
  })
  it('flags drift: same source, new hash', () => {
    const existing = [item({ skillMdHash: 'old', primarySourceUrl: 'u1', status: 'graded' })]
    const fresh = [item({ skillMdHash: 'new', primarySourceUrl: 'u1' })]
    const out = mergeWorklist(existing, fresh, new Set(['old']))
    expect(out.find((i) => i.skillMdHash === 'new')?.status).toBe('drifted')
  })
  it('adds genuinely new ready items', () => {
    const out = mergeWorklist([], [item({ skillMdHash: 'h2', primarySourceUrl: 'u2' })], new Set())
    expect(out).toHaveLength(1)
    expect(out[0].status).toBe('ready')
  })
})

describe('selectWave', () => {
  it('returns up to N ready/drifted items, popularity-desc', () => {
    const items = [
      item({ skillMdHash: 'a', primarySourceUrl: 'ua', stars: 1 }),
      item({ skillMdHash: 'b', primarySourceUrl: 'ub', stars: 9 }),
      item({ skillMdHash: 'c', primarySourceUrl: 'uc', status: 'graded', stars: 99 }),
      item({ skillMdHash: 'd', primarySourceUrl: 'ud', status: 'drifted', stars: 5 }),
    ]
    expect(selectWave(items, 2).map((i) => i.skillMdHash)).toEqual(['b', 'd'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test dataset/state.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `dataset/state.ts`:

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { WorklistItem } from './dedup.js'

const RANK: Record<WorklistItem['status'], number> = { ready: 0, drifted: 0, graded: 1, 'filtered-out': 2 }

// Merge a fresh discovery pass into existing state without losing grading work.
//   - a hash already graded stays graded (skip re-grading)
//   - a fresh item on a known source but a NEW hash = drift → re-grade
//   - anything else new = ready
export function mergeWorklist(existing: WorklistItem[], fresh: WorklistItem[], gradedHashes: Set<string>): WorklistItem[] {
  const byHash = new Map(existing.map((i) => [i.skillMdHash, i]))
  const gradedSourceHash = new Map(existing.filter((i) => i.status === 'graded').map((i) => [i.primarySourceUrl, i.skillMdHash]))
  for (const f of fresh) {
    if (gradedHashes.has(f.skillMdHash)) continue // already graded, unchanged
    const priorHashForSource = gradedSourceHash.get(f.primarySourceUrl)
    const status: WorklistItem['status'] = priorHashForSource && priorHashForSource !== f.skillMdHash ? 'drifted' : 'ready'
    const prev = byHash.get(f.skillMdHash)
    byHash.set(f.skillMdHash, { ...f, status: prev?.status === 'graded' ? 'graded' : status })
  }
  return [...byHash.values()]
}

// Next N to grade: ready or drifted, most popular first.
export function selectWave(items: WorklistItem[], n: number): WorklistItem[] {
  return items
    .filter((i) => i.status === 'ready' || i.status === 'drifted')
    .sort((a, b) => (RANK[a.status] - RANK[b.status]) || b.stars - a.stars)
    .slice(0, n)
}

export function loadState(dir: string): WorklistItem[] {
  const p = join(dir, 'candidates.json')
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as WorklistItem[]) : []
}

export function saveState(dir: string, items: WorklistItem[]): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'candidates.json'), JSON.stringify(items, null, 2) + '\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test dataset/state.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add dataset/state.ts dataset/state.test.ts
git commit -m "feat(dataset): worklist merge (resume + drift) and wave selection"
```

---

### Task 6: Discovery CLI — wire adapter → fetch → hash → dedup → filter → state

**Files:**
- Create: `dataset/discover.ts`
- Test: `dataset/discover.test.ts`

**Interfaces:**
- Consumes: `SourceAdapter`, `fetchSkillMd`, `hashCandidate`, `filterValid`, `dedupe`, `mergeWorklist`, `loadState`, `saveState`.
- Produces: `runDiscovery(opts: { adapter: SourceAdapter; fetchContent: (c: Candidate) => Promise<string | null>; dir: string; now: string; gradedHashes: Set<string> }): Promise<{ ready: number; filtered: number; drifted: number }>` — the orchestration, with fetch injected so it is testable without network.

- [ ] **Step 1: Write the failing test**

Create `dataset/discover.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test dataset/discover.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `dataset/discover.ts`:

```typescript
import { hashCandidate, filterValid, type FetchedCandidate } from './filter.js'
import { dedupe, type WorklistItem } from './dedup.js'
import { mergeWorklist, loadState, saveState } from './state.js'
import type { Candidate, SourceAdapter } from './adapters/types.js'

export interface DiscoveryOpts {
  adapter: SourceAdapter
  fetchContent: (c: Candidate) => Promise<string | null>
  dir: string
  now: string
  gradedHashes: Set<string>
}

export async function runDiscovery(opts: DiscoveryOpts): Promise<{ ready: number; filtered: number; drifted: number }> {
  const fetched: FetchedCandidate[] = []
  let filtered = 0
  for await (const c of opts.adapter.discover()) {
    const content = await opts.fetchContent(c)
    if (content === null) continue // fetch failed/refused → skip, never abort
    const fc = hashCandidate(c, content)
    const v = filterValid(fc)
    if (!v.ok) {
      filtered++
      continue
    }
    fetched.push(fc)
  }
  const freshItems: WorklistItem[] = dedupe(fetched, opts.now)
  const merged = mergeWorklist(loadState(opts.dir), freshItems, opts.gradedHashes)
  saveState(opts.dir, merged)
  return {
    ready: merged.filter((i) => i.status === 'ready').length,
    filtered,
    drifted: merged.filter((i) => i.status === 'drifted').length,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test dataset/discover.test.ts` → PASS.

- [ ] **Step 5: Add the network entry wiring (not unit-tested)**

Append to `dataset/discover.ts` a CLI entry that supplies the real GitHub `apiGet` (used by `githubAdapter`) and the real `fetchContent` (a cached wrapper over `fetchSkillMd`). Cache files are named by hash; the token comes from `process.env.GITHUB_TOKEN`.

```typescript
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { githubAdapter } from './adapters/github.js'
import { fetchSkillMd } from './fetch.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CACHE = join(HERE, 'cache')

function cachedFetch(token?: string) {
  mkdirSync(CACHE, { recursive: true })
  return async (c: import('./adapters/types.js').Candidate): Promise<string | null> => {
    // Cache key by source identity; the content hash names the stored file after fetch.
    const key = createHash('sha256').update(c.repo + '\0' + c.ref + '\0' + c.path).digest('hex')
    const meta = join(CACHE, key + '.json')
    const prior = existsSync(meta) ? (JSON.parse(readFileSync(meta, 'utf8')) as { etag?: string; file: string }) : null
    const r = await fetchSkillMd(c, { token, etag: prior?.etag })
    if (r === null) return prior && existsSync(prior.file) ? readFileSync(prior.file, 'utf8') : null
    const file = join(CACHE, createHash('sha256').update(r.content).digest('hex') + '.md')
    writeFileSync(file, r.content)
    writeFileSync(meta, JSON.stringify({ etag: r.etag, file }))
    return r.content
  }
}

async function githubApiGet(path: string): Promise<unknown> {
  const token = process.env.GITHUB_TOKEN
  const res = await fetch('https://api.github.com' + path, {
    headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  })
  if (!res.ok) throw new Error(`github api ${res.status} for ${path}`)
  return res.json()
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const token = process.env.GITHUB_TOKEN
  const gradedHashes = new Set<string>() // seeded by grade step; empty run = grade everything ready
  runDiscovery({ adapter: githubAdapter(githubApiGet), fetchContent: cachedFetch(token), dir: HERE, now: new Date().toISOString(), gradedHashes })
    .then((r) => console.log(`discovery: ready=${r.ready} filtered=${r.filtered} drifted=${r.drifted}`))
    .catch((e) => { console.error(e); process.exit(1) })
}
```

Run: `pnpm typecheck` → clean. (The CLI path is exercised manually at runtime, not in unit tests.)

- [ ] **Step 6: Commit**

```bash
git add dataset/discover.ts dataset/discover.test.ts
git commit -m "feat(dataset): discovery orchestration (testable core + GitHub CLI wiring)"
```

---

### Task 7: Grading bridge — batch input + verdict merge

**Files:**
- Create: `dataset/grade-input.ts`
- Create: `dataset/grade-merge.ts`
- Test: `dataset/grade-input.test.ts`, `dataset/grade-merge.test.ts`

**Interfaces:**
- Consumes: `WorklistItem`; `loadRubric` from `../src/rubric.js`; `aggregate` from `../src/aggregate.js`; `ReportVerdict` from `../src/types.js`; the `EvalInput` shape from `hub/build-catalog.ts`.
- Produces:
  - `buildBatchInput(wave: WorklistItem[], readContent: (hash: string) => string): { hash: string; name: string; sourceUrl: string; content: string }[]` (in `grade-input.ts`).
  - `interface WaveVerdicts { skillMdHash: string; category: string; tagline: string; verdict: string; verdicts: ReportVerdict[] }`
  - `mergeGraded(evals: EvalInput[], waveResults: WaveVerdicts[], items: Map<string, WorklistItem>, rubricDir: string, now: string): EvalInput[]` (in `grade-merge.ts`) — computes badges via `aggregate`, builds `EvalInput` entries (with `skillMdHash`, `sourceUrl`, `popularity`, `mirrors`, `discoveredVia:'github'`, `evaluatedAt`, top highlights), and merges by hash.

- [ ] **Step 1: Write the failing tests**

Create `dataset/grade-input.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildBatchInput } from './grade-input.js'
import type { WorklistItem } from './dedup.js'

const item = (h: string): WorklistItem => ({ skillMdHash: h, name: 'foo', primarySourceUrl: 'https://u/' + h, mirrors: [], repo: 'a/b', path: 'SKILL.md', stars: 1, pushedAt: '', size: 1, status: 'ready', lastSeen: 'now' })

describe('buildBatchInput', () => {
  it('pairs each wave item with its cached content', () => {
    const out = buildBatchInput([item('h1')], (h) => (h === 'h1' ? '# content' : ''))
    expect(out).toEqual([{ hash: 'h1', name: 'foo', sourceUrl: 'https://u/h1', content: '# content' }])
  })
})
```

Create `dataset/grade-merge.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeGraded } from './grade-merge.js'
import type { WorklistItem } from './dedup.js'

const RUBRIC = join(dirname(fileURLToPath(import.meta.url)), '../rubric/skill')
const item = (h: string): WorklistItem => ({ skillMdHash: h, name: 'foo', primarySourceUrl: 'https://u', mirrors: ['https://m'], repo: 'a/b', path: 'SKILL.md', stars: 7, pushedAt: '', size: 1, status: 'ready', lastSeen: 'now' })

describe('mergeGraded', () => {
  it('builds an EvalInput with badges from aggregate + provenance, merged by hash', () => {
    const items = new Map<string, WorklistItem>([['h1', item('h1')]])
    const out = mergeGraded([], [{
      skillMdHash: 'h1', category: 'workflow', tagline: 'a tagline', verdict: 'a verdict',
      verdicts: [], // empty verdicts → aggregate yields all-error → real letters, still a valid entry
    }], items, RUBRIC, 'now')
    expect(out).toHaveLength(1)
    expect(out[0].skillMdHash).toBe('h1')
    expect(out[0].sourceUrl).toBe('https://u')
    expect(out[0].popularity).toBe(7)
    expect(out[0].mirrors).toEqual(['https://m'])
    expect(out[0].badges.effectiveness).toBe('not-evaluated')
    expect(['A','B','C','D','F']).toContain(out[0].badges.security)
  })
  it('replaces an existing entry with the same hash (drift re-grade)', () => {
    const items = new Map<string, WorklistItem>([['h1', item('h1')]])
    const existing = [{ name: 'foo', source: 'old', kind: 'skill', category: 'workflow', tagline: 'old', badges: { security: 'F', quality: 'F', hygiene: 'F', effectiveness: 'not-evaluated' }, highlights: [], skillMdHash: 'h1' } as any]
    const out = mergeGraded(existing, [{ skillMdHash: 'h1', category: 'workflow', tagline: 'new', verdict: 'v', verdicts: [] }], items, RUBRIC, 'now')
    expect(out).toHaveLength(1)
    expect(out[0].tagline).toBe('new')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test dataset/grade-input.test.ts dataset/grade-merge.test.ts` → FAIL (modules not found).

- [ ] **Step 3: Implement the batch-input builder**

Create `dataset/grade-input.ts`:

```typescript
import type { WorklistItem } from './dedup.js'

// The payload each grading subagent receives: identity + source + the SKILL.md text.
// Content is UNTRUSTED data to evaluate — the grading prompt must frame it as such.
export function buildBatchInput(
  wave: WorklistItem[],
  readContent: (hash: string) => string,
): { hash: string; name: string; sourceUrl: string; content: string }[] {
  return wave.map((i) => ({ hash: i.skillMdHash, name: i.name, sourceUrl: i.primarySourceUrl, content: readContent(i.skillMdHash) }))
}
```

- [ ] **Step 4: Implement the verdict merger**

Create `dataset/grade-merge.ts`:

```typescript
import { loadRubric } from '../src/rubric.js'
import { aggregate } from '../src/aggregate.js'
import type { ReportVerdict, DimensionKey, Letter } from '../src/types.js'
import type { WorklistItem } from './dedup.js'

// The EvalInput shape consumed by hub/build-catalog.ts (kept in sync with it).
export interface EvalInput {
  name: string
  source: string
  sourceUrl?: string
  kind: 'skill'
  category: string
  tagline: string
  verdict?: string
  badges: { security: Letter | 'not-evaluated'; quality: Letter | 'not-evaluated'; hygiene: Letter | 'not-evaluated'; effectiveness: 'not-evaluated' }
  highlights: { check: string; status: string; summary: string }[]
  evaluator?: { mode: string; model: string }
  evaluatedAt?: string
  preCheck?: { frontmatterValid: boolean; fileCount: number; skillMdBytes: number; criticalFlags: number; majorFlags: number }
  popularity?: number
  mirrors?: string[]
  discoveredVia?: string | null
  skillMdHash?: string | null
}

export interface WaveVerdicts {
  skillMdHash: string
  category: string
  tagline: string
  verdict: string
  verdicts: ReportVerdict[]
}

// Turn one skill's per-check verdicts into a catalog EvalInput. Badges come from
// aggregate() (code, not the model). Merged into evals by hash so a re-grade
// (drift) replaces the old entry rather than duplicating it.
export function mergeGraded(
  evals: EvalInput[],
  waveResults: WaveVerdicts[],
  items: Map<string, WorklistItem>,
  rubricDir: string,
  now: string,
): EvalInput[] {
  const rubric = loadRubric(rubricDir)
  const byHash = new Map(evals.map((e) => [e.skillMdHash, e]))
  for (const w of waveResults) {
    const item = items.get(w.skillMdHash)
    if (!item) continue
    const badges = { effectiveness: 'not-evaluated' } as EvalInput['badges']
    for (const dim of rubric.dimensions as { key: DimensionKey; checks: Parameters<typeof aggregate>[0] }[]) {
      const vs = w.verdicts.filter((v) => dim.checks.some((c) => c.id === v.check))
      badges[dim.key] = aggregate(dim.checks, vs).letter
    }
    const highlights = w.verdicts
      .filter((v) => v.status === 'fail' || v.status === 'warning')
      .slice(0, 3)
      .map((v) => ({ check: v.check, status: v.status, summary: v.summary ?? '' }))
    byHash.set(w.skillMdHash, {
      name: item.name,
      source: `GitHub · ${item.repo}${item.stars ? ` · ${item.stars}★` : ''}`,
      sourceUrl: item.primarySourceUrl,
      kind: 'skill',
      category: w.category,
      tagline: w.tagline,
      verdict: w.verdict,
      badges,
      highlights,
      evaluator: { mode: 'claude-code-native', model: 'claude-sonnet-5' },
      evaluatedAt: now,
      preCheck: { frontmatterValid: true, fileCount: 1, skillMdBytes: item.size, criticalFlags: 0, majorFlags: 0 },
      popularity: item.stars,
      mirrors: item.mirrors,
      discoveredVia: 'github',
      skillMdHash: w.skillMdHash,
    })
  }
  return [...byHash.values()]
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test dataset/grade-input.test.ts dataset/grade-merge.test.ts` → PASS. `pnpm typecheck` → clean. (If `loadRubric`'s return type field is named other than `dimensions`, adjust the destructuring to match `src/rubric.ts` — the badge computation via `aggregate(dim.checks, vs)` is unchanged.)

- [ ] **Step 6: Commit**

```bash
git add dataset/grade-input.ts dataset/grade-merge.ts dataset/grade-input.test.ts dataset/grade-merge.test.ts
git commit -m "feat(dataset): grading bridge — batch input + verdict→badge merge"
```

---

### Task 8: build-catalog emits the compact index + detail shards

**Files:**
- Modify: `hub/build-catalog.ts`
- Test: `test/hub.test.ts` (append) or `hub/build-catalog.test.ts` (create)

**Interfaces:**
- Consumes: `Catalog`, `CatalogIndexEntry`, `slugify` from `./schema.js`.
- Produces: `toIndex(catalog: Catalog): CatalogIndexEntry[]` and `toShards(catalog: Catalog): Record<string, unknown>` (slug → full entry), exported for test; the CLI writes `catalog-index.json` and `skills/<slug>.json`.

- [ ] **Step 1: Write the failing test**

Create `hub/build-catalog.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { toIndex, toShards } from './build-catalog.js'
import { buildCatalog } from './build-catalog.js'

const evalInput = {
  name: 'Foo Bar', source: 's', kind: 'skill' as const, category: 'workflow' as const, tagline: 't',
  badges: { security: 'A', quality: 'B', hygiene: 'C', effectiveness: 'not-evaluated' } as const,
  highlights: [{ check: 'S01', status: 'pass', summary: 'ok' }],
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test hub/build-catalog.test.ts` → FAIL (`toIndex`/`toShards` not exported).

- [ ] **Step 3: Implement**

In `hub/build-catalog.ts`, add exports and import `CatalogIndexEntry`:

```typescript
import { CatalogSchema, TAXONOMY, overallGrade, slugify, type Catalog, type CatalogEntry, type CatalogIndexEntry } from './schema.js'

export function toIndex(catalog: Catalog): CatalogIndexEntry[] {
  return catalog.skills.map((s) => ({
    slug: s.slug,
    name: s.name,
    overall: s.overall,
    badges: { security: s.badges.security, quality: s.badges.quality, hygiene: s.badges.hygiene },
    category: s.category,
    tagline: s.tagline,
    popularity: s.popularity,
    sourceUrl: s.sourceUrl ?? '',
    skillMdHash: s.skillMdHash,
  }))
}

export function toShards(catalog: Catalog): Record<string, CatalogEntry> {
  const out: Record<string, CatalogEntry> = {}
  for (const s of catalog.skills) out[s.slug] = s // slug is unique per entry (slugify + build order)
  return out
}
```

In the CLI entrypoint (the `if (process.argv[1] ...)` block), after writing `catalog.json` and `index.html`, add:

```typescript
  writeFileSync(join(HERE, 'catalog-index.json'), JSON.stringify(toIndex(catalog)) + '\n')
  const shardDir = join(HERE, 'skills')
  mkdirSync(shardDir, { recursive: true })
  const shards = toShards(catalog)
  for (const [slug, entry] of Object.entries(shards)) {
    writeFileSync(join(shardDir, `${slug}.json`), JSON.stringify(entry) + '\n')
  }
  console.log(`wrote catalog-index.json (${catalog.skills.length} rows) + ${Object.keys(shards).length} shards`)
```

Add `mkdirSync` to the `node:fs` import at the top.

Note on slug uniqueness: if two entries slugify to the same value, suffix later ones. Add before writing shards:

```typescript
  // Guarantee unique slugs so a shard never overwrites another skill's detail.
  const used = new Set<string>()
  for (const s of catalog.skills) {
    let slug = s.slug, i = 2
    while (used.has(slug)) slug = `${s.slug}-${i++}`
    used.add(slug)
    ;(s as { slug: string }).slug = slug
  }
```

(Place this block immediately after `const catalog = buildCatalog(...)` in the CLI, before `toIndex`/`toShards`, so both the index and shards agree on the deduped slug.)

- [ ] **Step 4: Run test + full build**

Run: `pnpm test hub/build-catalog.test.ts` → PASS.
Run: `pnpm tsx hub/build-catalog.ts` → prints the shard count; `hub/catalog-index.json` and `hub/skills/*.json` exist.

- [ ] **Step 5: Commit**

```bash
git add hub/build-catalog.ts hub/build-catalog.test.ts hub/catalog-index.json hub/skills
git commit -m "feat(hub): emit compact catalog-index.json + per-skill detail shards"
```

---

### Task 9: Hub client — search/pagination over the index, lazy detail

**Files:**
- Create: `hub/client-search.js` (browser + vitest ESM; pure functions)
- Create: `hub/client-search.test.ts`
- Modify: `hub/index.template.html` (load the index, paginate, lazy-load detail)

**Interfaces:**
- Produces (from `hub/client-search.js`):
  - `filterSort(index, { q, minGrade, category, sort })` → filtered+sorted array.
  - `paginate(list, page, pageSize)` → `{ rows, hasMore }`.
  - `GRADE_ORDER` map.

- [ ] **Step 1: Write the failing test**

Create `hub/client-search.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
// @ts-expect-error plain JS module, no types
import { filterSort, paginate } from './client-search.js'

const idx = [
  { name: 'alpha', overall: 'A', category: 'workflow', tagline: 'x', popularity: 3 },
  { name: 'bravo', overall: 'D', category: 'security', tagline: 'y', popularity: 9 },
  { name: 'charlie', overall: 'B', category: 'workflow', tagline: 'z', popularity: 1 },
]

describe('filterSort', () => {
  it('filters by query substring (name/tagline)', () => {
    expect(filterSort(idx, { q: 'brav' }).map((r) => r.name)).toEqual(['bravo'])
  })
  it('filters by minGrade (A best)', () => {
    expect(filterSort(idx, { minGrade: 'B' }).map((r) => r.name).sort()).toEqual(['alpha', 'charlie'])
  })
  it('filters by category', () => {
    expect(filterSort(idx, { category: 'security' }).map((r) => r.name)).toEqual(['bravo'])
  })
  it('sorts by popularity desc', () => {
    expect(filterSort(idx, { sort: 'popularity' }).map((r) => r.name)).toEqual(['bravo', 'alpha', 'charlie'])
  })
})

describe('paginate', () => {
  it('slices a page and reports hasMore', () => {
    expect(paginate([1, 2, 3, 4, 5], 0, 2)).toEqual({ rows: [1, 2], hasMore: true })
    expect(paginate([1, 2, 3, 4, 5], 2, 2)).toEqual({ rows: [5], hasMore: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test hub/client-search.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement the pure client module**

Create `hub/client-search.js`:

```javascript
// Pure, framework-free browse logic — imported by the hub page (as an ES module)
// and by the vitest test. No DOM here.
export const GRADE_ORDER = { A: 0, B: 1, C: 2, D: 3, F: 4, 'not-evaluated': 9 }

export function filterSort(index, opts) {
  const o = opts || {}
  const q = (o.q || '').toLowerCase()
  const minGrade = o.minGrade || 'F'
  const category = o.category || 'all'
  const sort = o.sort || 'grade'
  const maxRank = GRADE_ORDER[minGrade]
  let rows = index.filter(function (r) {
    if (q && !((r.name || '').toLowerCase().includes(q) || (r.tagline || '').toLowerCase().includes(q))) return false
    if (category !== 'all' && r.category !== category) return false
    if ((GRADE_ORDER[r.overall] != null ? GRADE_ORDER[r.overall] : 9) > maxRank) return false
    return true
  })
  rows = rows.slice().sort(function (a, b) {
    if (sort === 'popularity') return (b.popularity || 0) - (a.popularity || 0)
    if (sort === 'name') return (a.name || '').localeCompare(b.name || '')
    return (GRADE_ORDER[a.overall] - GRADE_ORDER[b.overall]) || (b.popularity || 0) - (a.popularity || 0)
  })
  return rows
}

export function paginate(list, page, pageSize) {
  const start = page * pageSize
  const rows = list.slice(start, start + pageSize)
  return { rows: rows, hasMore: start + pageSize < list.length }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test hub/client-search.test.ts` → PASS.

- [ ] **Step 5: Rewire the page to the index + lazy detail**

In `hub/index.template.html`: replace the inline catalog `<script id="catalog" type="application/json">/*CATALOG_JSON*/</script>` data source with a runtime fetch of `catalog-index.json`, driven by the pure module. Replace the browse IIFE's data acquisition and card rendering so that:

1. On load: `const index = await (await fetch('catalog-index.json')).json()`.
2. Browse state `{ q, minGrade, category, sort, page }`; on any change: `const rows = filterSort(index, state)`, then `const { rows: pageRows, hasMore } = paginate(rows, 0..state.page, 60)` accumulated, render `pageRows` cards.
3. "Load more" via an `IntersectionObserver` sentinel at the grid bottom → `state.page++` and append the next page (never re-render all).
4. Card click / drawer open: `const detail = await (await fetch('skills/' + row.slug + '.json')).json()` then render the existing drawer from `detail` (verdict, highlights, preCheck).

Add the module import at the top of the page script section:

```html
<script type="module">
  import { filterSort, paginate, GRADE_ORDER } from './client-search.js'
  window.__browse = { filterSort, paginate, GRADE_ORDER }
</script>
```

and have the existing IIFE read `window.__browse`. Keep all existing escaping (`esc`) for any skill-derived string inserted into the DOM — a listed skill must not be able to inject markup. Keep the methodology/MCP/hero sections unchanged.

- [ ] **Step 6: Rebuild + verify the page loads the index**

Run: `pnpm tsx hub/build-catalog.ts`.
Run a static check that the built page references the index and the module, not an inline catalog:

```bash
grep -c "fetch('catalog-index.json')" hub/index.html
grep -c "client-search.js" hub/index.html
```
Expected: each `1`.

Manually (optional but recommended): serve `hub/` (`cd hub && python3 -m http.server 8099`) and confirm cards render, search filters, "load more" appends, and opening a card fetches its shard. Note the result in the commit.

- [ ] **Step 7: Commit**

```bash
git add hub/client-search.js hub/client-search.test.ts hub/index.template.html hub/index.html
git commit -m "feat(hub): client-side search/pagination over the index + lazy detail"
```

---

### Task 10: Ops — gitignore, nginx gzip + shard copy, operator runbook

**Files:**
- Modify: `.gitignore`
- Modify: `Dockerfile` (hub nginx image)
- Create: `dataset/README.md`

**Interfaces:** none (ops).

- [ ] **Step 1: Ignore the local build workspace + cache**

Append to `.gitignore`:

```
# dataset builder — local working state + fetched content (never committed)
dataset/cache/
dataset/candidates.json
```

(Keep the `dataset/*.ts` source tracked — only the workspace state and cache are ignored.)

- [ ] **Step 2: Serve the new files with gzip**

Replace `Dockerfile` (hub nginx image) so it copies the index + shards and enables gzip:

```dockerfile
# Static SkillGrade hub — nginx serving the self-contained index.html + catalog data.
FROM nginx:alpine
RUN printf 'gzip on;\ngzip_types application/json application/javascript text/css;\ngzip_min_length 1024;\n' > /etc/nginx/conf.d/gzip.conf
COPY hub/index.html /usr/share/nginx/html/index.html
COPY hub/client-search.js /usr/share/nginx/html/client-search.js
COPY hub/catalog.json /usr/share/nginx/html/catalog.json
COPY hub/catalog-index.json /usr/share/nginx/html/catalog-index.json
COPY hub/skills/ /usr/share/nginx/html/skills/
```

- [ ] **Step 3: Verify the image builds and serves the index**

Run:
```bash
docker build -f Dockerfile -t skillgrade-hub .
docker run --rm -d -p 8098:80 --name sg-hub skillgrade-hub
sleep 1
curl -s -H 'accept-encoding: gzip' -I http://localhost:8098/catalog-index.json | grep -i 'content-encoding: gzip'
curl -s http://localhost:8098/client-search.js | head -c 40
docker stop sg-hub
```
Expected: the `content-encoding: gzip` header is present and the JS is served.

- [ ] **Step 4: Write the operator runbook**

Create `dataset/README.md` documenting the end-to-end flow an operator runs in a Claude Code session:

1. `GITHUB_TOKEN=… pnpm tsx dataset/discover.ts` → populates `dataset/candidates.json` (ready/filtered/drifted counts).
2. Grade a wave: select the next N with `selectWave`, `buildBatchInput`, then invoke the `grade-skills-batch` ultracode Workflow (Sonnet 5 subagents → per-check `VERDICTS`), and `mergeGraded` the results into `hub/evaluations.json`. Repeat for successive waves (≈50–100 per wave).
3. `pnpm tsx hub/build-catalog.ts` → rebuilds `catalog.json` + `catalog-index.json` + `skills/`.
4. Deploy: commit `hub/evaluations.json` + built catalog artifacts, push; redeploy the hub app and the MCP app (Coolify) so both load the grown catalog.
5. Re-scan for drift: re-run step 1 (seed `gradedHashes` from `evaluations.json`); drifted skills re-enter the wave queue.

Document the security invariants (allowlist, no execution, size cap, token in env only) and that `dataset/` state + cache are gitignored.

- [ ] **Step 5: Commit**

```bash
git add .gitignore Dockerfile dataset/README.md
git commit -m "chore(dataset): gitignore workspace, nginx gzip + shards, operator runbook"
```

---

## Self-Review

**Spec coverage:**
- Discovery adapters (GitHub-native, pluggable interface) → Tasks 2. ✓
- Fetch (allowlist, conditional, cache, backoff, size cap) → Task 3 + Task 6 cache wiring. ✓
- Dedup + drift by skillMdHash → Tasks 4 (dedup), 5 (drift in mergeWorklist). ✓
- Deterministic filter → Task 4 (filter). ✓
- Grading waves (native Sonnet 5 Workflow; scores in code; resume; drift) → Task 7 + runbook Task 10. ✓
- Hub compact index + lazy shards + client search/pagination → Tasks 8, 9. ✓
- MCP unchanged → nothing touches `mcp/` (only `mcp/normalize.js` is imported). ✓
- Security (SSRF allowlist, no execution, cache-by-hash, size cap, token env-only, copy-free) → Task 3 + Global Constraints + runbook. ✓
- Provenance fields (sourceUrl, mirrors, popularity, discoveredVia, slug) → Task 1, populated in Task 7. ✓
- Testing (adapter, fetch, dedup, filter, state, build index/shards, client search) → Tasks 2–9 tests. ✓

**Placeholder scan:** no TBD/TODO; every code step shows full code; the one manual step (Task 9 Step 5 page rewiring) describes concrete edits with the exact fetch calls, module import, and escaping requirement — acceptable as it edits a large existing template rather than authoring a new function.

**Type consistency:** `Candidate` (Task 2) → consumed unchanged in Tasks 3, 4, 6. `FetchedCandidate` (Task 4) → Task 6. `WorklistItem` (Task 4) → Tasks 5, 6, 7. `EvalInput` (Task 7) mirrors `hub/build-catalog.ts` and is extended in Task 1. `CatalogIndexEntry`/`slugify` (Task 1) → Task 8. `skillMdHash` is the one identity across dedup (4), state/drift (5), grading merge (7). `filterSort`/`paginate` (Task 9) match their test. Slug uniqueness enforced in Task 8 before both index and shards are written.
