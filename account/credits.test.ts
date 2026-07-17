import { describe, it, expect, vi } from 'vitest'
import { makeCredits, SIGNUP_FREE } from './credits.js'

function harness(initialBalance: number) {
  const state = { bal: initialBalance, ledger: [] as { delta: number; reason: string }[] }
  const primitives = {
    // atomic conditional decrement: returns new balance or null if insufficient
    tryDecrement: vi.fn(async () => (state.bal >= 1 ? (--state.bal) : null)),
    increment: vi.fn(async (_userId: string, n: number) => { state.bal += n; return state.bal }),
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
