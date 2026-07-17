import type { Candidate } from './adapters/types.js'

export const ALLOWED_HOSTS = new Set(['api.github.com', 'raw.githubusercontent.com'])
export const MAX_BYTES = 262144 // 256 KB — larger "SKILL.md" is junk or an attack

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|::1)/i
const PRIVATE_172 = /^172\.(1[6-9]|2\d|3[01])\./

// SSRF guard: only https, only allowlisted hosts, never a private/link-local target.
export function assertAllowedUrl(url: string): void {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new Error(`unparseable URL: ${JSON.stringify(url)}`)
  }
  if (u.protocol !== 'https:') throw new Error(`refusing non-https URL: ${url}`)
  if (!ALLOWED_HOSTS.has(u.hostname)) throw new Error(`host not allowlisted: ${u.hostname}`)
  if (PRIVATE_HOST.test(u.hostname) || PRIVATE_172.test(u.hostname)) throw new Error(`refusing private host: ${u.hostname}`)
}

// Provenance allowlist: which hosts a Candidate's sourceUrl may legitimately come from.
// Wider than ALLOWED_HOSTS because the canonical link is a github.com/blob URL, but a
// candidate whose provenance is off-github is not trusted enough to fetch its repo/path.
const PROVENANCE_HOSTS = new Set(['github.com', 'api.github.com', 'raw.githubusercontent.com'])

function provenanceOk(sourceUrl: string): boolean {
  try {
    const u = new URL(sourceUrl)
    return u.protocol === 'https:' && PROVENANCE_HOSTS.has(u.hostname)
  } catch {
    return false
  }
}

// A github.com/{repo}/blob/{ref}/{path} link → the raw.githubusercontent.com URL we fetch.
function rawUrl(c: Candidate): string {
  return `https://raw.githubusercontent.com/${c.repo}/${c.ref}/${c.path}`
}

export interface FetchOpts {
  fetchFn?: typeof fetch
  token?: string
  maxBytes?: number
  etag?: string
}

// Returns {content, etag} on 200, or null on 304 / any failure (caller logs + skips).
// Enforces the allowlist BEFORE any network call and caps the body size.
export async function fetchSkillMd(c: Candidate, opts: FetchOpts = {}): Promise<{ content: string; etag?: string } | null> {
  const { fetchFn = fetch, token, maxBytes = MAX_BYTES, etag } = opts
  if (!provenanceOk(c.sourceUrl)) return null // untrusted provenance → skip, don't fetch
  const url = rawUrl(c)
  try {
    assertAllowedUrl(url)
  } catch {
    return null // refused hosts are skipped, not fatal
  }
  const headers: Record<string, string> = { accept: 'text/plain' }
  if (token) headers.authorization = `Bearer ${token}`
  if (etag) headers['if-none-match'] = etag
  let res: Response
  try {
    res = await fetchFn(url, { headers })
  } catch {
    return null
  }
  if (res.status === 304) return null
  if (!res.ok) return null
  const body = await res.text()
  if (body.length > maxBytes) return null
  const newEtag = res.headers.get('etag') ?? undefined
  return { content: body, etag: newEtag }
}
