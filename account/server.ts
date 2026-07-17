import { Hono } from 'hono'
import { getSignedCookie, setSignedCookie, deleteCookie } from 'hono/cookie'
import { serve } from '@hono/node-server'
import { fileURLToPath } from 'node:url'
import { eq } from 'drizzle-orm'
import Stripe from 'stripe'
import { getDb } from './db/client.js'
import { stripeEvents } from './db/schema.js'
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
  const setSession = (c: any, userId: string) =>
    setSignedCookie(c, 'session', userId, deps.cookieSecret, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/' })

  app.get('/', (c) => c.redirect('/dashboard'))
  app.get('/register', (c) => c.html(renderRegister()))
  app.post('/register', async (c) => {
    const b = await c.req.parseBody()
    let userId: string
    try {
      userId = await deps.auth.register(String(b.email), String(b.password))
    } catch (e: any) {
      return c.html(renderRegister(e?.message === 'email already registered' ? 'That email is already registered.' : 'Could not create the account.'), 400)
    }
    await deps.credits.grantSignupFree(userId)
    await setSession(c, userId)
    return c.redirect('/dashboard', 303)
  })
  app.get('/login', (c) => c.html(renderLogin()))
  app.post('/login', async (c) => {
    const b = await c.req.parseBody()
    const userId = await deps.auth.login(String(b.email), String(b.password))
    if (!userId) return c.html(renderLogin('Invalid email or password'), 401)
    await setSession(c, userId)
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

function envOrThrow(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} not set`)
  return v
}

// main() wires the real DB, Stripe SDK, and env secrets, then serves buildApp.
export function main(): void {
  const db = getDb()
  const credits = makeCredits(drizzlePrimitives(db))
  const auth = makeAuth(drizzleAuthPrimitives(db))
  const stripe = new Stripe(envOrThrow('STRIPE_SECRET_KEY'))
  const webhookSecret = envOrThrow('STRIPE_WEBHOOK_SECRET')
  const baseUrl = process.env.BASE_URL ?? 'https://account.skillgrade.dev'

  const webhook = makeWebhook({
    verify: (raw, sig) => stripe.webhooks.constructEvent(raw, sig, webhookSecret),
    alreadyProcessed: async (eventId) => {
      const [row] = await db.select({ eventId: stripeEvents.eventId }).from(stripeEvents).where(eq(stripeEvents.eventId, eventId)).limit(1)
      return !!row
    },
    // Skip paths (non-checkout events) mark the event alone. ON CONFLICT keeps
    // the redundant success-path call (below) harmless.
    markProcessed: async (eventId) => {
      await db.insert(stripeEvents).values({ eventId }).onConflictDoNothing()
    },
    // CARRY-FORWARD #1 (atomic credit) + #2 (signature adapter): the credit
    // (balance update + ledger insert) AND the stripe_events insert run in ONE
    // transaction, so a crash between them rolls back BOTH and Stripe's retry
    // re-credits exactly once. ref is event.id; reason is pinned to 'purchase'
    // so the event id never leaks into the ledger reason column.
    // NO onConflictDoNothing here: for CONCURRENT duplicate delivery both handlers
    // see alreadyProcessed=false and run the tx; the second insert must raise the
    // unique violation so its tx (credit included) rolls back. Stripe gets a non-2xx
    // and retries; the retry then sees alreadyProcessed=true and skips. Exactly-once
    // credit under both crash-retry AND concurrent delivery.
    addCredits: (userId, n, ref) => db.transaction(async (tx) => {
      await makeCredits(drizzlePrimitives(tx)).addCredits(userId, n, 'purchase', ref)
      await tx.insert(stripeEvents).values({ eventId: ref })
    }),
  })

  const app = buildApp({
    cookieSecret: envOrThrow('COOKIE_SECRET'),
    internalSecret: envOrThrow('INTERNAL_SECRET'),
    auth,
    credits,
    stripe: {
      async checkoutUrl(userId, priceId) {
        const session = await stripe.checkout.sessions.create({
          mode: 'payment',
          line_items: [{ price: priceId, quantity: 1 }],
          client_reference_id: userId,
          metadata: { price_id: priceId },
          success_url: `${baseUrl}/dashboard`,
          cancel_url: `${baseUrl}/dashboard`,
        })
        if (!session.url) throw new Error('Stripe returned no checkout URL')
        return session.url
      },
    },
    webhook,
  })

  const port = Number(process.env.PORT ?? 8080)
  serve({ fetch: app.fetch, port })
  console.log(`account server listening on :${port}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
