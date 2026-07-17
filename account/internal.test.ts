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
  it('returns 401 when the token is unknown', async () => {
    const { routes } = app()
    expect((await routes.fetch(req('/charge', { token: 'bad' }, 's3cret'))).status).toBe(401)
  })
})
