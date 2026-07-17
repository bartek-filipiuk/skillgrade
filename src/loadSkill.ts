import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, basename } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { listSkillFiles } from '../checks/prechecks.js'

const execFileAsync = promisify(execFile)

export interface LoadedSkill {
  name: string
  source: string
  dir: string
  files: { path: string; content: string }[]
  contentHash: string
  numberedContent: string
}

// A git URL is ONLY one of: https/http/ssh ending in .git, or scp-like `user@host:path`.
// Everything else (local paths, "ext::sh -c ...", "--upload-pack=...", "file://...")
// is NOT a git URL, so it is read as a local path and never handed to `git`.
export function isGitUrl(source: string): boolean {
  if (/^(https?|ssh):\/\/[^\s]+\.git$/.test(source)) return true
  // scp-like: user@host:path. First char must be a normal ident char (never '-'),
  // so a dash-leading option string can't masquerade as an scp URL.
  if (/^[A-Za-z0-9_][A-Za-z0-9._-]*@[A-Za-z0-9._-]+:[^\s]+$/.test(source)) return true
  return false
}

// Trust boundary: this string is about to be an argument to `git clone`. Even though
// we use execFile (no shell) + a "--" separator, we still refuse anything that isn't a
// plain http(s)/ssh/scp URL — no leading dash (option injection), no whitespace/control
// chars, no ext::/file:: transports (which git can turn into command execution).
export function assertSafeGitUrl(url: string): void {
  if (!isGitUrl(url)) throw new Error(`refusing non-git URL: ${JSON.stringify(url)}`)
  if (url.startsWith('-')) throw new Error(`refusing dash-leading URL: ${JSON.stringify(url)}`)
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x20\x7f]/.test(url)) throw new Error(`refusing URL with whitespace/control chars`)
}

// Args built so the URL sits AFTER "--": git can never read it as an option, even if
// validation were bypassed. --depth 1 (shallow) + hooksPath=/dev/null (no repo hooks run).
export function gitCloneArgs(url: string, dest: string): string[] {
  return ['clone', '--depth', '1', '-c', 'core.hooksPath=/dev/null', '--', url, dest]
}

async function cloneGit(url: string): Promise<string> {
  assertSafeGitUrl(url)
  const dest = await mkdtemp(join(tmpdir(), 'trust-skill-clone-'))
  await execFileAsync('git', gitCloneArgs(url, dest), {
    // Belt-and-suspenders hardening: whitelist transports at the git level (blocks
    // ext::/file:: even if they slipped through), no interactive prompts, ignore
    // user/system git config so a hostile ~/.gitconfig can't inject behavior.
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ALLOW_PROTOCOL: 'https:http:ssh:git',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
    },
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  })
  return dest
}

function skillName(files: { path: string; content: string }[], dir: string): string {
  const skill = files.find((f) => f.path === 'SKILL.md')
  const m = skill?.content.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (m) {
    try {
      const fm = parseYaml(m[1]) as Record<string, unknown> | null
      const name = fm?.name
      if (typeof name === 'string' && name.trim()) return name.trim()
    } catch {
      // invalid YAML → fall through to basename
    }
  }
  return basename(dir) || 'skill'
}

// Hash: sha256 over each file's `path\0content\0`, files sorted by path. Filenames
// cannot contain NUL, so \0 is an unambiguous record delimiter — the same set of files
// hashes identically regardless of discovery order; a single byte change flips it.
function hashFiles(files: { path: string; content: string }[]): string {
  const h = createHash('sha256')
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    h.update(f.path)
    h.update('\0')
    h.update(f.content)
    h.update('\0')
  }
  return h.digest('hex')
}

// The <skill-content> tags and the N| line prefixes are OUR frame; file bytes are only
// data inside it. Every content line is prefixed, so a literal "</skill-content>" or "N|"
// in the file is emitted prefixed (e.g. "1|</skill-content>") and can't be confused with
// our unprefixed real closer. Path is attribute-escaped so a quote in a filename can't
// break out of path="...".
export function numberContent(files: { path: string; content: string }[]): string {
  return files
    .map((f) => {
      const path = f.path.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/[\r\n]/g, '')
      const numbered = f.content
        .split('\n')
        .map((line, i) => `${i + 1}|${line}`)
        .join('\n')
      return `<skill-content path="${path}">\n${numbered}\n</skill-content>`
    })
    .join('\n')
}

export async function loadSkill(source: string): Promise<LoadedSkill> {
  const dir = isGitUrl(source) ? await cloneGit(source) : source
  // listSkillFiles already skips .git/node_modules/binaries and never follows symlinks.
  const files = listSkillFiles(dir)
  return {
    name: skillName(files, dir),
    source,
    dir,
    files,
    contentHash: hashFiles(files),
    numberedContent: numberContent(files),
  }
}
