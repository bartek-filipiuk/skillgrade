import { generateObject, generateText, type LanguageModel } from 'ai'
import { z } from 'zod'
import { EvidenceSchema, VerdictSchema } from './types.js'
import type { Dimension, PreCheckReport, ReportVerdict, Verdict } from './types.js'

export { resolveModel } from './models.js'

// Wire schema for the LLM boundary. It is deliberately NOT the refined
// DimensionVerdictsSchema: Zod `.refine` cannot be expressed in JSON Schema, so
// it never reaches the model (the model sees the same shape either way) — its
// only runtime effect is to make generateObject throw on the WHOLE batch when a
// single verdict is malformed. That would destroy the per-check retry the plan
// requires (a lone bad verdict would discard every sibling verdict). So we take
// the raw shape here and enforce VerdictSchema per verdict, in code, below.
const WireSchema = z.object({
  verdicts: z.array(
    z.object({
      check: z.string(),
      status: z.enum(['pass', 'fail', 'warning', 'not-applicable']),
      evidence: EvidenceSchema.optional(),
      note: z.string().optional(),
    }),
  ),
})

export interface EvaluateOpts {
  model: LanguageModel
  protocol: string
  dimension: Dimension
  preChecks: PreCheckReport
  numberedContent: string
  files: { path: string; content: string }[]
}

// The cited line of the cited file must literally contain the quote.
// Trust boundary: evidence.file / evidence.line are attacker-influenced (the
// model can emit anything). We look the file up by exact relative path — a
// path-traversal string simply won't match any known file — and bounds-check
// the line index, so a bad reference yields `false`, never a throw or a read
// outside the loaded skill. Policy: trim (the model drops the `N|` prefix and
// may lose indentation) but NEVER case-fold — case-folding would let an
// attacker "prove" a quote that isn't actually there.
export function verifyEvidence(v: Verdict, files: { path: string; content: string }[]): boolean {
  if (v.status !== 'fail' && v.status !== 'warning') return true
  const ev = v.evidence
  if (!ev) return false
  const file = files.find((f) => f.path === ev.file)
  if (!file) return false
  const lines = file.content.split('\n')
  if (ev.line < 1 || ev.line > lines.length) return false
  return lines[ev.line - 1].trim().includes(ev.quote.trim())
}

// A verdict is acceptable iff it passes the refined VerdictSchema AND its
// evidence (when required) survives verification.
function accept(raw: unknown, files: EvaluateOpts['files']): Verdict | null {
  const parsed = VerdictSchema.safeParse(raw)
  if (!parsed.success) return null
  return verifyEvidence(parsed.data, files) ? parsed.data : null
}

function rejectReason(raw: { status?: string; evidence?: unknown }): string {
  if ((raw.status === 'fail' || raw.status === 'warning') && !raw.evidence) {
    return 'fail/warning requires evidence (file, line, verbatim quote)'
  }
  return 'evidence quote was not found verbatim on the cited line'
}

function buildPrompt(opts: EvaluateOpts): string {
  return [
    opts.protocol,
    '',
    '<precheck-report>',
    JSON.stringify(opts.preChecks, null, 2),
    '</precheck-report>',
    '',
    opts.dimension.raw,
    '',
    opts.numberedContent,
  ].join('\n')
}

const JSON_INSTRUCTION = [
  '',
  'Respond with ONLY a JSON object, no markdown fences and no prose around it:',
  '{"verdicts":[{"check":"S01","status":"pass|fail|warning|not-applicable",',
  '"evidence":{"file":"...","line":1,"quote":"..."},"note":"..."}]}',
  'Include one verdict per check. `evidence` is required for fail/warning only.',
].join('\n')

// Pull a JSON object out of a free-text model reply: strip a ```json fence if
// present, else parse the widest {...} span. Pure parsing — never executes the
// content; a non-JSON reply yields null (→ the caller treats it as no verdicts).
function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fence ? fence[1] : text).trim()
  try {
    return JSON.parse(body)
  } catch {
    const start = body.indexOf('{')
    const end = body.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1))
      } catch {
        /* fall through */
      }
    }
    return null
  }
}

async function callModel(opts: EvaluateOpts, prompt: string): Promise<unknown[]> {
  // Preferred path: provider-native structured output (OpenAI, Anthropic).
  try {
    const { object } = await generateObject({ model: opts.model, schema: WireSchema, temperature: 0, prompt })
    return object.verdicts
  } catch {
    // Fallback: some providers (notably non-OpenAI models via OpenRouter) reject
    // the JSON-schema response_format and throw, which would otherwise collapse
    // the WHOLE dimension to evaluation-error. Ask for JSON as plain text and
    // parse it ourselves. Per-verdict validation (accept/verifyEvidence) is
    // unchanged downstream, so this loosens transport, never trust.
    try {
      const { text } = await generateText({ model: opts.model, temperature: 0, prompt: prompt + '\n' + JSON_INSTRUCTION })
      const parsed = WireSchema.safeParse(extractJson(text))
      return parsed.success ? parsed.data.verdicts : []
    } catch {
      return []
    }
  }
}

// One LLM call per dimension, plus at most one retry covering ONLY the checks
// whose verdict was rejected. Returns exactly one ReportVerdict per dimension
// check, in rubric order. Foreign-check verdicts and duplicates are dropped;
// missing verdicts and unrecoverable rejections become `evaluation-error`.
export async function evaluateDimension(opts: EvaluateOpts): Promise<ReportVerdict[]> {
  const dimIds = new Set(opts.dimension.checks.map((c) => c.id))
  const accepted = new Map<string, Verdict>()
  const rejected = new Map<string, string>() // check id -> reason (for the retry prompt)

  const first = await callModel(opts, buildPrompt(opts))
  for (const raw of first) {
    const id = (raw as { check?: unknown }).check
    if (typeof id !== 'string' || !dimIds.has(id)) continue // foreign check -> drop
    if (accepted.has(id) || rejected.has(id)) continue // duplicate -> keep first
    const ok = accept(raw, opts.files)
    if (ok) accepted.set(id, ok)
    else rejected.set(id, rejectReason(raw as { status?: string; evidence?: unknown }))
  }

  // Single retry, only for rejected checks (missing checks are NOT retried).
  if (rejected.size > 0) {
    const retryPrompt = [
      buildPrompt(opts),
      '',
      'Your previous response was rejected for these checks. Re-evaluate ONLY them',
      'and return a verdict for each listed check id. Any fail/warning MUST cite a',
      'quote copied verbatim from the stated line of the stated file.',
      ...[...rejected].map(([id, reason]) => `- ${id}: ${reason}`),
    ].join('\n')
    const retry = await callModel(opts, retryPrompt)
    const seen = new Set<string>()
    for (const raw of retry) {
      const id = (raw as { check?: unknown }).check
      if (typeof id !== 'string' || !rejected.has(id) || seen.has(id)) continue
      seen.add(id)
      const ok = accept(raw, opts.files)
      if (ok) accepted.set(id, ok)
    }
  }

  // One verdict per dimension check, in rubric order. Anything still unaccepted
  // (missing, or rejected twice) is an evaluation-error — a harness-only status.
  return opts.dimension.checks.map(
    (c): ReportVerdict => accepted.get(c.id) ?? { check: c.id, status: 'evaluation-error' },
  )
}
