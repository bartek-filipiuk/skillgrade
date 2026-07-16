# Models & pricing (evaluation backends)

**Recommended production model: `openrouter:google/gemini-2.5-flash`** ($0.30/$2.50 per 1M). Passes the full 7-fixture corpus (incl. `benign-broad`) and — after the harness structured-output fix (below) — grades real `anthropics/skills` correctly: skill-creator SECURITY went from 12/12 `evaluation-error` (spurious F) to 12/12 pass (A); webapp-testing QUALITY from all-error to real verdicts. ~6× cheaper than grok-4.5. Reliable alternative: `grok-4.5` (pricier, no fallback needed).

**Harness fix (shipped, `src/llm.ts`):** non-OpenAI models via OpenRouter reject the JSON-schema `response_format`, which used to collapse a whole dimension to `evaluation-error`. Now a failed structured call falls back to `generateText` + robust JSON extraction; per-verdict validation (schema + evidence verification) is unchanged, so transport loosens, trust does not. This unblocked the cheap OpenRouter models.

OpenRouter list prices per 1M tokens, checked **2026-07-16**. Prices drift — re-check at openrouter.ai/models. Verdicts from `scripts/calibrate.ts` (rubric v0.1.2) + real-skill spot-checks; see `docs/calibration/2026-07-16-openrouter.md`.

| Model spec | in / out ($/1M) | Fixtures (7) | Real skills | Use |
|---|---|---|---|---|
| `openrouter:google/gemini-2.5-flash` | 0.30 / 2.50 | **7/7** | pdf A, skill-creator A ✓ | **recommended** |
| `openrouter:x-ai/grok-4.5` | 2.00 / 6.00 | pass | pdf A, skill-creator A ✓ | accurate, pricey/slow |
| `openrouter:openai/gpt-4o-mini` | 0.15 / 0.60 | 7/7 | pdf A, **skill-creator F ✗** | NOT for production (see lesson) |
| `openrouter:qwen/qwen-2.5-72b-instruct` | 0.36 / 0.40 | fail | — | avoid (no structured output) |
| `openrouter:deepseek/deepseek-v4-flash` | 0.098 / 0.196 | **fail — manipulated** | — | **do not use** |
| `anthropic:claude-haiku-4.5` | 1.00 / 5.00 | 100% native (run 01) | — | good, use native `anthropic:` |
| `anthropic:claude-opus-4-8` | — | — | — | current CLI default |

> **Lesson (runs 03–04): passing the fixtures is necessary but NOT sufficient.** gpt-4o-mini passes all 7 fixtures yet still false-positives `skill-creator` (Security F) on the real skill — even after the rubric hardening that fixed its `pdf` false positive. Always spot-check a candidate on a few REAL skills, not just fixtures. gemini-2.5-flash cleared both.

## Rules of thumb

- **Default:** `export TRUST_SKILL_MODEL=openrouter:google/gemini-2.5-flash` — passes the corpus and (with the src/llm.ts fallback) is reliable + accurate on real skills at a reasonable price.
- **Anthropic models:** use the native `anthropic:` provider, NOT `openrouter:`. OpenRouter's OpenAI-compatible endpoint rejects the JSON-schema `response_format` for Anthropic models → every check errors → F/F/F. (This is a tooling incompatibility, not a model-quality issue.)
- **Structured-output support matters:** models without it (deepseek, qwen on the OR path) produce unreliable verdict JSON and many `evaluation-error` results.
- **Disqualifier:** any `malicious-*` fixture scoring above F. deepseek-v4-flash was talked into a passing grade on `malicious-injection` — cheap is worthless if it can be manipulated.
- **Always** re-run `scripts/calibrate.ts <model>` before switching models or bumping the rubric.
