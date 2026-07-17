// One-off: resolve each evaluations.json entry's SKILL.md, compute skillMdHash, write it back.
// Unresolvable entries get skillMdHash: null (they answer as `reference` via the name index).
// Re-runnable: skips entries that already have a non-null hash unless --force is passed.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashSkillMd } from '../mcp/normalize.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const EVALS = join(HERE, '../hub/evaluations.json')
const force = process.argv.includes('--force')

interface Eval { name: string; sourceUrl?: string; skillMdHash?: string | null }

function clawhubParts(sourceUrl: string): { handle: string; slug: string } | null {
  // ponytail: `/skills/` is optional — some sourceUrls are clawhub.ai/<handle>/<slug>. Both resolve via the same API.
  const m = sourceUrl.match(/clawhub\.ai\/([^/]+)\/(?:skills\/)?([^/?#]+)/)
  return m ? { handle: m[1], slug: m[2] } : null
}

async function fetchClawhubSkillMd(handle: string, slug: string): Promise<string | null> {
  const url = `https://clawhub.ai/api/v1/skills/${encodeURIComponent(slug)}?owner=${encodeURIComponent(handle)}`
  try {
    const r = await fetch(url, { headers: { accept: 'application/json' } })
    if (!r.ok) return null
    const j = (await r.json()) as { skill?: { description?: string } }
    const desc = j.skill?.description
    return typeof desc === 'string' && desc.trim() ? desc : null
  } catch {
    return null
  }
}

async function main() {
  const evals = JSON.parse(readFileSync(EVALS, 'utf8')) as Eval[]
  let resolved = 0, nulled = 0, skipped = 0
  for (const e of evals) {
    if (!force && e.skillMdHash) { skipped++; continue }
    const parts = e.sourceUrl ? clawhubParts(e.sourceUrl) : null
    let content: string | null = null
    if (parts) content = await fetchClawhubSkillMd(parts.handle, parts.slug)
    if (content) { e.skillMdHash = hashSkillMd(content); resolved++ }
    else { e.skillMdHash = null; nulled++; console.warn(`unresolved: ${e.name} (${e.sourceUrl ?? 'no source'})`) }
  }
  writeFileSync(EVALS, JSON.stringify(evals, null, 2) + '\n')
  console.log(`backfill done — resolved:${resolved} null:${nulled} skipped:${skipped} total:${evals.length}`)
}

main().catch((err) => { console.error(err); process.exit(1) })
