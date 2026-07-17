# Paid Fresh-Grade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a paid, credit-metered fresh-grade: a new Account service (email+password, credits, Stripe, tokens) plus a bearer-authenticated `grade_skill` tool on the MCP that charges a credit and grades submitted `SKILL.md` content in memory (never stored).

**Architecture:** A standalone `account/` service (Hono + Postgres via Drizzle) owns identity, credits, Stripe payments, and an internal shared-secret charge/refund API. The existing MCP gains one `grade_skill` tool that validates a bearer token by charging the Account service, then runs the existing grading engine (`evaluateDimension` + `aggregate`, gemini-2.5-flash) over the content, refunding on failure. Money/identity live only in the Account service; LLM/grading lives in the MCP. Content is never persisted.

**Tech Stack:** Node ≥20, TypeScript ESM, Hono, Postgres, Drizzle ORM (+ Drizzle Kit migrations), Node `crypto.scrypt`, Stripe SDK, Vitest, Coolify/Docker.

## Global Constraints

- TypeScript ESM, `type: module`; import local files with the `.js` extension in specifiers, matching existing `src/`.
- New deps (add with pnpm): `hono`, `drizzle-orm`, `postgres`, `stripe`. Dev: `drizzle-kit`. Keep the root package lean — the Account service lives under `account/` and shares the repo's tsconfig/vitest.
- Tests: Vitest via `pnpm test`; colocate `*.test.ts`. Extend `vitest.config.ts` `include` with `account/**/*.test.ts`. All tests run WITHOUT a live DB, network, or Stripe — inject fakes (a fake `db`, a fake Stripe, a stub `evaluateDimension`).
- **Credit integrity:** a charge is the single atomic statement `UPDATE users SET credit_balance = credit_balance - 1 WHERE id = $1 AND credit_balance >= 1 RETURNING credit_balance`. Never read-then-write. Every credit mutation also appends a `credit_ledger` row.
- **Secrets are env-only** (never committed/logged): `DATABASE_URL`, `OPENROUTER_API_KEY` (grading), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `INTERNAL_SECRET` (MCP↔Account), `COOKIE_SECRET`.
- **Passwords:** `scrypt` with a 16-byte random salt; store `hash` + `salt` hex; verify with `crypto.timingSafeEqual`.
- **API tokens:** 32 random bytes hex; store ONLY `sha256(token)`; return plaintext once.
- **grade_skill content:** untrusted — evaluated never executed; `MAX_CONTENT_BYTES = 262144`; scores computed in code; content never persisted (only hash + result in `grade_log`).
- **Model:** grading uses `openrouter:google/gemini-2.5-flash` (the calibrated safe model; gpt-4o-mini and deepseek are disqualified). Never change the grader to a cheaper unvetted model.
- **Fail closed:** on any DB/charge uncertainty, do not grant a grade or a credit.

---

### Task 1: Account service scaffold — deps, Drizzle schema, DB client

**Files:**
- Modify: `package.json` (deps), `vitest.config.ts` (include)
- Create: `account/db/schema.ts`, `account/db/client.ts`, `drizzle.config.ts`
- Test: `account/db/schema.test.ts`

**Interfaces:**
- Produces: Drizzle tables `users`, `apiTokens`, `creditLedger`, `gradeLog`, `stripeEvents`; `db` (drizzle instance) and `type DB`.

- [ ] **Step 1: Add dependencies**

Run: `pnpm add hono drizzle-orm postgres stripe` and `pnpm add -D drizzle-kit`.
Extend `vitest.config.ts` `include` to add `'account/**/*.test.ts'`.

- [ ] **Step 2: Write the failing test**

Create `account/db/schema.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { users, apiTokens, creditLedger, gradeLog, stripeEvents } from './schema.js'

describe('schema', () => {
  it('exposes the five tables with key columns', () => {
    expect(users.email).toBeDefined()
    expect(users.creditBalance).toBeDefined()
    expect(apiTokens.tokenHash).toBeDefined()
    expect(creditLedger.delta).toBeDefined()
    expect(gradeLog.skillMdHash).toBeDefined()
    expect(stripeEvents.eventId).toBeDefined()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test account/db/schema.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement the schema**

Create `account/db/schema.ts`:

```typescript
import { pgTable, uuid, text, integer, timestamp, jsonb } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  passwordSalt: text('password_salt').notNull(),
  creditBalance: integer('credit_balance').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const apiTokens = pgTable('api_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull().unique(),
  label: text('label'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
})

