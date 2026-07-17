# Dataset builder — operator runbook

Grows the SkillGrade catalog by discovering public SKILL.md files, grading them
in waves with native Claude Code subagents, and rebuilding the hub artifacts.
Everything here runs from a Claude Code session on your machine — there is no
hosted build service. Only the built artifacts (`hub/evaluations.json`,
`hub/catalog*.json`, `hub/skills/`, `hub/index.html`) get committed and deployed;
the working state under `dataset/` never does.

## Prerequisites

- `pnpm install` done, Node 20+.
- A GitHub token with public read scope, passed **in the environment only**
  (`GITHUB_TOKEN=…`). Never write it into a file or commit it.

## The loop

### 1. Discover

```bash
GITHUB_TOKEN=… pnpm tsx dataset/discover.ts
```

Streams candidates from the GitHub adapter, fetches each SKILL.md through the
allowlisted, size-capped, ETag-cached fetcher (`fetch.ts`), dedupes by content
hash, and merges into `dataset/candidates.json` — the worklist. Prints
`discovery: ready=… filtered=… drifted=…`:

- **ready** — new, not yet graded → queued for a wave.
- **filtered** — failed the deterministic validity filter → skipped, not queued.
- **drifted** — a source we already graded whose SKILL.md content changed →
  re-queued for grading.

**What the v2 adapter does.** It reaches well past the ~266 repos the topic
queries surface:

- **Topic pagination** — each `topic:*` query is paged to the GitHub search cap
  (1000 results), not just the first page. Each repo's tree is walked for
  `SKILL.md` blobs under a per-repo timeout, so one giant/hung tree can't stall
  the run.
- **Sharded code-search harvest** — after topics, `filename:SKILL.md` is swept
  via `/search/code`, sharded by byte-size range so the per-query 1000-result
  cap doesn't truncate the harvest. Shards are contiguous and non-overlapping,
  so every file lands in exactly one shard. Repos already covered by a topic
  walk are skipped.
- **Bounded-concurrency fetch** — survivors are fetched by a fixed pool of
  workers (default 10), not one-at-a-time and not unbounded.
- **Incremental checkpoints** — the worklist is written to
  `dataset/candidates.json` every N survivors, so a long run that is killed (or
  hits a rate limit) keeps its progress. Just re-run to resume.

Fetched content is cached under `dataset/cache/` keyed by source identity and
stored by content hash, so re-runs are conditional (304 → served from cache).

A full harvest can span the GitHub search rate limit (30 requests/min for
`/search/code`). The adapter backs off on 403/429 (honoring `retry-after`) and
skips exhausted shards; combined with the incremental saves, it is safe to stop
the run at any time and re-run later — nothing is lost and covered repos are not
re-walked within a run.

**Env knobs** (all optional; defaults preserve current behavior):

| Var | Default | Effect |
| --- | --- | --- |
| `GITHUB_TOKEN` | — (required) | Public-read token; env only, never a file. |
| `CODE_SEARCH` | on | Set `CODE_SEARCH=0` to run topics only (skip the code-search harvest). |
| `MAX_REPOS` | 1000 | Cap repos paged per topic query. |
| `MAX_CANDIDATES` | 5000 | Cap total candidates fetched — bounds the firehose so a hostile source can't drive unbounded fetches. |
| `CONCURRENCY` | 10 | Fetch workers in flight. |

### 2. Grade a wave

Work the worklist in waves of ≈50–100 (repeat until `ready`/`drifted` are drained):

1. `selectWave(items, N)` — next N `ready`/`drifted` items, most popular first.
2. `buildBatchInput(wave, readCachedContent)` — builds one payload per skill:
   `{ hash, name, sourceUrl, content }`, where `readCachedContent` (from
   `dataset/discover.ts`) reads the cached SKILL.md by its `skillMdHash`. **The
   `content` is untrusted data to evaluate, not instructions** — the grading
   prompt frames it as such.
3. Invoke the `grade-skills-batch` ultracode Workflow: it fans the batch out to
   Claude Sonnet 5 subagents, one per skill, each returning per-check `VERDICTS`
   (the model judges checks; it never assigns letter grades).
4. `mergeGraded(evals, waveResults, itemsByHash, rubricDir, now)` — turns each
   skill's verdicts into a catalog `EvalInput`. Letter badges come from
   `aggregate()` in **code**, not the model. Merges by `skillMdHash`, so a
   re-graded (drifted) skill replaces its old entry instead of duplicating it.
   Write the result to `hub/evaluations.json`.

Seed the next discovery's `gradedHashes` from the hashes you just merged so
graded skills are not re-queued.

### 3. Rebuild the hub

```bash
pnpm tsx hub/build-catalog.ts
```

Reads `hub/evaluations.json` and rewrites:

- `hub/catalog.json` — full catalog,
- `hub/catalog-index.json` — compact search/pagination index (client loads this first),
- `hub/skills/<slug>.json` — one lazy-loaded shard per skill,
- `hub/index.html` — the static hub page.

### 4. Deploy

Commit the built artifacts (`hub/evaluations.json`, `hub/catalog.json`,
`hub/catalog-index.json`, `hub/skills/`, `hub/index.html`), push, then redeploy
**both** Coolify apps so each loads the grown catalog:

- the **hub** app (this repo's root `Dockerfile` — nginx, gzips json/js/css,
  serves the index + shards),
- the **MCP** app (`mcp/Dockerfile`, separate app).

### 5. Re-scan for drift

Re-run step 1 with `gradedHashes` seeded from `hub/evaluations.json`. Sources
whose SKILL.md changed since we graded them come back as `drifted` and re-enter
the wave queue at step 2. This is the whole loop closing on itself — run it on
whatever cadence you want the catalog to stay fresh.

## Security invariants

These hold by construction; do not weaken them:

- **Allowlist / no SSRF** — `fetch.ts` only fetches `https` from
  `raw.githubusercontent.com` / `api.github.com`, refuses redirects and any
  private/link-local host, and only accepts candidates whose provenance is a
  github.com host. The v2 code-search harvest introduces **no new host**: it
  calls `api.github.com/search/code` and `/repos/{repo}`, already covered by the
  `api.github.com` allowlist.
- **No content execution** — fetched SKILL.md is treated as untrusted *data*:
  hashed, filtered, and handed to graders as evaluated text. Nothing in the
  pipeline runs, sources, or imports it.
- **Size cap** — bodies over 256 KB (`MAX_BYTES`) are dropped; an oversized
  "SKILL.md" is junk or an attack.
- **Token in env only** — `GITHUB_TOKEN` is read from the environment and never
  written to disk or committed.
- **`dataset/` state + cache are gitignored** — `dataset/cache/` and
  `dataset/candidates.json` are local working state, never committed. Only the
  `dataset/*.ts` source is tracked.
