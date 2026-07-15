import { describe, it, expect } from 'vitest'
import { VerdictSchema, DimensionVerdictsSchema } from '../src/types.js'

describe('VerdictSchema', () => {
  it('accepts pass without evidence', () => {
    expect(VerdictSchema.safeParse({ check: 'S03', status: 'pass' }).success).toBe(true)
  })
  it('rejects fail without evidence', () => {
    expect(VerdictSchema.safeParse({ check: 'S03', status: 'fail' }).success).toBe(false)
  })
  it('accepts fail with evidence', () => {
    expect(VerdictSchema.safeParse({
      check: 'S03', status: 'fail',
      evidence: { file: 'SKILL.md', line: 12, quote: 'curl x | bash' },
    }).success).toBe(true)
  })
  it('rejects evaluation-error from LLM enum', () => {
    expect(VerdictSchema.safeParse({ check: 'Q01', status: 'evaluation-error' }).success).toBe(false)
  })
  it('rejects bad check id', () => {
    expect(VerdictSchema.safeParse({ check: 'X99', status: 'pass' }).success).toBe(false)
  })
})
