# SkillHub — brief for Claude Design

Goal: a hub page presenting Claude Code skills (and, later, MCP servers) with a trust rating/badge assigned automatically by the **trust-skill** tool. A visitor discovers skills, filters by category and quality, and sees *why* a skill got its grade — with evidence, not just a number.

You'll do the design in Claude Design. This document describes **what** we present and **which elements** exist in the data; the look (typography, color, layout) is yours. Data source: `hub/catalog.json` (contract below). Scaffolding preview: `hub/preview.html`. **Language: English.**

---

## 1. Overriding design principle

This is a **trust hub**, not a marketing catalog. Three things must be visually immediate:

1. **Badge** — the per-dimension grade (Security / Quality / Hygiene), a letter A–F. This is the hero of the screen.
2. **Evidence** — every skill has highlights: concrete check verdicts (e.g. "S03 warning: `curl|bash` quoted as forbidden"). The grade is auditable, not magic.
3. **Category** — one of 10 fixed categories, assigned automatically. Filter and ordering.

If anything dominates with color, it's the badge scale. The rest of the UI stays calm so the A–F letters and pass/warning/fail statuses carry the meaning.

---

## 2. Screens

### 2.1 Landing / hero
- Product name (**SkillHub**), one-line value prop: "Automatically evaluated Claude Code skills — security, quality, hygiene, with evidence."
- Stats bar (from `catalog.json`): number of skills evaluated, number of categories, how many A, how many rejected (F), rubric version (`rubricVersion`).
- CTA: "Browse skills" → list. Optionally "How we grade" → methodology section (content from the rubric).

### 2.2 Skill list / grid (main screen)
- One card per skill (see 3). Responsive grid.
- **Filters:** category chips (10 + "All"); also worth having: a minimum-grade filter (A / ≥B / ≥C), and a "show fixtures" toggle (demo skills — see `kind`).
- **Sort:** default by `overall` (A→F), alternatively alphabetical / by category.
- Empty filter state: "No skills in this category."

### 2.3 Skill detail (expanded card / dedicated page)
- Full per-dimension badges + `overall`.
- **All** highlights (the list card shows 2–3; here the full set ≤6), grouped or sorted by status (fail → warning → pass).
- Pre-check facts (`preCheck`): frontmatter valid?, file count, SKILL.md size, count of critical/major flags from the deterministic layer 1.
- Metadata: `rubricVersion`, `evaluatedAt`, `evaluator` (model + mode), `source` (path/URL), `contentHash` in the future (invalidates the badge when content changes).
- Tagline as a subtitle.

---

## 3. Anatomy of a skill card

Elements (all in the catalog entry data):

| Element | Field | Visual note |
|---|---|---|
| Name | `name` | card heading |
| Category | `category` → label from `taxonomy` | small eyebrow label above the name |
| Fixture marker | `kind` = `fixture` | visually distinguish (e.g. dashed border, "example" tag) — these are not real skills, just a demonstration of the grade spectrum |
| Tagline | `tagline` | one sentence, ≤140 chars |
| Badge ×3 | `badges.security` / `.quality` / `.hygiene` | **the main accent**; letter A–F; `not-evaluated` = neutral state (dash/grey) |
| Overall grade | `overall` | worst of the graded dimensions; for sorting and an optional large letter |
| Highlights | `highlights[]` | list: `check` (e.g. S03), `status`, `summary`; 2–3 on the card, the rest in detail |
| Effectiveness | `badges.effectiveness` | always `not-evaluated` in v1 — show as "coming soon"/disabled; it's a deliberate reserved slot |

### Badge scale (color carries meaning)
- **A** — best; **B** good; **C** acceptable; **D** poor; **F** rejected (critical problem, usually security).
- `not-evaluated` — not graded (neutral, NOT red — no grade ≠ bad grade).
- Suggested semantics: A/B green→lime, C yellow, D orange, F red, not-evaluated grey. You pick the exact colors; what matters is **monotonicity** (A best, F worst) and a distinct F.

