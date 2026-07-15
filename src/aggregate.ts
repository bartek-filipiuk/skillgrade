import type { CheckDef, CheckStatus, Letter, ReportVerdict } from './types.js'

const VALUE: Record<string, number> = { pass: 1, warning: 0.5, fail: 0, 'evaluation-error': 0 }

// Worst-first severity of a status. Lower rank = more severe = wins on duplicate
// verdicts for the same check. This is a trust boundary: verdicts come from an
// LLM classifying UNTRUSTED skill content, so a duplicate verdict must never be
// able to UPGRADE an earlier one (a trailing `pass` cannot bury a `fail`).
// Single source of truth for status severity ordering: lower = worse. Shared
// with report.ts's run-majority tiebreak so dedup and majority vote can never
// disagree about which status wins.
export const STATUS_RANK: Record<CheckStatus, number> = {
  fail: 0,
  'evaluation-error': 1,
  warning: 2,
  pass: 3,
  'not-applicable': 4,
}
const worse = (a: CheckStatus, b: CheckStatus): CheckStatus =>
  (STATUS_RANK[a] ?? 0) <= (STATUS_RANK[b] ?? 0) ? a : b

export function aggregate(
  checks: CheckDef[],
  verdicts: ReportVerdict[],
): { score: number | null; letter: Letter } {
  // Deduplicate: keep the worst status per check id (see STATUS_RANK).
  const byId = new Map<string, ReportVerdict>()
  for (const v of verdicts) {
    const prev = byId.get(v.check)
    byId.set(v.check, prev ? (worse(prev.status, v.status) === prev.status ? prev : v) : v)
  }

  let num = 0
  let den = 0
  let criticalFail = false
  for (const c of checks) {
    const status = byId.get(c.id)?.status ?? 'evaluation-error'
    if (status === 'not-applicable') continue
    // Critical fail forces F independent of weight — check it before the weight guard.
    if (status === 'fail' && c.severity === 'critical') criticalFail = true
    if (!(c.weight > 0)) continue // ponytail: guard zero/negative/NaN weights so they can't corrupt the score
    num += c.weight * (VALUE[status] ?? 0)
    den += c.weight
  }

  if (criticalFail) return { score: den ? num / den : 0, letter: 'F' }
  if (den === 0) return { score: null, letter: 'A' } // ponytail: no applicable checks = no charges to answer
  const s = num / den
  const letter: Letter = s >= 0.9 ? 'A' : s >= 0.8 ? 'B' : s >= 0.65 ? 'C' : s >= 0.5 ? 'D' : 'F'
  return { score: s, letter }
}
