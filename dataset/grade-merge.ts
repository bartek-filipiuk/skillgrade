import { loadRubric } from '../src/rubric.js'
import { aggregate } from '../src/aggregate.js'
import type { ReportVerdict, DimensionKey, Letter } from '../src/types.js'
import type { WorklistItem } from './dedup.js'

// The EvalInput shape consumed by hub/build-catalog.ts (kept in sync with it).
export interface EvalInput {
  name: string
  source: string
  sourceUrl?: string
  kind: 'skill'
  category: string
  tagline: string
  verdict?: string
  badges: { security: Letter | 'not-evaluated'; quality: Letter | 'not-evaluated'; hygiene: Letter | 'not-evaluated'; effectiveness: 'not-evaluated' }
  highlights: { check: string; status: string; summary: string }[]
  evaluator?: { mode: string; model: string }
  evaluatedAt?: string
  preCheck?: { frontmatterValid: boolean; fileCount: number; skillMdBytes: number; criticalFlags: number; majorFlags: number }
  popularity?: number
  mirrors?: string[]
  discoveredVia?: string | null
  skillMdHash?: string | null
}

export interface WaveVerdicts {
  skillMdHash: string
  category: string
  tagline: string
  verdict: string
  verdicts: ReportVerdict[]
}

// Turn one skill's per-check verdicts into a catalog EvalInput. Badges come from
// aggregate() (code, not the model). Merged into evals by hash so a re-grade
// (drift) replaces the old entry rather than duplicating it.
export function mergeGraded(
  evals: EvalInput[],
  waveResults: WaveVerdicts[],
  items: Map<string, WorklistItem>,
  rubricDir: string,
  now: string,
): EvalInput[] {
  const rubric = loadRubric(rubricDir)
  // Hashless existing entries have no key to merge on — pass them through untouched
  // rather than collapsing them all under one null key (data loss).
  const passthrough = evals.filter((e) => !e.skillMdHash)
  const byHash = new Map(evals.filter((e) => e.skillMdHash).map((e) => [e.skillMdHash, e]))
  for (const w of waveResults) {
    const item = items.get(w.skillMdHash)
    if (!item) continue
    const badges = { effectiveness: 'not-evaluated' } as EvalInput['badges']
    for (const dim of rubric.dimensions as { key: DimensionKey; checks: Parameters<typeof aggregate>[0] }[]) {
      const vs = w.verdicts.filter((v) => dim.checks.some((c) => c.id === v.check))
      badges[dim.key] = aggregate(dim.checks, vs).letter
    }
    // Keep only schema-valid highlights: fail/warning, real check id, deduped by
    // check, summary clamped to 1..200 chars so CatalogSchema.parse can't reject the build.
    const seen = new Set<string>()
    const highlights = w.verdicts
      .filter((v) => (v.status === 'fail' || v.status === 'warning') && /^[SQH]\d{2}$/.test(v.check))
      .filter((v) => !seen.has(v.check) && seen.add(v.check))
      .map((v) => ({ check: v.check, status: v.status, summary: (v.note?.trim() || v.check).slice(0, 200) }))
      .slice(0, 3)
    byHash.set(w.skillMdHash, {
      name: item.name,
      source: `GitHub · ${item.repo}${item.stars ? ` · ${item.stars}★` : ''}`,
      sourceUrl: item.primarySourceUrl,
      kind: 'skill',
      category: w.category,
      tagline: w.tagline,
      verdict: w.verdict,
      badges,
      highlights,
      evaluator: { mode: 'claude-code-native', model: 'claude-sonnet-5' },
      evaluatedAt: now,
      preCheck: { frontmatterValid: true, fileCount: 1, skillMdBytes: item.size, criticalFlags: 0, majorFlags: 0 },
      popularity: item.stars,
      mirrors: item.mirrors,
      discoveredVia: 'github',
      skillMdHash: w.skillMdHash,
    })
  }
  return [...passthrough, ...byHash.values()]
}
