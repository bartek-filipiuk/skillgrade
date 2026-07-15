import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { PreCheckReport, PreCheckFlag } from '../src/types.js'
import { PATTERN_RULES, CANARY_RULES } from './patterns.js'

const SKIP_DIRS = new Set(['.git', 'node_modules'])
const ALL_RULES = [...PATTERN_RULES, ...CANARY_RULES]

// Recursive walk. Skips .git/node_modules and — importantly — symlinks, so a
// symlink pointing outside the skill dir can never pull foreign files into scope.
function walk(root: string): string[] {
  const out: string[] = []
  const rec = (dir: string) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue // never follow symlinks (escape + loop guard)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) rec(join(dir, e.name))
      } else if (e.isFile()) {
        out.push(relative(root, join(dir, e.name)).split(sep).join('/'))
      }
    }
  }
  rec(root)
  return out.sort() // deterministic across runs
}

// Binary iff a NUL byte appears in the first 8 KB — cheap, catches images/blobs
// and text files smuggling a NUL to dodge the pattern scan.
function isBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8192).includes(0)
}

export function listSkillFiles(skillDir: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = []
  for (const path of walk(skillDir)) {
    const buf = readFileSync(join(skillDir, path))
    if (isBinary(buf)) continue
    out.push({ path, content: buf.toString('utf8') })
  }
  return out
}

function checkFrontmatter(skillDir: string): { valid: boolean; errors: string[] } {
  let raw: string
  try {
    raw = readFileSync(join(skillDir, 'SKILL.md'), 'utf8')
  } catch {
    return { valid: false, errors: ['SKILL.md not found'] }
  }
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (!m) return { valid: false, errors: ['no frontmatter block'] }
  let data: unknown
  try {
    data = parseYaml(m[1])
  } catch (e) {
    return { valid: false, errors: [`invalid YAML: ${(e as Error).message}`] }
  }
  const errors: string[] = []
  const fm = (data ?? {}) as Record<string, unknown>
  for (const key of ['name', 'description'] as const) {
    const v = fm[key]
    if (typeof v !== 'string' || v.trim() === '') errors.push(`missing or empty ${key}`)
  }
  return { valid: errors.length === 0, errors }
}

export function runPreChecks(skillDir: string): PreCheckReport {
  const files: PreCheckReport['files'] = []
  const flags: PreCheckFlag[] = []
  for (const path of walk(skillDir)) {
    const buf = readFileSync(join(skillDir, path))
    const binary = isBinary(buf)
    files.push({ path, bytes: buf.length, binary })
    if (binary) continue
    const lines = buf.toString('utf8').split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      for (const { rule, re, severity } of ALL_RULES) {
        if (re.test(line)) {
          flags.push({ rule, severity, file: path, line: i + 1, excerpt: line.slice(0, 200) })
        }
      }
    }
  }
  return { files, frontmatter: checkFrontmatter(skillDir), flags }
}
