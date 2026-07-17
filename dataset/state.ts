import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { WorklistItem } from './dedup.js'

// Merge a fresh discovery pass into existing state without losing grading work.
//   - a hash already graded stays graded (skip re-grading)
//   - a fresh item on a known source but a NEW hash = drift → re-grade
//   - anything else new = ready
export function mergeWorklist(existing: WorklistItem[], fresh: WorklistItem[], gradedHashes: Set<string>): WorklistItem[] {
  const byHash = new Map(existing.map((i) => [i.skillMdHash, i]))
  const gradedSourceHash = new Map(existing.filter((i) => i.status === 'graded').map((i) => [i.primarySourceUrl, i.skillMdHash]))
  for (const f of fresh) {
    if (gradedHashes.has(f.skillMdHash)) continue // already graded, unchanged
    const priorHashForSource = gradedSourceHash.get(f.primarySourceUrl)
    const status: WorklistItem['status'] = priorHashForSource && priorHashForSource !== f.skillMdHash ? 'drifted' : 'ready'
    const prev = byHash.get(f.skillMdHash)
    byHash.set(f.skillMdHash, { ...f, status: prev?.status === 'graded' ? 'graded' : status })
  }
  return [...byHash.values()]
}

// Next N to grade: ready or drifted, most popular first.
export function selectWave(items: WorklistItem[], n: number): WorklistItem[] {
  return items
    .filter((i) => i.status === 'ready' || i.status === 'drifted')
    .sort((a, b) => b.stars - a.stars)
    .slice(0, n)
}

export function loadState(dir: string): WorklistItem[] {
  const p = join(dir, 'candidates.json')
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as WorklistItem[]) : []
}

export function saveState(dir: string, items: WorklistItem[]): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'candidates.json'), JSON.stringify(items, null, 2) + '\n')
}
