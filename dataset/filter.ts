import { parse as parseYaml } from 'yaml'
import { hashSkillMd } from '../mcp/normalize.js'
import type { Candidate } from './adapters/types.js'

export interface FetchedCandidate extends Candidate {
  content: string
  skillMdHash: string
  name: string
  size: number
}

const FRONTMATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/

function frontmatter(content: string): { fm: Record<string, unknown> | null; body: string } {
  const m = content.match(FRONTMATTER)
  if (!m) return { fm: null, body: '' }
  try {
    return { fm: (parseYaml(m[1]) as Record<string, unknown>) ?? null, body: (m[2] ?? '').trim() }
  } catch {
    return { fm: null, body: '' }
  }
}

export function hashCandidate(c: Candidate, content: string): FetchedCandidate {
  const { fm } = frontmatter(content)
  const name = typeof fm?.name === 'string' && fm.name.trim() ? fm.name.trim() : (c.repo.split('/')[1] ?? 'skill')
  return { ...c, content, skillMdHash: hashSkillMd(content), name, size: content.length }
}

// Deterministic validity gate — no LLM. A real skill needs a name+description
// frontmatter and a non-empty body. Junk is dropped with a reason for the log.
export function filterValid(fc: FetchedCandidate): { ok: boolean; reason?: string } {
  const { fm, body } = frontmatter(fc.content)
  if (!fm) return { ok: false, reason: 'no-frontmatter' }
  if (typeof fm.name !== 'string' || !fm.name.trim()) return { ok: false, reason: 'no-name' }
  if (typeof fm.description !== 'string' || !fm.description.trim()) return { ok: false, reason: 'no-description' }
  if (!body) return { ok: false, reason: 'empty-body' }
  return { ok: true }
}
