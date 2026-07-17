import { describe, it, expect } from 'vitest'
import { normalizeSkillMd, hashSkillMd } from './normalize.js'

const canonical = '---\nname: foo\n---\n# Foo\n\nBody line.'

describe('normalizeSkillMd', () => {
  it('is stable across CRLF, lone CR, trailing newlines and BOM', () => {
    const crlf = canonical.replace(/\n/g, '\r\n')
    const cr = canonical.replace(/\n/g, '\r')
    const trailing = canonical + '\n\n  \n'
    const bom = '﻿' + canonical
    const h = hashSkillMd(canonical)
    expect(hashSkillMd(crlf)).toBe(h)
    expect(hashSkillMd(cr)).toBe(h)
    expect(hashSkillMd(trailing)).toBe(h)
    expect(hashSkillMd(bom)).toBe(h)
  })

  it('changes when the content changes', () => {
    expect(hashSkillMd(canonical)).not.toBe(hashSkillMd(canonical + ' extra'))
  })

  it('produces lowercase 64-char hex', () => {
    expect(hashSkillMd(canonical)).toMatch(/^[0-9a-f]{64}$/)
  })
})
