# SkillGrade MCP

A read-only [MCP](https://modelcontextprotocol.io) server that lets a consumer agent
check locally-installed Claude skills against the SkillGrade catalog — by **SKILL.md
hash** and/or name — and get back a grade, verdict, and findings.

The server ships the graded catalog inside its image (`hub/catalog.json`, zod-validated
at startup — malformed catalog = fail loud, won't boot). It **executes nothing**, fetches
no user-supplied URL, and never receives skill content. See [Trust boundary](#trust-boundary).

## Run

```bash
pnpm mcp                 # = tsx mcp/server.ts, listens on $PORT (default 8080) at /mcp
```

Startup logs one line, e.g.:

```
skillgrade MCP on :8080/mcp (120 hashed skills)
```

Smoke-test `tools/list` (Streamable HTTP transport needs the JSON+SSE accept header):

```bash
curl -sS http://localhost:8080/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Tools

All results are JSON with a `status` field (one of the four below). Send **only**
`{name, hash}` — never skill content.

### `lookup_skill({ hash?, name? })`
Match one skill. Resolution order: hash first, then name.
- hash matches a graded entry → **`verified`** (full grade below)
- name matches but hash differs → **`drift`**
- name matches, no hash supplied → **`reference`**
- nothing matches → **`unknown`**

A `verified` result contains: `name`, `category`, `overall` (A–F), `badges`
`{security, quality, hygiene}`, `verdict`, `findings[]` (each `{check, dimension,
status, summary}`), `gradedHash`, `rubricVersion`, `evaluatedAt`, `reportUrl`, `sourceUrl`.

### `audit_skills({ skills: [{ name?, hash? }] })`
Batch `lookup_skill` over an installed skill set. Returns:
- `summary`: `{ total, verified, drifted, unknown, gradeCounts }` (`gradeCounts` = grade
  histogram over the verified skills; `reference` results count only in `total`)
- `skills`: the per-skill `lookup_skill` results, in order

### `search({ query })`
Substring match on skill name. Returns hits of `{name, overall, category, reportUrl}`.
No hash needed — this is discovery, not verification.

### `grade_skill({ content })` — paid fresh grade
Grade a `SKILL.md` that isn't in the catalog yet. Unlike the lookup tools, this one
**does** receive the skill content — but only in memory, for the duration of the
grade. **Content is never stored.**

- **Auth:** requires an API token from the account dashboard
  (<https://account.skillgrade.dev>), passed as `Authorization: Bearer <token>`
  (preferred) or the `token` arg. Missing/invalid token → `{ error: 'invalid-token' }`.
- **Free catalog short-circuit:** the content is hashed locally; if that hash is
  already in the graded catalog the stored grade is returned for **free** —
  `{ charged: false, source: 'catalog', overall, badges, name, reportUrl }`. No token
  charge, no LLM call.
- **Paid path:** a novel skill charges **one credit**, then grades in memory →
  `{ charged: true, remaining, overall, badges, findings, skillMdHash }`. If grading
  throws, the credit is **refunded** and you get `{ error: 'grade-failed' }`.
- Content over the size cap → `{ error: 'too-large', maxBytes }`; no credits → `{ error: 'no-credits' }`.

## Environment (paid path)

The read-only lookup tools need no env beyond `PORT`. `grade_skill` adds:

| var | purpose |
|---|---|
| `INTERNAL_URL` | Account service origin (e.g. `https://account.skillgrade.dev`) for charge/refund. |
| `INTERNAL_SECRET` | Shared secret sent as `x-internal-secret`; must match the Account service's `INTERNAL_SECRET`. |
| `OPENROUTER_API_KEY` | Key for the grader model (`openrouter:google/gemini-2.5-flash`). |

### The four result statuses
| status | meaning |
|---|---|
| **verified** | Your hash matches a skill we graded — this is exactly the copy we evaluated. |
| **drift** | Same name, different hash — you have a modified or different version; we can't vouch for it. |
| **reference** | Name match with no hash supplied — here's our grade, but we can't confirm it's your exact copy. |
| **unknown** | Not in the catalog yet. |

## Normalization rules (VERBATIM — reproduce these to make hashes match)

The hash is computed over the **`SKILL.md` file ONLY** (not the bundle, not other files).
A consumer agent MUST apply these exact steps, in order, or hashes will never match. This
must match [`mcp/normalize.ts`](./normalize.ts) exactly:

1. **Decode UTF-8**, and strip a single leading BOM (`U+FEFF`) if present.
2. **CRLF and lone CR → LF** (every `\r\n` and every remaining `\r` becomes `\n`).
3. **rstrip** all trailing whitespace/newlines at the **end of the file**.
4. **sha256** of the resulting UTF-8 bytes, as **lowercase hex**.

Reference (`mcp/normalize.ts`):

```ts
export function normalizeSkillMd(content: string): string {
  let s = content
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1)   // 1. strip leading BOM
  s = s.replace(/\r\n?/g, '\n')                    // 2. CRLF / CR -> LF
  s = s.replace(/\s+$/, '')                        // 3. rstrip trailing whitespace
  return s
}
export function hashSkillMd(content: string): string {
  return createHash('sha256').update(normalizeSkillMd(content), 'utf8').digest('hex') // 4. sha256 hex
}
```

Only leading BOM and *trailing* whitespace are stripped; interior content, aside from
line-ending normalization (step 2), is left intact.

## Trust boundary

- Only `{name, hash}` ever leaves the user's machine. **Skill content never does** —
  the agent hashes `SKILL.md` locally and sends the digest.
- The server **executes nothing** and **fetches no user-supplied URL**. It only reads
  its own in-image catalog and returns JSON.
- The lookup tools (`lookup_skill`, `audit_skills`, `search`) are read-only over
  graded data: no auth, no LLM, no content submission. The paid `grade_skill` tool
  is the one exception — it takes a bearer token and grades submitted content **in
  memory only** (never stored, never persisted after the response).

## Coolify deploy

Deploy as a **new** Coolify application (its own app UUID, separate from the hub):

| setting | value |
|---|---|
| source | public repo |
| build pack | `dockerfile` |
| Dockerfile path | `mcp/Dockerfile` |
| build context | repo **root** (so `hub/catalog.json` is in the image) |
| `ports_exposes` | `8080` |
| domain | `https://mcp.skillgrade.dev` |

DNS: add an **A record** `mcp.skillgrade.dev → 65.109.60.26`.

**Redeploy whenever `hub/catalog.json` is rebuilt** — the catalog is baked into the image
at build time, so a rebuilt catalog only reaches production on the next deploy.
