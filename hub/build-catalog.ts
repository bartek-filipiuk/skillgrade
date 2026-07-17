// Assembles hub/catalog.json (and preview.html) from hub/evaluations.json.
//
// Split of responsibility:
//   - evaluations.json  = the MODEL's judgment  (category, badges, tagline, highlights)
//   - runPreChecks      = deterministic FACTS   (frontmatter, file count, sizes, flags)
//   - this builder       = mechanical assembly   (overall grade, taxonomy, validation)
//
// The model never computes the overall grade; code does (overallGrade). Run:
//   pnpm tsx hub/build-catalog.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPreChecks } from '../checks/prechecks.js'
import { CatalogSchema, TAXONOMY, overallGrade, slugify, type Catalog, type CatalogEntry } from './schema.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const RUBRIC_VERSION = JSON.parse(readFileSync(join(HERE, '../rubric/skill/meta.json'), 'utf8')).version as string
const EVALUATOR = { mode: 'claude-code-native', model: 'claude-fable-5' }

interface EvalInput {
  name: string
  source: string
  sourceUrl?: string
  kind: 'skill' | 'fixture'
  category: CatalogEntry['category']
  tagline: string
  verdict?: string
  badges: CatalogEntry['badges']
  highlights: CatalogEntry['highlights']
  evaluator?: CatalogEntry['evaluator'] // who actually graded it; defaults to native
  evaluatedAt?: string // override the build timestamp (e.g. from a CLI report)
  preCheck?: CatalogEntry['preCheck'] // pre-supplied facts; else runPreChecks(e.source)
  featured?: boolean
  featuredOrder?: number
  skillMdHash?: string | null // normalized SKILL.md hash; carried from evaluations.json
  popularity?: number
  mirrors?: string[]
  discoveredVia?: string | null
}

function buildEntry(e: EvalInput, evaluatedAt: string): CatalogEntry {
  // Prefer facts carried in the eval input (from a CLI report) so the catalog is
  // self-contained — a public skill's original need not be present locally.
  let preCheck = e.preCheck
  if (!preCheck) {
    const pc = runPreChecks(e.source)
    const skillMd = pc.files.find((f) => f.path === 'SKILL.md')
    preCheck = {
      frontmatterValid: pc.frontmatter.valid,
      fileCount: pc.files.length,
      skillMdBytes: skillMd?.bytes ?? 0,
      criticalFlags: pc.flags.filter((f) => f.severity === 'critical').length,
      majorFlags: pc.flags.filter((f) => f.severity === 'major').length,
    }
  }
  return {
    ...e,
    overall: overallGrade(e.badges),
    preCheck,
    rubricVersion: RUBRIC_VERSION,
    evaluatedAt: e.evaluatedAt ?? evaluatedAt,
    evaluator: e.evaluator ?? EVALUATOR,
    skillMdHash: e.skillMdHash ?? null,
    popularity: e.popularity ?? 0,
    mirrors: e.mirrors ?? [],
    discoveredVia: e.discoveredVia ?? null,
    slug: slugify(e.name),
  }
}

export function buildCatalog(evals: EvalInput[], now: string): Catalog {
  const catalog: Catalog = {
    generatedAt: now,
    rubricVersion: RUBRIC_VERSION,
    taxonomy: TAXONOMY.map((t) => ({ id: t.id, label: t.label, description: t.description })),
    skills: evals.map((e) => buildEntry(e, now)),
  }
  return CatalogSchema.parse(catalog) // fail loud if any entry is malformed
}

function renderPreview(catalog: Catalog, template: string): string {
  // Escape '<' so a skill name/tagline containing "</script>" can't break out of
  // the <script type="application/json"> block it's injected into.
  const json = JSON.stringify(catalog).replace(/</g, '\\u003c')
  return template.replace('/*CATALOG_JSON*/', json)
}

// CLI entrypoint (skipped when imported by tests)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const evals = JSON.parse(readFileSync(join(HERE, 'evaluations.json'), 'utf8')) as EvalInput[]
  const catalog = buildCatalog(evals, new Date().toISOString())
  writeFileSync(join(HERE, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n')
  const template = readFileSync(join(HERE, 'index.template.html'), 'utf8')
  writeFileSync(join(HERE, 'index.html'), renderPreview(catalog, template))
  const grades = catalog.skills.reduce<Record<string, number>>((a, s) => ((a[s.overall] = (a[s.overall] ?? 0) + 1), a), {})
  console.log(`catalog.json: ${catalog.skills.length} skills, overall grades ${JSON.stringify(grades)}`)
  console.log('index.html written')
}
