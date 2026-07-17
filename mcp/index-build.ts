import type { Catalog, CatalogEntry } from '../hub/schema.js'

export interface SkillIndex {
  byHash: Map<string, CatalogEntry>
  byName: Map<string, CatalogEntry[]>
}

// Pre-computed lookup over the graded catalog.
//   byHash — primary identity + provenance (1:1). null-hash entries are absent here.
//   byName — fallback + collision handling (1:many); every entry appears.
export function buildIndex(catalog: Catalog): SkillIndex {
  const byHash = new Map<string, CatalogEntry>()
  const byName = new Map<string, CatalogEntry[]>()
  for (const e of catalog.skills) {
    if (e.skillMdHash) byHash.set(e.skillMdHash, e)
    const group = byName.get(e.name)
    if (group) group.push(e)
    else byName.set(e.name, [e])
  }
  return { byHash, byName }
}
