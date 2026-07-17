import { z } from 'zod'

export const REPORT_BASE = 'https://skillgrade.dev'

export const FindingSchema = z.object({
  check: z.string(),
  dimension: z.enum(['security', 'quality', 'hygiene']),
  status: z.enum(['fail', 'warning']),
  summary: z.string(),
})

const gradedBadges = z.object({ security: z.string(), quality: z.string(), hygiene: z.string() })

export const SkillResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('verified'),
    name: z.string(),
    category: z.string(),
    overall: z.string(),
    badges: gradedBadges,
    verdict: z.string().optional(),
    findings: z.array(FindingSchema),
    gradedHash: z.string(),
    rubricVersion: z.string(),
    evaluatedAt: z.string(),
    reportUrl: z.string(),
    sourceUrl: z.string().optional(),
  }),
  z.object({
    status: z.literal('drift'),
    name: z.string(),
    gradedOverall: z.string(),
    gradedHash: z.string(),
    yourHash: z.string(),
    message: z.string(),
    reportUrl: z.string(),
  }),
  z.object({
    status: z.literal('reference'),
    name: z.string(),
    overall: z.string(),
    badges: gradedBadges,
    verdict: z.string().optional(),
    findings: z.array(FindingSchema),
    message: z.string(),
    reportUrl: z.string(),
    sourceUrl: z.string().optional(),
  }),
  z.object({
    status: z.literal('unknown'),
    name: z.string().optional(),
    message: z.string(),
  }),
])

export const AuditReportSchema = z.object({
  summary: z.object({
    total: z.number(),
    verified: z.number(),
    drifted: z.number(),
    unknown: z.number(),
    gradeCounts: z.record(z.string(), z.number()),
  }),
  skills: z.array(SkillResultSchema),
})

export const SearchHitSchema = z.object({
  name: z.string(),
  overall: z.string(),
  category: z.string(),
  reportUrl: z.string(),
})

export type Finding = z.infer<typeof FindingSchema>
export type SkillResult = z.infer<typeof SkillResultSchema>
export type AuditReport = z.infer<typeof AuditReportSchema>
export type SearchHit = z.infer<typeof SearchHitSchema>
