import { and, eq, isNull } from 'drizzle-orm'
import type { AuthPrimitives } from '../auth.js'
import { users, apiTokens } from './schema.js'
import type { DB } from './client.js'

// Real AuthPrimitives over Drizzle. Mirrors drizzlePrimitives(db) in credits.ts.
export function drizzleAuthPrimitives(db: DB): AuthPrimitives {
  return {
    async findUserByEmail(email) {
      const [u] = await db.select({ id: users.id, passwordHash: users.passwordHash, passwordSalt: users.passwordSalt })
        .from(users).where(eq(users.email, email)).limit(1)
      return u ?? null
    },
    async createUser(email, passwordHash, passwordSalt) {
      try {
        const [u] = await db.insert(users).values({ email, passwordHash, passwordSalt }).returning({ id: users.id })
        return u.id
      } catch (e: any) {
        // 23505 = unique_violation on the email constraint (Task 1). Surface a friendly error.
        if (e?.code === '23505') throw new Error('email already registered')
        throw e
      }
    },
    async insertToken(userId, tokenHash, label) {
      await db.insert(apiTokens).values({ userId, tokenHash, label })
    },
    async userIdForTokenHash(tokenHash) {
      const [t] = await db.select({ userId: apiTokens.userId }).from(apiTokens)
        .where(and(eq(apiTokens.tokenHash, tokenHash), isNull(apiTokens.revokedAt))).limit(1)
      return t?.userId ?? null
    },
    async revokeToken(userId, tokenHash) {
      await db.update(apiTokens).set({ revokedAt: new Date() })
        .where(and(eq(apiTokens.userId, userId), eq(apiTokens.tokenHash, tokenHash)))
    },
  }
}
