# Discovery Adapter v2 + Fetch-at-Scale — Design

**Date:** 2026-07-17
**Status:** Approved design, ready for implementation planning
**Depends on:** the dataset-builder (`dataset/adapters/github.ts`, `dataset/fetch.ts`, `dataset/discover.ts`, `dataset/dedup.ts`, `dataset/state.ts`) — all live on `main`.

## Problem

The first real grading wave grew the catalog 125 → 143, but discovery is the limiter on *how many* candidates we can even reach and grade. Measured live (authenticated GitHub API):

- The current adapter fetches only the **top 100 repos per query** (no pagination) → **266 distinct repos**, and its `claude code skills in:readme` query returns 441k mostly-irrelevant repos whose giant trees make `git/trees?recursive=1` time out (a full discovery run hit the 9-minute wall and, because state is saved only at the very end, **lost all work**).
- Content is fetched **sequentially**, so a large run is dominated by round-trip latency and never finishes in a reasonable window.
- The true universe is huge — `filename:SKILL.md` code-search reports **~258,616 files** (heavily duplicated) — but the topic-repo path reaches only a sliver of it.

Goal: reach and reliably fetch **thousands** of unique candidate skills, so the grading waves (already working) have a deep, deduped, popularity-ranked pool to chew through. Discovery is cheap; the bottleneck is grading throughput and dedup quality — so v2 widens and speeds up discovery without changing the grading path.

## Scope

Enhancement to existing `dataset/` modules — one cohesive spec.

