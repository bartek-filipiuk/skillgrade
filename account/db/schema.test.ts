import { describe, it, expect } from 'vitest'
import { users, apiTokens, creditLedger, gradeLog, stripeEvents } from './schema.js'

describe('schema', () => {
  it('exposes the five tables with key columns', () => {
    expect(users.email).toBeDefined()
    expect(users.creditBalance).toBeDefined()
    expect(apiTokens.tokenHash).toBeDefined()
    expect(creditLedger.delta).toBeDefined()
    expect(gradeLog.skillMdHash).toBeDefined()
    expect(stripeEvents.eventId).toBeDefined()
  })
})
