# SkillGrade Consumer MCP — Design

**Date:** 2026-07-17
**Status:** Approved design, ready for implementation planning
**Depends on:** SkillGrade hub (rubric 0.1.2, `hub/catalog.json` with 125 graded skills, `hub/schema.ts`), live at skillgrade.dev

## Problem

SkillGrade grades public Claude Code skills (Security / Quality / Hygiene, A–F) and shows them on a hub. Today the value flows one way: we publish, people read. There is no way for a *consumer* — someone who has skills installed locally — to ask their agent "are the skills I actually have any good, and is my copy the same one you graded?"

We want an AI-native path: a hosted MCP server the consumer's agent calls to match locally-installed skills against our graded catalog, surface the grade, flag drift (local copy ≠ graded copy), and hand back lightweight text suggestions on what to fix. Suggestions only — no patch, no PR.

The differentiator is **find + provenance/drift**, not aggregation. "You have `skill-foo`; we graded it B; your copy matches; here are the two Hygiene warnings" — or "your copy differs from what we graded, we can't vouch for it."

## Scope

**In (MVP):**
- Hosted remote-HTTP MCP server on our side, read-only, serving the pre-computed catalog.
- Three tools: `lookup_skill`, `search`, `audit_skills`.
- `skillMdHash` added to every catalog entry (identity = normalized hash of SKILL.md).
- Backfill script for the 125 existing entries.
- The consumer's agent does the local work (scan skill dir, hash SKILL.md, present results). We do not ship a client — the agent uses its own filesystem tools.

**Out (explicitly deferred):**
- No LLM at request time. No fresh grading on our side.
- No auth/token in MVP (all data is public, read-only).
- No content submission. No patch/PR generation (suggestions only).
- Path C (token-gated paid fresh-grade for skills not in the DB) — future.
- Full per-check findings (we return stored top-3 highlights, not all ~30 verdicts) — future.

## Architecture

A small Node HTTP MCP server (streamable-HTTP transport) hosted on the same Coolify as skillgrade.dev, own subdomain (e.g. `mcp.skillgrade.dev`), own app UUID. It loads `catalog.json` into memory at startup, builds two indexes, and answers tool calls. Zero DB, zero LLM, zero secrets.

Three components, each independently testable:

### 1. skillgrade-index (pure, in-memory)
Built from `catalog.json`. Two maps:
- `hash → entry` (1:1) — primary lookup + provenance verification.
- `name → [entries]` (1:many) — fallback when hash misses, and handles name collisions (e.g. two `skill-creator`).

