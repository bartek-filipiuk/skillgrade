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
    if (!path.endsWith('SKILL.md')) continue
    out.push({
      sourceUrl: `https://github.com/${meta.repo}/blob/${meta.ref}/${path}`,
      repo: meta.repo,
      path,
      ref: meta.ref,
      stars: meta.stars,
      pushedAt: meta.pushedAt,
    })
  }
  return out
}

// Search queries that surface repos holding Claude Code skills. Kept explicit so
// coverage is auditable; add queries here, not magic elsewhere.
export const GITHUB_QUERIES = [
  'topic:claude-skills',
  'topic:agent-skills',
  'topic:claude-code-skills',
  'claude code skills in:name,description,readme',
]

type ApiGet = (path: string) => Promise<unknown>

// discover() drives the network via an injected apiGet (tested modules stay pure;
// the real apiGet lives in fetch.ts and is wired in discover.ts).
export function githubAdapter(apiGet: ApiGet): SourceAdapter {
  return {
    name: 'github',
    async *discover(): AsyncIterable<Candidate> {
      const seenRepos = new Set<string>()
      for (const q of GITHUB_QUERIES) {
        const search = await apiGet(`/search/repositories?q=${encodeURIComponent(q)}&per_page=100&sort=stars`)
        for (const m of parseRepoSearch(search)) {
          if (seenRepos.has(m.repo)) continue
          seenRepos.add(m.repo)
          const tree = await apiGet(`/repos/${m.repo}/git/trees/${m.defaultBranch}?recursive=1`)
          for (const c of parseTree(tree, { repo: m.repo, ref: m.defaultBranch, stars: m.stars, pushedAt: m.pushedAt })) {
            yield c
          }
        }
      }
    },
  }
}
