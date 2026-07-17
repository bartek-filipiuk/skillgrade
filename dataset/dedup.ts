import type { FetchedCandidate } from './filter.js'

export interface WorklistItem {
  skillMdHash: string
  name: string
  primarySourceUrl: string
  mirrors: string[]
  repo: string
  path: string
  stars: number
  pushedAt: string
  size: number
  status: 'ready' | 'filtered-out' | 'graded' | 'drifted'
  filterReason?: string
  lastSeen: string
  gradedAt?: string
}

// Same content (hash) from multiple sources = one item. Primary = highest stars;
// the rest become mirrors so provenance keeps every place the skill lives.
export function dedupe(fetched: FetchedCandidate[], now: string): WorklistItem[] {
  const byHash = new Map<string, FetchedCandidate[]>()
  for (const fc of fetched) {
    const g = byHash.get(fc.skillMdHash)
    if (g) g.push(fc)
    else byHash.set(fc.skillMdHash, [fc])
  }
  const items: WorklistItem[] = []
  for (const [hash, group] of byHash) {
    const sorted = [...group].sort((a, b) => b.stars - a.stars)
    const primary = sorted[0]
    items.push({
      skillMdHash: hash,
      name: primary.name,
      primarySourceUrl: primary.sourceUrl,
      mirrors: sorted.slice(1).map((x) => x.sourceUrl),
      repo: primary.repo,
      path: primary.path,
      stars: primary.stars,
      pushedAt: primary.pushedAt,
      size: primary.size,
      status: 'ready',
      lastSeen: now,
    })
  }
  return items
}
