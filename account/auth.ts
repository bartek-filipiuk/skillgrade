import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto'

export function hashPassword(pw: string): { hash: string; salt: string } {
  const salt = randomBytes(16)
  const hash = scryptSync(pw, salt, 64)
  return { hash: hash.toString('hex'), salt: salt.toString('hex') }
}

export function verifyPassword(pw: string, hashHex: string, saltHex: string): boolean {
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(pw, Buffer.from(saltHex, 'hex'), 64)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('hex')
  return { token, hash: hashToken(token) }
}

// DB-facing operations behind injectable primitives (tests fake these; prod wires Drizzle).
export interface AuthPrimitives {
  findUserByEmail(email: string): Promise<{ id: string; passwordHash: string; passwordSalt: string } | null>
  createUser(email: string, passwordHash: string, passwordSalt: string): Promise<string> // returns userId
  insertToken(userId: string, tokenHash: string, label: string | null): Promise<void>
  userIdForTokenHash(tokenHash: string): Promise<string | null> // only non-revoked
  revokeToken(userId: string, tokenHash: string): Promise<void>
}

export function makeAuth(p: AuthPrimitives) {
  return {
    async register(email: string, pw: string): Promise<string> {
      const e = email.toLowerCase().trim()
      if (await p.findUserByEmail(e)) throw new Error('email already registered')
      const { hash, salt } = hashPassword(pw)
      return p.createUser(e, hash, salt)
    },
    async login(email: string, pw: string): Promise<string | null> {
      const u = await p.findUserByEmail(email.toLowerCase().trim())
      if (!u) return null
      return verifyPassword(pw, u.passwordHash, u.passwordSalt) ? u.id : null
    },
    async issueToken(userId: string, label: string | null): Promise<string> {
      const { token, hash } = newToken()
      await p.insertToken(userId, hash, label)
      return token // shown once
    },
    userIdForToken: (token: string) => p.userIdForTokenHash(hashToken(token)),
    revokeToken: (userId: string, token: string) => p.revokeToken(userId, hashToken(token)),
  }
}
