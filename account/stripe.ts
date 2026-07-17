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
