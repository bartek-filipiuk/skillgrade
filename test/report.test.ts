import { describe, it, expect } from 'vitest'
import {
  buildReport,
  renderMarkdown,
  exitCodeForReport,
  majorityVerdict,
} from '../src/report.js'
import type { Dimension, PreCheckReport, Report, ReportVerdict } from '../src/types.js'

const emptyPre = (flags: PreCheckReport['flags'] = []): PreCheckReport => ({
  files: [{ path: 'SKILL.md', bytes: 10, binary: false }],
  frontmatter: { valid: true, errors: [] },
  flags,
})

const secDim: Dimension = {
  key: 'security',
  raw: '# Security',
  checks: [
    { id: 'S01', title: 'Secret exfiltration', severity: 'critical', weight: 10, body: '' },
    { id: 'S02', title: 'Network egress', severity: 'major', weight: 5, body: '' },
  ],
}

const subject = { name: 'demo', source: '/tmp/demo', contentHash: 'abc123' }

describe('buildReport — (a) --no-llm', () => {
  const report = buildReport({
    ...subject,
    rubricVersion: '0.1.0',
    mode: 'no-llm',
    model: 'none',
    runs: 1,
    preChecks: emptyPre([
      { rule: 'secret-paths', severity: 'major', file: 'SKILL.md', line: 2, excerpt: 'cat ~/.ssh' },
    ]),
    evaluated: [],
  })

  it('all three dimension badges are not-evaluated', () => {
    expect(report.badges).toEqual({
      security: 'not-evaluated',
      quality: 'not-evaluated',
      hygiene: 'not-evaluated',
      effectiveness: 'not-evaluated',
    })
  })

  it('preChecks.flags are carried through', () => {
    expect(report.preChecks.flags).toHaveLength(1)
    expect(report.preChecks.flags[0].rule).toBe('secret-paths')
  })

  it('no verdicts in --no-llm', () => {
    expect(report.verdicts).toEqual([])
  })

  it('exit code 2 when a critical/major flag is present, 0 otherwise', () => {
    expect(exitCodeForReport(report)).toBe(2)
    const clean = buildReport({
      ...subject,
      rubricVersion: '0.1.0',
      mode: 'no-llm',
      model: 'none',
      runs: 1,
      preChecks: emptyPre([
        { rule: 'sudo', severity: 'minor', file: 'SKILL.md', line: 1, excerpt: 'sudo' },
      ]),
      evaluated: [],
    })
    expect(exitCodeForReport(clean)).toBe(0)
  })

  it('createdAt is an ISO-8601 timestamp', () => {
    expect(report.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })
})

describe('buildReport — (b) full mode', () => {
  const verdicts: ReportVerdict[] = [
    { check: 'S01', status: 'pass' },
    { check: 'S02', status: 'pass' },
  ]
  const report = buildReport({
    ...subject,
    rubricVersion: '0.1.0',
    mode: 'cli',
    model: 'anthropic:claude-opus-4-8',
    runs: 1,
    preChecks: emptyPre(),
    evaluated: [{ dimension: secDim, verdicts }],
  })

  it('badge is computed by aggregate (all pass → A)', () => {
    expect(report.badges.security).toBe('A')
  })

  it('effectiveness stays not-evaluated', () => {
    expect(report.badges.effectiveness).toBe('not-evaluated')
  })

  it('dimensions not evaluated stay not-evaluated', () => {
    expect(report.badges.quality).toBe('not-evaluated')
    expect(report.badges.hygiene).toBe('not-evaluated')
  })

  it('a critical fail forces F and exit code 2', () => {
    const failReport = buildReport({
      ...subject,
      rubricVersion: '0.1.0',
      mode: 'cli',
      model: 'm',
      runs: 1,
      preChecks: emptyPre(),
      evaluated: [
        {
          dimension: secDim,
          verdicts: [
            {
              check: 'S01',
              status: 'fail',
              evidence: { file: 'SKILL.md', line: 2, quote: 'cat ~/.ssh' },
            },
            { check: 'S02', status: 'pass' },
          ],
        },
      ],
    })
    expect(failReport.badges.security).toBe('F')
    expect(exitCodeForReport(failReport)).toBe(2)
  })
})

describe('renderMarkdown — (c)', () => {
  const report: Report = {
    subject: { type: 'skill', ...subject },
    rubricVersion: '0.1.0',
    evaluator: { model: 'anthropic:claude-opus-4-8', runs: 1, mode: 'cli' },
    badges: { security: 'F', quality: 'B', hygiene: 'A', effectiveness: 'not-evaluated' },
    verdicts: [
      {
        check: 'S01',
        status: 'fail',
        evidence: { file: 'SKILL.md', line: 2, quote: 'cat ~/.ssh/id_rsa' },
        note: 'reads private key',
      },
      { check: 'Q03', status: 'warning', evidence: { file: 'SKILL.md', line: 9, quote: 'step 2 vs 5' } },
      { check: 'S02', status: 'pass' },
    ],
    preChecks: emptyPre([
      { rule: 'secret-paths', severity: 'major', file: 'SKILL.md', line: 2, excerpt: 'cat ~/.ssh' },
    ]),
    createdAt: '2026-07-15T00:00:00.000Z',
  }

  const md = renderMarkdown(report)

  it('contains a badge table with every dimension', () => {
    expect(md).toContain('| Security | F |')
    expect(md).toContain('| Quality | B |')
    expect(md).toContain('| Hygiene | A |')
    expect(md).toContain('| Effectiveness | not-evaluated |')
  })

  it('has a findings section with the failing check and its quote', () => {
    expect(md).toMatch(/Findings/)
    expect(md).toContain('S01')
    expect(md).toContain('cat ~/.ssh/id_rsa')
    expect(md).toContain('SKILL.md:2')
  })

  it('shows warnings with quotes too', () => {
    expect(md).toContain('Q03')
    expect(md).toContain('step 2 vs 5')
  })

  it('does not list passing checks as findings', () => {
    // S02 pass — should not appear under a fail/warning heading
    expect(md).not.toMatch(/### S02/)
  })
})

describe('majorityVerdict — runs tie-break', () => {
  it('majority wins', () => {
    const out = majorityVerdict([
      [{ check: 'S01', status: 'pass' }],
      [{ check: 'S01', status: 'pass' }],
      [{ check: 'S01', status: 'fail', evidence: { file: 'a', line: 1, quote: 'x' } }],
    ])
    expect(out).toHaveLength(1)
    expect(out[0].status).toBe('pass')
  })

  it('tie resolves to the worse status (fail > warning > pass > not-applicable)', () => {
    const out = majorityVerdict([
      [{ check: 'S01', status: 'fail', evidence: { file: 'a', line: 1, quote: 'x' } }],
      [{ check: 'S01', status: 'pass' }],
    ])
    expect(out[0].status).toBe('fail')
    expect(out[0].evidence).toEqual({ file: 'a', line: 1, quote: 'x' })
  })
})