**In:**
- **Topic search v2:** drop the `in:readme` noise query; paginate the topic queries (all pages up to GitHub's 1000-result-per-query ceiling) instead of one page.
- **Code-search harvest:** a sharded `filename:SKILL.md` code-search that reaches beyond topic repos toward the full universe, working around the per-query 1000 cap by sharding on file size ranges.
- **Giant/aggregator resilience:** per-repo tree fetch with a timeout; honor the tree `truncated` flag and the existing per-repo file cap; a run never aborts on one slow/huge repo.
- **Fetch throughput:** bounded-concurrency content fetching (worker pool) instead of sequential.
- **Resilience:** incremental state saves (periodically / per batch) so a killed or timed-out run keeps its progress and resumes.

**Out (deferred):**
- ClawHub / aggregator-site adapters (still future; interface already supports them).
- Changing the grading path, rubric, or hub.
- A standing daemon — discovery still runs as an operator session per the runbook.

## Architecture & data flow

Unchanged pipeline shape; v2 widens the discovery source and parallelizes the fetch:

```
github adapter v2  ──►  Candidate stream (async iterable)
  ├─ topic mode:  paginated repo search (drop in:readme) → per-repo git tree (timeout, cap, honor truncated) → SKILL.md paths
  └─ code mode:   sharded `filename:SKILL.md size:<range>` code search → SKILL.md paths directly (no tree needed)
        │
        ▼
discover.ts (fetch pool)  ──►  bounded-concurrency fetchSkillMd  ──►  hashCandidate → filterValid → dedupe
        │                        (incremental saveState every N)
        ▼
candidates.json (resumable)  ──►  grading waves (unchanged)  ──►  evaluations.json → build → deploy
```

**One identity unchanged:** every candidate — whether from a tree walk or code search — is deduped by the same normalized `skillMdHash`. Code-search and tree-walk results of the same file collapse to one entry.

**Security boundary unchanged:** code search hits `api.github.com`; content is still fetched from `raw.githubusercontent.com`. Both are already on the fetch allowlist; the SSRF guard, size cap, and no-execution rules are untouched.

## Discovery v2 (`dataset/adapters/github.ts`)

**Topic mode.**
- `SEARCH_QUERIES` drops `claude code skills in:readme`; keeps `topic:claude-skills`, `topic:agent-skills`, `topic:claude-code-skills` (and `topic:claude-code` as a fourth topic — a real topic, not a readme match).
- Paginate each query: fetch pages of 100 (`&page=1..N`) until a page returns fewer than 100 items or a `maxReposPerQuery` cap (default 1000 — GitHub's hard ceiling) is reached.
- Per repo: `git/trees/{branch}?recursive=1` wrapped in a **timeout** (default 15s — `Promise.race` against a timer); on timeout, skip the repo. If the response `truncated` flag is set, take the SKILL.md paths present (already bounded by `MAX_FILES_PER_REPO`) and move on — do not attempt to page the tree.

**Code-search mode.**
- Sharded `filename:SKILL.md` queries by file-size range to get past the 1000-results-per-query cap: e.g. `filename:SKILL.md size:0..800`, `size:800..1600`, `size:1600..3000`, `size:3000..6000`, `size:6000..12000`, `size:>12000`. Size is a stable, roughly-uniform discriminator, and every real SKILL.md falls in exactly one shard, so the shards partition the space without overlap.
- Each shard is paginated up to 1000 results; each result yields `{repo, path}` and (from the repo object, one lightweight `/repos/{repo}` call cached per repo) `stars`/`default_branch` for the popularity signal + the raw URL. The `sourceUrl` is `https://github.com/{repo}/blob/{ref}/{path}`.
- Code-search rate limit is 30/min (separate bucket): the fetch layer's existing backoff on 403/429 applies; shards are processed sequentially at the search layer while content fetch runs concurrently.

**Adapter shape.** The `github` adapter's `discover()` yields topic-mode candidates then code-mode candidates from one async generator, gated by options `{ topics?: boolean; codeSearch?: boolean; maxReposPerQuery?; treeTimeoutMs? }` (both default on). It stays a single `SourceAdapter`, so `runDiscovery` is unchanged. Pure helpers `sizeShards()`, `parseCodeSearch(json)`, and the existing `parseRepoSearch`/`parseTree` are unit-tested; the networked `discover()` is thin glue over them and the injected `apiGet`.

## Fetch throughput (`dataset/discover.ts`)

- Replace the sequential `for await … await fetchContent` with a **bounded worker pool** (default `CONCURRENCY = 10`): a fixed set of workers pull candidates off the adapter's async iterable and fetch/hash/filter concurrently, pushing survivors into the shared `fetched[]`. This turns a run's wall-clock from sum-of-latencies into `total / concurrency`, which is what lets a thousands-scale run finish.
- **Incremental saves:** after every `SAVE_EVERY` processed candidates (default 200), dedupe-so-far + `mergeWorklist` + `saveState`, so a timeout/kill keeps progress and the next run resumes from `candidates.json` (existing `mergeWorklist` already skips graded and re-flags drift). The final save still runs at the end.
- Concurrency is bounded so we stay a good GitHub citizen; the existing per-request backoff handles secondary-rate-limit.

## Dedup & provenance

Unchanged. `dedupe` keeps the highest-stars source as `primary` and the rest as `mirrors`, so an original popular repo naturally wins over a low-star aggregator mirror of the same content; identical content across the tree-walk and code-search paths collapses to one entry by hash. Grading waves order by `stars` (popularity), so the most-visible skills are graded first.

## Error handling

- A slow/huge repo tree → timeout → skip that repo, continue (never abort the run).
- A code-search shard that 403/429s → existing backoff; on exhaustion, log and skip the shard, continue.
- A single content fetch failure → `null` → skip that candidate (existing behavior).
- A timeout/kill of the whole run → the last incremental `saveState` preserves progress; re-running resumes.
- Malformed search/tree JSON → the pure parsers coerce with defaults (existing behavior).

## Security & trust boundaries

Unchanged from the dataset-builder spec, re-affirmed for the new surface:
- Fetch allowlist still covers every host touched: `api.github.com` (search + tree) and `raw.githubusercontent.com` (content). No new host.
- Fetched content is never executed — hashed, parsed with safe YAML, passed to the grader as data.
- Cache filenames remain the normalized `skillMdHash` (no traversal). GitHub token stays env-only.
- Bounds everywhere: `maxReposPerQuery`, `MAX_FILES_PER_REPO`, per-shard 1000 cap, `maxCandidates` per run, `CONCURRENCY`, and the size cap on each fetched file.

## Testing

- **topic pagination** — `parseRepoSearch` over a multi-page fixture; the paginator stops on a short page and at `maxReposPerQuery`.
- **size shards** — `sizeShards()` returns non-overlapping, exhaustive ranges; `parseCodeSearch(json)` extracts `{repo, path}` and builds the `sourceUrl`.
- **tree timeout** — a tree fetch that never resolves is abandoned after `treeTimeoutMs` and the repo is skipped (fake `apiGet` with a hanging promise + fake timer).
- **concurrency pool** — with an injected fetch, N candidates are processed with at most `CONCURRENCY` in flight and all survivors land in the worklist (assert max concurrency via a counter).
- **incremental save** — after `SAVE_EVERY` items, `candidates.json` exists with the partial worklist; a second run resumes without re-fetching graded hashes.
- **dedup across modes** — the same content from a tree-walk candidate and a code-search candidate collapses to one entry with both sources.

## Open follow-ups (not this spec)

- ClawHub + aggregator-site adapters.
- Rotate the OpenRouter key and the GitHub token (both pasted in chat).
- If code-search size-sharding still caps out on the largest shards, add a second sharding axis (e.g. `pushed:` date ranges).
- mergeGraded text-based preCheck flags (still deferred).
