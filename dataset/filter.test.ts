import { describe, it, expect } from 'vitest'
import { hashCandidate, filterValid } from './filter.js'
import type { Candidate } from './adapters/types.js'

const c: Candidate = { sourceUrl: 'https://github.com/a/b/blob/main/SKILL.md', repo: 'a/b', path: 'SKILL.md', ref: 'main', stars: 3, pushedAt: '' }
const good = '---\nname: foo\ndescription: does a thing\n---\n# Foo\n\nBody.'

describe('hashCandidate', () => {
  it('extracts frontmatter name and hashes', () => {
    const fc = hashCandidate(c, good)
    expect(fc.name).toBe('foo')
    expect(fc.skillMdHash).toMatch(/^[0-9a-f]{64}$/)
    expect(fc.size).toBe(good.length)
  })
})

describe('filterValid', () => {
  it('accepts a valid skill', () => expect(filterValid(hashCandidate(c, good)).ok).toBe(true))
  it('rejects missing frontmatter', () => {
    const r = filterValid(hashCandidate(c, '# no frontmatter'))
    expect(r).toEqual({ ok: false, reason: 'no-frontmatter' })
  })
  it('rejects missing name/description', () => {
    expect(filterValid(hashCandidate(c, '---\nname: foo\n---\nx')).ok).toBe(false)
  })
  it('rejects empty body', () => {
    expect(filterValid(hashCandidate(c, '---\nname: foo\ndescription: d\n---\n')).ok).toBe(false)
  })
})
