import { describe, it, expect } from 'vitest'
import { assertAllowedUrl, fetchSkillMd, MAX_BYTES } from './fetch.js'
import type { Candidate } from './adapters/types.js'

const cand = (sourceUrl: string): Candidate => ({ sourceUrl, repo: 'a/b', path: 'SKILL.md', ref: 'main', stars: 1, pushedAt: '' })

describe('assertAllowedUrl', () => {
  it('accepts github raw + api', () => {
    expect(() => assertAllowedUrl('https://raw.githubusercontent.com/a/b/main/SKILL.md')).not.toThrow()
    expect(() => assertAllowedUrl('https://api.github.com/x')).not.toThrow()
  })
  it('rejects non-https, other hosts, localhost, metadata IP, bracketed ::1', () => {
    for (const u of ['http://raw.githubusercontent.com/x', 'https://evil.example/x', 'https://localhost/x', 'https://169.254.169.254/x', 'https://127.0.0.1/x', 'https://[::1]/x']) {
      expect(() => assertAllowedUrl(u)).toThrow()
    }
  })
})

describe('fetchSkillMd', () => {
  it('rejects an oversize body without returning content', async () => {
    const fetchFn = (async () => new Response('x'.repeat(MAX_BYTES + 1), { status: 200 })) as unknown as typeof fetch
    expect(await fetchSkillMd(cand('https://raw.githubusercontent.com/a/b/main/SKILL.md'), { fetchFn })).toBeNull()
  })
  it('returns null on 304 (caller keeps cache)', async () => {
    const fetchFn = (async () => new Response('', { status: 304 })) as unknown as typeof fetch
    expect(await fetchSkillMd(cand('https://raw.githubusercontent.com/a/b/main/SKILL.md'), { fetchFn, etag: 'W/"x"' })).toBeNull()
  })
  it('returns content + etag on 200', async () => {
    const fetchFn = (async () => new Response('# hi', { status: 200, headers: { etag: 'W/"y"' } })) as unknown as typeof fetch
    const r = await fetchSkillMd(cand('https://raw.githubusercontent.com/a/b/main/SKILL.md'), { fetchFn })
    expect(r).toEqual({ content: '# hi', etag: 'W/"y"' })
  })
  it('returns null (does not throw) when the body read rejects', async () => {
    const fetchFn = (async () => ({
      status: 200,
      ok: true,
      headers: new Headers(),
      text: () => Promise.reject(new Error('stream')),
    })) as unknown as typeof fetch
    await expect(fetchSkillMd(cand('https://raw.githubusercontent.com/a/b/main/SKILL.md'), { fetchFn })).resolves.toBeNull()
  })
  it('refuses a candidate whose sourceUrl host is not allowlisted', async () => {
    const fetchFn = (async () => new Response('x', { status: 200 })) as unknown as typeof fetch
    // github blob URLs are rewritten to raw; a non-github host must be refused
    expect(await fetchSkillMd(cand('https://evil.example/a/b/SKILL.md'), { fetchFn })).toBeNull()
  })
})
