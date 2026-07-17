import { createHash } from 'node:crypto'

// The canonical form used on BOTH sides of the trust boundary: our backfill and the
// consumer's agent MUST apply these exact rules, or hashes never match. Keep it simple.
//   1. strip a leading UTF-8 BOM
//   2. CRLF and lone CR -> LF
//   3. rstrip trailing whitespace/newlines at end of file
export function normalizeSkillMd(content: string): string {
  let s = content
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)
  s = s.replace(/\r\n?/g, '\n')
  s = s.replace(/[\s﻿\xA0]+$/, '')
  return s
}

export function hashSkillMd(content: string): string {
  return createHash('sha256').update(normalizeSkillMd(content), 'utf8').digest('hex')
}
