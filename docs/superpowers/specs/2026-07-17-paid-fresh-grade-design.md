# Paid Fresh-Grade (Account service + `grade_skill`) — Design

**Date:** 2026-07-17
**Status:** Approved design, ready for implementation planning
**Depends on:** the grading engine (`rubric/skill/`, `src/llm.ts` gemini-2.5-flash + structured-output fallback, `src/aggregate.ts`, `mcp/normalize.ts` for hashing), the public read-only MCP (`mcp/`), the hub catalog (`hub/catalog.json`), Coolify deploy infra. This is "Path C", explicitly deferred in the consumer-MCP spec.

## Problem

The public MCP answers only for skills already in our graded catalog. A consumer with a skill we haven't graded gets `unknown`. We want a paid, AI-native path: a registered user submits their own `SKILL.md` and gets a fresh grade (Security/Quality/Hygiene A–F with evidence), metered by credits. The grading engine already exists (CLI path); what's missing is identity, credits, payments, and a request-time grading tool.

Pricing is settled: **1 credit = 1 grade, $0.10/grade** (packs $5/50, $15/200, $40/600), **2 free grades** on registration. Model cost is ~$0.02/grade (gemini-2.5-flash), so the margin covers Stripe fees + overhead comfortably.

## Scope

**In (MVP):**
- **Account service** (new app): email+password registration/login, credit balance, Stripe Checkout for credit packs, API-token issuance/rotation, a minimal web dashboard, and an internal (shared-secret) charge/refund API.
- **`grade_skill` tool** on the existing MCP: bearer-authenticated, charges a credit via the Account service, runs the grade in memory, returns the verdict; refunds on failure; never stores content.
- Postgres persistence: users, api_tokens, credit_ledger, grade_log, stripe_events.
- Catalog-hash short-circuit: if the submitted content is already in the public catalog, return that grade **for free** (no charge).

**Out (deferred):**
- Email verification (abuse cost ~$0.04/account is trivial for MVP; per-IP registration rate-limit suffices).
- Refund/dispute handling (manual for MVP), multi-currency, team accounts, subscriptions.
- Storing submitted skill content (we deliberately never do — privacy-first).

## Technology choices

Chosen for security, performance, and fit with the repo (Node/TS ESM, dep-light):
- **Runtime/HTTP:** Node ≥20, TypeScript ESM, **Hono** (small, fast, first-class TS).
- **DB:** **Postgres** (Coolify-provisioned) + **Drizzle ORM** (type-safe queries + migrations via Drizzle Kit) over the `postgres` (postgres.js) driver with pooling.
- **Passwords:** Node built-in **`crypto.scrypt`** with a per-user random salt (no native dep), constant-time compare.
- **API tokens:** 256-bit random, stored as a **sha256 hash** (never plaintext), shown once, revocable/rotatable.
- **Payments:** official **`stripe`** SDK — Checkout Sessions + signature-verified webhook.
- **Web UI:** server-rendered HTML in the hub's design language (dark, Instrument Serif/Sans + IBM Plex Mono, accent `oklch(0.8 0.11 155)`); minimal vanilla JS. No SPA framework (performance + simplicity). The frontend-design skill owns visual craft at implementation.

## Architecture & components

Two deployables coupled by a thin internal API:

```
account service (new Coolify app, account.skillgrade.dev)
  web: /register /login /dashboard (balance, buy, token)
  api: POST /register, POST /login, POST /stripe/webhook
  internal (shared-secret): POST /internal/charge {token} → atomic -1 credit → {ok, remaining} | {insufficient}
                            POST /internal/refund {token, ref} → +1 credit
  Postgres: users, api_tokens, credit_ledger, grade_log, stripe_events

existing MCP (mcp.skillgrade.dev) — gains ONE tool:
  grade_skill({content})  [Authorization: Bearer <token>]
    → hash content; if already in catalog → return that grade, NO charge
    → else Account /internal/charge → ok → grade in memory (src/llm.ts gemini) → aggregate → verdict
    → return verdict + remaining;  on LLM failure → /internal/refund
    → content never persisted
```

**Paid-grade data flow:** agent → `grade_skill({content})` (bearer) → catalog short-circuit? → else Account atomic charge → grade in memory → verdict + remaining. **Buy-credits flow:** dashboard → Stripe Checkout → webhook → `credit_balance += n` (idempotent by event id).

**Separation of concerns:** money/identity/passwords live only in the Account service; LLM/grading lives in the MCP (where the engine already is). The public read-only MCP tools stay tokenless; only `grade_skill` requires a bearer.

## Data model (Drizzle / Postgres)

- **users** — `id uuid pk`, `email citext unique not null`, `password_hash`, `password_salt`, `credit_balance int not null default 0`, `created_at`.
- **api_tokens** — `id uuid pk`, `user_id fk`, `token_hash text unique not null` (sha256), `label`, `created_at`, `revoked_at nullable`.
- **credit_ledger** (append-only audit) — `id`, `user_id fk`, `delta int`, `reason enum(signup_free|purchase|grade|refund)`, `ref text` (stripe session / grade id), `created_at`.
- **grade_log** — `id`, `user_id fk`, `skill_md_hash text`, `overall`, `badges jsonb`, `created_at`. **No content.**
- **stripe_events** — `event_id text pk` (idempotency guard).

