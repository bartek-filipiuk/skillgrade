import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CheckDef, Dimension, Severity } from './types.js'

const HEADER = /^## ([SQH]\d{2}) — (.+)$/
const FILES: Record<string, Dimension['key']> = {
  '10-security.md': 'security',
  '20-quality.md': 'quality',
  '30-hygiene.md': 'hygiene',
}

export function parseChecks(md: string): CheckDef[] {
  const lines = md.split('\n')
  const checks: CheckDef[] = []
  let current: CheckDef | null = null
  const push = () => { if (current) { current.body = current.body.trim(); checks.push(current); current = null } }
  for (const line of lines) {
    const m = line.match(HEADER)
    if (m) {
      push()
      current = { id: m[1], title: m[2].trim(), severity: 'minor', weight: 1, body: '' }
      continue
    }
    if (line.startsWith('## ')) { push(); continue } // sekcja bez ID — poza checkami
    if (current) {
      const sev = line.match(/^severity:\s*(critical|major|minor)\s*$/)
      const w = line.match(/^weight:\s*(\d+)\s*$/)
      if (sev) current.severity = sev[1] as Severity
      else if (w) current.weight = Number(w[1])
      else current.body += line + '\n'
    }
  }
  push()
  const ids = new Set<string>()
  for (const c of checks) {
    if (ids.has(c.id)) throw new Error(`duplicate check id: ${c.id}`)
    ids.add(c.id)
  }
  return checks
}

export function loadRubric(dir: string) {
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as { version: string }
  const protocol = readFileSync(join(dir, '00-protocol.md'), 'utf8')
  const dimensions: Dimension[] = Object.entries(FILES).map(([file, key]) => {
    const raw = readFileSync(join(dir, file), 'utf8')
    return { key, raw, checks: parseChecks(raw) }
  })
  return { version: meta.version, protocol, dimensions }
}
