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
  maxCandidates?: number // bound the adapter firehose so a hostile source can't drive unbounded fetches
  concurrency?: number // bounded fetches in flight
  saveEvery?: number // checkpoint the worklist every N survivors so a kill keeps progress
}

export async function runDiscovery(opts: DiscoveryOpts): Promise<{ ready: number; filtered: number; drifted: number }> {
  const maxCandidates = opts.maxCandidates ?? 5000
  const concurrency = opts.concurrency ?? 10
  const saveEvery = opts.saveEvery ?? 200
  const fetched: FetchedCandidate[] = []
  let filtered = 0
  let consumed = 0

  // dedupe → merge into prior state → persist. Fully synchronous, so it is atomic
  // between worker await points and safe to call mid-run.
  const checkpoint = (): WorklistItem[] => {
    const merged = mergeWorklist(loadState(opts.dir), dedupe(fetched, opts.now), opts.gradedHashes)
    saveState(opts.dir, merged)
    return merged
  }

  const it = opts.adapter.discover()[Symbol.asyncIterator]()
  async function worker(): Promise<void> {
    for (;;) {
      if (consumed >= maxCandidates) return
      const { value: c, done } = await it.next() // concurrent .next() is serialized by the generator
      if (done) return
      consumed++
      const content = await opts.fetchContent(c as Candidate)
      if (content === null) continue // fetch failed/refused → skip, never abort
      const fc = hashCandidate(c as Candidate, content)
      if (!filterValid(fc).ok) { filtered++; continue }
      fetched.push(fc)
      if (fetched.length % saveEvery === 0) checkpoint() // sync → atomic; only one worker hits the exact multiple
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  const merged = checkpoint()
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
import { hashSkillMd } from '../mcp/normalize.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CACHE = join(HERE, 'cache')

// Read cached SKILL.md content by its normalized hash (skillMdHash). The grade step
// reads content by the same key it grades under, keeping a single identity per skill.
export function readCachedContent(hash: string): string {
  return readFileSync(join(CACHE, hash + '.md'), 'utf8')
}

function cachedFetch(token?: string) {
  mkdirSync(CACHE, { recursive: true })
  return async (c: import('./adapters/types.js').Candidate): Promise<string | null> => {
    // Cache key by source identity; the stored file is named by the NORMALIZED hash
    // (skillMdHash) so the grade step can look it up via readCachedContent.
    const key = createHash('sha256').update(c.repo + '\0' + c.ref + '\0' + c.path).digest('hex')
    const meta = join(CACHE, key + '.json')
    const prior = existsSync(meta) ? (JSON.parse(readFileSync(meta, 'utf8')) as { etag?: string; file: string }) : null
    // Only revalidate with the etag when the cached body still exists; otherwise a
    // surviving meta with a deleted .md would 304 → null → the skill is skipped forever.
    const etag = prior && existsSync(prior.file) ? prior.etag : undefined
    const r = await fetchSkillMd(c, { token, etag })
    if (r === null) return prior && existsSync(prior.file) ? readFileSync(prior.file, 'utf8') : null
    const file = join(CACHE, hashSkillMd(r.content) + '.md')
    writeFileSync(file, r.content)
    writeFileSync(meta, JSON.stringify({ etag: r.etag, file }))
    return r.content
  }
}

async function githubApiGet(path: string): Promise<unknown> {
  const token = process.env.GITHUB_TOKEN
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://api.github.com' + path, {
      headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    })
    if (res.ok) return res.json()
    // Rate limited / abuse detection: honor retry-after (or exponential backoff), cap retries.
    if ((res.status === 403 || res.status === 429) && attempt < 3) {
      const retryAfter = Number(res.headers.get('retry-after'))
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt
      await new Promise((r) => setTimeout(r, waitMs))
      continue
    }
    throw new Error(`github api ${res.status} for ${path}`)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const token = process.env.GITHUB_TOKEN
  const gradedHashes = new Set<string>() // seed from evaluations.json when re-scanning; empty = grade everything ready
  const adapter = githubAdapter(githubApiGet, {
    codeSearch: process.env.CODE_SEARCH !== '0', // default on; CODE_SEARCH=0 to disable
    maxReposPerQuery: process.env.MAX_REPOS ? Number(process.env.MAX_REPOS) : undefined,
  })
  runDiscovery({
    adapter,
    fetchContent: cachedFetch(token),
    dir: HERE,
    now: new Date().toISOString(),
    gradedHashes,
    maxCandidates: process.env.MAX_CANDIDATES ? Number(process.env.MAX_CANDIDATES) : undefined,
    concurrency: process.env.CONCURRENCY ? Number(process.env.CONCURRENCY) : undefined,
  })
    .then((r) => console.log(`discovery: ready=${r.ready} filtered=${r.filtered} drifted=${r.drifted}`))
    .catch((e) => { console.error(e); process.exit(1) })
}