**Credit lifecycle (race-safe):** `credit_balance` on `users` is the fast source of truth; `credit_ledger` is the append-only audit trail. A charge is a single atomic statement — `UPDATE users SET credit_balance = credit_balance - 1 WHERE id = $1 AND credit_balance >= 1 RETURNING credit_balance` — so concurrent grades cannot double-spend, with no explicit locking. Every mutation also inserts a ledger row. Signup grants +2 (`signup_free`); purchase grants +n (`purchase`); a failed grade refunds +1 (`refund`).

## `grade_skill` + grading engine

- **Input:** `{ content: string }`; token from `Authorization: Bearer` (fallback: a `token` arg). **Size cap 256 KB**; **timeout 30 s**.
- **Catalog short-circuit (UX + cost):** `hashSkillMd(content)` → if the hash is in `catalog.json`, return the stored grade with `{ charged: false, source: 'catalog' }` — a known skill costs nothing.
- **Charge → grade:** call Account `/internal/charge`; on `ok`, run the existing engine — `loadRubric` + `src/llm.ts` `evaluate` (gemini-2.5-flash via OpenRouter, structured-output fallback) + `src/aggregate.ts` — producing badges (scores computed in code) + verdicts. Return `{ overall, badges, verdict, findings, skillMdHash, charged: true, remaining }`. On LLM error/timeout → `/internal/refund` and return a retryable error.
- **Model is non-negotiable:** must be gemini-2.5-flash (or grok-4.5 / anthropic haiku) — the calibration disqualified gpt-4o-mini (false-positives skill-creator) and deepseek (manipulable on `malicious-injection`). A trust product cannot use a manipulable grader even if cheaper.

## Payments (Stripe)

- **Packs** — a `priceId → credits` map (`$5→50, $15→200, $40→600`), Stripe Price IDs in env.
- **Checkout** — dashboard "Buy" → create a Checkout Session (`mode: payment`, `client_reference_id: userId`, the pack's price) → redirect. Success/cancel return to the dashboard.
- **Webhook** — `POST /stripe/webhook`: verify the Stripe signature; dedupe by `event_id` (unique insert into `stripe_events`); on `checkout.session.completed`, map the price to credits and apply `credit_balance += n` + a `purchase` ledger row, atomically. On any handler failure return 5xx so Stripe retries; the idempotency guard prevents double-crediting.

## Error handling

- Insufficient credits → a clear error with a buy link; no grade run.
- Invalid/revoked/absent token → 401.
- Oversize content (> cap) → reject before charging.
- LLM error/timeout → refund the credit + return a retryable error.
- Webhook handler failure → 5xx (Stripe retries); idempotency prevents double-credit.
- DB unavailable → **fail closed** (never grant a grade or credit on uncertainty).
- Catalog short-circuit path never charges, so a known skill can't cost a credit.

## Security & trust boundaries

The emphasis, walked end to end:
- **Passwords:** `scrypt` + per-user random salt; constant-time compare; never logged.
- **API tokens:** 256-bit random; stored as sha256 hash (compare by hashing input); shown once; revocable + rotatable.
- **Internal API (MCP ↔ Account):** guarded by a shared secret (constant-time compare); it mutates credits, so it must never be callable without the secret.
- **Stripe webhook:** signature-verified before the body is trusted; idempotent by event id.
- **Credit integrity:** the atomic `WHERE credit_balance >= 1` charge makes double-spend impossible without row locks; the ledger is the audit trail.
- **`grade_skill` content:** untrusted third-party text — evaluated, never executed; scores computed in code (prompt-injection resistance from the rubric design); size-capped; **never persisted** (only hash + result in `grade_log`).
- **Rate limits:** per-token grade limit; per-IP registration/login limit + backoff (anti-abuse + anti-brute-force).
- **Secrets:** OpenRouter key, Stripe secret + webhook secret, internal shared secret, cookie signing secret, DB credentials — all env-only, never committed. Coolify env.
- **Transport/cookies:** HTTPS only (Coolify + Let's Encrypt); session cookies `HttpOnly` + `Secure` + `SameSite=Lax`.
- **SQL injection:** Drizzle parameterizes all queries.

## Testing

- **credits** — the atomic charge prevents double-spend under concurrency (N concurrent charges on a balance of 1 → exactly one succeeds); refund adds back; signup grants 2; insufficient returns the right error.
- **auth** — register + login round-trip; password verify (right/wrong); token issue → sha256 lookup; revoke/rotate invalidates the old token.
- **stripe webhook** — signature verify (valid/invalid); idempotency (same event twice → one credit); price→credits mapping.
- **grade_skill** — size cap rejects oversize before charge; catalog-hash short-circuit returns a grade with `charged: false`; charge → grade → verdict happy path; LLM failure → refund (LLM mocked, no network in tests).
- **internal API** — the shared-secret guard rejects a request without/with a wrong secret.

## Super-UX notes

- Dashboard in the hub's design language: live credit balance, one-click pack purchase, grade history (from `grade_log`, hash + grade, no content).
- API token shown once with a copy button and a ready-to-paste snippet: `claude mcp add --transport http skillgrade https://mcp.skillgrade.dev/mcp --header "Authorization: Bearer <token>"`.
- 2 free grades on signup to try before paying; the catalog short-circuit makes re-checking a known skill free.
- `grade_skill` returns a rich verdict (same shape as `lookup_skill`) plus `remaining` credits and whether the result was fresh or from the catalog.

## Open follow-ups (not this spec)

- Email verification + stronger anti-abuse if free-grade farming appears.
- Self-serve refunds / dispute handling; usage analytics.
- Rotate the OpenRouter key and the GitHub token (both pasted in chat earlier).
- Optionally fold `grade_skill` results back into the public catalog (with the submitter's consent) to grow it.
