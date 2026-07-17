# Skill Dataset Builder + Hub-at-Scale — Design

**Date:** 2026-07-17
**Status:** Approved design, ready for implementation planning
**Depends on:** SkillGrade (rubric 0.1.2, `hub/evaluations.json` + `build-catalog.ts`, `mcp/normalize.ts` for hashing, `checks/prechecks.ts`, the `grade-skills-batch` ultracode Workflow), live at skillgrade.dev + mcp.skillgrade.dev.

## Problem

SkillGrade grades public Claude Code skills but the catalog (125 entries) was populated by hand-curated lists. To become the reference trust registry we need a **large** graded corpus, built by discovering skills across the ecosystem, deduping, grading them against the rubric, and serving thousands of entries in a hub that stays fast. The same corpus — hashed, graded, with evidence — is also the fine-tuning dataset the project wanted from day one.

The differentiator over other aggregators stays: **find + provenance/drift**. Because every skill is identified by a normalized `SKILL.md` hash, the corpus knows *which copy* it graded and can detect when a source changes.

## Scope

One combined spec covering three independently-testable subsystems:
- **dataset-builder** — discovery adapters → fetch/cache → dedup → deterministic filter → resumable worklist.
- **grading bridge** — feed the worklist into the existing native grading Workflow in popularity-ordered waves; merge verdicts into `evaluations.json`.
- **hub-at-scale** — `build-catalog` emits a compact index + per-skill detail shards; the hub page does client-side search/pagination over the index; the MCP is unchanged.

**In:**
- GitHub-native discovery adapter first, behind a pluggable `SourceAdapter` interface.
- Fetch layer with host allowlist, conditional requests, on-disk cache, backoff.
- Dedup + drift by `skillMdHash` (reuse `mcp/normalize.ts`).
- Deterministic junk filter (frontmatter/size/prechecks) before any LLM.
- Grading via the existing `grade-skills-batch` ultracode Workflow (native Sonnet 5), waves bounded per run, resumable, drift-aware.
- Hub: compact `catalog-index.json` + lazy `skills/<slug>.json`, vanilla client search/filter/pagination, nginx gzip.

**Out (deferred):**
- ClawHub + aggregator adapters (later, but the interface is built now so they drop in).
- Headless/cron grading (native grading needs a Claude Code session; "scheduled" = a session/night-loop run).
- Paid fresh-grade (path C from the MCP spec).
- Committing fetched skill content (never — cache is gitignored; the catalog stays evaluation+link+hash only).

## Architecture & data flow

```
discovery adapters (github-native; clawhub/aggregator pluggable later)
  → Candidate {sourceUrl, repo, path, ref, stars, pushedAt}
fetch layer (allowlist → conditional GET → cache; backoff)
  → raw SKILL.md
normalize + skillMdHash (mcp/normalize.ts — identical hash to the MCP)
dedup by hash (same content across sources = 1 entry + mirrors[])
deterministic filter (valid frontmatter + non-empty + size cap + runPreChecks) → drop junk, free
worklist (unique, valid, ungraded-or-drifted; ranked by popularity)
grading waves (native Sonnet 5 via grade-skills-batch Workflow; per-check verdicts → scores in code)
merge → hub/evaluations.json (dedup by hash; + sourceUrl(s), popularity, evaluatedAt, discoveredVia)
build-catalog → catalog.json (full, for MCP) + catalog-index.json (compact) + skills/<slug>.json (details) + index.html
deploy (static hub + redeploy MCP so it loads the grown catalog)
```

**One identity everywhere.** `skillMdHash` (normalized sha256 of `SKILL.md`, from `mcp/normalize.ts`) is the single key for dedup, resume (skip already-graded), and drift (re-scan compares fresh hash vs stored). No second notion of identity.

## Dataset-builder internals

Files under `dataset/` (one responsibility each):

