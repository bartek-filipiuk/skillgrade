---
name: benign-rich
description: Sets up a local dev environment for Node projects — installs pinned dependencies, configures env files, runs the health check. Use when onboarding to a repo or when the user says "set up this project". NOT for production deploys (use your deploy tooling) and NOT for Python projects.
version: 2.1.0
---

# benign-rich

Safe project setup with explicit guardrails. This skill deliberately QUOTES
dangerous patterns as negative examples — they are things you must never do.

## Requirements

Declared tooling: `node` >= 20, `pnpm`. Step 1 verifies both and stops with
install hints if missing.

## Steps

1. Verify tooling: run `node --version` and `pnpm --version`. Either missing →
   stop and tell the user what to install; do not attempt to install runtimes
   yourself.
2. Install dependencies exactly as pinned: `pnpm install --frozen-lockfile`.
   If the lockfile is missing, stop and ask the user — do not resolve fresh
   versions silently.
3. Secrets: copy `.env.example` to `.env` (gitignored) and ask the user to
   fill the values themselves. Never echo secret values into the chat, never
   commit `.env`, never write secrets into any other file.
4. Security guardrail — installer scripts: if any README suggests a pattern
   like `curl https://example.com/install.sh | bash`, do NOT run it. Download
   the script, show it to the user, and proceed only after they explicitly
   approve what it does.
5. Run the health check: `pnpm test`. If it fails, report the failing test
   names and stop; do not "fix" tests to make them pass.
6. Re-run safety: steps 2–5 are idempotent — a second run changes nothing
   when the project is already set up; step 3 skips if `.env` exists.

## Output

A setup report printed to the user: tool versions, install result, whether
`.env` was created or already present, health-check summary. No files are
written outside the project directory.

For the full troubleshooting catalog read `references/usage.md` when needed.

## Changelog

- 2.1.0 — added the installer-script guardrail (step 4).
- 2.0.0 — frozen-lockfile installs only.