Entries whose `skillMdHash` is `null` (backfill couldn't resolve a source) are absent from the hash index but present in the name index (they can only ever answer as `reference`).

### 2. MCP server (thin request layer)
Wraps the index in three read-only tools (contracts below). Validates the outgoing response shape with zod. Light in-memory per-IP rate limit. Executes nothing, fetches nothing, accepts no skill content.

### 3. consumer agent (not ours)
The user's Claude Code / agent scans the local skills directory, reads each SKILL.md, normalizes + hashes it **with the identical rules we use**, calls the MCP, and presents results. The normalization rules are the contract that makes hashes match across the boundary — they must be published/documented so any agent reproduces them.

**Trust boundary:** only `{name, hash}` leaves the user's machine — never skill content. The MCP is a pure read function over public data. Responses are plain JSON; the agent presents them (we never render HTML).

## Data model

### skillMdHash
New field on `CatalogEntry`: `skillMdHash: string | null` — sha256 of the **normalized SKILL.md content** (the SKILL.md file only, not the whole bundle). SKILL.md is the common denominator: the one file the consumer definitely has and can hash the same way, regardless of whether we originally graded a bundle or SKILL.md-only.

Populated by the import/grade pipeline at grade time going forward; backfilled once for existing entries.

### Normalization (load-bearing)
Without normalization nearly every skill would show false drift, because our stored SKILL.md (e.g. from the ClawHub API `.skill.description`) and the user's installed file differ in trivial encoding. The rules must be **identical on both sides** and simple enough for any agent to reproduce:

1. Decode UTF-8, strip a leading BOM.
2. CRLF and lone CR → LF.
3. `rstrip` trailing whitespace/newlines at end of file.
4. sha256 of the resulting UTF-8 bytes.

Anything beyond this (a real content change) = real drift, correctly.

Accepted MVP risk: if the ClawHub API returns lightly-processed content vs the installed file, some skills produce false "drift." That is the safe direction of error — the message says "verify manually," never "it's fine." The real rate is measured during backfill.

### Backfill
One-off `scripts/backfill-hashes.ts`:
- ClawHub entries → re-fetch SKILL.md from the API (`.skill.description`), normalize, hash.
- cv-master / anthropic entries → from repo/clone.
- Log how many entries resolved a source. Unresolvable → `skillMdHash: null` (name-index only).

## Tool contracts

Shared per-skill result:

```jsonc
// status: "verified" — hash matched exactly
{ "status": "verified", "name": "...", "category": "...",
  "overall": "A".."F", "badges": { "security","quality","hygiene" },
  "verdict": "plain language: what's good / what's wrong and what could happen",
  "findings": [ { "check":"S04", "dimension":"security", "status":"fail", "summary":"can delete files..." } ],
  "gradedHash": "sha256...", "rubricVersion":"0.1.2", "evaluatedAt":"...", "reportUrl":"https://skillgrade.dev/..." }
```

Status variants:
- **`drift`** — name matches, hash doesn't: `{ status:"drift", name, gradedOverall, gradedHash, yourHash, message, reportUrl }`. Message: "you have a modified/different version than the one we graded (was A); we can't vouch for your copy — review the findings or request a re-grade."
- **`reference`** — only a name was supplied (no hash): return the graded entry annotated "this is our grade of a skill by this name, but without a hash we can't confirm it's your copy."
- **`unknown`** — not in the DB: `{ status:"unknown", name, message:"Not in the SkillGrade database yet. (Coming: registered users can request a fresh grade.)" }`.

**`findings`** = the stored `highlights` filtered to `fail`/`warning` (check, dimension, status, human `summary`), plus the `verdict`. This is the "what's not ok → what to fix" list, straight from stored data, no LLM. MVP limitation: top-3 highlights per entry (not all verdicts) — for D/F we show the most important, not everything.

### lookup_skill({ hash?, name? })
Single result.
- hash given and matches → `verified`.
- hash given, no hash match, name matches an entry → `drift`.
- only name given → `reference`.
- nothing matches → `unknown`.

### audit_skills({ skills: [{ name, hash }] })
Portfolio:
```jsonc
{ "summary": { "total":23, "verified":8, "drifted":2, "unknown":13,
               "gradeCounts": { "A":1,"B":3,"C":3,"D":1,"F":0 } },
  "skills": [ <per-skill result> ] }
```
`gradeCounts` counts graded (`verified`) skills by overall letter.

### search({ query })
Discovery: `[{ name, overall, category, reportUrl }]` — "do you have a graded skill for X?".

## Hosting & ops

- Node HTTP MCP server, streamable-HTTP transport, own Coolify app + subdomain (`mcp.skillgrade.dev`).
- `catalog.json` shipped in the image; redeploy alongside a hub catalog rebuild. Loaded to RAM at startup and validated with zod.
- No secrets, no DB, no LLM in MVP.
- Light in-memory per-IP rate limit.

## Error handling

- Malformed `catalog.json` at startup → fail loud (zod), don't serve a half-loaded index.
- Unknown hash/name → `unknown` (not an error — it's a valid answer).
- `skillMdHash: null` entries → never in hash index; answer as `reference` via name.
- Rate limit exceeded → standard MCP error, no data.
- Backfill re-fetch failure for one entry → log, set `skillMdHash: null`, continue (don't abort the batch).

## Testing (Vitest, consistent with the repo)

1. **index build** — from sample `catalog.json`: hash→entry 1:1; name→[entries] catches a collision (two `skill-creator`).
2. **hash normalization** (most important) — same SKILL.md across CRLF/LF/trailing-newline/BOM → identical hash; content change → different hash.
3. **lookup_skill** — all four branches (verified / drift / reference / unknown).
4. **audit_skills** — summary matches the per-skill results (counts + gradeCounts).
5. **response contract** — zod-validate tool outputs so the shape can't drift.

Backfill gets its own one-off script (not mixed into the server) and logs how many entries resolved a source.

## Open follow-ups (not this spec)

- Rotate the OpenRouter key (pending from earlier work).
- Path C: token-gated paid fresh-grade for skills not in the DB.
- Full per-check findings (persist all verdicts to entries, not just top-3 highlights).
- Publish the normalization rules where consumer agents can read them (docs page / tool description).
