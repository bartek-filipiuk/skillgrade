# SkillGrade Consumer MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a read-only hosted MCP server that matches a consumer's locally-installed skills against the graded SkillGrade catalog, flags drift (local copy ≠ graded copy), and returns lightweight text suggestions.

**Architecture:** A thin Node HTTP MCP server (stateless streamable-HTTP) loads `hub/catalog.json` into memory, builds two indexes (`hash→entry`, `name→[entries]`), and answers three read-only tools. All request-time logic is pure functions over the index — no DB, no LLM, no secrets. Identity is a normalized sha256 of `SKILL.md`; the same normalization runs in our backfill and (documented) in the consumer's agent so hashes match across the boundary.

**Tech Stack:** TypeScript ESM (Node ≥20), pnpm, `@modelcontextprotocol/sdk`, Zod 4, Vitest, Docker/nginx→Node on Coolify.

## Global Constraints

- TypeScript ESM, `type: module`; import local files with the `.js` extension in import specifiers (e.g. `./lookup.js`), matching the existing `src/` code.
- Node ≥ 20. pnpm (`pnpm@10.24.0`).
- Zod 4 (already a dep). MCP SDK requires `zod ^4.2.0` — compatible.
- Tests: Vitest (`pnpm test` → `vitest run`). Colocate as `*.test.ts` next to source, matching existing layout.
- The MCP executes nothing, fetches no user-supplied URL, accepts no skill content — only `{name, hash}` inputs. Responses are plain JSON.
- Normalization rules (identical everywhere): decode UTF-8 → strip leading BOM → CRLF and lone CR → LF → rstrip trailing whitespace/newlines → sha256 of resulting UTF-8 bytes, lowercase hex.
- `skillMdHash` = normalized sha256 of the **SKILL.md file only** (not the bundle). Distinct from the existing bundle `contentHash` in `src/loadSkill.ts`.
- Report base URL constant: `https://skillgrade.dev`.
- Never write the OpenRouter key to any file/commit/log; env var only. (Backfill uses no LLM, so it needs no key.)

---

### Task 1: Add `skillMdHash` to the catalog data contract

**Files:**
- Modify: `hub/schema.ts` (CatalogEntrySchema)
- Modify: `hub/build-catalog.ts` (EvalInput + buildEntry)
- Test: `hub/schema.test.ts` (create)

**Interfaces:**
- Produces: `CatalogEntry.skillMdHash: string | null` — present on every entry; `null` when no source could be resolved. `EvalInput.skillMdHash?: string | null` passthrough.

- [ ] **Step 1: Write the failing test**

Create `hub/schema.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test hub/schema.test.ts`
Expected: FAIL (`skillMdHash` unknown / not required).

- [ ] **Step 3: Add the field to the schema**

In `hub/schema.ts`, inside `CatalogEntrySchema`, add after the `evaluator` field (last property):

```typescript
  evaluator: z.object({ mode: z.string(), model: z.string() }),
  skillMdHash: z.string().nullable(), // normalized sha256 of SKILL.md; null when no source resolved
```

- [ ] **Step 4: Thread it through the builder**

In `hub/build-catalog.ts`, add to the `EvalInput` interface (after `featuredOrder?`):

```typescript
  skillMdHash?: string | null // normalized SKILL.md hash; carried from evaluations.json
```

In `buildEntry`, change the returned object so the key is always present:

```typescript
  return {
    ...e,
    overall: overallGrade(e.badges),
    preCheck,
    rubricVersion: RUBRIC_VERSION,
    evaluatedAt: e.evaluatedAt ?? evaluatedAt,
    evaluator: e.evaluator ?? EVALUATOR,
    skillMdHash: e.skillMdHash ?? null,
  }
```

- [ ] **Step 5: Run tests + rebuild catalog**

Run: `pnpm test hub/schema.test.ts`
Expected: PASS.

Run: `pnpm tsx hub/build-catalog.ts`
Expected: prints `catalog.json: 125 skills ...`; every entry now has `"skillMdHash": null` (backfilled in Task 6).

- [ ] **Step 6: Commit**

```bash
git add hub/schema.ts hub/build-catalog.ts hub/schema.test.ts hub/catalog.json hub/index.html
git commit -m "feat(hub): add skillMdHash field to catalog entries"
```

---

### Task 2: Normalization + SKILL.md hash

**Files:**
- Create: `mcp/normalize.ts`
- Test: `mcp/normalize.test.ts`

