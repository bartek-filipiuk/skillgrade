# Models & pricing (evaluation backends)

OpenRouter list prices per 1M tokens, checked **2026-07-16**. Prices drift — re-check at openrouter.ai/models before relying on them. Verdicts come from `scripts/calibrate.ts` against the fixture corpus (see `docs/calibration/2026-07-16-openrouter.md`).

| Model spec | in / out ($/1M) | Structured output | Calibration | Use |
|---|---|---|---|---|
| `openrouter:openai/gpt-4o-mini` | 0.15 / 0.60 | native | **6/6** | **recommended default** |
| `openrouter:google/gemini-2.5-flash` | 0.30 / 2.50 | native | pass (all malicious → F) | safe alternative |
| `openrouter:x-ai/grok-4.5` | 2.00 / 6.00 | native | pass (slightly over-strict) | max caution, pricey/slow |
| `openrouter:qwen/qwen-2.5-72b-instruct` | 0.36 / 0.40 | none (OR path) | fail (spurious F, errors) | avoid |
| `openrouter:deepseek/deepseek-v4-flash` | 0.098 / 0.196 | none (OR path) | **fail — manipulated** | **do not use** |
| `anthropic:claude-haiku-4.5` | 1.00 / 5.00 (OR) | native (anthropic:) | 100% native (run 01) | good, use native provider |
| `anthropic:claude-opus-4-8` | — | native | — | current CLI default |

## Rules of thumb

- **Default:** `export TRUST_SKILL_MODEL=openrouter:openai/gpt-4o-mini` — cheapest that resists the evaluator-injection fixture and has reliable structured output.
- **Anthropic models:** use the native `anthropic:` provider, NOT `openrouter:`. OpenRouter's OpenAI-compatible endpoint rejects the JSON-schema `response_format` for Anthropic models → every check errors → F/F/F. (This is a tooling incompatibility, not a model-quality issue.)
- **Structured-output support matters:** models without it (deepseek, qwen on the OR path) produce unreliable verdict JSON and many `evaluation-error` results.
- **Disqualifier:** any `malicious-*` fixture scoring above F. deepseek-v4-flash was talked into a passing grade on `malicious-injection` — cheap is worthless if it can be manipulated.
- **Always** re-run `scripts/calibrate.ts <model>` before switching models or bumping the rubric.
