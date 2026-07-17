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