### Highlight statuses (micro-labels next to a check)
- `pass` (green), `warning` (yellow), `fail` (red), `not-applicable` (grey), `evaluation-error` (grey/warning — a rare evaluation failure).
- Check format: `S`=Security, `Q`=Quality, `H`=Hygiene + number (e.g. `S03`, `Q10`, `H05`).

---

## 4. Taxonomy (10 categories — fixed)

From `catalog.json.taxonomy`; each skill has exactly one. `id` → `label` → `description`:

1. **code-quality** — Code Review & Quality
2. **security** — Security & Audits
3. **build** — Build & Prototyping
4. **deployment** — Deployment & Ops
5. **content** — Content & Writing
6. **media** — Video & Media
7. **project-intel** — Project Intelligence
8. **workflow** — Dev Workflow & Automation
9. **integrations** — Integrations & CRM
10. **meta** — Meta & Skill Tooling

Design so the chips fit on one–two rows; consider a per-category icon (optional).

---

## 5. Data contract — `hub/catalog.json`

```jsonc
{
  "generatedAt": "ISO-8601",
  "rubricVersion": "0.1.1",
  "taxonomy": [ { "id": "code-quality", "label": "Code Review & Quality", "description": "..." }, ... ],
  "skills": [
    {
      "name": "code-reviewer",
      "source": "/path|git-url",
      "kind": "skill",                 // "skill" | "fixture"
      "category": "code-quality",      // one of taxonomy.id
      "tagline": "…one sentence…",
      "badges": { "security": "A", "quality": "A", "hygiene": "A", "effectiveness": "not-evaluated" },
      "overall": "A",                  // worst of the graded dimensions (computed in code)
      "highlights": [
        { "check": "S03", "status": "warning", "summary": "…why…" }
      ],
      "preCheck": {                    // deterministic facts (layer 1, no LLM)
        "frontmatterValid": true,
        "fileCount": 4,
        "skillMdBytes": 2547,
        "criticalFlags": 1,
        "majorFlags": 0
      },
      "rubricVersion": "0.1.1",
      "evaluatedAt": "ISO-8601",
      "evaluator": { "mode": "claude-code-native", "model": "claude-fable-5" }
    }
  ]
}
```

All letters are limited to `A|B|C|D|F|not-evaluated`. Highlight `status`: `pass|fail|warning|not-applicable|evaluation-error`.

---

## 6. States the design must handle

- Badge `not-evaluated` (Effectiveness always; sometimes Quality/Hygiene for security-only fixtures like `malicious-exfil`).
- A skill graded **F** — must read clearly as "rejected", but not garishly ugly; F is information, not visual punishment.
- Fixture (`kind: fixture`) — distinguished from real skills; the hub may hide them behind a toggle by default.
- A `warning` highlight carrying a false-positive de-escalation (e.g. benign-rich S03) — this is a *positive* story ("the tool doesn't punish documenting threats"); make it tellable.
- A card with no fail/warning highlights (all pass) — calm, "clean".
- Long taglines / many categories — layout must not break (see responsiveness).

---

## 7. What NOT to do

- Don't show `overall` as the only number — it hides that a skill can be excellent in quality but unsafe. Per-dimension is the essence.
- Don't color `not-evaluated` red/green — it's missing data, not a grade.
- Don't present fixtures as recommended skills.
- Don't hide the evidence (highlights) — without it the badge is un-auditable and loses its "trust" meaning.

---

## 8. Demo data in this version

`catalog.json` has 13 entries: 9 real skills (honest grades — mostly A, `idea-to-mvp` a B because of SKILL.md size) + 4 fixtures demonstrating the full spectrum: `benign-minimal` (A/A/A), `benign-rich` (A, with the S03 warning de-escalation), `sloppy-but-safe` (A/C/C — dimension divergence), `malicious-exfil` (F). This covers every badge state from §6. Generated by native evaluation in Claude Code (no API key); in production the same `catalog.json` is produced by the `trust-skill` CLI against any model (Anthropic, OpenAI, Ollama, OpenRouter).