**Interfaces:**
- Produces:
  - `normalizeSkillMd(content: string): string`
  - `hashSkillMd(content: string): string` — lowercase sha256 hex of the normalized content.

- [ ] **Step 1: Write the failing test**

Create `mcp/normalize.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { normalizeSkillMd, hashSkillMd } from './normalize.js'

const canonical = '---\nname: foo\n---\n# Foo\n\nBody line.'

describe('normalizeSkillMd', () => {
  it('is stable across CRLF, lone CR, trailing newlines and BOM', () => {
    const crlf = canonical.replace(/\n/g, '\r\n')
    const cr = canonical.replace(/\n/g, '\r')
    const trailing = canonical + '\n\n  \n'
    const bom = '﻿' + canonical
    const h = hashSkillMd(canonical)
    expect(hashSkillMd(crlf)).toBe(h)
    expect(hashSkillMd(cr)).toBe(h)
    expect(hashSkillMd(trailing)).toBe(h)
    expect(hashSkillMd(bom)).toBe(h)
  })

  it('changes when the content changes', () => {
    expect(hashSkillMd(canonical)).not.toBe(hashSkillMd(canonical + ' extra'))
  })

  it('produces lowercase 64-char hex', () => {
    expect(hashSkillMd(canonical)).toMatch(/^[0-9a-f]{64}$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test mcp/normalize.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `mcp/normalize.ts`:

```typescript
import { createHash } from 'node:crypto'

// The canonical form used on BOTH sides of the trust boundary: our backfill and the
// consumer's agent MUST apply these exact rules, or hashes never match. Keep it simple.
//   1. strip a leading UTF-8 BOM
//   2. CRLF and lone CR -> LF
//   3. rstrip trailing whitespace/newlines at end of file
export function normalizeSkillMd(content: string): string {
  let s = content
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  s = s.replace(/\r\n?/g, '\n')
  s = s.replace(/[\s﻿\xA0]+$/, '')
  return s
}

