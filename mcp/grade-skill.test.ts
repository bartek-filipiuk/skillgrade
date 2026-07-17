import { describe, it, expect, vi } from 'vitest'
import { buildIndex } from './index-build.js'
import { makeGradeSkill } from './grade-skill.js'
import { hashSkillMd } from './normalize.js'
import type { Catalog } from '../hub/schema.js'

const md = '---\nname: foo\ndescription: d\n---\n# Foo\nbody'
const known = { name: 'foo', source: 's', kind: 'skill', category: 'workflow', tagline: 't', badges: { security: 'A', quality: 'A', hygiene: 'A', effectiveness: 'not-evaluated' }, overall: 'A', highlights: [], preCheck: { frontmatterValid: true, fileCount: 1, skillMdBytes: 1, criticalFlags: 0, majorFlags: 0 }, rubricVersion: '0.1.2', evaluatedAt: 'now', evaluator: { mode: 'm', model: 'x' }, skillMdHash: hashSkillMd(md), slug: 'foo', popularity: 0, mirrors: [], discoveredVia: null }
const catalog = { generatedAt: 'now', rubricVersion: '0.1.2', taxonomy: [], skills: [known] } as unknown as Catalog

function mk(over: Partial<any> = {}) {
  const charge = vi.fn(async () => ({ ok: true, remaining: 4 }))
  const refund = vi.fn(async () => {})
  const gradeContent = vi.fn(async () => ({ skillMdHash: 'h', overall: 'B', badges: { security: 'A', quality: 'B', hygiene: 'B' }, findings: [] }))
  const h = makeGradeSkill({ index: buildIndex(catalog), gradeContent, charge, refund, maxBytes: 1000, ...over })
  return { h, charge, refund, gradeContent }
}

describe('grade_skill', () => {
  it('catalog hit returns the stored grade and does NOT charge', async () => {
    const { h, charge } = mk()
    const r = await h.handle({ content: md, token: 't' })
    expect(r).toMatchObject({ charged: false, source: 'catalog', overall: 'A' })
    expect(charge).not.toHaveBeenCalled()
  })
  it('new content: charges, grades, returns remaining', async () => {
    const { h, charge, gradeContent } = mk()
    const r = await h.handle({ content: '---\nname: new\ndescription: d\n---\n# N\nx', token: 't' })
    expect(charge).toHaveBeenCalledWith('t')
    expect(gradeContent).toHaveBeenCalled()
    expect(r).toMatchObject({ charged: true, remaining: 4, overall: 'B' })
  })
  it('no credits -> error, no grade', async () => {
    const { h, gradeContent } = mk({ charge: vi.fn(async () => ({ ok: false, reason: 'no-credits' })) })
    const r = await h.handle({ content: '---\nname: new2\ndescription: d\n---\n# N\nx', token: 't' })
    expect(r).toMatchObject({ error: 'no-credits' })
    expect(gradeContent).not.toHaveBeenCalled()
  })
  it('invalid token from charge -> error, no grade', async () => {
    const { h, gradeContent } = mk({ charge: vi.fn(async () => ({ ok: false, reason: 'invalid-token' })) })
    const r = await h.handle({ content: '---\nname: new4\ndescription: d\n---\n# N\nx', token: 't' })
    expect(r).toMatchObject({ error: 'invalid-token' })
    expect(gradeContent).not.toHaveBeenCalled()
  })
  it('missing token -> invalid-token', async () => {
    const { h } = mk()
    expect(await h.handle({ content: 'x', token: undefined })).toMatchObject({ error: 'invalid-token' })
  })
  it('oversize -> too-large, no charge', async () => {
    const { h, charge } = mk({ maxBytes: 5 })
    expect(await h.handle({ content: 'way too long content', token: 't' })).toMatchObject({ error: 'too-large' })
    expect(charge).not.toHaveBeenCalled()
  })
  it('grade failure -> refund + grade-failed', async () => {
    const { h, refund } = mk({ gradeContent: vi.fn(async () => { throw new Error('llm down') }) })
    const r = await h.handle({ content: '---\nname: new3\ndescription: d\n---\n# N\nx', token: 't' })
    expect(r).toMatchObject({ error: 'grade-failed' })
    expect(refund).toHaveBeenCalled()
  })
})
