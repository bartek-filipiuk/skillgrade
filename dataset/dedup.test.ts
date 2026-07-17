import { describe, it, expect } from 'vitest'
import { dedupe } from './dedup.js'
import { hashCandidate } from './filter.js'
import type { Candidate } from './adapters/types.js'

const md = '---\nname: foo\ndescription: d\n---\n# Foo\nx'
const mk = (repo: string, stars: number): Candidate => ({ sourceUrl: `https://github.com/${repo}/blob/main/SKILL.md`, repo, path: 'SKILL.md', ref: 'main', stars, pushedAt: '' })

describe('dedupe', () => {
  it('collapses identical content to one item, primary = higher stars, others as mirrors', () => {
    const items = dedupe([hashCandidate(mk('a/b', 3), md), hashCandidate(mk('c/d', 9), md)], 'now')
    expect(items).toHaveLength(1)
    expect(items[0].primarySourceUrl).toContain('c/d')
    expect(items[0].mirrors).toEqual(['https://github.com/a/b/blob/main/SKILL.md'])
    expect(items[0].stars).toBe(9)
    expect(items[0].status).toBe('ready')
  })
})
