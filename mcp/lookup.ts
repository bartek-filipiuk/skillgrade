import type { CatalogEntry } from '../hub/schema.js'
import type { SkillIndex } from './index-build.js'
import { REPORT_BASE, type Finding, type SkillResult, type AuditReport, type SearchHit } from './schema.js'

function dimensionOf(check: string): Finding['dimension'] {
  if (check.startsWith('S')) return 'security'
  if (check.startsWith('Q')) return 'quality'
  return 'hygiene'
}

function findings(e: CatalogEntry): Finding[] {
  return e.highlights
    .filter((h): h is typeof h & { status: 'fail' | 'warning' } => h.status === 'fail' || h.status === 'warning')
    .map((h) => ({ check: h.check, dimension: dimensionOf(h.check), status: h.status, summary: h.summary }))
}

function reportUrl(name: string): string {
  return `${REPORT_BASE}/#skill-${encodeURIComponent(name)}`
}

function gradedBadges(e: CatalogEntry) {
  return { security: e.badges.security, quality: e.badges.quality, hygiene: e.badges.hygiene }
}

function verified(e: CatalogEntry): SkillResult {
  return {
    status: 'verified', name: e.name, category: e.category, overall: e.overall,
    badges: gradedBadges(e), verdict: e.verdict, findings: findings(e),
    gradedHash: e.skillMdHash as string, rubricVersion: e.rubricVersion, evaluatedAt: e.evaluatedAt,
    reportUrl: reportUrl(e.name), sourceUrl: e.sourceUrl,
  }
}

export function lookupSkill(index: SkillIndex, q: { hash?: string; name?: string }): SkillResult {
  if (q.hash) {
    const hit = index.byHash.get(q.hash)
    if (hit) return verified(hit)
  }
  if (q.name) {
    const group = index.byName.get(q.name)
    if (group && group.length > 0) {
      const e = group[0]
      if (q.hash) {
        // name matched but the hash didn't — the user has a different/modified copy
        return {
          status: 'drift', name: e.name, gradedOverall: e.overall,
          gradedHash: (e.skillMdHash as string) ?? 'unknown', yourHash: q.hash,
          message: `You have a modified or different version than the one we graded (was ${e.overall}). ` +
            `We can't vouch for your copy — review the findings on the report page or request a re-grade.`,
          reportUrl: reportUrl(e.name),
        }
      }
      return {
        status: 'reference', name: e.name, overall: e.overall, badges: gradedBadges(e),
        verdict: e.verdict, findings: findings(e),
        message: `This is our grade of a skill named "${e.name}". Without a hash we can't confirm it's your exact copy.`,
        reportUrl: reportUrl(e.name), sourceUrl: e.sourceUrl,
      }
    }
  }
  return {
    status: 'unknown', name: q.name,
    message: 'Not in the SkillGrade database yet. (Coming: registered users can request a fresh grade.)',
  }
}

export function auditSkills(index: SkillIndex, skills: { name?: string; hash?: string }[]): AuditReport {
  const results = skills.map((s) => lookupSkill(index, s))
  const gradeCounts: Record<string, number> = {}
  let verifiedN = 0, drifted = 0, unknown = 0
  for (const r of results) {
    if (r.status === 'verified') { verifiedN++; gradeCounts[r.overall] = (gradeCounts[r.overall] ?? 0) + 1 }
    else if (r.status === 'drift') drifted++
    else if (r.status === 'unknown') unknown++
    // 'reference' is counted only in total (no hash was supplied to verify)
  }
  return {
    summary: { total: results.length, verified: verifiedN, drifted, unknown, gradeCounts },
    skills: results,
  }
}

export function searchSkills(index: SkillIndex, query: string): SearchHit[] {
  const q = query.toLowerCase()
  const hits: SearchHit[] = []
  for (const [name, group] of index.byName) {
    if (!name.toLowerCase().includes(q)) continue
    const e = group[0]
    hits.push({ name: e.name, overall: e.overall, category: e.category, tagline: e.tagline, reportUrl: reportUrl(e.name) })
  }
  return hits
}