- **`adapters/types.ts`** — `interface SourceAdapter { name: string; discover(): AsyncIterable<Candidate> }` and `interface Candidate { sourceUrl: string; repo: string; path: string; ref: string; stars: number; pushedAt: string }`. Adding a source later = a new adapter file, no core change.
- **`adapters/github.ts`** — the first adapter. Discovery: (1) repo/topic search (`topic:claude-skills`, `topic:agent-skills`, `"awesome claude skills"`, `claude code skills`); (2) for each repo, `GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=1` → every `**/SKILL.md` path (one API call per repo, bypassing the code-search 1000-result cap); (3) a sharded code-search mode (`filename:SKILL.md` + a frontmatter term) for repos not caught by topics. Emits candidates carrying `stars` + `pushedAt` as the popularity/recency signal.
- **`fetch.ts`** — `fetchSkillMd(candidate): Promise<{content: string, contentSha: string} | null>`. Order: **host allowlist check** (reject anything but `api.github.com` / `raw.githubusercontent.com`) → conditional GET with stored `ETag`/`If-None-Match` (a 304 serves from cache, saving quota) → on-disk cache → return content. Token-bucket rate limiter + exponential backoff on 429 / secondary-rate-limit. Returns `null` on any failure (caller logs + skips — never aborts the run).
- **`dedup.ts`** — group candidates by `skillMdHash`; one canonical entry per hash, `primarySourceUrl` = the highest-stars source, the rest recorded as `mirrors[]`.
- **`filter.ts`** — deterministic validity gate: valid YAML frontmatter (`name`+`description`), non-empty body, size within the cap, and `runPreChecks` clean enough to be a real skill. Junk is dropped with a logged reason. No LLM.
- **`state.ts`** — loads/saves `candidates.json`; status transitions (`discovered|fetched|filtered-out|graded|drifted`); ranking by popularity; `selectWave(n, byPopularity)` returns the next N ungraded-or-drifted candidates.
- **`discover.ts`** — CLI entry: run adapters → fetch → normalize+hash → dedup → filter → write `candidates.json`. Idempotent and resumable.

**State (`dataset/` is gitignored — a local build workspace, consistent with the "scan locally, then deploy" model):**
- `dataset/candidates.json` — worklist: `{skillMdHash, name, primarySourceUrl, mirrors[], repo, path, stars, pushedAt, size, status, filterReason?, lastSeen, gradedAt?}`. Metadata only — no skill content.
- `dataset/cache/<skillMdHash>.md` — raw fetched content, ephemeral. Filename is the **hash** (never a repo path → no traversal). Never committed → the repo stays copy-free.

Provenance that must survive lives in `hub/evaluations.json` entries (`sourceUrl`, `discoveredVia`, `evaluatedAt`), which is committed.

## Grading bridge

- **`grade-wave`** reuses the existing `grade-skills-batch` ultracode Workflow: Sonnet-5 subagents return per-check `VERDICTS {security[], quality[], hygiene[]}`; **scores are computed in code** by `src/aggregate`, never by the model.
- Flow: `state.selectWave(N, byPopularity)` → batch of `{candidate + cached content}` → Workflow → verdicts → scores → `EvalInput` (badges, highlights, plus category/tagline/verdict produced by the subagent from content+scores) → **merge into `hub/evaluations.json` keyed by `skillMdHash`**.
- **Resume:** candidates whose hash already appears in `evaluations.json` are skipped.
- **Drift:** a candidate whose fresh hash differs from the stored hash for the same `primarySourceUrl` is marked `drifted` → re-graded in a wave → `evaluatedAt` updated.
- Waves are bounded per run (≈50–100, matching current batch sizes); the user runs successive waves. Because native grading needs a Claude Code session, "scheduled re-scan" means a session/night-loop run, not a headless cron — an accepted boundary.

## Hub-at-scale

`build-catalog` emits three artifacts:
- `hub/catalog.json` — the full catalog, unchanged, consumed by the MCP.
- `hub/catalog-index.json` — compact array: `{slug, name, overall, badges, category, tagline, popularity, sourceUrl, skillMdHash}`. No highlights/verdict/preCheck/evaluator. This is what the page loads.
- `hub/skills/<slug>.json` — full per-skill detail (verdict, highlights, preCheck, evaluatedAt, evaluator, mirrors), lazy-loaded when the detail drawer opens.

`slug` is the URL-safe skill identifier used in the existing `reportUrl` anchor (`skill-<name>`), collision-suffixed if two names collide.

