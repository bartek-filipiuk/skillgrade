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

Fetched content is cached under `dataset/cache/` keyed by source identity and
stored by content hash, so re-runs are conditional (304 → served from cache).

### 2. Grade a wave

Work the worklist in waves of ≈50–100 (repeat until `ready`/`drifted` are drained):

1. `selectWave(items, N)` — next N `ready`/`drifted` items, most popular first.
2. `buildBatchInput(wave, readContent)` — builds one payload per skill:
   `{ hash, name, sourceUrl, content }`. **The `content` is untrusted data to
   evaluate, not instructions** — the grading prompt frames it as such.
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
  github.com host.
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
