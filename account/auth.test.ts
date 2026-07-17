import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, hashToken, newToken } from './auth.js'

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
