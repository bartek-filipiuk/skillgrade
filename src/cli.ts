import { parseArgs } from 'node:util'
import { existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { loadSkill, isGitUrl } from './loadSkill.js'
import { loadRubric } from './rubric.js'
import { runPreChecks } from '../checks/prechecks.js'
import { evaluateDimension, resolveModel } from './llm.js'
import { buildReport, exitCodeForReport, majorityVerdict, renderMarkdown } from './report.js'
import type { DimensionKey, Report, ReportVerdict } from './types.js'

const DEFAULT_MODEL = 'anthropic:claude-opus-4-8'
const DIMENSIONS: DimensionKey[] = ['security', 'quality', 'hygiene']

export interface EvaluateOptions {
  source: string
  model: string
  runs: number
  noLlm: boolean
  dimension?: DimensionKey
}

// Injectable seams so tests exercise the full pipeline with a mock model (or a
// stubbed evaluateDimension) instead of the network.
export interface EvaluateDeps {
  loadSkill: typeof loadSkill
  runPreChecks: typeof runPreChecks
  loadRubric: typeof loadRubric
  resolveModel: typeof resolveModel
  evaluateDimension: typeof evaluateDimension
  rubricDir: string
}

// Walk up from this module until rubric/skill/meta.json is found. Works both from
// src/ (tsx) and from dist/src/ (built bin), without depending on cwd.
function findRubricDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'rubric', 'skill')
    if (existsSync(join(candidate, 'meta.json'))) return candidate
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error('rubric/skill not found (looked upward from the trust-skill install)')
}

function defaultDeps(): EvaluateDeps {
  return { loadSkill, runPreChecks, loadRubric, resolveModel, evaluateDimension, rubricDir: findRubricDir() }
}

export async function evaluate(
  opts: EvaluateOptions,
  overrides: Partial<EvaluateDeps> = {},
): Promise<{ report: Report; exitCode: 0 | 2 }> {
  const deps = { ...defaultDeps(), ...overrides }

  if (!isGitUrl(opts.source) && !existsSync(opts.source)) {
    throw new Error(`source not found: ${opts.source}`)
  }

  const skill = await deps.loadSkill(opts.source)
  const preChecks = deps.runPreChecks(skill.dir)
  const rubric = deps.loadRubric(deps.rubricDir)

  const common = {
    name: skill.name,
    source: skill.source,
    contentHash: skill.contentHash,
    rubricVersion: rubric.version,
    preChecks,
  }

  let report: Report
  if (opts.noLlm) {
    report = buildReport({ ...common, mode: 'no-llm', model: 'none', runs: opts.runs, evaluated: [] })
  } else {
    const model = deps.resolveModel(opts.model)
    const dims = opts.dimension
      ? rubric.dimensions.filter((d) => d.key === opts.dimension)
      : rubric.dimensions
    const evaluated = []
    for (const dimension of dims) {
      const perRun: ReportVerdict[][] = []
      for (let r = 0; r < opts.runs; r++) {
        perRun.push(
          await deps.evaluateDimension({
            model,
            protocol: rubric.protocol,
            dimension,
            preChecks,
            numberedContent: skill.numberedContent,
            files: skill.files,
          }),
        )
      }
      evaluated.push({ dimension, verdicts: opts.runs > 1 ? majorityVerdict(perRun) : perRun[0] })
    }
    report = buildReport({ ...common, mode: 'cli', model: opts.model, runs: opts.runs, evaluated })
  }

  return { report, exitCode: exitCodeForReport(report) }
}

// Returns a process exit code. Never throws: usage errors and exceptions → 1.
export async function cli(argv: string[], overrides: Partial<EvaluateDeps> = {}): Promise<number> {
  let opts: EvaluateOptions
  let outPath: string | undefined
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        model: { type: 'string' },
        runs: { type: 'string' },
        'no-llm': { type: 'boolean' },
        dimension: { type: 'string' },
        out: { type: 'string' },
      },
    })

    if (positionals[0] !== 'evaluate') {
      throw new Error('usage: trust-skill evaluate <path|git-url> [--model provider:id] [--runs N] [--no-llm] [--dimension security|quality|hygiene] [--out report.json]')
    }
    const source = positionals[1]
    if (!source) throw new Error('missing <path|git-url> to evaluate')

    let runs = 1
    if (values.runs !== undefined) {
      runs = Number(values.runs)
      if (!Number.isInteger(runs) || runs < 1) throw new Error(`--runs must be a positive integer, got ${values.runs}`)
      if (runs % 2 === 0) throw new Error(`--runs must be odd (majority vote needs no ties), got ${runs}`)
    }

    let dimension: DimensionKey | undefined
    if (values.dimension !== undefined) {
      if (!DIMENSIONS.includes(values.dimension as DimensionKey)) {
        throw new Error(`unknown --dimension ${JSON.stringify(values.dimension)}: expected ${DIMENSIONS.join('|')}`)
      }
      dimension = values.dimension as DimensionKey
    }

    const model = values.model ?? process.env.TRUST_SKILL_MODEL ?? DEFAULT_MODEL
    outPath = values.out
    opts = { source, model, runs, noLlm: Boolean(values['no-llm']), dimension }
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`)
    return 1
  }

  try {
    const { report, exitCode } = await evaluate(opts, overrides)
    if (outPath) {
      try {
        writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n')
      } catch (e) {
        process.stderr.write(`error: cannot write --out ${JSON.stringify(outPath)}: ${(e as Error).message}\n`)
        return 1
      }
    }
    process.stdout.write(renderMarkdown(report))
    return exitCode
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`)
    return 1
  }
}

// Direct run: `tsx src/cli.ts evaluate <path> ...` (or node dist/src/cli.js).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cli(process.argv.slice(2)).then((code) => process.exit(code))
}