export function hashSkillMd(content: string): string {
  return createHash('sha256').update(normalizeSkillMd(content), 'utf8').digest('hex')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test mcp/normalize.test.ts`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add mcp/normalize.ts mcp/normalize.test.ts
git commit -m "feat(mcp): normalized SKILL.md hashing"
```

---

### Task 3: Skill index builder

**Files:**
- Create: `mcp/index-build.ts`
- Test: `mcp/index-build.test.ts`

**Interfaces:**
- Consumes: `Catalog`, `CatalogEntry` from `../hub/schema.js`.
- Produces:
  - `interface SkillIndex { byHash: Map<string, CatalogEntry>; byName: Map<string, CatalogEntry[]> }`
  - `buildIndex(catalog: Catalog): SkillIndex`

- [ ] **Step 1: Write the failing test**

Create `mcp/index-build.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildIndex } from './index-build.js'
import type { Catalog, CatalogEntry } from '../hub/schema.js'

function entry(name: string, hash: string | null): CatalogEntry {
  return {
    name, source: 's', kind: 'skill', category: 'workflow', tagline: 't',
    badges: { security: 'A', quality: 'A', hygiene: 'A', effectiveness: 'not-evaluated' },
    overall: 'A', highlights: [],
    preCheck: { frontmatterValid: true, fileCount: 1, skillMdBytes: 1, criticalFlags: 0, majorFlags: 0 },
    rubricVersion: '0.1.2', evaluatedAt: 'now', evaluator: { mode: 'm', model: 'x' },
    skillMdHash: hash,
  }
}

const catalog: Catalog = {
  generatedAt: 'now', rubricVersion: '0.1.2', taxonomy: [],
  skills: [
    entry('skill-creator', 'hash-a'),
    entry('skill-creator', 'hash-b'), // name collision, different hash
    entry('orphan', null),            // no resolved source
  ],
}

describe('buildIndex', () => {
  it('maps each non-null hash to its entry', () => {
    const idx = buildIndex(catalog)
    expect(idx.byHash.get('hash-a')?.skillMdHash).toBe('hash-a')
    expect(idx.byHash.get('hash-b')?.skillMdHash).toBe('hash-b')
    expect(idx.byHash.size).toBe(2)
  })
  it('excludes null-hash entries from the hash index', () => {
    expect(buildIndex(catalog).byHash.has('null')).toBe(false)
  })
  it('groups all entries by name including collisions', () => {
    const idx = buildIndex(catalog)
    expect(idx.byName.get('skill-creator')).toHaveLength(2)
    expect(idx.byName.get('orphan')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test mcp/index-build.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `mcp/index-build.ts`:

```typescript
import type { Catalog, CatalogEntry } from '../hub/schema.js'

export interface SkillIndex {
  byHash: Map<string, CatalogEntry>
  byName: Map<string, CatalogEntry[]>
}

// Pre-computed lookup over the graded catalog.
//   byHash — primary identity + provenance (1:1). null-hash entries are absent here.
//   byName — fallback + collision handling (1:many); every entry appears.
export function buildIndex(catalog: Catalog): SkillIndex {
  const byHash = new Map<string, CatalogEntry>()
  const byName = new Map<string, CatalogEntry[]>()
  for (const e of catalog.skills) {
    if (e.skillMdHash) byHash.set(e.skillMdHash, e)
    const group = byName.get(e.name)
    if (group) group.push(e)
    else byName.set(e.name, [e])
  }
  return { byHash, byName }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test mcp/index-build.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mcp/index-build.ts mcp/index-build.test.ts
git commit -m "feat(mcp): skill index (hash + name)"
```

---

### Task 4: Response schemas + core lookup logic

**Files:**
- Create: `mcp/schema.ts` (response contract)
- Create: `mcp/lookup.ts` (pure query logic)
- Test: `mcp/lookup.test.ts`

**Interfaces:**
- Consumes: `SkillIndex` from `./index-build.js`; `CatalogEntry` from `../hub/schema.js`.
- Produces (from `mcp/lookup.ts`):
  - `lookupSkill(index: SkillIndex, q: { hash?: string; name?: string }): SkillResult`
  - `auditSkills(index: SkillIndex, skills: { name?: string; hash?: string }[]): AuditReport`
  - `searchSkills(index: SkillIndex, query: string): SearchHit[]`
- Produces (from `mcp/schema.ts`): `SkillResult`, `AuditReport`, `SearchHit` types + their zod schemas `SkillResultSchema`, `AuditReportSchema`, `SearchHitSchema`.

- [ ] **Step 1: Write the response schemas**

Create `mcp/schema.ts`:

```typescript
import { z } from 'zod'

export const REPORT_BASE = 'https://skillgrade.dev'

export const FindingSchema = z.object({
  check: z.string(),
  dimension: z.enum(['security', 'quality', 'hygiene']),
  status: z.enum(['fail', 'warning']),
  summary: z.string(),
})

const gradedBadges = z.object({ security: z.string(), quality: z.string(), hygiene: z.string() })

export const SkillResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('verified'),
    name: z.string(),
    category: z.string(),
    overall: z.string(),
    badges: gradedBadges,
    verdict: z.string().optional(),
    findings: z.array(FindingSchema),
    gradedHash: z.string(),
    rubricVersion: z.string(),
    evaluatedAt: z.string(),
    reportUrl: z.string(),
    sourceUrl: z.string().optional(),
  }),
  z.object({
    status: z.literal('drift'),
    name: z.string(),
    gradedOverall: z.string(),
    gradedHash: z.string(),
    yourHash: z.string(),
    message: z.string(),
    reportUrl: z.string(),
  }),
  z.object({
    status: z.literal('reference'),
    name: z.string(),
    overall: z.string(),
    badges: gradedBadges,
    verdict: z.string().optional(),
    findings: z.array(FindingSchema),
    message: z.string(),
    reportUrl: z.string(),
    sourceUrl: z.string().optional(),
  }),
  z.object({
    status: z.literal('unknown'),
    name: z.string().optional(),
    message: z.string(),
  }),
])

export const AuditReportSchema = z.object({
  summary: z.object({
    total: z.number(),
    verified: z.number(),
    drifted: z.number(),
    unknown: z.number(),
    gradeCounts: z.record(z.string(), z.number()),
  }),
  skills: z.array(SkillResultSchema),
})

export const SearchHitSchema = z.object({
  name: z.string(),
  overall: z.string(),
  category: z.string(),
  reportUrl: z.string(),
})

export type Finding = z.infer<typeof FindingSchema>
export type SkillResult = z.infer<typeof SkillResultSchema>
export type AuditReport = z.infer<typeof AuditReportSchema>
export type SearchHit = z.infer<typeof SearchHitSchema>
```

- [ ] **Step 2: Write the failing test**

Create `mcp/lookup.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildIndex } from './index-build.js'
import { lookupSkill, auditSkills, searchSkills } from './lookup.js'
import type { Catalog, CatalogEntry } from '../hub/schema.js'

