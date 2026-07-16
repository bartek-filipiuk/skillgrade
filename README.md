# trust-skill

Automated trust evaluation for Claude Code skills (and, later, public MCP servers). Produces a per-dimension badge — **Security / Quality / Hygiene**, graded A–F — plus an auditable report with evidence quotes for every finding. Powers the [SkillHub](CLAUDE_DESIGN.md).

The scoring is deterministic (computed in code, never by the model); the rubric lives as data in `rubric/skill/` and is designed so a *weaker* model can execute it faithfully. Works in Claude Code natively, or standalone via CLI against any provider — including OpenRouter.

## Install

```bash
pnpm install
```

Node ≥ 20. No API key is needed for the deterministic pre-check layer.

## Scan a skill

A "skill" is a directory containing `SKILL.md` plus any helper files. Source can be a **local path** or a **git URL** (shallow-cloned to a temp dir, never executed).

### 1. Free, no API key — deterministic pre-checks only

```bash
pnpm tsx src/cli.ts evaluate ./path/to/skill --no-llm
```

Runs layer 1: frontmatter validation, file inventory, and pattern/canary scan (piped-shell, secret reads, hardcoded egress, evaluator-manipulation, hidden instructions…). No letter grades — badges come back `not-evaluated`. **Exit code 2** if any critical/major flag is found, so it works as a free first-pass filter for a hub. Exit 0 = clean, 1 = usage error.

### 2. Full scan — with a model

```bash
pnpm tsx src/cli.ts evaluate ./path/to/skill --model <provider:model-id> --out report.json
```

Layer 2 sends the skill (as untrusted data) plus the rubric, one dimension per call, and gets back per-check verdicts (`pass|fail|warning|not-applicable`) with a verbatim evidence quote for every fail/warning. Quotes are verified against the cited line — a hallucinated quote is rejected. Code then aggregates the letters.

Output: `report.json` (the hub contract, see `docs/superpowers/specs/…-design.md` §3.6) plus a rendered markdown summary on stdout.

### Options

| Flag | Meaning |
|---|---|
| `--model provider:model-id` | Which LLM runs layer 2 (default `anthropic:claude-opus-4-8`, or `$TRUST_SKILL_MODEL`) |
| `--no-llm` | Skip layer 2; deterministic pre-checks only |
| `--dimension security\|quality\|hygiene` | Evaluate one dimension instead of all three |
| `--runs N` | Odd N; majority vote per check across runs (ties → worse status) |
| `--out report.json` | Write the JSON report to a file (also always printed to stdout as markdown) |

## Models & providers

The `--model` value is `provider:model-id`. Split is on the **first** colon, so model ids may contain colons/slashes.

| Provider | Spec example | Env vars |
|---|---|---|
| Anthropic | `anthropic:claude-opus-4-8` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai:gpt-4o-mini` | `OPENAI_API_KEY`, opt. `OPENAI_BASE_URL` |
| Ollama (local) | `ollama:llama3:8b` | opt. `OLLAMA_BASE_URL` (default `http://localhost:11434/v1`) |
| **OpenRouter** | `openrouter:anthropic/claude-3.5-haiku` | `OPENROUTER_API_KEY`, opt. `OPENROUTER_BASE_URL` |

### OpenRouter

OpenRouter is an OpenAI-compatible gateway to many models — the simplest way to run trust-skill against Anthropic, Google, Llama, etc. behind one key.

```bash
export OPENROUTER_API_KEY=sk-or-...

# any OpenRouter model id (note the slash; :free / :nitro variants work too)
pnpm tsx src/cli.ts evaluate ./path/to/skill \
  --model openrouter:anthropic/claude-3.5-haiku --out report.json

pnpm tsx src/cli.ts evaluate ./path/to/skill \
  --model openrouter:google/gemini-flash-1.5 --dimension security
```

Because the rubric is written to be executable by a weaker model (calibration showed 100% per-check agreement between a strong and a small model on the hard fixtures), a cheap OpenRouter model is a reasonable production choice — pick by price/latency and re-run calibration if you switch.

## Build the hub catalog

`hub/build-catalog.ts` assembles `hub/catalog.json` (the data the SkillHub renders) from per-skill evaluations, merging in real pre-check facts, then emits a scaffolding `hub/preview.html`.

```bash
pnpm tsx hub/build-catalog.ts
```

See `CLAUDE_DESIGN.md` for the hub's data contract and UI element spec.

## Use inside Claude Code (no CLI, no key)

The `skills/trust-skill/` skill drives the same rubric natively: Claude runs the pre-checks via Bash, reads the rubric, classifies each check, and computes letters through `src/aggregate-cli.ts` (never in its head). Trigger it with "evaluate this skill" / "trust check".

## How it evaluates (two layers)

1. **Deterministic pre-checks** (`checks/`, no LLM) — facts and red-flag patterns, including a canary check for attempts to manipulate the evaluator.
2. **LLM against the rubric** (`src/llm.ts`) — one call per dimension, structured output, evidence verified in code.

**The evaluated skill is always untrusted data.** It is wrapped in delimiters, never executed, and instructions inside it (including any aimed at the evaluator) are treated as data — and as evidence for the evaluator-manipulation check. Git clones are hardened (no shell, protocol allow-list, hooks disabled) and symlinks are never followed.

## Test

```bash
pnpm test        # 107 tests, offline (LLM layer uses mock models)
pnpm typecheck
```
