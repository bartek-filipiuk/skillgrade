import { describe, it, expect } from 'vitest'
import { mergeWorklist, selectWave } from './state.js'
import type { WorklistItem } from './dedup.js'

const item = (over: Partial<WorklistItem> & { skillMdHash: string; primarySourceUrl: string }): WorklistItem => ({
  name: 'n', mirrors: [], repo: 'a/b', path: 'SKILL.md', stars: 0, pushedAt: '', size: 1, status: 'ready', lastSeen: 'now', ...over,
})

describe('mergeWorklist', () => {
  it('keeps graded items and does not re-add them as ready', () => {
    const existing = [item({ skillMdHash: 'h1', primarySourceUrl: 'u1', status: 'graded' })]
    const fresh = [item({ skillMdHash: 'h1', primarySourceUrl: 'u1' })]
    const out = mergeWorklist(existing, fresh, new Set(['h1']))
    expect(out.filter((i) => i.status === 'graded')).toHaveLength(1)
    expect(out.filter((i) => i.status === 'ready')).toHaveLength(0)
  })
  it('flags drift: same source, new hash', () => {
    const existing = [item({ skillMdHash: 'old', primarySourceUrl: 'u1', status: 'graded' })]
    const fresh = [item({ skillMdHash: 'new', primarySourceUrl: 'u1' })]
    const out = mergeWorklist(existing, fresh, new Set(['old']))
    expect(out.find((i) => i.skillMdHash === 'new')?.status).toBe('drifted')
  })
  it('adds genuinely new ready items', () => {
    const out = mergeWorklist([], [item({ skillMdHash: 'h2', primarySourceUrl: 'u2' })], new Set())
    expect(out).toHaveLength(1)
    expect(out[0].status).toBe('ready')
  })
})

describe('selectWave', () => {
  it('returns up to N ready/drifted items, popularity-desc', () => {
    const items = [
      item({ skillMdHash: 'a', primarySourceUrl: 'ua', stars: 1 }),
      item({ skillMdHash: 'b', primarySourceUrl: 'ub', stars: 9 }),
      item({ skillMdHash: 'c', primarySourceUrl: 'uc', status: 'graded', stars: 99 }),
      item({ skillMdHash: 'd', primarySourceUrl: 'ud', status: 'drifted', stars: 5 }),
    ]
    expect(selectWave(items, 2).map((i) => i.skillMdHash)).toEqual(['b', 'd'])
  })
})
