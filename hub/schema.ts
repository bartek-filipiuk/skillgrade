import { z } from 'zod'

// Data contract between the trust evaluator and the SkillHub frontend.
// The hub layer depends on the evaluator (imports its types), never the reverse.

export const LETTER = z.enum(['A', 'B', 'C', 'D', 'F'])
export const GRADE = z.union([LETTER, z.literal('not-evaluated')])

// Fixed taxonomy — the evaluator assigns each skill exactly one category id.
// Kept here as the single source of truth; the hub renders labels from it.
export const TAXONOMY = [
  { id: 'code-quality', label: 'Code Review & Quality', description: 'Reviewing diffs, finding bugs, refactoring, enforcing standards.' },
  { id: 'security', label: 'Security & Audits', description: 'Vulnerability assessment, threat modeling, pentest, trust boundaries.' },
  { id: 'build', label: 'Build & Prototyping', description: 'From idea to working app, UI generation, feature scaffolding.' },
  { id: 'deployment', label: 'Deployment & Ops', description: 'Shipping, hosting, infra, CI/CD, self-hosting.' },
  { id: 'content', label: 'Content & Writing', description: 'Blogs, marketing, humanizing text, CVs, docs.' },
  { id: 'media', label: 'Video & Media', description: 'Video pipelines, voiceover, narrative, thumbnails.' },
  { id: 'project-intel', label: 'Project Intelligence', description: 'Data extraction, dashboards, project radar, reporting.' },
  { id: 'workflow', label: 'Dev Workflow & Automation', description: 'Loops, browser automation, orchestration, environment setup.' },
  { id: 'integrations', label: 'Integrations & CRM', description: 'External APIs, CRM, content platforms, connectors.' },
  { id: 'meta', label: 'Meta & Skill Tooling', description: 'Skills about skills: protocols, trust, tooling.' },
] as const

export const CATEGORY_IDS = TAXONOMY.map((t) => t.id) as [string, ...string[]]

export const HighlightSchema = z.object({
  check: z.string().regex(/^[SQH]\d{2}$/),
  status: z.enum(['pass', 'fail', 'warning', 'not-applicable', 'evaluation-error']),
  summary: z.string().min(1).max(200),
})

export const CatalogEntrySchema = z.object({
  name: z.string().min(1),
  source: z.string().min(1),
  kind: z.enum(['skill', 'fixture']), // fixtures demonstrate the full badge range honestly
  category: z.enum(CATEGORY_IDS),
  tagline: z.string().min(1).max(140),
  badges: z.object({
    security: GRADE,
    quality: GRADE,
    hygiene: GRADE,
    effectiveness: z.literal('not-evaluated'),
  }),
  overall: GRADE, // worst of the graded dimensions; computed by the builder
  highlights: z.array(HighlightSchema).max(6),
  preCheck: z.object({
    frontmatterValid: z.boolean(),
    fileCount: z.number().int().nonnegative(),
    skillMdBytes: z.number().int().nonnegative(),
    criticalFlags: z.number().int().nonnegative(),
    majorFlags: z.number().int().nonnegative(),
  }),
  rubricVersion: z.string(),
  evaluatedAt: z.string(),
  evaluator: z.object({ mode: z.string(), model: z.string() }),
})

export const CatalogSchema = z.object({
  generatedAt: z.string(),
  rubricVersion: z.string(),
  taxonomy: z.array(z.object({ id: z.string(), label: z.string(), description: z.string() })),
  skills: z.array(CatalogEntrySchema),
})

export type Grade = z.infer<typeof GRADE>
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>
export type Catalog = z.infer<typeof CatalogSchema>

// Worst graded dimension = the card's headline grade. 'not-evaluated' is skipped;
// if every dimension is unevaluated the overall is 'not-evaluated' too.
const ORDER: Grade[] = ['A', 'B', 'C', 'D', 'F']
export function overallGrade(badges: { security: Grade; quality: Grade; hygiene: Grade }): Grade {
  const graded = [badges.security, badges.quality, badges.hygiene].filter(
    (g): g is Exclude<Grade, 'not-evaluated'> => g !== 'not-evaluated',
  )
  if (graded.length === 0) return 'not-evaluated'
  return graded.reduce((worst, g) => (ORDER.indexOf(g) > ORDER.indexOf(worst) ? g : worst))
}
