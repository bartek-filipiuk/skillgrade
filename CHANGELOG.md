# Changelog — SkillGrade

Trust grades (Security / Quality / Hygiene, A–F, with evidence) for Claude Code skills.
Live: [skillgrade.dev](https://skillgrade.dev) · MCP: `mcp.skillgrade.dev` · Accounts: `account.skillgrade.dev`.

Newest first.

## 2026-07-19

- **Catalog at 671 graded skills.** Spectrum roughly A:129 B:244 C:206 D:29 F:63.
- **gstack collection (59 skills).** Scanned Garry Tan's gstack suite (122k★) and shipped it as a `⚡ gstack` menu filter. Honest spread A:15 B:3 C:3 F:38 — the F's flag a shared preamble that runs undisclosed always-on telemetry, evals tool output, and does destructive git ops.
- **Cheap grader settled: gemini-2.5-flash via OpenRouter.** Bake-off vs haiku-4.5 — haiku disqualified (graded everything F and confused the grader's own system prompt for skill content). gemini grades through a direct OpenRouter call, so it scales past the 200-subagent session limit.
- **New `collection` field** on catalog entries + a matching menu chip. Reusable for future curated sets.
- **"The algorithm" section** on the landing page: the six-step grading pipeline, in the open, as a trust signal.
- **Mobile layout fixes**: killed horizontal overflow, skill detail now opens full-page (not a cramped sidebar), header nav wraps.

## 2026-07-18

- **Paid fresh-grade live** (`account.skillgrade.dev`). Email + password accounts, 2 free grades on signup, credit packs via Stripe (test mode), rotatable API tokens. The MCP gained `grade_skill`: bearer auth → catalog short-circuit (free for a known skill) → charge a credit → grade in memory → refund on failure. Content is never stored. Verified end to end.
- **Catalog 306 → 618** over the day: full official `anthropics/skills` set (17), plus community waves from K-Dense and skills.sh (facebook/react, vercel/next.js, pytorch, fastapi, angular, shadcn/ui, and ~90 other repos).
- **skills.sh discovery** wired up — a directory of ~20,000 skills across ~2,400 repos, harvested gently into a local pool then graded in batches.

## 2026-07-17

- **Consumer MCP live** (`mcp.skillgrade.dev`): `lookup_skill`, `audit_skills`, `search`. Matches a user's installed skills against the graded catalog by content hash, flags drift, stays read-only and privacy-first (only a name and a hash leave the machine).
- **Dataset builder + hub-at-scale**: GitHub discovery, SSRF-hardened fetch, dedup by hash, compact catalog index + lazy detail shards, client-side search.

## 2026-07-16

- **First public launch.** `skillgrade.dev` live with the graded catalog and the grading rubric (v0.1.x). Landing page, browse/filter, per-skill detail with evidence.

## Known limits / not yet live

- Stripe runs in **test mode** — real payments need `sk_live_` keys and one live test purchase. Anonymous `grade_skill` calls return a clean `invalid-token` (no charge, no crash).
- Rotate the exposed keys (OpenRouter, GitHub, Stripe test) before going live.
