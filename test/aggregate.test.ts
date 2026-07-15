import { describe, it, expect } from 'vitest'
import { aggregate } from '../src/aggregate.js'
import type { CheckDef, ReportVerdict, Severity } from '../src/types.js'

// Test helper — a minimal CheckDef; body is irrelevant to scoring.
function check(id: string, severity: Severity, weight: number): CheckDef {
  return { id, title: id, severity, weight, body: '' }
}

describe('aggregate — plan cases a–h', () => {
  it('(a) all pass → A', () => {
    const checks = [check('S01', 'critical', 10), check('Q01', 'major', 5)]
    const verdicts: ReportVerdict[] = [
      { check: 'S01', status: 'pass' },
      { check: 'Q01', status: 'pass' },
    ]
    expect(aggregate(checks, verdicts)).toEqual({ score: 1, letter: 'A' })
  })

  it('(b) fail on critical → F even at score 0.95', () => {
    const checks = [check('S01', 'critical', 1), check('Q01', 'major', 19)]
    const verdicts: ReportVerdict[] = [
      { check: 'S01', status: 'fail', evidence: { file: 'SKILL.md', line: 1, quote: 'x' } },
      { check: 'Q01', status: 'pass' },
    ]
    const r = aggregate(checks, verdicts)
    expect(r.letter).toBe('F')
    expect(r.score).toBeCloseTo(0.95, 10)
  })

  it('(c) warning counts as 0.5 of weight', () => {
    const checks = [check('Q01', 'major', 10)]
    const verdicts: ReportVerdict[] = [
      { check: 'Q01', status: 'warning', evidence: { file: 'SKILL.md', line: 1, quote: 'x' } },
    ]
    expect(aggregate(checks, verdicts)).toEqual({ score: 0.5, letter: 'D' })
  })

  it('(d) not-applicable drops out of the denominator', () => {
    const checks = [check('Q01', 'major', 10), check('Q02', 'major', 10)]
    const verdicts: ReportVerdict[] = [
      { check: 'Q01', status: 'pass' },
      { check: 'Q02', status: 'not-applicable' },
    ]
    // 10/10 = 1.0, the N/A check contributes nothing to num or den
    expect(aggregate(checks, verdicts)).toEqual({ score: 1, letter: 'A' })
  })

  it('(e) evaluation-error counts as 0', () => {
    const checks = [check('Q01', 'major', 1), check('Q02', 'major', 1)]
    const verdicts: ReportVerdict[] = [
      { check: 'Q01', status: 'pass' },
      { check: 'Q02', status: 'evaluation-error' },
    ]
    expect(aggregate(checks, verdicts)).toEqual({ score: 0.5, letter: 'D' })
  })

  it('(f) all not-applicable → score null, letter A', () => {
    const checks = [check('Q01', 'major', 10), check('Q02', 'major', 10)]
    const verdicts: ReportVerdict[] = [
      { check: 'Q01', status: 'not-applicable' },
      { check: 'Q02', status: 'not-applicable' },
    ]
    expect(aggregate(checks, verdicts)).toEqual({ score: null, letter: 'A' })
  })

  it('(g) missing verdict for a listed check → treated as evaluation-error (0)', () => {
    const checks = [check('Q01', 'major', 1), check('Q02', 'major', 1)]
    const verdicts: ReportVerdict[] = [{ check: 'Q01', status: 'pass' }]
    // Q02 absent → 0; 1/2 = 0.5
    expect(aggregate(checks, verdicts)).toEqual({ score: 0.5, letter: 'D' })
  })

  it('(h) threshold 0.9 → A (exact boundary is inclusive)', () => {
    const checks = [check('Q01', 'major', 9), check('Q02', 'minor', 1)]
    const verdicts: ReportVerdict[] = [
      { check: 'Q01', status: 'pass' },
      { check: 'Q02', status: 'fail', evidence: { file: 'SKILL.md', line: 1, quote: 'x' } },
    ]
    expect(aggregate(checks, verdicts)).toEqual({ score: 0.9, letter: 'A' })
  })

  it('(h) threshold 0.8999 → B (just below 0.9)', () => {
    const checks = [check('Q01', 'major', 8999), check('Q02', 'minor', 1001)]
    const verdicts: ReportVerdict[] = [
      { check: 'Q01', status: 'pass' },
      { check: 'Q02', status: 'fail', evidence: { file: 'SKILL.md', line: 1, quote: 'x' } },
    ]
    expect(aggregate(checks, verdicts)).toEqual({ score: 0.8999, letter: 'B' })
  })
})

