import { describe, it, expect } from 'vitest'
import { buildBatchInput } from './grade-input.js'
import type { WorklistItem } from './dedup.js'

const item = (h: string): WorklistItem => ({ skillMdHash: h, name: 'foo', primarySourceUrl: 'https://u/' + h, mirrors: [], repo: 'a/b', path: 'SKILL.md', stars: 1, pushedAt: '', size: 1, status: 'ready', lastSeen: 'now' })

describe('buildBatchInput', () => {
  it('pairs each wave item with its cached content', () => {
    const out = buildBatchInput([item('h1')], (h) => (h === 'h1' ? '# content' : ''))
    expect(out).toEqual([{ hash: 'h1', name: 'foo', sourceUrl: 'https://u/h1', content: '# content' }])
  })
})
