import { describe, it, expect } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeGraded } from './grade-merge.js'
import type { WorklistItem } from './dedup.js'

const RUBRIC = join(dirname(fileURLToPath(import.meta.url)), '../rubric/skill')
const item = (h: string): WorklistItem => ({ skillMdHash: h, name: 'foo', primarySourceUrl: 'https://u', mirrors: ['https://m'], repo: 'a/b', path: 'SKILL.md', stars: 7, pushedAt: '', size: 1, status: 'ready', lastSeen: 'now' })

describe('mergeGraded', () => {
  it('builds an EvalInput with badges from aggregate + provenance, merged by hash', () => {
    const items = new Map<string, WorklistItem>([['h1', item('h1')]])
    const out = mergeGraded([], [{
      skillMdHash: 'h1', category: 'workflow', tagline: 'a tagline', verdict: 'a verdict',
      verdicts: [], // empty verdicts → aggregate yields all-error → real letters, still a valid entry
    }], items, RUBRIC, 'now')
    expect(out).toHaveLength(1)
    expect(out[0].skillMdHash).toBe('h1')
    expect(out[0].sourceUrl).toBe('https://u')
    expect(out[0].popularity).toBe(7)
    expect(out[0].mirrors).toEqual(['https://m'])
    expect(out[0].badges.effectiveness).toBe('not-evaluated')
    expect(['A','B','C','D','F']).toContain(out[0].badges.security)
  })
  it('replaces an existing entry with the same hash (drift re-grade)', () => {
    const items = new Map<string, WorklistItem>([['h1', item('h1')]])
    const existing = [{ name: 'foo', source: 'old', kind: 'skill', category: 'workflow', tagline: 'old', badges: { security: 'F', quality: 'F', hygiene: 'F', effectiveness: 'not-evaluated' }, highlights: [], skillMdHash: 'h1' } as any]
    const out = mergeGraded(existing, [{ skillMdHash: 'h1', category: 'workflow', tagline: 'new', verdict: 'v', verdicts: [] }], items, RUBRIC, 'now')
    expect(out).toHaveLength(1)
    expect(out[0].tagline).toBe('new')
  })
})
