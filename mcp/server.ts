import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { CatalogSchema } from '../hub/schema.js'
import { buildIndex, type SkillIndex } from './index-build.js'
import { makeHandlers } from './handlers.js'
import { makeGradeSkill } from './grade-skill.js'
import { gradeContent } from './grade-content.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const RUBRIC_DIR = join(HERE, '../rubric/skill')
const MAX_GRADE_BYTES = 262144

// charge/refund hit the Account service's internal routes with the shared secret.
async function postInternal(path: string, body: unknown) {
  return fetch(`${process.env.INTERNAL_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET ?? '' },
    body: JSON.stringify(body),
  })
}

function gradeSkillDeps(index: SkillIndex) {
  return makeGradeSkill({
    index,
    gradeContent: (content) => gradeContent(content, { rubricDir: RUBRIC_DIR, model: 'openrouter:google/gemini-2.5-flash' }),
    charge: async (token) => {
      const res = await postInternal('/internal/charge', { token })
      if (res.status === 401) return { ok: false as const, reason: 'invalid-token' as const }
      if (!res.ok) throw new Error(`charge failed: ${res.status}`) // fail loud (e.g. 500 / bad INTERNAL_SECRET)
      const j = (await res.json()) as { ok: boolean; remaining: number }
      return j.ok ? { ok: true as const, remaining: j.remaining } : { ok: false as const, reason: 'no-credits' as const }
    },
    // Never throw: a lost refund must leave a loud, replayable trace, not reject the tool call.
    refund: async (token, ref) => {
      try {
        const res = await postInternal('/internal/refund', { token, ref })
        if (!res.ok) console.error('[grade_skill] REFUND FAILED ref=%s status=%s — credit must be manually restored', ref, res.status)
      } catch (err) {
        console.error('[grade_skill] REFUND FAILED ref=%s status=%s — credit must be manually restored', ref, err)
      }
    },
    maxBytes: MAX_GRADE_BYTES,
  })
}

// Prefer the request's `Authorization: Bearer <token>` header; fall back to the token arg.
function bearerFrom(extra: { requestInfo?: { headers?: Record<string, string | string[] | undefined> } }): string | undefined {
  const raw = extra.requestInfo?.headers?.authorization
  const header = Array.isArray(raw) ? raw[0] : raw
  const m = header?.match(/^Bearer\s+(.+)$/i)
  return m?.[1]
}

export function loadIndex(): SkillIndex {
  const raw = JSON.parse(readFileSync(join(HERE, '../hub/catalog.json'), 'utf8'))
  return buildIndex(CatalogSchema.parse(raw)) // fail loud on a malformed catalog
}

export function buildMcpServer(index: SkillIndex): McpServer {
  const h = makeHandlers(index)
  const server = new McpServer({ name: 'skillgrade', version: '1.0.0' })

  server.registerTool('lookup_skill', {
    title: 'Look up one skill',
    description: 'Match a locally-installed skill against the SkillGrade catalog by SKILL.md hash and/or name. ' +
      'Returns verified / drift / reference / unknown. Send only {name, hash} — never skill content. ' +
      'Compute hash by normalizing SKILL.md (strip BOM; CRLF/CR->LF; rstrip trailing whitespace) then sha256 hex.',
    inputSchema: { hash: z.string().optional(), name: z.string().optional() },
  }, ({ hash, name }) => h.lookup({ hash, name }))

  server.registerTool('audit_skills', {
    title: 'Audit a set of skills',
    description: 'Batch version of lookup_skill for a whole installed skill set. Returns a summary + per-skill results.',
    inputSchema: { skills: z.array(z.object({ name: z.string().optional(), hash: z.string().optional() })).max(500) },
  }, ({ skills }) => h.audit({ skills }))

  server.registerTool('search', {
    title: 'Search graded skills',
    description: 'Find graded skills by name substring. Returns name, overall grade, category and report URL.',
    inputSchema: { query: z.string() },
  }, ({ query }) => h.search({ query }))

  const grader = gradeSkillDeps(index)
  server.registerTool('grade_skill', {
    title: 'Grade a SKILL.md (paid fresh grade)',
    description: 'Grade the submitted SKILL.md content against the SkillGrade rubric. Requires a bearer token — pass it as ' +
      'the Authorization header (preferred) or the `token` arg. A skill already in the public catalog returns its stored ' +
      'grade for FREE; anything new charges one credit and is refunded if grading fails. Content is graded in memory, never stored.',
    inputSchema: { content: z.string(), token: z.string().optional() },
  }, async ({ content, token }, extra) => {
    const result = await grader.handle({ content, token: bearerFrom(extra) ?? token })
    return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result }
  })

  return server
}

// ponytail: fixed-window in-memory rate limit; swap for a shared store only if we scale past one instance.
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 120
const hits = new Map<string, { count: number; resetAt: number }>()
function rateLimited(ip: string, now: number): boolean {
  const e = hits.get(ip)
  if (!e || now > e.resetAt) { hits.set(ip, { count: 1, resetAt: now + WINDOW_MS }); return false }
  e.count++
  return e.count > MAX_PER_WINDOW
}

// ponytail: trusts x-forwarded-for from the known front proxy (Coolify/Traefik/nginx).
// Without this, remoteAddress is the proxy IP — one bucket for the whole world.
function clientKey(req: import('node:http').IncomingMessage): string {
  const xff = req.headers['x-forwarded-for']
  const first = Array.isArray(xff) ? xff[0] : xff
  if (first) return first.split(',')[0].trim()
  return req.socket.remoteAddress ?? 'unknown'
}

export async function main() {
  const index = loadIndex()
  const port = Number(process.env.PORT ?? 8080)

  const httpServer = createServer(async (req, res) => {
    if (req.url !== '/mcp') { res.writeHead(404).end(); return }
    const ip = clientKey(req)
    if (rateLimited(ip, Date.now())) {
      res.writeHead(429, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'rate limit exceeded' }))
      return
    }
    // A fresh stateless transport + server per request (no session state to share).
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    const server = buildMcpServer(index)
    res.on('close', () => { transport.close(); server.close() })
    await server.connect(transport)
    await transport.handleRequest(req, res)
  })

  httpServer.listen(port, () => console.log(`skillgrade MCP on :${port}/mcp (${index.byHash.size} hashed skills)`))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
