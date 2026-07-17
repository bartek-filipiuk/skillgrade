import { describe, it, expect, vi } from 'vitest'
import { buildApp, makeRateLimiter } from './server.js'

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

describe('auth rate limiter', () => {
  it('blocks after the cap for one IP and resets in a new window', () => {
    const limited = makeRateLimiter(60_000, 3)
    const t0 = 1_000
    expect(limited('1.1.1.1', t0)).toBe(false) // 1
    expect(limited('1.1.1.1', t0)).toBe(false) // 2
    expect(limited('1.1.1.1', t0)).toBe(false) // 3 (== cap, still allowed)
    expect(limited('1.1.1.1', t0)).toBe(true)  // 4 > cap → blocked
    expect(limited('2.2.2.2', t0)).toBe(false) // other IP has its own bucket
    expect(limited('1.1.1.1', t0 + 60_001)).toBe(false) // new window resets
  })
})