describe('aggregate — letter bands', () => {
  it('0.8 → B, 0.65 → C, 0.5 → D, below 0.5 → F', () => {
    const band = (num: number, den: number) => {
      const checks = [check('Q01', 'major', num), check('Q02', 'minor', den - num)]
      const verdicts: ReportVerdict[] = [
        { check: 'Q01', status: 'pass' },
        { check: 'Q02', status: 'fail', evidence: { file: 'SKILL.md', line: 1, quote: 'x' } },
      ]
      return aggregate(checks, verdicts).letter
    }
    expect(band(80, 100)).toBe('B') // 0.80
    expect(band(65, 100)).toBe('C') // 0.65
    expect(band(50, 100)).toBe('D') // 0.50
    expect(band(49, 100)).toBe('F') // 0.49
  })
})

describe('aggregate — adversarial break scenarios (howtoprojects §1–2)', () => {
  // Scenario 1: boundary inputs
  it('empty check list → score null, letter A (no charges to answer)', () => {
    expect(aggregate([], [])).toEqual({ score: null, letter: 'A' })
  })

  it('verdict for a non-existent check is ignored (not in rubric → no effect)', () => {
    const checks = [check('Q01', 'major', 10)]
    const verdicts: ReportVerdict[] = [
      { check: 'Q01', status: 'pass' },
      { check: 'Z99', status: 'fail', evidence: { file: 'x', line: 1, quote: 'x' } },
    ]
    expect(aggregate(checks, verdicts)).toEqual({ score: 1, letter: 'A' })
  })

  it('zero / negative weight is excluded from scoring, never corrupts the score', () => {
    const checks = [check('Q01', 'major', 10), check('Q02', 'major', 0), check('Q03', 'major', -5)]
    const verdicts: ReportVerdict[] = [
      { check: 'Q01', status: 'pass' },
      { check: 'Q02', status: 'fail', evidence: { file: 'x', line: 1, quote: 'x' } },
      { check: 'Q03', status: 'fail', evidence: { file: 'x', line: 1, quote: 'x' } },
    ]
    // only Q01 counts → 10/10 = 1; score stays in [0,1]
    const r = aggregate(checks, verdicts)
    expect(r).toEqual({ score: 1, letter: 'A' })
  })

  it('critical fail still forces F even when its weight is zero/invalid', () => {
    const checks = [check('S01', 'critical', 0), check('Q01', 'major', 10)]
    const verdicts: ReportVerdict[] = [
      { check: 'S01', status: 'fail', evidence: { file: 'x', line: 1, quote: 'x' } },
      { check: 'Q01', status: 'pass' },
    ]
    expect(aggregate(checks, verdicts).letter).toBe('F')
  })

  // Scenario 2: double execution — pure function
  it('is pure: repeated calls with the same inputs give identical results', () => {
    const checks = [check('S01', 'critical', 10), check('Q01', 'major', 5)]
    const verdicts: ReportVerdict[] = [
      { check: 'S01', status: 'pass' },
      { check: 'Q01', status: 'warning', evidence: { file: 'x', line: 1, quote: 'x' } },
    ]
    const a = aggregate(checks, verdicts)
    const b = aggregate(checks, verdicts)
    expect(a).toEqual(b)
    expect(verdicts).toHaveLength(2) // inputs untouched
  })

  // Scenario 3: malicious actor — duplicate verdicts for one check.
  // Deterministic rule: the WORST status wins, so a duplicate can never upgrade a verdict.
  it('duplicate verdicts: worst status wins regardless of order (pass then fail)', () => {
    const checks = [check('S01', 'critical', 10)]
    const verdicts: ReportVerdict[] = [
      { check: 'S01', status: 'pass' },
      { check: 'S01', status: 'fail', evidence: { file: 'x', line: 1, quote: 'x' } },
    ]
    expect(aggregate(checks, verdicts).letter).toBe('F')
  })

  it('duplicate verdicts: worst status wins regardless of order (fail then pass)', () => {
    const checks = [check('S01', 'critical', 10)]
    const verdicts: ReportVerdict[] = [
      { check: 'S01', status: 'fail', evidence: { file: 'x', line: 1, quote: 'x' } },
      { check: 'S01', status: 'pass' },
    ]
    // a trailing pass must NOT overturn the earlier fail
    expect(aggregate(checks, verdicts).letter).toBe('F')
  })

  it('duplicate verdicts on a non-critical check pick the lower-scoring status', () => {
    const checks = [check('Q01', 'major', 10)]
    const verdicts: ReportVerdict[] = [
      { check: 'Q01', status: 'pass' },
      { check: 'Q01', status: 'warning', evidence: { file: 'x', line: 1, quote: 'x' } },
    ]
    // warning (0.5) is worse than pass (1) → 0.5
    expect(aggregate(checks, verdicts)).toEqual({ score: 0.5, letter: 'D' })
  })
})