function entry(over: Partial<CatalogEntry> & { name: string; skillMdHash: string | null }): CatalogEntry {
  return {
    source: 's', sourceUrl: 'https://clawhub.ai/x/skills/' + over.name, kind: 'skill',
    category: 'workflow', tagline: 't',
    badges: { security: 'A', quality: 'B', hygiene: 'C', effectiveness: 'not-evaluated' },
    overall: 'C',
    highlights: [
      { check: 'S04', status: 'fail', summary: 'can delete files' },
      { check: 'Q03', status: 'warning', summary: 'doc slip' },
      { check: 'H05', status: 'pass', summary: 'fine' },
    ],
    preCheck: { frontmatterValid: true, fileCount: 1, skillMdBytes: 1, criticalFlags: 0, majorFlags: 0 },
    rubricVersion: '0.1.2', evaluatedAt: 'now', evaluator: { mode: 'm', model: 'x' },
    verdict: 'a verdict', ...over,
  } as CatalogEntry
}

const catalog: Catalog = {
  generatedAt: 'now', rubricVersion: '0.1.2', taxonomy: [],
  skills: [entry({ name: 'foo', skillMdHash: 'hash-foo' })],
}
const idx = buildIndex(catalog)

describe('lookupSkill', () => {
  it('verified: hash matches', () => {
    const r = lookupSkill(idx, { hash: 'hash-foo', name: 'foo' })
    expect(r.status).toBe('verified')
    if (r.status === 'verified') {
      expect(r.gradedHash).toBe('hash-foo')
      expect(r.findings.map((f) => f.check)).toEqual(['S04', 'Q03']) // fail/warning only, pass dropped
      expect(r.findings[0].dimension).toBe('security')
      expect(r.badges).not.toHaveProperty('effectiveness')
    }
  })
  it('drift: name matches, hash does not', () => {
    const r = lookupSkill(idx, { hash: 'other', name: 'foo' })
    expect(r.status).toBe('drift')
    if (r.status === 'drift') {
      expect(r.gradedHash).toBe('hash-foo')
      expect(r.yourHash).toBe('other')
    }
  })
  it('reference: only a name', () => {
    expect(lookupSkill(idx, { name: 'foo' }).status).toBe('reference')
  })
  it('unknown: nothing matches', () => {
    expect(lookupSkill(idx, { hash: 'x', name: 'nope' }).status).toBe('unknown')
  })
})

describe('auditSkills', () => {
  it('summarizes per-skill results', () => {
    const rep = auditSkills(idx, [
      { name: 'foo', hash: 'hash-foo' }, // verified (overall C)
      { name: 'foo', hash: 'other' },    // drift
      { name: 'nope', hash: 'z' },       // unknown
    ])
    expect(rep.summary).toMatchObject({ total: 3, verified: 1, drifted: 1, unknown: 1 })
    expect(rep.summary.gradeCounts).toEqual({ C: 1 })
  })
})

