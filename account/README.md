# SkillGrade Account service

The paid backend behind the `grade_skill` MCP tool: accounts, credits, Stripe
top-ups, and rotatable API tokens. A [Hono](https://hono.dev) server on `$PORT`
(default 8080), Postgres via Drizzle. It serves a small web dashboard (register /
login / buy credits / rotate token) and an internal shared-secret API the MCP
calls to charge and refund credits.

## Run

```bash
pnpm account                 # = tsx account/server.ts, listens on $PORT (default 8080)
pnpm drizzle-kit migrate     # apply migrations (also run automatically on container boot)
```

## Environment

Every secret is **env-only** — nothing is committed, nothing is baked into the image.

| var | required | purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. Drizzle migrations run against it on boot. |
| `STRIPE_SECRET_KEY` | yes | Stripe API key — creates Checkout sessions. |
| `STRIPE_WEBHOOK_SECRET` | yes | Signing secret for the `/stripe/webhook` endpoint. Bad signature → 400, no credit. |
| `STRIPE_PRICE_5` | yes | Stripe Price ID for the 50-credit pack. |
| `STRIPE_PRICE_15` | yes | Stripe Price ID for the 200-credit pack. |
| `STRIPE_PRICE_40` | yes | Stripe Price ID for the 600-credit pack. |
| `INTERNAL_SECRET` | yes | Shared secret the MCP presents (`x-internal-secret`) to `/internal/charge` and `/internal/refund`. Must match the MCP's `INTERNAL_SECRET`. |
| `COOKIE_SECRET` | yes | Signs the HttpOnly session cookie. |
| `PORT` | no | Listen port (default 8080). |
| `BASE_URL` | no | Public origin for Stripe success/cancel URLs (default `https://account.skillgrade.dev`). |

Missing any required var makes `main()` throw on start (fail loud).

## Migrations

`account/db/migrations` (Drizzle) is applied on every container start via the
Dockerfile `CMD` (`pnpm drizzle-kit migrate && pnpm account`). A failed migration
aborts the boot rather than serving against a stale schema.

## Docker

Built from the repo **root** (shares the pnpm workspace):

```bash
docker build -f account/Dockerfile -t skillgrade-account .
```

The image installs deps with `--frozen-lockfile`, copies the repo, exposes 8080,
and on start runs migrations then the server.

## Coolify deploy

Deploy as a **new** Coolify application, separate from the hub and the MCP.

1. **Provision Postgres** in the same Coolify project; copy its connection string
   into the app's `DATABASE_URL`.
2. **Create the app:**

   | setting | value |
   |---|---|
   | source | public repo |
   | build pack | `dockerfile` |
   | Dockerfile path | `account/Dockerfile` |
   | build context | repo **root** |
   | `ports_exposes` | `8080` |
   | domain | `https://account.skillgrade.dev` |

3. **DNS:** add an **A record** `account.skillgrade.dev → 65.109.60.26`.
4. Set all env secrets above, then deploy. Migrations run on the first boot.

## Stripe setup

1. Create **three Products/Prices** (one-time payments): 50, 200, and 600 credits.
   Copy each Price ID into `STRIPE_PRICE_5`, `STRIPE_PRICE_15`, `STRIPE_PRICE_40`
   (the numbers are the dollar price of each pack, not the credit count).
2. Register a **webhook endpoint** → `https://account.skillgrade.dev/stripe/webhook`,
   subscribed to `checkout.session.completed`.
3. Copy the endpoint's **signing secret** into `STRIPE_WEBHOOK_SECRET` and redeploy.

Credits are granted only when a signed `checkout.session.completed` arrives. The
webhook is idempotent: the credit and the `stripe_events` row are written in one
transaction, so a Stripe retry (crash or concurrent duplicate delivery) credits
exactly once.

## Security invariants

- **Env-only secrets** — no secret is committed or baked into the image.
- **Hashed API tokens** — only a hash of each token is stored; the plaintext is
  shown once at issue/rotation and is unrecoverable afterward.
- **scrypt passwords** — passwords are stored as salted scrypt hashes.
- **Atomic credits** — charging is a race-safe conditional `UPDATE`; concurrent
  charges can never overdraw, and purchases credit exactly once.
- **No content stored** — the Account service never sees or stores skill content;
  it only moves credits. Grading happens in the MCP, in memory.
- **HttpOnly, Secure, signed** session cookies; the internal API is fail-closed on
  a missing or wrong shared secret.
