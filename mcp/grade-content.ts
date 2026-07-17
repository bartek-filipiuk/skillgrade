import type { LanguageModel } from 'ai'
import { loadRubric } from '../src/rubric.js'
import { evaluateDimension as realEvaluate, resolveModel } from '../src/llm.js'
import { numberContent } from '../src/loadSkill.js'
import { scanFlags, checkFrontmatterContent } from '../checks/prechecks.js'
import { aggregate } from '../src/aggregate.js'
import { hashSkillMd } from './normalize.js'
import type { DimensionKey, PreCheckReport } from '../src/types.js'

export interface GradeContentOpts {
  rubricDir: string
  model: string
  evaluateDimension?: typeof realEvaluate
}

// Run the same pattern/canary + frontmatter checks the CLI runs, but over the raw
// string — no filesystem. The single SKILL.md is all the paid grade ever sees.
function preChecksFor(content: string): PreCheckReport {
  return {
    files: [{ path: 'SKILL.md', bytes: Buffer.byteLength(content, 'utf8'), binary: false }],
    frontmatter: checkFrontmatterContent(content),
    flags: scanFlags('SKILL.md', content),
  }
}

// Grade a raw SKILL.md string with the existing engine — no filesystem, no loadSkill.
// The real evaluateDimension needs the full EvaluateOpts (resolved model, protocol,
// prechecks, numbered content), which we build here; the injected test fake ignores
// all but `dimension`, so tests run with no LLM and no model resolution.
export async function gradeContent(content: string, opts: GradeContentOpts) {
  const evaluate = opts.evaluateDimension ?? realEvaluate
  const rubric = loadRubric(opts.rubricDir)
  const files = [{ path: 'SKILL.md', content }]
  const preChecks = preChecksFor(content)
  const numberedContent = numberContent(files)
  // resolveModel would throw on a placeholder spec (e.g. tests' 'x'); only the real
  // engine needs a live model, so resolve lazily and skip it when a fake is injected.
  const model = opts.evaluateDimension ? (undefined as unknown as LanguageModel) : resolveModel(opts.model)

  const badges = {} as Record<DimensionKey, string>
  const findings: { check: string; dimension: DimensionKey; status: string; summary: string }[] = []
  for (const dimension of rubric.dimensions) {
    const verdicts = await evaluate({ model, protocol: rubric.protocol, dimension, preChecks, numberedContent, files })
    badges[dimension.key] = aggregate(dimension.checks, verdicts).letter
    for (const v of verdicts) {
      if (v.status === 'fail' || v.status === 'warning') {
        findings.push({ check: v.check, dimension: dimension.key, status: v.status, summary: v.note ?? '' })
      }
    }
  }

  const order = ['A', 'B', 'C', 'D', 'F']
  const overall = [badges.security, badges.quality, badges.hygiene].reduce((w, g) =>
    order.indexOf(g) > order.indexOf(w) ? g : w,
  )
  return {
    skillMdHash: hashSkillMd(content),
    overall,
    badges: { security: badges.security, quality: badges.quality, hygiene: badges.hygiene },
    findings,
  }
}