describe('searchSkills', () => {
  it('matches by name substring, case-insensitive', () => {
    expect(searchSkills(idx, 'FO').map((h) => h.name)).toEqual(['foo'])
    expect(searchSkills(idx, 'zzz')).toEqual([])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test mcp/lookup.test.ts`
Expected: FAIL (`./lookup.js` not found).

- [ ] **Step 4: Implement the lookup logic**

Create `mcp/lookup.ts`:

```typescript
import type { CatalogEntry } from '../hub/schema.js'
import type { SkillIndex } from './index-build.js'
import { REPORT_BASE, type Finding, type SkillResult, type AuditReport, type SearchHit } from './schema.js'

function dimensionOf(check: string): Finding['dimension'] {
  if (check.startsWith('S')) return 'security'
  if (check.startsWith('Q')) return 'quality'
  return 'hygiene'
}

function findings(e: CatalogEntry): Finding[] {
  return e.highlights
    .filter((h): h is typeof h & { status: 'fail' | 'warning' } => h.status === 'fail' || h.status === 'warning')
    .map((h) => ({ check: h.check, dimension: dimensionOf(h.check), status: h.status, summary: h.summary }))
}

function reportUrl(name: string): string {
  return `${REPORT_BASE}/#skill-${encodeURIComponent(name)}`
}

function gradedBadges(e: CatalogEntry) {
  return { security: e.badges.security, quality: e.badges.quality, hygiene: e.badges.hygiene }
}

function verified(e: CatalogEntry): SkillResult {
  return {
    status: 'verified', name: e.name, category: e.category, overall: e.overall,
    badges: gradedBadges(e), verdict: e.verdict, findings: findings(e),
    gradedHash: e.skillMdHash as string, rubricVersion: e.rubricVersion, evaluatedAt: e.evaluatedAt,
    reportUrl: reportUrl(e.name), sourceUrl: e.sourceUrl,
  }
}

export function lookupSkill(index: SkillIndex, q: { hash?: string; name?: string }): SkillResult {
  if (q.hash) {
    const hit = index.byHash.get(q.hash)
    if (hit) return verified(hit)
  }
  if (q.name) {
    const group = index.byName.get(q.name)
    if (group && group.length > 0) {
      const e = group[0]
      if (q.hash) {
        // name matched but the hash didn't — the user has a different/modified copy
        return {
          status: 'drift', name: e.name, gradedOverall: e.overall,
          gradedHash: (e.skillMdHash as string) ?? 'unknown', yourHash: q.hash,
          message: `You have a modified or different version than the one we graded (was ${e.overall}). ` +
            `We can't vouch for your copy — review the findings on the report page or request a re-grade.`,
          reportUrl: reportUrl(e.name),
        }
      }
      return {
        status: 'reference', name: e.name, overall: e.overall, badges: gradedBadges(e),
        verdict: e.verdict, findings: findings(e),
        message: `This is our grade of a skill named "${e.name}". Without a hash we can't confirm it's your exact copy.`,
        reportUrl: reportUrl(e.name), sourceUrl: e.sourceUrl,
      }
    }
  }
  return {
    status: 'unknown', name: q.name,
    message: 'Not in the SkillGrade database yet. (Coming: registered users can request a fresh grade.)',
  }
}

export function auditSkills(index: SkillIndex, skills: { name?: string; hash?: string }[]): AuditReport {
  const results = skills.map((s) => lookupSkill(index, s))
  const gradeCounts: Record<string, number> = {}
  let verifiedN = 0, drifted = 0, unknown = 0
  for (const r of results) {
    if (r.status === 'verified') { verifiedN++; gradeCounts[r.overall] = (gradeCounts[r.overall] ?? 0) + 1 }
    else if (r.status === 'drift') drifted++
    else if (r.status === 'unknown') unknown++
    // 'reference' is counted only in total (no hash was supplied to verify)
  }
  return {
    summary: { total: results.length, verified: verifiedN, drifted, unknown, gradeCounts },
    skills: results,
  }
}

export function searchSkills(index: SkillIndex, query: string): SearchHit[] {
  const q = query.toLowerCase()
  const hits: SearchHit[] = []
  const seen = new Set<string>()
  for (const [name, group] of index.byName) {
    if (!name.toLowerCase().includes(q)) continue
    const e = group[0]
    if (seen.has(name)) continue
    seen.add(name)
    hits.push({ name: e.name, overall: e.overall, category: e.category, reportUrl: reportUrl(e.name) })
  }
  return hits
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test mcp/lookup.test.ts`
Expected: PASS (all groups).

- [ ] **Step 6: Commit**

```bash
git add mcp/schema.ts mcp/lookup.ts mcp/lookup.test.ts
git commit -m "feat(mcp): response schemas + lookup/audit/search logic"
```

---

### Task 5: MCP server (tool handlers + streamable-HTTP wiring)

**Files:**
- Create: `mcp/handlers.ts` (pure tool handlers → MCP content shape)
- Create: `mcp/server.ts` (catalog load, McpServer, HTTP transport, rate limit, `main`)
- Create: `mcp/handlers.test.ts`
- Modify: `package.json` (add dep + `mcp` script)

**Interfaces:**
- Consumes: `buildIndex`, `lookupSkill`, `auditSkills`, `searchSkills`; the three response schemas.
- Produces (from `mcp/handlers.ts`):
  - `makeHandlers(index: SkillIndex)` → `{ lookup, audit, search }`, each an async fn returning `{ content: [{ type: 'text', text }], structuredContent }`.
- Produces (from `mcp/server.ts`): `loadIndex(): SkillIndex`, `buildMcpServer(index): McpServer`, `main()`.

- [ ] **Step 1: Add the SDK dependency**

Run: `pnpm add @modelcontextprotocol/sdk`
Add to `package.json` `scripts`:

```json
    "mcp": "tsx mcp/server.ts",
```

- [ ] **Step 2: Write the failing handler test**

Create `mcp/handlers.test.ts`:

```typescript
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test mcp/handlers.test.ts`
Expected: FAIL (`./handlers.js` not found).

- [ ] **Step 4: Implement the handlers**

Create `mcp/handlers.ts`:

```typescript
import type { SkillIndex } from './index-build.js'
import { lookupSkill, auditSkills, searchSkills } from './lookup.js'

function wrap<T>(structuredContent: T) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }], structuredContent }
}

// Thin, pure wrappers: query logic + MCP content envelope. Tested directly; server.ts just registers them.
export function makeHandlers(index: SkillIndex) {
  return {
    lookup: async (args: { hash?: string; name?: string }) => wrap(lookupSkill(index, args)),
    audit: async (args: { skills: { name?: string; hash?: string }[] }) => wrap(auditSkills(index, args.skills)),
    search: async (args: { query: string }) => wrap({ results: searchSkills(index, args.query) }),
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test mcp/handlers.test.ts`
Expected: PASS.

- [ ] **Step 6: Implement the server wiring**

Create `mcp/server.ts`:

```typescript
import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { CatalogSchema } from '../hub/schema.js'
import { buildIndex, type SkillIndex } from './index-build.js'
import { makeHandlers } from './handlers.js'

const HERE = dirname(fileURLToPath(import.meta.url))

export function loadIndex(): SkillIndex {
  const raw = JSON.parse(readFileSync(join(HERE, '../hub/catalog.json'), 'utf8'))
  return buildIndex(CatalogSchema.parse(raw)) // fail loud on a malformed catalog
}

export function buildMcpServer(index: SkillIndex): McpServer {
  const h = makeHandlers(index)
  const server = new McpServer({ name: 'skillgrade', version: '1.0.0' })

  server.registerTool('lookup_skill', {
    title: 'Look up one skill',
    description: 'Match a locally-installed skill against the SkillGrade catalog by SKILL.md hash and/or name. ' +
      'Returns verified / drift / reference / unknown. Send only {name, hash} — never skill content. ' +
      'Compute hash by normalizing SKILL.md (strip BOM; CRLF/CR->LF; rstrip trailing whitespace) then sha256 hex.',
    inputSchema: { hash: z.string().optional(), name: z.string().optional() },
  }, ({ hash, name }) => h.lookup({ hash, name }))

  server.registerTool('audit_skills', {
    title: 'Audit a set of skills',
    description: 'Batch version of lookup_skill for a whole installed skill set. Returns a summary + per-skill results.',
    inputSchema: { skills: z.array(z.object({ name: z.string().optional(), hash: z.string().optional() })) },
  }, ({ skills }) => h.audit({ skills }))

  server.registerTool('search', {
    title: 'Search graded skills',
    description: 'Find graded skills by name substring. Returns name, overall grade, category and report URL.',
    inputSchema: { query: z.string() },
  }, ({ query }) => h.search({ query }))

  return server
}

// ponytail: fixed-window in-memory rate limit; swap for a shared store only if we scale past one instance.
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 120
const hits = new Map<string, { count: number; resetAt: number }>()
function rateLimited(ip: string, now: number): boolean {
  const e = hits.get(ip)
  if (!e || now > e.resetAt) { hits.set(ip, { count: 1, resetAt: now + WINDOW_MS }); return false }
  e.count++
  return e.count > MAX_PER_WINDOW
}

export async function main() {
  const index = loadIndex()
  const port = Number(process.env.PORT ?? 8080)

  const httpServer = createServer(async (req, res) => {
    if (req.url !== '/mcp') { res.writeHead(404).end(); return }
    const ip = (req.socket.remoteAddress ?? 'unknown')
    if (rateLimited(ip, Date.now())) {
      res.writeHead(429, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'rate limit exceeded' }))
      return
    }
    // A fresh stateless transport + server per request (no session state to share).
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    const server = buildMcpServer(index)
    res.on('close', () => { transport.close(); server.close() })
    await server.connect(transport)
    await transport.handleRequest(req, res)
  })

  httpServer.listen(port, () => console.log(`skillgrade MCP on :${port}/mcp (${index.byHash.size} hashed skills)`))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
```

- [ ] **Step 7: Typecheck + smoke test the running server**

Run: `pnpm typecheck`
Expected: no errors. (If the installed SDK exposes a different transport import path or `registerTool` signature, adjust the import/handler shape to match the installed version — the handler logic in `handlers.ts` is unaffected.)

Run in one terminal: `pnpm mcp`
Expected: `skillgrade MCP on :8080/mcp (... hashed skills)`.

In another terminal, verify tools list (stateless single-shot JSON-RPC):

```bash
curl -sS -X POST http://localhost:8080/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | tail -c 800
```

Expected: JSON listing `lookup_skill`, `audit_skills`, `search`. Stop the server (Ctrl-C).

- [ ] **Step 8: Commit**

```bash
git add mcp/handlers.ts mcp/handlers.test.ts mcp/server.ts package.json pnpm-lock.yaml
git commit -m "feat(mcp): streamable-HTTP server with 3 read-only tools"
```

---

### Task 6: Backfill `skillMdHash` for the 125 existing entries

**Files:**
- Create: `scripts/backfill-hashes.ts`
- Modify: `hub/evaluations.json` (produced output — hashes written in)

**Interfaces:**
- Consumes: `hashSkillMd` from `../mcp/normalize.js`; reads/writes `hub/evaluations.json`; fetches ClawHub SKILL.md.

- [ ] **Step 1: Confirm the ClawHub source shape**

The catalog's ClawHub entries carry `sourceUrl` like `https://clawhub.ai/<handle>/skills/<slug>`. SKILL.md content is the API field `.skill.description` at `https://clawhub.ai/api/v1/skills/<slug>?owner=<handle>`. Non-ClawHub entries (cv-master, anthropic) have other sources and are handled as "unresolved → null" in MVP (backfill logs them; they answer as `reference` via the name index).

Run to see how many entries are ClawHub vs other:

```bash
pnpm tsx -e "const e=require('./hub/evaluations.json'); const c=e.filter(x=>x.sourceUrl?.includes('clawhub.ai')).length; console.log('clawhub:',c,'other:',e.length-c)"
```

Expected: prints the split (most are ClawHub).

- [ ] **Step 2: Write the backfill script**

Create `scripts/backfill-hashes.ts`:

```typescript
// One-off: resolve each evaluations.json entry's SKILL.md, compute skillMdHash, write it back.
// Unresolvable entries get skillMdHash: null (they answer as `reference` via the name index).
// Re-runnable: skips entries that already have a non-null hash unless --force is passed.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashSkillMd } from '../mcp/normalize.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const EVALS = join(HERE, '../hub/evaluations.json')
const force = process.argv.includes('--force')

interface Eval { name: string; sourceUrl?: string; skillMdHash?: string | null }

function clawhubParts(sourceUrl: string): { handle: string; slug: string } | null {
  const m = sourceUrl.match(/clawhub\.ai\/([^/]+)\/skills\/([^/?#]+)/)
  return m ? { handle: m[1], slug: m[2] } : null
}

async function fetchClawhubSkillMd(handle: string, slug: string): Promise<string | null> {
  const url = `https://clawhub.ai/api/v1/skills/${encodeURIComponent(slug)}?owner=${encodeURIComponent(handle)}`
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' } })
    if (!r.ok) return null
    const j = (await r.json()) as { skill?: { description?: string } }
    const desc = j.skill?.description
    return typeof desc === 'string' && desc.trim() ? desc : null
  } catch {
    return null
  }
}

