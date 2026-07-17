import { hashCandidate, filterValid, type FetchedCandidate } from './filter.js'
import { dedupe, type WorklistItem } from './dedup.js'
import { mergeWorklist, loadState, saveState } from './state.js'
import type { Candidate, SourceAdapter } from './adapters/types.js'

export interface DiscoveryOpts {
  adapter: SourceAdapter
  fetchContent: (c: Candidate) => Promise<string | null>
  dir: string
  now: string
  gradedHashes: Set<string>
}

export async function runDiscovery(opts: DiscoveryOpts): Promise<{ ready: number; filtered: number; drifted: number }> {
  const fetched: FetchedCandidate[] = []
  let filtered = 0
  for await (const c of opts.adapter.discover()) {
    const content = await opts.fetchContent(c)
    if (content === null) continue // fetch failed/refused → skip, never abort
    const fc = hashCandidate(c, content)
    const v = filterValid(fc)
    if (!v.ok) {
      filtered++
      continue
    }
    fetched.push(fc)
  }
  const freshItems: WorklistItem[] = dedupe(fetched, opts.now)
  const merged = mergeWorklist(loadState(opts.dir), freshItems, opts.gradedHashes)
  saveState(opts.dir, merged)
  return {
    ready: merged.filter((i) => i.status === 'ready').length,
    filtered,
    drifted: merged.filter((i) => i.status === 'drifted').length,
  }
}

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { githubAdapter } from './adapters/github.js'
import { fetchSkillMd } from './fetch.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CACHE = join(HERE, 'cache')

function cachedFetch(token?: string) {
  mkdirSync(CACHE, { recursive: true })
  return async (c: import('./adapters/types.js').Candidate): Promise<string | null> => {
    // Cache key by source identity; the content hash names the stored file after fetch.
    const key = createHash('sha256').update(c.repo + '\0' + c.ref + '\0' + c.path).digest('hex')
    const meta = join(CACHE, key + '.json')
    const prior = existsSync(meta) ? (JSON.parse(readFileSync(meta, 'utf8')) as { etag?: string; file: string }) : null
    const r = await fetchSkillMd(c, { token, etag: prior?.etag })
    if (r === null) return prior && existsSync(prior.file) ? readFileSync(prior.file, 'utf8') : null
    const file = join(CACHE, createHash('sha256').update(r.content).digest('hex') + '.md')
    writeFileSync(file, r.content)
    writeFileSync(meta, JSON.stringify({ etag: r.etag, file }))
    return r.content
  }
}

async function githubApiGet(path: string): Promise<unknown> {
  const token = process.env.GITHUB_TOKEN
  const res = await fetch('https://api.github.com' + path, {
    headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  })
  if (!res.ok) throw new Error(`github api ${res.status} for ${path}`)
  return res.json()
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const token = process.env.GITHUB_TOKEN
  const gradedHashes = new Set<string>() // seeded by grade step; empty run = grade everything ready
  runDiscovery({ adapter: githubAdapter(githubApiGet), fetchContent: cachedFetch(token), dir: HERE, now: new Date().toISOString(), gradedHashes })
    .then((r) => console.log(`discovery: ready=${r.ready} filtered=${r.filtered} drifted=${r.drifted}`))
    .catch((e) => { console.error(e); process.exit(1) })
}
