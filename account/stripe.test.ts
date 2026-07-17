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
