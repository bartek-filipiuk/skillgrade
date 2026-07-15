import { describe, it, expect } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import { cli, evaluate } from '../src/cli.js'

// A mock model that grades every security check (S01..S12) as pass. No network.
function passModel() {
  const verdicts = Array.from({ length: 12 }, (_, i) => ({
    check: `S${String(i + 1).padStart(2, '0')}`,
    status: 'pass' as const,
  }))
  const text = JSON.stringify({ verdicts })
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text' as const, text }],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage: {
        inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: undefined, text: undefined, reasoning: undefined },
      },
      warnings: [],
    }),
  })
}

describe('(b) full mode via injected mock model', () => {
  it('computes the badge from aggregate; effectiveness not-evaluated', async () => {
    const { report, exitCode } = await evaluate(
      { source: 'checks/fixtures/benign-minimal', model: 'anthropic:x', runs: 1, noLlm: false, dimension: 'security' },
      { resolveModel: () => passModel() },
    )
    expect(report.badges.security).toBe('A')
    expect(report.badges.effectiveness).toBe('not-evaluated')
    expect(report.badges.quality).toBe('not-evaluated') // --dimension security only
    expect(report.evaluator.mode).toBe('cli')
    expect(exitCode).toBe(0)
  })
})

describe('(d) argument parsing', () => {
  it('--runs 2 (even) is a usage error → exit 1', async () => {
    expect(await cli(['evaluate', 'checks/fixtures/benign-minimal', '--runs', '2', '--no-llm'])).toBe(1)
  })

  it('unknown --dimension is a usage error → exit 1', async () => {
    expect(await cli(['evaluate', 'checks/fixtures/benign-minimal', '--dimension', 'bogus', '--no-llm'])).toBe(1)
  })

  it('unknown flag is a usage error → exit 1', async () => {
    expect(await cli(['evaluate', 'checks/fixtures/benign-minimal', '--frobnicate'])).toBe(1)
  })

  it('missing command / source → exit 1', async () => {
    expect(await cli([])).toBe(1)
    expect(await cli(['evaluate'])).toBe(1)
  })
})

describe('(e) e2e --no-llm on malicious-exfil', () => {
  it('exits 2 and the report carries the pre-check flag', async () => {
    const { report, exitCode } = await evaluate({
      source: 'checks/fixtures/malicious-exfil',
      model: 'none',
      runs: 1,
      noLlm: true,
    })
    expect(exitCode).toBe(2)
    expect(report.evaluator.mode).toBe('no-llm')
    expect(report.badges.security).toBe('not-evaluated')
    expect(report.preChecks.flags.length).toBeGreaterThan(0)
    expect(report.preChecks.flags.map((f) => f.rule)).toContain('secret-paths')
  })

  it('cli() returns exit 2 for the same run', async () => {
    expect(await cli(['evaluate', 'checks/fixtures/malicious-exfil', '--no-llm'])).toBe(2)
  })

  it('a clean skill in --no-llm exits 0', async () => {
    expect(await cli(['evaluate', 'checks/fixtures/benign-minimal', '--no-llm'])).toBe(0)
  })
})
