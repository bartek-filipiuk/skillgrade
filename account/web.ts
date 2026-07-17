// Self-contained HTML for the account pages, in the SkillGrade hub's design
// language (dark #171614, Instrument Serif/Sans + IBM Plex Mono, accent
// oklch(0.8 0.11 155)). Every value interpolated into HTML goes through esc()
// — a served page must not be XSS-able by a token label or a balance string.

export function esc(v: unknown): string {
  return String(v).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

const HEAD = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Instrument+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;padding:0;background:#171614;color:#ece7dc;font-family:'Instrument Sans',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  *{box-sizing:border-box}
  a{color:oklch(0.8 0.11 155);text-decoration:none}a:hover{text-decoration:underline}
  .serif{font-family:'Instrument Serif',serif;font-weight:400}
  .mono{font-family:'IBM Plex Mono',monospace}
  .wrap{max-width:560px;margin:0 auto;padding:64px 24px}
  h1{font-weight:400;margin:0}
  label{display:block;font-size:12px;letter-spacing:.04em;color:#9a948a;margin:18px 0 6px}
  input{width:100%;background:#111010;border:1px solid rgba(232,226,214,.14);border-radius:4px;color:#ece7dc;font-family:inherit;font-size:15px;padding:11px 13px}
  input:focus{outline:none;border-color:oklch(0.8 0.11 155)}
  button.cta{background:#ece7dc;color:#171614;font-size:14.5px;font-weight:600;padding:12px 22px;border:none;border-radius:2px;cursor:pointer}
  button.cta:hover{background:#fff}
  .ghost{border:1px solid rgba(232,226,214,.22);background:none;color:#ece7dc;font-size:14px;padding:10px 18px;border-radius:2px;cursor:pointer}
  .kicker{font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.18em;color:oklch(0.8 0.11 155);margin:0 0 18px}
  .err{color:#e8a0a0;font-size:13.5px;margin:14px 0 0}
  .card{background:#1a1917;border:1px solid rgba(232,226,214,.1);border-radius:6px;padding:22px 24px}
  .snippet{background:#111010;border:1px solid rgba(232,226,214,.14);border-radius:4px;padding:14px 16px;font-family:'IBM Plex Mono',monospace;font-size:12.5px;color:#ece7dc;overflow-x:auto;white-space:pre-wrap;word-break:break-all}
</style>`

const page = (title: string, body: string) =>
  `<!DOCTYPE html><html lang="en"><head><title>${esc(title)}</title>${HEAD}</head><body><main class="wrap">${body}</main></body></html>`

const authForm = (action: string, submit: string) => `
  <form method="post" action="${action}">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="email" required>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" minlength="8" required>
    <div style="margin-top:26px"><button class="cta" type="submit">${submit}</button></div>
  </form>`

export function renderRegister(error?: string): string {
  return page('Create account · SkillGrade', `
    <p class="kicker">SKILLGRADE · ACCOUNT</p>
    <h1 class="serif" style="font-size:42px">Create your account</h1>
    <p style="color:#9a948a;font-size:15px;margin:14px 0 0">Two free grades on signup. No card required.</p>
    ${error ? `<p class="err">${esc(error)}</p>` : ''}
    ${authForm('/register', 'Create account')}
    <p style="margin-top:24px;font-size:14px;color:#9a948a">Already have an account? <a href="/login">Sign in</a></p>`)
}

export function renderLogin(error?: string): string {
  return page('Sign in · SkillGrade', `
    <p class="kicker">SKILLGRADE · ACCOUNT</p>
    <h1 class="serif" style="font-size:42px">Sign in</h1>
    ${error ? `<p class="err">${esc(error)}</p>` : ''}
    ${authForm('/login', 'Sign in')}
    <p style="margin-top:24px;font-size:14px;color:#9a948a">No account yet? <a href="/register">Create one</a></p>`)
}

export interface DashboardView {
  balance: number
  packs: Record<string, number>
  token?: string
}

export function renderDashboard(v: DashboardView): string {
  const packBtns = Object.entries(v.packs).map(([priceId, credits]) => `
    <form method="post" action="/buy/${encodeURIComponent(priceId)}" style="flex:1;min-width:150px">
      <button class="ghost" type="submit" style="width:100%">Buy ${esc(credits)} credits</button>
    </form>`).join('')

  const cmd = `claude mcp add --transport http skillgrade https://mcp.skillgrade.dev/mcp --header "Authorization: Bearer ${v.token ?? ''}"`
  const tokenBlock = v.token ? `
    <div class="card" style="margin-top:28px;border-color:oklch(0.8 0.11 155 / .4)">
      <p class="mono" style="font-size:11px;letter-spacing:.12em;color:oklch(0.8 0.11 155);margin:0 0 10px">NEW TOKEN · SHOWN ONCE</p>
      <div class="snippet" id="tok">${esc(v.token)}</div>
      <button class="ghost" style="margin-top:12px" onclick="navigator.clipboard.writeText(document.getElementById('tok').textContent)">Copy token</button>
      <p style="font-size:13px;color:#9a948a;margin:20px 0 8px">Add the MCP server with this token:</p>
      <div class="snippet">${esc(cmd)}</div>
    </div>` : ''

  return page('Dashboard · SkillGrade', `
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:16px">
      <p class="kicker" style="margin:0">SKILLGRADE · DASHBOARD</p>
      <form method="post" action="/logout"><button class="ghost" type="submit" style="padding:6px 14px;font-size:12px">Sign out</button></form>
    </div>
    <h1 class="serif" style="font-size:44px;margin-top:20px">${esc(v.balance)}<span style="font-size:18px;color:#9a948a"> credits</span></h1>
    <p style="color:#9a948a;font-size:15px;margin:10px 0 0">Each grade costs one credit. Buy more below.</p>
    <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:26px">${packBtns}</div>
    <div style="margin-top:34px">
      <form method="post" action="/token/rotate"><button class="cta" type="submit">Generate API token</button></form>
      <p style="font-size:13px;color:#8a857b;margin:10px 0 0">Generating a new token does not revoke old ones.</p>
    </div>
    ${tokenBlock}`)
}