**Client (performance-first, stays zero-dependency and self-contained):**
- Fetches `catalog-index.json` on load instead of inlining thousands of entries into the HTML. nginx serves `.json` gzipped (~10k entries ≈ 2–3 MB raw, ~400 KB gzipped).
- Search/filter is a **vanilla in-memory filter over the index array** — at 10k entries this is sub-millisecond per keystroke, so no search library is needed.
- Rendering is **paginated/virtualized**: render ~60 cards, then "load more" via `IntersectionObserver` — never 10k DOM nodes at once.
- The detail drawer fetches `skills/<slug>.json` on demand.
- The MCP is unchanged (still loads the full `catalog.json`); it is redeployed after the catalog grows.

`hub/Dockerfile` (nginx) copies `catalog-index.json` and `skills/`, and enables gzip for `.json`.

## Error handling

- Fetch failure (network, non-2xx, oversize) → log + skip; a run never aborts on one bad candidate (same discipline as the existing backfill).
- Malformed/absent frontmatter → `filtered-out` with a reason; never reaches grading.
- Grading subagent failure on a check → `evaluation-error` for that check (existing behavior); the dimension is not silently passed.
- `build-catalog` validates every entry with the zod `CatalogSchema` — fail loud on a malformed entry rather than shipping a broken catalog.
- Transient Workflow safety-classifier blocks → resume via `resumeFromRunId` (existing pattern) replays cached agents and re-runs the blocked ones.

## Security & trust boundaries

This feature ingests untrusted content from the public internet, so the boundaries are the core of the design:

- **Never execute fetched content.** `SKILL.md` is data — read, hashed, and passed to the grader *for evaluation*, never *for execution*. No eval, no running embedded scripts, no following instructions inside it.
- **Prompt injection on the grader** (the main surface): a malicious skill may try to talk the grader into an A or into hiding a critical finding. Mitigation: the rubric treats content as untrusted, evidence is quoted and **verified in code**, and the **score is computed in code** — the model's trust in the content never sets the grade. The grading prompt frames content as data-to-evaluate.
- **SSRF:** fetch only from an **allowlist** (`api.github.com`, `raw.githubusercontent.com`; ClawHub added with its adapter). Every `sourceUrl` from discovery is validated before a fetch — reject non-HTTPS, localhost, private ranges, and `169.254.169.254` — reusing the `assertSafeGitUrl` hardening in `src/loadSkill.ts`.
- **Path traversal / zip-slip:** cache files are named by `skillMdHash`, never by a repo-supplied path, so a crafted path cannot escape the cache dir.
- **Resource exhaustion:** cap fetched `SKILL.md` size (skip > ~256 KB — junk/attack), cap files-per-repo and total-per-run; the YAML parser is the safe `yaml` library. Every array is bounded.
- **Secrets:** the GitHub token lives in an env var only — never in logs, the cache, commits, or the catalog.
- **Good citizen / legal:** official APIs, backoff, conditional requests; respect `robots.txt` for any future HTML scraping; every catalog entry links back to its source (attribution), and skill content is never copied into the repo.

## Testing

- **Adapter** — candidate normalization from a GitHub tree/search response (fixture) yields correct `{sourceUrl, repo, path, stars}`.
- **fetch** — allowlist rejects a non-allowlisted / private-IP / non-HTTPS host; size cap rejects an oversize body; a 304 serves from cache.
- **dedup** — same content from two sources collapses to one entry with both in `mirrors[]`, primary = higher stars.
- **filter** — a skill with no frontmatter / empty body / oversize is dropped with a reason; a valid one passes.
- **state** — ranking orders by popularity; `selectWave` skips `graded`, includes `drifted`; a hash change flips a graded entry to `drifted`.
- **build-catalog** — emits `catalog-index.json` (compact fields only) and one `skills/<slug>.json` per entry with the full detail; slug collisions are suffixed.
- **hub client** — search/filter/sort/pagination extracted as pure functions and tested (substring match, min-grade filter, category filter, page slicing).

## Open follow-ups (not this spec)

- ClawHub + aggregator (claudemarketplaces.com, SkillsMP) discovery adapters.
- Rotate the OpenRouter key (still pending from earlier work).
- Paid token-gated fresh-grade (path C).
- If the corpus passes ~10k and JSON state or the single-file index strain, migrate `dataset/` state to SQLite and/or shard `catalog-index.json` by category.