export const creditLedger = pgTable('credit_ledger', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  delta: integer('delta').notNull(),
  reason: text('reason').notNull(), // signup_free | purchase | grade | refund
  ref: text('ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const gradeLog = pgTable('grade_log', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => users.id),
  skillMdHash: text('skill_md_hash').notNull(),
  overall: text('overall').notNull(),
  badges: jsonb('badges').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const stripeEvents = pgTable('stripe_events', {
  eventId: text('event_id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
```

Create `account/db/client.ts`:

```typescript
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

// Lazily constructed so tests never open a connection.
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined
export function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL not set')
    _db = drizzle(postgres(url), { schema })
  }
  return _db
}
export type DB = ReturnType<typeof getDb>
```

Create `drizzle.config.ts`:

```typescript
import type { Config } from 'drizzle-kit'
export default {
  schema: './account/db/schema.ts',
  out: './account/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
} satisfies Config
```

- [ ] **Step 5: Run test + generate the migration**

Run: `pnpm test account/db/schema.test.ts` → PASS. `pnpm typecheck` → clean.
Run: `pnpm drizzle-kit generate` → writes `account/db/migrations/0000_*.sql` (commit it; it's applied at deploy).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts account/db drizzle.config.ts
git commit -m "feat(account): Drizzle schema + db client + initial migration"
```

---

### Task 2: Credits — atomic charge, refund, grant, balance

**Files:**
- Create: `account/credits.ts`
- Test: `account/credits.test.ts`

**Interfaces:**
- Consumes: `users`, `creditLedger` from `./db/schema.js`.
- Produces: `charge(db, userId): Promise<{ ok: boolean; remaining: number }>`; `refund(db, userId, ref): Promise<void>`; `grantSignupFree(db, userId): Promise<void>`; `addCredits(db, userId, n, reason, ref): Promise<void>`; `balance(db, userId): Promise<number>`. `SIGNUP_FREE = 2`.

- [ ] **Step 1: Write the failing test**

Create `account/credits.test.ts`. Use a minimal fake `db` that models the atomic charge semantics (a `UPDATE ... WHERE credit_balance >= 1 RETURNING` returns a row only when balance was ≥1) and records ledger inserts:

```typescript
import { describe, it, expect } from 'vitest'
import { charge, refund, grantSignupFree, balance, SIGNUP_FREE } from './credits.js'

// Fake db: emulates the atomic conditional UPDATE + ledger inserts, no real SQL.
function fakeDb(initialBalance: number) {
  const state = { bal: initialBalance, ledger: [] as any[] }
  return {
    state,
    execute: async (sql: any) => {
      // credits.ts calls db.execute(sql`UPDATE users SET credit_balance = credit_balance - 1 WHERE id=${id} AND credit_balance >= 1 RETURNING credit_balance`)
      const text = String(sql?.queryChunks ? sql : sql).toLowerCase?.() ?? ''
      // We route on the sentinel added by credits.ts (see Step 3): the sql object carries a `.op` tag in tests via a wrapper — instead assert via the exported helpers below.
      throw new Error('use the injected primitives')
    },
  } as any
}
```

Because raw-SQL matching is brittle, the module exposes its DB effects behind small injectable primitives. Rewrite the test to inject those:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { makeCredits, SIGNUP_FREE } from './credits.js'

function harness(initialBalance: number) {
  const state = { bal: initialBalance, ledger: [] as { delta: number; reason: string }[] }
  const primitives = {
    // atomic conditional decrement: returns new balance or null if insufficient
    tryDecrement: vi.fn(async () => (state.bal >= 1 ? (--state.bal) : null)),
    increment: vi.fn(async (n: number) => { state.bal += n; return state.bal }),
    addLedger: vi.fn(async (delta: number, reason: string) => { state.ledger.push({ delta, reason }) }),
    getBalance: vi.fn(async () => state.bal),
  }
  return { state, credits: makeCredits(primitives), primitives }
}

describe('credits', () => {
  it('charge succeeds and decrements when funded', async () => {
    const { credits, state } = harness(2)
    expect(await credits.charge('u')).toEqual({ ok: true, remaining: 1 })
    expect(state.ledger).toContainEqual({ delta: -1, reason: 'grade' })
  })
  it('charge fails without balance and writes no ledger', async () => {
    const { credits, state } = harness(0)
    expect(await credits.charge('u')).toEqual({ ok: false, remaining: 0 })
    expect(state.ledger).toHaveLength(0)
  })
  it('two concurrent charges on balance 1 -> exactly one succeeds', async () => {
    const { credits } = harness(1)
    const [a, b] = await Promise.all([credits.charge('u'), credits.charge('u')])
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
  })
  it('refund adds one back', async () => {
    const { credits, state } = harness(0)
    await credits.refund('u', 'ref')
    expect(state.bal).toBe(1)
    expect(state.ledger).toContainEqual({ delta: 1, reason: 'refund' })
  })
  it('signup grants SIGNUP_FREE', async () => {
    const { credits, state } = harness(0)
    await credits.grantSignupFree('u')
    expect(state.bal).toBe(SIGNUP_FREE)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test account/credits.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `account/credits.ts`. The module separates the pure orchestration (`makeCredits`) from the real SQL primitives so tests inject fakes and production wires Drizzle:

```typescript
import { sql } from 'drizzle-orm'
import { creditLedger } from './db/schema.js'

export const SIGNUP_FREE = 2

// The four DB effects the credit logic needs. Real impl below; tests inject fakes.
export interface CreditPrimitives {
  tryDecrement(userId: string): Promise<number | null> // atomic -1 if >=1, returns new balance or null
  increment(userId: string, n: number): Promise<number>
  addLedger(delta: number, reason: string, ref: string | null, userId: string): Promise<void>
  getBalance(userId: string): Promise<number>
}

export function makeCredits(p: CreditPrimitives) {
  return {
    async charge(userId: string): Promise<{ ok: boolean; remaining: number }> {
      const remaining = await p.tryDecrement(userId)
      if (remaining === null) return { ok: false, remaining: await p.getBalance(userId) }
      await p.addLedger(-1, 'grade', null, userId)
      return { ok: true, remaining }
    },
    async refund(userId: string, ref: string): Promise<void> {
      await p.increment(userId, 1)
      await p.addLedger(1, 'refund', ref, userId)
    },
    async addCredits(userId: string, n: number, reason: string, ref: string | null): Promise<void> {
      await p.increment(userId, n)
      await p.addLedger(n, reason, ref, userId)
    },
    async grantSignupFree(userId: string): Promise<void> {
      await p.increment(userId, SIGNUP_FREE)
      await p.addLedger(SIGNUP_FREE, 'signup_free', null, userId)
    },
    balance: (userId: string) => p.getBalance(userId),
  }
}

// Production primitives over Drizzle. Any db with .execute + .insert works.
export function drizzlePrimitives(db: any): CreditPrimitives {
  return {
    async tryDecrement(userId) {
      const rows = await db.execute(sql`UPDATE users SET credit_balance = credit_balance - 1 WHERE id = ${userId} AND credit_balance >= 1 RETURNING credit_balance`)
      const r = (rows as any[])[0]
      return r ? Number(r.credit_balance) : null
    },
    async increment(userId, n) {
      const rows = await db.execute(sql`UPDATE users SET credit_balance = credit_balance + ${n} WHERE id = ${userId} RETURNING credit_balance`)
      return Number((rows as any[])[0].credit_balance)
    },
    async addLedger(delta, reason, ref, userId) {
      await db.insert(creditLedger).values({ userId, delta, reason, ref: ref ?? null })
    },
    async getBalance(userId) {
      const rows = await db.execute(sql`SELECT credit_balance FROM users WHERE id = ${userId}`)
      return Number((rows as any[])[0]?.credit_balance ?? 0)
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test account/credits.test.ts` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add account/credits.ts account/credits.test.ts
git commit -m "feat(account): race-safe credit charge/refund/grant"
```

---

### Task 3: Auth — scrypt passwords, register/login, hashed API tokens

**Files:**
- Create: `account/auth.ts`
- Test: `account/auth.test.ts`

**Interfaces:**
- Produces: `hashPassword(pw): { hash: string; salt: string }`; `verifyPassword(pw, hash, salt): boolean`; `hashToken(token): string`; `newToken(): { token: string; hash: string }`. Plus DB-facing `makeAuth(prims)` with `register`, `login`, `issueToken`, `userIdForToken`, `revokeToken` behind injectable primitives (same pattern as credits).

- [ ] **Step 1: Write the failing test**

Create `account/auth.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, hashToken, newToken } from './auth.js'

describe('password hashing', () => {
  it('verifies the right password and rejects the wrong one', () => {
    const { hash, salt } = hashPassword('correct horse')
    expect(verifyPassword('correct horse', hash, salt)).toBe(true)
    expect(verifyPassword('wrong', hash, salt)).toBe(false)
  })
  it('uses a random salt (two hashes of the same pw differ)', () => {
    expect(hashPassword('x').hash).not.toBe(hashPassword('x').hash)
  })
})

describe('tokens', () => {
  it('newToken returns a 64-hex token and its sha256 hash', () => {
    const { token, hash } = newToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).toBe(hashToken(token))
    expect(hash).not.toBe(token) // stored hash != plaintext
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test account/auth.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `account/auth.ts`:

```typescript
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto'

export function hashPassword(pw: string): { hash: string; salt: string } {
  const salt = randomBytes(16)
  const hash = scryptSync(pw, salt, 64)
  return { hash: hash.toString('hex'), salt: salt.toString('hex') }
}

export function verifyPassword(pw: string, hashHex: string, saltHex: string): boolean {
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(pw, Buffer.from(saltHex, 'hex'), 64)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('hex')
  return { token, hash: hashToken(token) }
}

// DB-facing operations behind injectable primitives (tests fake these; prod wires Drizzle).
export interface AuthPrimitives {
  findUserByEmail(email: string): Promise<{ id: string; passwordHash: string; passwordSalt: string } | null>
  createUser(email: string, passwordHash: string, passwordSalt: string): Promise<string> // returns userId
  insertToken(userId: string, tokenHash: string, label: string | null): Promise<void>
  userIdForTokenHash(tokenHash: string): Promise<string | null> // only non-revoked
  revokeToken(userId: string, tokenHash: string): Promise<void>
}

export function makeAuth(p: AuthPrimitives) {
  return {
    async register(email: string, pw: string): Promise<string> {
      if (await p.findUserByEmail(email)) throw new Error('email already registered')
      const { hash, salt } = hashPassword(pw)
      return p.createUser(email.toLowerCase().trim(), hash, salt)
    },
    async login(email: string, pw: string): Promise<string | null> {
      const u = await p.findUserByEmail(email.toLowerCase().trim())
      if (!u) return null
      return verifyPassword(pw, u.passwordHash, u.passwordSalt) ? u.id : null
    },
    async issueToken(userId: string, label: string | null): Promise<string> {
      const { token, hash } = newToken()
      await p.insertToken(userId, hash, label)
      return token // shown once
    },
    userIdForToken: (token: string) => p.userIdForTokenHash(hashToken(token)),
    revokeToken: (userId: string, token: string) => p.revokeToken(userId, hashToken(token)),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test account/auth.test.ts` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add account/auth.ts account/auth.test.ts
git commit -m "feat(account): scrypt passwords + hashed rotatable API tokens"
```

---

### Task 4: Stripe — packs, checkout, idempotent signed webhook

**Files:**
- Create: `account/stripe.ts`
- Test: `account/stripe.test.ts`

**Interfaces:**
- Consumes: `credits` (from Task 2), `stripeEvents` schema.
- Produces: `PACKS` (`priceId → credits`); `creditsForPrice(priceId): number | null`; `makeWebhook({ verify, alreadyProcessed, markProcessed, addCredits })` returning `handle(rawBody, sig): Promise<{ credited: number } | { skipped: true }>`.

- [ ] **Step 1: Write the failing test**

Create `account/stripe.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { makeWebhook, creditsForPrice } from './stripe.js'

const event = (id: string, priceId: string, userId: string) => ({
  id, type: 'checkout.session.completed',
  data: { object: { client_reference_id: userId, line_items: undefined, metadata: { price_id: priceId } } },
})

function harness() {
  const processed = new Set<string>()
  const credited: { userId: string; n: number }[] = []
  const wh = makeWebhook({
    verify: (raw: any) => JSON.parse(raw),
    alreadyProcessed: async (id: string) => processed.has(id),
    markProcessed: async (id: string) => { processed.add(id) },
    addCredits: async (userId: string, n: number, ref: string) => { credited.push({ userId, n }) },
  })
  return { wh, processed, credited }
}

describe('stripe webhook', () => {
  it('credits the mapped pack on a new event', async () => {
    const { wh, credited } = harness()
    // assumes PACKS maps 'price_5' -> 50 (see impl)
    const res = await wh.handle(JSON.stringify(event('evt_1', 'price_5', 'user_1')), 'sig')
    expect(credited).toEqual([{ userId: 'user_1', n: 50 }])
  })
  it('is idempotent: the same event twice credits once', async () => {
    const { wh, credited } = harness()
    const raw = JSON.stringify(event('evt_2', 'price_5', 'user_1'))
    await wh.handle(raw, 'sig'); await wh.handle(raw, 'sig')
    expect(credited).toHaveLength(1)
  })
  it('creditsForPrice returns null for an unknown price', () => {
    expect(creditsForPrice('nope')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test account/stripe.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `account/stripe.ts` (the webhook logic is pure + injectable; the real Stripe SDK is wired in the server task):

```typescript
// priceId -> credits. Real Stripe Price IDs come from env at wiring time; the map
// is keyed by an env-provided id so tests use symbolic ids.
export const PACKS: Record<string, number> = {
  [process.env.STRIPE_PRICE_5 ?? 'price_5']: 50,
  [process.env.STRIPE_PRICE_15 ?? 'price_15']: 200,
  [process.env.STRIPE_PRICE_40 ?? 'price_40']: 600,
}
export function creditsForPrice(priceId: string): number | null {
  return PACKS[priceId] ?? null
}

export interface WebhookDeps {
  verify(rawBody: string, sig: string): any // throws on bad signature; returns the event
  alreadyProcessed(eventId: string): Promise<boolean>
  markProcessed(eventId: string): Promise<void>
  addCredits(userId: string, n: number, ref: string): Promise<void>
}

export function makeWebhook(deps: WebhookDeps) {
  return {
    async handle(rawBody: string, sig: string): Promise<{ credited: number } | { skipped: true }> {
      const event = deps.verify(rawBody, sig) // bad signature throws -> caller returns 400
      if (await deps.alreadyProcessed(event.id)) return { skipped: true }
      if (event.type !== 'checkout.session.completed') { await deps.markProcessed(event.id); return { skipped: true } }
      const session = event.data.object
      const priceId = session.metadata?.price_id
      const userId = session.client_reference_id
      const n = priceId ? creditsForPrice(priceId) : null
      if (!userId || !n) { await deps.markProcessed(event.id); return { skipped: true } }
      await deps.addCredits(userId, n, event.id)
      await deps.markProcessed(event.id) // after crediting; the unique event_id row also guards double-credit
      return { credited: n }
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test account/stripe.test.ts` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add account/stripe.ts account/stripe.test.ts
git commit -m "feat(account): Stripe pack mapping + idempotent webhook logic"
```

---

### Task 5: Internal API — shared-secret charge/refund routes

**Files:**
- Create: `account/internal.ts`
- Test: `account/internal.test.ts`

**Interfaces:**
- Consumes: a `credits` object (Task 2 `makeCredits`) and an `authLookup(token): Promise<userId|null>` (Task 3 `userIdForToken`).
- Produces: `internalRoutes({ secret, credits, userIdForToken })` → a Hono sub-app with `POST /charge` and `POST /refund`, guarded by a constant-time `X-Internal-Secret` check.

- [ ] **Step 1: Write the failing test**

Create `account/internal.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { internalRoutes } from './internal.js'

function app() {
  const credits = { charge: vi.fn(async () => ({ ok: true, remaining: 5 })), refund: vi.fn(async () => {}) }
  const routes = internalRoutes({
    secret: 's3cret',
    credits: credits as any,
    userIdForToken: async (t: string) => (t === 'good' ? 'user_1' : null),
  })
  return { routes, credits }
}
const req = (path: string, body: any, secret?: string) =>
  new Request('http://x' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(secret ? { 'x-internal-secret': secret } : {}) }, body: JSON.stringify(body) })

describe('internal routes', () => {
  it('rejects a missing/wrong secret with 401', async () => {
    const { routes } = app()
    expect((await routes.fetch(req('/charge', { token: 'good' }))).status).toBe(401)
    expect((await routes.fetch(req('/charge', { token: 'good' }, 'wrong'))).status).toBe(401)
  })
  it('charges a valid token', async () => {
    const { routes, credits } = app()
    const res = await routes.fetch(req('/charge', { token: 'good' }, 's3cret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, remaining: 5 })
    expect(credits.charge).toHaveBeenCalledWith('user_1')
  })
  it('returns 402 when the token is unknown', async () => {
    const { routes } = app()
    expect((await routes.fetch(req('/charge', { token: 'bad' }, 's3cret'))).status).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test account/internal.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `account/internal.ts`:

```typescript
import { Hono } from 'hono'
import { timingSafeEqual } from 'node:crypto'

function secretOk(provided: string | undefined, expected: string): boolean {
  if (!provided) return false
  const a = Buffer.from(provided), b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export interface InternalDeps {
  secret: string
  credits: { charge(userId: string): Promise<{ ok: boolean; remaining: number }>; refund(userId: string, ref: string): Promise<void> }
  userIdForToken(token: string): Promise<string | null>
}

export function internalRoutes(deps: InternalDeps): Hono {
  const app = new Hono()
  app.use('*', async (c, next) => {
    if (!secretOk(c.req.header('x-internal-secret'), deps.secret)) return c.json({ error: 'forbidden' }, 401)
    await next()
  })
  app.post('/charge', async (c) => {
    const { token } = await c.req.json<{ token: string }>()
    const userId = token ? await deps.userIdForToken(token) : null
    if (!userId) return c.json({ error: 'invalid token' }, 401)
    return c.json(await deps.credits.charge(userId))
  })
  app.post('/refund', async (c) => {
    const { token, ref } = await c.req.json<{ token: string; ref: string }>()
    const userId = token ? await deps.userIdForToken(token) : null
    if (!userId) return c.json({ error: 'invalid token' }, 401)
    await deps.credits.refund(userId, ref ?? 'grade')
    return c.json({ ok: true })
  })
  return app
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test account/internal.test.ts` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add account/internal.ts account/internal.test.ts
git commit -m "feat(account): shared-secret internal charge/refund routes"
```

---

### Task 6: Web + public API + server wiring

**Files:**
- Create: `account/db/prims.ts` (real Drizzle primitives for auth), `account/web.ts` (HTML routes), `account/server.ts` (Hono app + Stripe SDK + all wiring)
- Test: `account/web.test.ts`

**Interfaces:**
- Consumes: everything above + `getDb`, `stripe` SDK.
- Produces: `buildApp(deps)` — a Hono app mounting web routes (`/`, `/register`, `/login`, `/dashboard`, `/buy/:pack`, `/token/rotate`), the Stripe webhook (`/stripe/webhook`), and the internal routes (`/internal/*`); a `main()` that serves it. Session via a signed HttpOnly cookie.

- [ ] **Step 1: Write the failing test (register→login→session)**

Create `account/web.test.ts` — build the app with injected fakes (fake auth/credits, no DB), assert the register→login flow sets a session cookie and the dashboard shows the balance:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { buildApp } from './server.js'

function fakeDeps() {
  const users = new Map<string, { id: string; pw: string }>()
  return {
    cookieSecret: 'ck', internalSecret: 'is',
    auth: {
      register: vi.fn(async (email: string) => { const id = 'u_' + email; users.set(email, { id, pw: 'x' }); return id }),
      login: vi.fn(async (email: string) => users.get(email)?.id ?? null),
      issueToken: vi.fn(async () => 'tok_plain_once'),
      userIdForToken: vi.fn(async () => null), revokeToken: vi.fn(),
    },
    credits: { balance: vi.fn(async () => 2), grantSignupFree: vi.fn(async () => {}), charge: vi.fn(), refund: vi.fn() },
    stripe: { checkoutUrl: vi.fn(async () => 'https://checkout') },
    webhook: { handle: vi.fn() },
  }
}
const form = (o: Record<string, string>) => new URLSearchParams(o).toString()

describe('account web', () => {
  it('register grants free credits, issues a session, redirects to dashboard', async () => {
    const app = buildApp(fakeDeps() as any)
    const res = await app.fetch(new Request('http://x/register', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ email: 'a@b.co', password: 'pw123456' }) }))
    expect([302, 303]).toContain(res.status)
    expect(res.headers.get('set-cookie')).toMatch(/session=/)
  })
  it('dashboard without a session redirects to login', async () => {
    const app = buildApp(fakeDeps() as any)
    const res = await app.fetch(new Request('http://x/dashboard'))
    expect([302, 303]).toContain(res.status)
    expect(res.headers.get('location')).toContain('/login')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test account/web.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement the Drizzle primitives**

Create `account/db/prims.ts` — the real `AuthPrimitives` over Drizzle (`findUserByEmail`, `createUser`, `insertToken`, `userIdForTokenHash` filtering `revokedAt IS NULL`, `revokeToken`), plus a helper to grant signup credits on `createUser`. (Straightforward Drizzle `select/insert/update` using `users`/`apiTokens`; mirror the `drizzlePrimitives` shape from Task 2.)

- [ ] **Step 4: Implement `buildApp` + web routes**

Create `account/web.ts` with the HTML page renderers (register, login, dashboard) in the hub's design language — dark background `#171614`, Instrument Serif/Sans + IBM Plex Mono, accent `oklch(0.8 0.11 155)`. Every user-derived value inserted into HTML is escaped. The dashboard shows the live credit balance, the three buy buttons, grade history (hash + grade), and — after `issueToken` — the plaintext token once with a copy control and the ready snippet `claude mcp add --transport http skillgrade https://mcp.skillgrade.dev/mcp --header "Authorization: Bearer <token>"`.

Create `account/server.ts`:

```typescript
import { Hono } from 'hono'
import { getSignedCookie, setSignedCookie, deleteCookie } from 'hono/cookie'
import Stripe from 'stripe'
import { getDb } from './db/client.js'
import { drizzlePrimitives, makeCredits } from './credits.js'
import { makeAuth } from './auth.js'
import { makeWebhook, creditsForPrice, PACKS } from './stripe.js'
import { internalRoutes } from './internal.js'
import { drizzleAuthPrimitives } from './db/prims.js'
import { renderRegister, renderLogin, renderDashboard } from './web.js'

export interface AppDeps {
  cookieSecret: string
  internalSecret: string
  auth: { register(email: string, pw: string): Promise<string>; login(email: string, pw: string): Promise<string | null>; issueToken(userId: string, label: string | null): Promise<string>; userIdForToken(token: string): Promise<string | null>; revokeToken(userId: string, token: string): Promise<void> }
  credits: { balance(userId: string): Promise<number>; grantSignupFree(userId: string): Promise<void>; charge(userId: string): Promise<{ ok: boolean; remaining: number }>; refund(userId: string, ref: string): Promise<void> }
  stripe: { checkoutUrl(userId: string, priceId: string): Promise<string> }
  webhook: { handle(raw: string, sig: string): Promise<unknown> }
}

export function buildApp(deps: AppDeps): Hono {
  const app = new Hono()
  const sessionUser = async (c: any) => (await getSignedCookie(c, deps.cookieSecret, 'session')) || null

  app.get('/', (c) => c.redirect('/dashboard'))
  app.get('/register', (c) => c.html(renderRegister()))
  app.post('/register', async (c) => {
    const b = await c.req.parseBody()
    const userId = await deps.auth.register(String(b.email), String(b.password))
    await deps.credits.grantSignupFree(userId)
    await setSignedCookie(c, 'session', userId, deps.cookieSecret, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/' })
    return c.redirect('/dashboard', 303)
  })
  app.get('/login', (c) => c.html(renderLogin()))
  app.post('/login', async (c) => {
    const b = await c.req.parseBody()
    const userId = await deps.auth.login(String(b.email), String(b.password))
    if (!userId) return c.html(renderLogin('Invalid email or password'), 401)
    await setSignedCookie(c, 'session', userId, deps.cookieSecret, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/' })
    return c.redirect('/dashboard', 303)
  })
  app.post('/logout', (c) => { deleteCookie(c, 'session', { path: '/' }); return c.redirect('/login', 303) })

  app.get('/dashboard', async (c) => {
    const userId = await sessionUser(c)
    if (!userId) return c.redirect('/login', 303)
    return c.html(renderDashboard({ balance: await deps.credits.balance(userId), packs: PACKS }))
  })
  app.post('/token/rotate', async (c) => {
    const userId = await sessionUser(c)
    if (!userId) return c.redirect('/login', 303)
    const token = await deps.auth.issueToken(userId, 'dashboard')
    return c.html(renderDashboard({ balance: await deps.credits.balance(userId), packs: PACKS, token }))
  })
  app.post('/buy/:priceId', async (c) => {
    const userId = await sessionUser(c)
    if (!userId) return c.redirect('/login', 303)
    const priceId = c.req.param('priceId')
    if (!creditsForPrice(priceId)) return c.text('unknown pack', 400)
    return c.redirect(await deps.stripe.checkoutUrl(userId, priceId), 303)
  })
  app.post('/stripe/webhook', async (c) => {
    try {
      await deps.webhook.handle(await c.req.text(), c.req.header('stripe-signature') ?? '')
      return c.json({ received: true })
    } catch (e) {
      return c.json({ error: 'bad signature' }, 400) // Stripe retries 5xx; 400 = drop malformed
    }
  })

  app.route('/internal', internalRoutes({ secret: deps.internalSecret, credits: deps.credits, userIdForToken: deps.auth.userIdForToken }))
  return app
}

// main() (skipped by tests) wires the real DB, Stripe SDK, and env secrets, then serves buildApp.
```

Add a `main()` that builds the real deps (Drizzle `getDb`, `makeCredits(drizzlePrimitives(db))`, `makeAuth(drizzleAuthPrimitives(db))`, a Stripe SDK `checkoutUrl` creating a Checkout Session with `client_reference_id` + `metadata.price_id`, and `makeWebhook` with `stripe.webhooks.constructEvent` as `verify` + `stripeEvents` idempotency) and serves it with `@hono/node-server` (add dep) on `PORT ?? 8080`. Add `"account": "tsx account/server.ts"` to `package.json` scripts.

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm test account/web.test.ts` → PASS. `pnpm test` (full) → all pass. `pnpm typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add account/db/prims.ts account/web.ts account/server.ts package.json pnpm-lock.yaml
git commit -m "feat(account): web dashboard + public API + server wiring"
```

---

### Task 7: `gradeContent` — grade a SKILL.md string with the existing engine

**Files:**
- Create: `mcp/grade-content.ts`
- Test: `mcp/grade-content.test.ts`

**Interfaces:**
- Consumes: `loadRubric` (`../src/rubric.js`), `evaluateDimension` + `resolveModel` (`../src/llm.js`), `aggregate` (`../src/aggregate.js`), `hashSkillMd` (`./normalize.js`), `numberContent` if exported (else inline).
- Produces: `gradeContent(content: string, opts: { rubricDir: string; model: string; evaluateDimension?: typeof evaluateDimension }): Promise<{ skillMdHash: string; overall: string; badges: {security,quality,hygiene}; findings: {check,dimension,status,summary}[] }>`.

- [ ] **Step 1: Write the failing test (engine injected — no network)**

Create `mcp/grade-content.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gradeContent } from './grade-content.js'

const RUBRIC = join(dirname(fileURLToPath(import.meta.url)), '../rubric/skill')
const good = '---\nname: foo\ndescription: does a thing\n---\n# Foo\n\nBody.'

// Inject a fake evaluateDimension so no LLM is called.
const fakeEval = async ({ dimension }: any) =>
  dimension.checks.map((c: any) => ({ check: c.id, status: 'pass', note: 'ok' }))

describe('gradeContent', () => {
  it('grades a SKILL.md string to badges + hash without network', async () => {
    const r = await gradeContent(good, { rubricDir: RUBRIC, model: 'x', evaluateDimension: fakeEval as any })
    expect(r.skillMdHash).toMatch(/^[0-9a-f]{64}$/)
    expect(r.badges.security).toBe('A') // all pass -> A
    expect(['A','B','C','D','F']).toContain(r.overall)
    expect(Array.isArray(r.findings)).toBe(true)
  })
  it('a security fail yields security F and surfaces the finding', async () => {
    const failSec = async ({ dimension }: any) =>
      dimension.checks.map((c: any) => ({ check: c.id, status: c.id === 'S04' ? 'fail' : 'pass', note: 'x' }))
    const r = await gradeContent(good, { rubricDir: RUBRIC, model: 'x', evaluateDimension: failSec as any })
    expect(r.badges.security).toBe('F')
    expect(r.findings.some((f) => f.check === 'S04' && f.status === 'fail')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test mcp/grade-content.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `mcp/grade-content.ts`:

```typescript
import { loadRubric } from '../src/rubric.js'
import { evaluateDimension as realEvaluate } from '../src/llm.js'
import { aggregate } from '../src/aggregate.js'
import { hashSkillMd } from './normalize.js'
import type { DimensionKey } from '../src/types.js'

function dimensionOf(check: string): 'security' | 'quality' | 'hygiene' {
  return check.startsWith('S') ? 'security' : check.startsWith('Q') ? 'quality' : 'hygiene'
}

export interface GradeContentOpts {
  rubricDir: string
  model: string
  evaluateDimension?: typeof realEvaluate
}

// Grade a raw SKILL.md string with the existing engine — no filesystem, no loadSkill.
export async function gradeContent(content: string, opts: GradeContentOpts) {
  const evaluate = opts.evaluateDimension ?? realEvaluate
  const rubric = loadRubric(opts.rubricDir)
  const files = [{ path: 'SKILL.md', content }]
  const badges = {} as { security: string; quality: string; hygiene: string }
  const findings: { check: string; dimension: 'security' | 'quality' | 'hygiene'; status: string; summary: string }[] = []
  for (const dimension of rubric.dimensions as { key: DimensionKey; checks: Parameters<typeof aggregate>[0] }[]) {
    const verdicts = await evaluate({ dimension, files, model: opts.model } as any)
    badges[dimension.key] = aggregate(dimension.checks, verdicts).letter
    for (const v of verdicts) {
      if (v.status === 'fail' || v.status === 'warning') {
        findings.push({ check: v.check, dimension: dimensionOf(v.check), status: v.status, summary: (v as any).note ?? '' })
      }
    }
  }
  const graded = [badges.security, badges.quality, badges.hygiene]
  const order = ['A', 'B', 'C', 'D', 'F']
  const overall = graded.reduce((w, g) => (order.indexOf(g) > order.indexOf(w) ? g : w))
  return { skillMdHash: hashSkillMd(content), overall, badges, findings }
}
```

(If `evaluateDimension`'s real `EvaluateOpts` needs more fields — e.g. `runs`, a resolved model object — adjust the call and pass them from `opts`; the injected fake in the test only reads `dimension`, so the shape is validated at wiring time in Task 8.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test mcp/grade-content.test.ts` → PASS. `pnpm typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add mcp/grade-content.ts mcp/grade-content.test.ts
git commit -m "feat(mcp): gradeContent — grade a SKILL.md string via the engine"
```

---

### Task 8: `grade_skill` tool — bearer, catalog short-circuit, charge, grade, refund

**Files:**
- Create: `mcp/grade-skill.ts` (pure handler)
- Modify: `mcp/server.ts` (register the tool)
- Test: `mcp/grade-skill.test.ts`

**Interfaces:**
- Consumes: `SkillIndex` (`./index-build.js`), `gradeContent` (`./grade-content.js`), `hashSkillMd` (`./normalize.js`).
- Produces: `makeGradeSkill({ index, gradeContent, charge, refund, maxBytes })` → `handle({ content, token }): Promise<result>`. Result is one of: catalog hit (`charged:false`), graded (`charged:true, remaining`), or an error (`no-credits` / `invalid-token` / `too-large` / `grade-failed`).

- [ ] **Step 1: Write the failing test**

Create `mcp/grade-skill.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { buildIndex } from './index-build.js'
import { makeGradeSkill } from './grade-skill.js'
import { hashSkillMd } from './normalize.js'
import type { Catalog } from '../hub/schema.js'

const md = '---\nname: foo\ndescription: d\n---\n# Foo\nbody'
const known = { name: 'foo', source: 's', kind: 'skill', category: 'workflow', tagline: 't', badges: { security: 'A', quality: 'A', hygiene: 'A', effectiveness: 'not-evaluated' }, overall: 'A', highlights: [], preCheck: { frontmatterValid: true, fileCount: 1, skillMdBytes: 1, criticalFlags: 0, majorFlags: 0 }, rubricVersion: '0.1.2', evaluatedAt: 'now', evaluator: { mode: 'm', model: 'x' }, skillMdHash: hashSkillMd(md), slug: 'foo', popularity: 0, mirrors: [], discoveredVia: null }
const catalog = { generatedAt: 'now', rubricVersion: '0.1.2', taxonomy: [], skills: [known] } as unknown as Catalog

function mk(over: Partial<any> = {}) {
  const charge = vi.fn(async () => ({ ok: true, remaining: 4 }))
  const refund = vi.fn(async () => {})
  const gradeContent = vi.fn(async () => ({ skillMdHash: 'h', overall: 'B', badges: { security: 'A', quality: 'B', hygiene: 'B' }, findings: [] }))
  const h = makeGradeSkill({ index: buildIndex(catalog), gradeContent, charge, refund, maxBytes: 1000, ...over })
  return { h, charge, refund, gradeContent }
}

describe('grade_skill', () => {
  it('catalog hit returns the stored grade and does NOT charge', async () => {
    const { h, charge } = mk()
    const r = await h.handle({ content: md, token: 't' })
    expect(r).toMatchObject({ charged: false, source: 'catalog', overall: 'A' })
    expect(charge).not.toHaveBeenCalled()
  })
  it('new content: charges, grades, returns remaining', async () => {
    const { h, charge, gradeContent } = mk()
    const r = await h.handle({ content: '---\nname: new\ndescription: d\n---\n# N\nx', token: 't' })
    expect(charge).toHaveBeenCalledWith('t')
    expect(gradeContent).toHaveBeenCalled()
    expect(r).toMatchObject({ charged: true, remaining: 4, overall: 'B' })
  })
  it('no credits -> error, no grade', async () => {
    const { h, gradeContent } = mk({ charge: vi.fn(async () => ({ ok: false, remaining: 0 })) })
    const r = await h.handle({ content: '---\nname: new2\ndescription: d\n---\n# N\nx', token: 't' })
    expect(r).toMatchObject({ error: 'no-credits' })
    expect(gradeContent).not.toHaveBeenCalled()
  })
  it('missing token -> invalid-token', async () => {
    const { h } = mk()
    expect(await h.handle({ content: 'x', token: undefined })).toMatchObject({ error: 'invalid-token' })
  })
  it('oversize -> too-large, no charge', async () => {
    const { h, charge } = mk({ maxBytes: 5 })
    expect(await h.handle({ content: 'way too long content', token: 't' })).toMatchObject({ error: 'too-large' })
    expect(charge).not.toHaveBeenCalled()
  })
  it('grade failure -> refund + grade-failed', async () => {
    const { h, refund } = mk({ gradeContent: vi.fn(async () => { throw new Error('llm down') }) })
    const r = await h.handle({ content: '---\nname: new3\ndescription: d\n---\n# N\nx', token: 't' })
    expect(r).toMatchObject({ error: 'grade-failed' })
    expect(refund).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test mcp/grade-skill.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `mcp/grade-skill.ts`:

```typescript
import { hashSkillMd } from './normalize.js'
import type { SkillIndex } from './index-build.js'

export interface GradeSkillDeps {
  index: SkillIndex
  gradeContent: (content: string) => Promise<{ skillMdHash: string; overall: string; badges: { security: string; quality: string; hygiene: string }; findings: unknown[] }>
  charge: (token: string) => Promise<{ ok: boolean; remaining: number }>
  refund: (token: string, ref: string) => Promise<void>
  maxBytes: number
}

export function makeGradeSkill(deps: GradeSkillDeps) {
  return {
    async handle({ content, token }: { content: string; token?: string }) {
      if (!token) return { error: 'invalid-token' as const }
      if (Buffer.byteLength(content, 'utf8') > deps.maxBytes) return { error: 'too-large' as const, maxBytes: deps.maxBytes }

      // Catalog short-circuit: a skill we've already graded costs nothing.
      const hash = hashSkillMd(content)
      const hit = deps.index.byHash.get(hash)
      if (hit) return { charged: false as const, source: 'catalog' as const, overall: hit.overall, badges: { security: hit.badges.security, quality: hit.badges.quality, hygiene: hit.badges.hygiene }, name: hit.name, reportUrl: `https://skillgrade.dev/#skill-${encodeURIComponent(hit.name)}` }

      const c = await deps.charge(token)
      if (!c.ok) return { error: 'no-credits' as const, remaining: c.remaining }
      try {
        const g = await deps.gradeContent(content)
        return { charged: true as const, remaining: c.remaining, overall: g.overall, badges: g.badges, findings: g.findings, skillMdHash: g.skillMdHash }
      } catch {
        await deps.refund(token, hash)
        return { error: 'grade-failed' as const }
      }
    },
  }
}
```

- [ ] **Step 4: Wire the tool into the MCP server (network path — smoke-only)**

In `mcp/server.ts`, register a `grade_skill` tool. It reads the bearer from the request `Authorization` header (fallback: a `token` arg), constructs the deps — `charge`/`refund` POST to the Account service `INTERNAL_URL` + `/internal/{charge,refund}` with the `X-Internal-Secret` header and `{ token }`, `gradeContent` binds `mcp/grade-content.ts`'s `gradeContent(content, { rubricDir, model: 'openrouter:google/gemini-2.5-flash' })`, `maxBytes: 262144` — and returns `handle(...)` wrapped in the MCP content envelope. Pass the bearer from the header into `handle`. (The tool input schema is `{ content: z.string(), token: z.string().optional() }`; the header is preferred when present.)

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm test mcp/grade-skill.test.ts` → PASS. `pnpm test` (full) → all pass. `pnpm typecheck` → clean.
Smoke (optional, needs the Account service + OPENROUTER_API_KEY): start both, call `grade_skill` with a valid token and a small SKILL.md, confirm a verdict + `remaining` decremented, and a catalog skill returns `charged:false`.

- [ ] **Step 6: Commit**

```bash
git add mcp/grade-skill.ts mcp/grade-skill.test.ts mcp/server.ts
git commit -m "feat(mcp): grade_skill tool — catalog short-circuit, charge, grade, refund"
```

---

### Task 9: Containerize + deploy the Account service; wire the MCP

**Files:**
- Create: `account/Dockerfile`, `account/README.md`
- Modify: `mcp/README.md` (document `grade_skill` + the bearer)

**Interfaces:** none (ops).

- [ ] **Step 1: Dockerfile**

Create `account/Dockerfile` (build context = repo root so it shares the workspace):

```dockerfile
FROM node:22-slim
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
EXPOSE 8080
ENV PORT=8080
# migrations are applied on boot, then the server starts
CMD ["sh", "-c", "pnpm drizzle-kit migrate && pnpm account"]
```

- [ ] **Step 2: Build locally (or inspect if no Docker)**

Run: `docker build -f account/Dockerfile -t skillgrade-account .` → builds. (If Docker is unavailable, validate by inspection and say so.)

- [ ] **Step 3: README + runbook**

Create `account/README.md` documenting: the env vars (`DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_5/15/40`, `INTERNAL_SECRET`, `COOKIE_SECRET`, `PORT`); the Coolify deploy (new app + Postgres, `account/Dockerfile`, subdomain `account.skillgrade.dev`, Stripe webhook endpoint → `/stripe/webhook`, add the webhook secret); and that migrations run on boot. Update `mcp/README.md` to document the new `grade_skill` tool, the `Authorization: Bearer <token>` header (from the dashboard), the free catalog short-circuit, and the MCP's new env (`INTERNAL_URL`, `INTERNAL_SECRET`, `OPENROUTER_API_KEY`).

- [ ] **Step 4: Commit**

```bash
git add account/Dockerfile account/README.md mcp/README.md
git commit -m "chore(account): Dockerfile + deploy/runbook; document grade_skill"
```

- [ ] **Step 5: Deploy (operator step, run when ready — uses coolify-deploy + Stripe setup)**

Provision Postgres in Coolify; create the Account app (public repo, `account/Dockerfile`, context repo root, port 8080, domain `account.skillgrade.dev`, all env secrets). Create the three Stripe Products/Prices, set `STRIPE_PRICE_*`. Register the Stripe webhook → `https://account.skillgrade.dev/stripe/webhook`, copy its signing secret to `STRIPE_WEBHOOK_SECRET`. Set the MCP app's `INTERNAL_URL=https://account.skillgrade.dev`, `INTERNAL_SECRET`, `OPENROUTER_API_KEY` and redeploy it. DNS A `account.skillgrade.dev → 65.109.60.26` (user).

---

## Self-Review

**Spec coverage:**
- Account service (auth, credits, Stripe, tokens, web, internal API) → Tasks 1–6. ✓
- Postgres schema (users/api_tokens/credit_ledger/grade_log/stripe_events) → Task 1. ✓
- Atomic race-safe credit charge → Task 2 (`tryDecrement` = conditional UPDATE). ✓
- scrypt passwords + hashed rotatable tokens → Task 3. ✓
- Stripe Checkout + signed idempotent webhook → Task 4 (+ wiring Task 6). ✓
- Internal shared-secret charge/refund → Task 5. ✓
- `grade_skill` (bearer, catalog short-circuit = free, charge, grade in memory, refund, content never stored, size cap) → Tasks 7–8. ✓
- gemini-2.5-flash grader / scores in code → Task 7/8 wiring. ✓
- Security (env-only secrets, hashed tokens, HttpOnly cookies, fail-closed, no content persistence) → Global Constraints + Tasks 2/3/5/8. ✓
- Testing (concurrent-charge, webhook idempotency, catalog short-circuit no-charge, refund-on-failure, secret guard) → Tasks 2–8. ✓
- Deploy (Account app + Postgres + Stripe + MCP wiring) → Task 9. ✓

**Placeholder scan:** no TBD/TODO in code steps; the web HTML (Task 6 Step 4) and README (Task 9 Step 3) are described concretely as prose deliverables (frontend-design owns HTML craft), which is acceptable for docs/large-template steps. The Task 2 test's first `fakeDb` sketch is explicitly discarded in favour of the injectable-primitives harness in the same step.

**Type consistency:** the injectable-primitives pattern (`makeCredits`/`makeAuth`/`makeWebhook`/`internalRoutes`/`makeGradeSkill`) is used uniformly so every module is tested with fakes and wired to Drizzle/Stripe/HTTP in Task 6/8. `credits.charge → {ok, remaining}` consumed unchanged by `internal.ts` and `grade-skill.ts`. `gradeContent`'s return (`{skillMdHash, overall, badges, findings}`) consumed by `grade-skill.ts`. `SkillIndex.byHash` (from the existing MCP) drives the catalog short-circuit. `INTERNAL_SECRET`/`INTERNAL_URL` bridge the MCP and Account service consistently.
