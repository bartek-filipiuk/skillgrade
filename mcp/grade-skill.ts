import { hashSkillMd } from './normalize.js'
import type { SkillIndex } from './index-build.js'

export interface GradeSkillDeps {
  index: SkillIndex
  gradeContent: (content: string) => Promise<{ skillMdHash: string; overall: string; badges: { security: string; quality: string; hygiene: string }; findings: unknown[] }>
  charge: (token: string) => Promise<{ ok: boolean; remaining: number }>
  refund: (token: string, ref: string) => Promise<void>
  maxBytes: number
}

export function makeGradeSkill(deps: GradeSkillDeps) {
  return {
    async handle({ content, token }: { content: string; token?: string }) {
      if (!token) return { error: 'invalid-token' as const }
      if (Buffer.byteLength(content, 'utf8') > deps.maxBytes) return { error: 'too-large' as const, maxBytes: deps.maxBytes }

      // Catalog short-circuit: a skill we've already graded costs nothing.
      const hash = hashSkillMd(content)
      const hit = deps.index.byHash.get(hash)
      if (hit) return { charged: false as const, source: 'catalog' as const, overall: hit.overall, badges: { security: hit.badges.security, quality: hit.badges.quality, hygiene: hit.badges.hygiene }, name: hit.name, reportUrl: `https://skillgrade.dev/#skill-${encodeURIComponent(hit.name)}` }

      const c = await deps.charge(token)
      if (!c.ok) return { error: 'no-credits' as const, remaining: c.remaining }
      try {
        const g = await deps.gradeContent(content)
        return { charged: true as const, remaining: c.remaining, overall: g.overall, badges: g.badges, findings: g.findings, skillMdHash: g.skillMdHash }
      } catch {
        await deps.refund(token, hash)
        return { error: 'grade-failed' as const }
      }
    },
  }
}
