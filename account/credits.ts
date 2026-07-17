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
