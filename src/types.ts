import { z } from 'zod'

export const EvidenceSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive(),
  quote: z.string().min(1),
})

export const VerdictSchema = z
  .object({
    check: z.string().regex(/^[SQH]\d{2}$/),
    status: z.enum(['pass', 'fail', 'warning', 'not-applicable']),
    evidence: EvidenceSchema.optional(),
    note: z.string().optional(),
  })
  .refine((v) => !['fail', 'warning'].includes(v.status) || v.evidence !== undefined, {
    message: 'fail/warning requires evidence',
  })

export const DimensionVerdictsSchema = z.object({ verdicts: z.array(VerdictSchema) })

export type Verdict = z.infer<typeof VerdictSchema>
export type CheckStatus = Verdict['status'] | 'evaluation-error'
export type Severity = 'critical' | 'major' | 'minor'
export type Letter = 'A' | 'B' | 'C' | 'D' | 'F'
export type DimensionKey = 'security' | 'quality' | 'hygiene'

export interface CheckDef {
  id: string
  title: string
  severity: Severity
  weight: number
  body: string // pełna treść sekcji checka (definicja + przykłady + instrukcja)
}

export interface Dimension {
  key: DimensionKey
  checks: CheckDef[]
  raw: string // cały plik wymiaru — trafia do promptu
}

export interface PreCheckFlag {
  rule: string
  severity: Severity
  file: string
  line: number
  excerpt: string
}

export interface PreCheckReport {
  files: { path: string; bytes: number; binary: boolean }[]
  frontmatter: { valid: boolean; errors: string[] }
  flags: PreCheckFlag[]
}

export interface ReportVerdict {
  check: string
  status: CheckStatus
  evidence?: z.infer<typeof EvidenceSchema>
  note?: string
}

export interface Report {
  subject: { type: 'skill'; name: string; source: string; contentHash: string }
  rubricVersion: string
  evaluator: { model: string; runs: number; mode: 'cli' | 'claude-code' | 'no-llm' }
  badges: Record<DimensionKey, Letter | 'not-evaluated'> & { effectiveness: 'not-evaluated' }
  verdicts: ReportVerdict[]
  preChecks: PreCheckReport
  createdAt: string
}
