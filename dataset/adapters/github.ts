import type { Candidate, SourceAdapter } from './types.js'

interface RepoMeta { repo: string; stars: number; pushedAt: string; defaultBranch: string }

export function parseRepoSearch(json: unknown): RepoMeta[] {
  const items = (json as { items?: unknown[] }).items ?? []
  return items.map((r) => {
    const o = r as Record<string, unknown>
    return {
      repo: String(o.full_name),
      stars: Number(o.stargazers_count ?? 0),
      pushedAt: String(o.pushed_at ?? ''),
      defaultBranch: String(o.default_branch ?? 'main'),
    }
  })
}

// Cap SKILL.md blobs taken from any one repo so a hostile repo tree can't flood the run.
export const MAX_FILES_PER_REPO = 200

export function parseTree(
  json: unknown,
  meta: { repo: string; ref: string; stars: number; pushedAt: string },
): Candidate[] {
  const tree = (json as { tree?: unknown[] }).tree ?? []
  const out: Candidate[] = []
  for (const n of tree) {
    const o = n as Record<string, unknown>
    if (o.type !== 'blob') continue
    const path = String(o.path)
    // Exact filename only — endsWith('SKILL.md') would also match MYSKILL.md.
    if (path !== 'SKILL.md' && !path.endsWith('/SKILL.md')) continue
    out.push({
      sourceUrl: `https://github.com/${meta.repo}/blob/${meta.ref}/${path}`,
      repo: meta.repo,
      path,
      ref: meta.ref,
      stars: meta.stars,
      pushedAt: meta.pushedAt,
    })
    if (out.length >= MAX_FILES_PER_REPO) break
  }
  return out
}

// Topic queries only — the old `in:readme` query returned 441k mostly-irrelevant
// repos whose giant trees timed out the run. Real topics, auditable here.
export const TOPIC_QUERIES = [
  'topic:claude-skills',
  'topic:agent-skills',
  'topic:claude-code-skills',
  'topic:claude-code',
]

type ApiGet = (path: string) => Promise<unknown>

// Fail a hung/slow promise after ms so one giant repo tree can't stall the run.
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout>
  const timer = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms) })
  return Promise.race([p.finally(() => clearTimeout(t)), timer])
}

// Paginate a repo search to maxRepos (GitHub caps search at 1000 results = 10 pages).
export async function* paginateRepos(apiGet: ApiGet, query: string, maxRepos: number): AsyncIterable<RepoMeta> {
  for (let page = 1; page * 100 - 100 < maxRepos; page++) {
    const search = await apiGet(`/search/repositories?q=${encodeURIComponent(query)}&per_page=100&page=${page}&sort=stars`)
    const metas = parseRepoSearch(search)
    for (const m of metas) yield m
    if (metas.length < 100) return
  }
}

export interface GithubAdapterOpts {
  maxReposPerQuery?: number
  treeTimeoutMs?: number
  topics?: boolean
  codeSearch?: boolean
}

// discover() drives the network via an injected apiGet (tested modules stay pure;
// the real apiGet lives in fetch.ts and is wired in discover.ts).
export function githubAdapter(apiGet: ApiGet, opts: GithubAdapterOpts = {}): SourceAdapter {
  const { maxReposPerQuery = 1000, treeTimeoutMs = 15000, topics = true, codeSearch = false } = opts
  return {
    name: 'github',
    async *discover(): AsyncIterable<Candidate> {
      const seenRepos = new Set<string>()
      if (topics) {
        for (const q of TOPIC_QUERIES) {
          for await (const m of paginateRepos(apiGet, q, maxReposPerQuery)) {
            if (seenRepos.has(m.repo)) continue
            seenRepos.add(m.repo)
            let tree: unknown
            try {
              tree = await withTimeout(apiGet(`/repos/${m.repo}/git/trees/${m.defaultBranch}?recursive=1`), treeTimeoutMs)
            } catch {
              continue // hung/slow/deleted repo → skip, never abort
            }
            for (const c of parseTree(tree, { repo: m.repo, ref: m.defaultBranch, stars: m.stars, pushedAt: m.pushedAt })) {
              yield c
            }
          }
        }
      }
    },
  }
}
