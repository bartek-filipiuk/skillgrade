import { describe, it, expect } from 'vitest'
import { checkExpectation } from '../scripts/calibrate.js'
import type { Report } from '../src/types.js'

const badges = (s: string, q: string, h: string): Report['badges'] =>
  ({ security: s, quality: q, hygiene: h, effectiveness: 'not-evaluated' }) as Report['badges']
const v = (check: string, status: string) => ({ check, status }) as Report['verdicts'][number]

describe('checkExpectation', () => {
  it('passes when grades sit within bounds and required checks fail', () => {
    const fails = checkExpectation(
      { minSecurity: 'F', maxSecurity: 'F', mustFailChecks: ['S01', 'S02'] },
      badges('F', 'A', 'A'),
      [v('S01', 'fail'), v('S02', 'fail')],
    )
    expect(fails).toEqual([])
  })

  it('flags security graded better than allowed (model too lenient)', () => {
    const fails = checkExpectation({ minSecurity: 'F', maxSecurity: 'F' }, badges('A', 'A', 'A'), [])
    expect(fails.join()).toMatch(/security A better than allowed F/)
  })

  it('accepts a range: benign-rich security A or B', () => {
    expect(checkExpectation({ minSecurity: 'B', maxSecurity: 'A' }, badges('A', 'A', 'A'), [])).toEqual([])
    expect(checkExpectation({ minSecurity: 'B', maxSecurity: 'A' }, badges('B', 'A', 'A'), [])).toEqual([])
    expect(checkExpectation({ minSecurity: 'B', maxSecurity: 'A' }, badges('C', 'A', 'A'), []).join()).toMatch(/worse than allowed B/)
  })

  it('enforces quality/hygiene caps (no better than C)', () => {
    expect(checkExpectation({ maxQuality: 'C', maxHygiene: 'C' }, badges('A', 'C', 'C'), [])).toEqual([])
    expect(checkExpectation({ maxQuality: 'C' }, badges('A', 'A', 'A'), []).join()).toMatch(/quality A better than allowed C/)
  })

  it('reports a missing or non-fail required check', () => {
    expect(checkExpectation({ mustFailChecks: ['S06'] }, badges('F', 'A', 'A'), []).join()).toMatch(/missing verdict for S06/)
    expect(checkExpectation({ mustFailChecks: ['S06'] }, badges('F', 'A', 'A'), [v('S06', 'warning')]).join()).toMatch(/S06 is warning/)
  })
})
