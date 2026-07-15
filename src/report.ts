import { aggregate, STATUS_RANK } from './aggregate.js'
import type { CheckStatus, Dimension, PreCheckReport, Report, ReportVerdict } from './types.js'

export interface EvaluatedDimension {
  dimension: Dimension
  verdicts: ReportVerdict[]
}

export interface BuildReportInput {
  name: string
  source: string
  contentHash: string
  rubricVersion: string
  mode: Report['evaluator']['mode']
  model: string
  runs: number
  preChecks: PreCheckReport
  /** Dimensions actually evaluated. Empty in --no-llm; a subset when --dimension is used. */
  evaluated: EvaluatedDimension[]
}

export function buildReport(input: BuildReportInput): Report {
  const badges: Report['badges'] = {
    security: 'not-evaluated',
    quality: 'not-evaluated',
    hygiene: 'not-evaluated',
    effectiveness: 'not-evaluated',
  }
  const verdicts: ReportVerdict[] = []
  for (const { dimension, verdicts: vs } of input.evaluated) {
    badges[dimension.key] = aggregate(dimension.checks, vs).letter
    verdicts.push(...vs)
  }
  return {
    subject: { type: 'skill', name: input.name, source: input.source, contentHash: input.contentHash },
    rubricVersion: input.rubricVersion,
    evaluator: { model: input.model, runs: input.runs, mode: input.mode },
    badges,
    verdicts,
    preChecks: input.preChecks,
    createdAt: new Date().toISOString(),
  }
}

// Exit-code contract, derived purely from the report so it is testable and the
// bin has a single source of truth:
//   2 = the skill is REJECTED — security graded F (full mode), or, when security
//       was not LLM-evaluated (--no-llm), the free pre-check filter tripped a
//       security-significant flag (severity critical or major). Minor flags
//       (a bare `sudo`) do not reject.
//   0 = evaluated, nothing blocking.
// Rationale for the --no-llm major threshold: the canonical exfil case
// (fixtures/malicious-exfil) produces only `major` flags under the shipped
// pattern rules, yet the free filter must catch it — see deviations in the task
// report. Usage/exception → 1, handled in cli().
export function exitCodeForReport(report: Report): 0 | 2 {
  if (report.badges.security === 'F') return 2
  if (
    report.badges.security === 'not-evaluated' &&
    report.preChecks.flags.some((f) => f.severity !== 'minor')
  ) {
    return 2
  }
  return 0
}

// Worst-first rank; tie-breaks resolve to the WORSE status. Kept consistent with
// Majority vote per check across N runs. On a count tie, the worse status wins
// (STATUS_RANK). Output preserves first-run (rubric) order. Evidence/note are
// taken from a run-verdict that carries the chosen status.
export function majorityVerdict(perRun: ReportVerdict[][]): ReportVerdict[] {
  const byId = new Map<string, ReportVerdict[]>()
  for (const run of perRun) {
    for (const v of run) {
      const arr = byId.get(v.check)
      if (arr) arr.push(v)
      else byId.set(v.check, [v])
    }
  }
  const out: ReportVerdict[] = []
  for (const [check, vs] of byId) {
    const counts = new Map<CheckStatus, number>()
    for (const v of vs) counts.set(v.status, (counts.get(v.status) ?? 0) + 1)
    let best: CheckStatus | null = null
    for (const [status, n] of counts) {
      if (best === null) {
        best = status
        continue
      }
      const bestN = counts.get(best) ?? 0
      if (n > bestN || (n === bestN && STATUS_RANK[status] < STATUS_RANK[best])) best = status
    }
    const rep = vs.find((v) => v.status === best) ?? vs[0]
    out.push({ check, status: best as CheckStatus, evidence: rep.evidence, note: rep.note })
  }
  return out
}

// ---------------------------------------------------------------------------
// Markdown render — English (public artifact). One badge table, then findings.
// ---------------------------------------------------------------------------

function badgeTable(badges: Report['badges']): string {
  const rows: [string, string][] = [
    ['Security', badges.security],
    ['Quality', badges.quality],
    ['Hygiene', badges.hygiene],
    ['Effectiveness', badges.effectiveness],
  ]
  return ['| Dimension | Grade |', '| --- | --- |', ...rows.map(([d, g]) => `| ${d} | ${g} |`)].join('\n')
}

function findingBlock(v: ReportVerdict): string {
  const lines = [`### ${v.check} — ${v.status}`]
  if (v.evidence) {
    lines.push(`- \`${v.evidence.file}:${v.evidence.line}\``)
    lines.push('  ```')
    lines.push(`  ${v.evidence.quote}`)
    lines.push('  ```')
  }
  if (v.note) lines.push(`- ${v.note}`)
  return lines.join('\n')
}

export function renderMarkdown(report: Report): string {
  const { subject, evaluator, badges, verdicts, preChecks } = report
  const out: string[] = []
  out.push(`# Trust report: ${subject.name}`)
  out.push('')
  out.push(`**Source:** \`${subject.source}\``)
  out.push(
    `**Rubric:** v${report.rubricVersion} · **Evaluator:** ${evaluator.model} (${evaluator.mode}, ${evaluator.runs} run${evaluator.runs === 1 ? '' : 's'}) · **Content:** sha256:${subject.contentHash.slice(0, 12)}`,
  )
  out.push(`**Created:** ${report.createdAt}`)
  out.push('')
  out.push('## Badges')
  out.push(badgeTable(badges))
  out.push('')

  out.push('## Pre-checks')
  out.push(
    `- ${preChecks.files.length} file(s) scanned · frontmatter ${preChecks.frontmatter.valid ? 'valid' : `invalid (${preChecks.frontmatter.errors.join('; ')})`}`,
  )
  if (preChecks.flags.length === 0) {
    out.push('- No pattern/canary flags.')
  } else {
    for (const f of preChecks.flags) {
      out.push(`- **${f.severity}** \`${f.rule}\` at \`${f.file}:${f.line}\` — ${f.excerpt.trim()}`)
    }
  }
  out.push('')

  const findings = verdicts.filter((v) => v.status === 'fail' || v.status === 'warning')
  out.push('## Findings')
  if (findings.length === 0) {
    out.push('No fail or warning verdicts.')
  } else {
    out.push(findings.map(findingBlock).join('\n\n'))
  }

  const errors = verdicts.filter((v) => v.status === 'evaluation-error')
  if (errors.length > 0) {
    out.push('')
    out.push(`_${errors.length} check(s) could not be evaluated: ${errors.map((v) => v.check).join(', ')}._`)
  }

  return out.join('\n') + '\n'
}
