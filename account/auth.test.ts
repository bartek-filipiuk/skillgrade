import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, hashToken, newToken, makeAuth, type AuthPrimitives } from './auth.js'

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

// In-memory fake of the DB primitives: users keyed by normalized email, tokenHash -> userId.
function fakePrimitives(): AuthPrimitives {
  const users = new Map<string, { id: string; passwordHash: string; passwordSalt: string }>()
  const tokens = new Map<string, string>() // tokenHash -> userId (present = non-revoked)
  let seq = 0
  return {
    async findUserByEmail(email) {
      return users.get(email) ?? null // exact match, mirrors the DB unique index
    },
    async createUser(email, passwordHash, passwordSalt) {
      const id = `u${++seq}`
      users.set(email, { id, passwordHash, passwordSalt })
      return id
    },
    async insertToken(userId, tokenHash) {
      tokens.set(tokenHash, userId)
    },
    async userIdForTokenHash(tokenHash) {
      return tokens.get(tokenHash) ?? null
    },
    async revokeToken(_userId, tokenHash) {
      tokens.delete(tokenHash)
    },
  }
}

describe('makeAuth', () => {
  it('register rejects a different-cased duplicate email (regresses the un-normalized check)', async () => {
    const auth = makeAuth(fakePrimitives())
    await auth.register('foo@x.com', 'pw')
    await expect(auth.register('Foo@X.com', 'pw')).rejects.toThrow('email already registered')
  })

  it('login returns the userId for the right password (any email case) and null otherwise', async () => {
    const auth = makeAuth(fakePrimitives())
    const id = await auth.register('foo@x.com', 'pw')
    expect(await auth.login('FOO@x.com', 'pw')).toBe(id) // email case-insensitive
    expect(await auth.login('foo@x.com', 'wrong')).toBeNull()
    expect(await auth.login('nobody@x.com', 'pw')).toBeNull()
  })

  it('issueToken -> userIdForToken resolves, then null after revoke', async () => {
    const auth = makeAuth(fakePrimitives())
    const id = await auth.register('foo@x.com', 'pw')
    const token = await auth.issueToken(id, null)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(await auth.userIdForToken(token)).toBe(id)
    await auth.revokeToken(id, token)
    expect(await auth.userIdForToken(token)).toBeNull()
  })
})