async function main() {
  const evals = JSON.parse(readFileSync(EVALS, 'utf8')) as Eval[]
  let resolved = 0, nulled = 0, skipped = 0
  for (const e of evals) {
    if (!force && e.skillMdHash) { skipped++; continue }
    const parts = e.sourceUrl ? clawhubParts(e.sourceUrl) : null
    let content: string | null = null
    if (parts) content = await fetchClawhubSkillMd(parts.handle, parts.slug)
    if (content) { e.skillMdHash = hashSkillMd(content); resolved++ }
    else { e.skillMdHash = null; nulled++; console.warn(`unresolved: ${e.name} (${e.sourceUrl ?? 'no source'})`) }
  }
  writeFileSync(EVALS, JSON.stringify(evals, null, 2) + '\n')
  console.log(`backfill done — resolved:${resolved} null:${nulled} skipped:${skipped} total:${evals.length}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
```

- [ ] **Step 3: Run the backfill (network)**

Run: `pnpm tsx scripts/backfill-hashes.ts`
Expected: streams any `unresolved:` warnings, ends with `backfill done — resolved:N null:M ...`. `N` should cover the bulk of ClawHub entries; `M` = non-ClawHub + any fetch failures.

- [ ] **Step 4: Rebuild the catalog and verify hashes landed**

Run: `pnpm tsx hub/build-catalog.ts`

Run:
```bash
pnpm tsx -e "const c=require('./hub/catalog.json'); const h=c.skills.filter(s=>s.skillMdHash).length; console.log('with hash:',h,'/',c.skills.length)"
```
Expected: `with hash:` count matches the backfill's `resolved`.

- [ ] **Step 5: Sanity-check the index builds cleanly on real data**

Run:
```bash
pnpm tsx -e "const {buildIndex}=require('./mcp/index-build.ts'); const {CatalogSchema}=require('./hub/schema.ts')" 2>/dev/null || \
pnpm tsx -e "import('./mcp/index-build.js').then(async m=>{const c=JSON.parse(require('fs').readFileSync('./hub/catalog.json','utf8'));const i=m.buildIndex(c);console.log('byHash',i.byHash.size,'byName',i.byName.size)})"
```
Expected: prints non-zero `byHash` and `byName` sizes.

- [ ] **Step 6: Commit**

```bash
git add scripts/backfill-hashes.ts hub/evaluations.json hub/catalog.json hub/index.html
git commit -m "feat(hub): backfill skillMdHash for graded catalog entries"
```

---

### Task 7: Containerize + deploy notes

**Files:**
- Create: `mcp/Dockerfile`
- Create: `mcp/README.md` (run + deploy + normalization rules for consumer agents)

**Interfaces:** none (ops deliverable).

- [ ] **Step 1: Write the Dockerfile**

Create `mcp/Dockerfile` (build context = repo root, so the whole project — including `hub/catalog.json` — is available):

```dockerfile
FROM node:22-slim AS base
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
EXPOSE 8080
ENV PORT=8080
CMD ["pnpm", "mcp"]
```

- [ ] **Step 2: Build + run the image locally**

Run (from repo root):
```bash
docker build -f mcp/Dockerfile -t skillgrade-mcp .
docker run --rm -p 8080:8080 skillgrade-mcp
```
Expected: `skillgrade MCP on :8080/mcp (...)`. Verify with the same `tools/list` curl from Task 5 Step 7, then stop.

- [ ] **Step 3: Write the README**

Create `mcp/README.md` documenting: the three tools and their I/O; the **normalization rules verbatim** (so consumer agents reproduce the hash: strip BOM → CRLF/CR to LF → rstrip trailing whitespace → sha256 hex); the trust boundary (only `{name, hash}` leaves the machine); and the Coolify deploy (new app, build context = repo root, Dockerfile `mcp/Dockerfile`, port 8080, subdomain `mcp.skillgrade.dev`, redeploy whenever `hub/catalog.json` is rebuilt).

- [ ] **Step 4: Commit**

```bash
git add mcp/Dockerfile mcp/README.md
git commit -m "chore(mcp): Dockerfile + deploy/consumer README"
```

- [ ] **Step 5: Deploy (uses the coolify-deploy skill; run when ready)**

Deploy as a new Coolify application (own app UUID, separate from the hub): public repo, build_pack dockerfile, dockerfile path `mcp/Dockerfile`, build context repo root, `ports_exposes` 8080, domain `https://mcp.skillgrade.dev`. Add the app UUID to `.coolify.env` (e.g. `COOLIFY_MCP_APP_UUID=`). DNS: A record `mcp.skillgrade.dev → 65.109.60.26` (user sets it). Redeploy whenever the catalog is rebuilt.

---

## Self-Review

**Spec coverage:**
- Architecture (index / server / consumer agent) → Tasks 3, 5, and README in 7. ✓
- `skillMdHash` field + normalization → Tasks 1, 2. ✓
- Backfill (ClawHub re-fetch, null on unresolved) → Task 6. ✓
- Three tool contracts (verified/drift/reference/unknown; audit summary+gradeCounts; search) → Tasks 4, 5. ✓
- Hosting/ops (own subdomain, catalog in image, rate limit, zod-validate on load) → Tasks 5, 7. ✓
- Error handling (malformed catalog fail-loud; unknown as valid answer; null-hash → reference; backfill continue-on-error) → Tasks 5 (loadIndex), 4 (lookup), 6. ✓
- Testing (index / normalization / lookup 4 branches / audit / response contract) → Tasks 1–5 tests. ✓
- Out of scope (no auth, no LLM, no content submission, top-3 highlights only) → respected; noted in README/spec. ✓

**Placeholder scan:** no TBD/TODO; all code steps show full code; README content (Task 7 Step 3) is described concretely rather than pasted — acceptable as it's prose documentation, not code.

**Type consistency:** `SkillIndex`, `SkillResult`, `AuditReport`, `SearchHit`, `Finding` defined in Tasks 3–4 and consumed unchanged in Task 5. `skillMdHash` nullable string consistent across schema (Task 1), index (Task 3), lookup (Task 4), backfill (Task 6). Handler names `lookup/audit/search` consistent between `makeHandlers` (Task 5 Step 4) and its test/registration.
