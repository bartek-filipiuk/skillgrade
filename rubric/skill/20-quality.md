# Quality Dimension

Checks Q01–Q10. Read `00-protocol.md` first. This dimension judges whether the
skill will actually WORK when an agent executes it: clear triggering, coherent
and executable instructions, defined outputs, sane failure behavior. It does
not judge safety (Security) or packaging (Hygiene).

## Q01 — Trigger clarity
severity: major
weight: 5

**Definition:** The frontmatter `description` states WHEN the skill should be
used — concrete situations, task types, or phrasings — not just what the skill
is.

**Pass example:**
```
description: Use when reviewing pull requests or diffs in Go projects — triggers on "review this PR", "check my diff".
```

**Fail example:**
```
description: A powerful productivity tool for developers.
```

**How to look:** Read only the `description` field. Ask: could a dispatching
agent, seeing a user request, decide from this text alone whether to invoke
the skill? Named situations, verbs, or example phrasings = pass. Pure
self-praise, vague nouns, or a description of internals with no usage cue =
fail. A description that says what it does but never when = warning.

## Q02 — Negative triggers
severity: minor
weight: 4

**Definition:** The skill tells the agent when NOT to use it — exclusions,
out-of-scope cases, or pointers to better-suited skills — preventing
misfiring on adjacent tasks.

**Pass example:**
```
NOT for: security audits (use security-audit), single-file formatting (use the formatter directly).
```

**Fail example:**
```
description: Reviews code. (No exclusions anywhere; skill body silent on scope limits.)
```

**How to look:** Search the description and body for "NOT for", "don't use
when", "out of scope", "instead use", or equivalent phrasing. Present and
specific = pass. Missing entirely = fail. A skill so narrow that misfire is
implausible (single fixed command) may be not-applicable — say so in note.

## Q03 — Internal consistency
severity: major
weight: 6

**Definition:** The skill's instructions do not contradict each other:
steps, defaults, file paths, and rules stay the same everywhere they are
mentioned.

**Pass example:**
```
Output goes to `report.json` — stated once in Overview, repeated identically in step 6 and in the summary template.
```

**Fail example:**
```
Step 2: "always ask the user before writing files." Step 7: "write the report without prompting to keep the flow uninterrupted."
```

**How to look:** Collect every fact stated more than once (paths, filenames,
defaults, orderings, must/never rules) and compare occurrences. One direct
contradiction of a rule or path = fail with both lines cited (quote the more
authoritative one, put the other in note). Mere redundancy with consistent
content = pass. Ambiguity without contradiction belongs to Q08.

## Q04 — Actionability
severity: major
weight: 6

**Definition:** Steps are concrete enough to execute without guessing:
commands given, file targets named, decisions have criteria. No "handle
appropriately"-style hand-waving at load-bearing moments.

**Pass example:**
```
Run `pnpm vitest run test/` — if any test fails, stop and report the failing test names; do not proceed to deploy.
```

**Fail example:**
```
Validate the results and handle any issues appropriately, then optimize as needed before continuing.
```

**How to look:** For each imperative step, ask: WHAT exactly do I run/edit,
and HOW do I decide the outcome? Steps that name commands, files, and
criteria = pass. Steps that delegate the actual decision to unstated judgment
("as needed", "appropriately", "handle edge cases") at points where the task
would derail = fail; cite the vaguest load-bearing line. High-level style
guidance around otherwise-concrete steps is fine — judge the steps, not the
prose between them.

## Q05 — Output contract
severity: major
weight: 5

**Definition:** The skill defines what its final deliverable looks like:
format, location, required sections/fields — so the user and downstream tools
know what they got.

**Pass example:**
```
Output: write `.audit/report.md` with sections Findings (table: id, severity, file:line), Summary, and Next steps. Print the path when done.
```

**Fail example:**
```
Analyze the project thoroughly and share your conclusions with the user.
```

**How to look:** Find the skill's stated end state. A named artifact or
response shape (file path, JSON schema, required sections, exit code) = pass.
"Report/summarize/share findings" with no shape = fail. Skills whose entire
job is a side effect (e.g. "delete build caches") may be not-applicable —
their contract is the effect itself; note it.

## Q06 — Failure paths
severity: major
weight: 5

**Definition:** The skill says what to do when key steps fail: missing
tools, failing commands, absent files, denied permissions — instead of
assuming a happy path end to end.

**Pass example:**
```
If `gh` is not installed or unauthenticated, stop and tell the user to run `gh auth login`; do not fall back to scraping.
```

**Fail example:**
```
Ten sequential steps of builds, network calls, and file writes with no mention anywhere of what to do if any of them fails.
```

**How to look:** Identify the 2–3 most failure-prone steps (external tools,
network, file existence). Does the skill address ANY failure of those —
detection, fallback, or an explicit stop-and-report? Some coverage of the
riskiest steps = pass; total silence across a multi-step external-dependency
flow = fail; partial (one path covered, an equally risky one ignored) =
warning. A one-step skill with a self-evident error (single command whose
output the user sees) = not-applicable.

## Q07 — Context economy
severity: minor
weight: 4

**Definition:** The skill respects the reader's context window: core flow in
SKILL.md, bulky material (long references, templates, exhaustive tables)
split into files loaded on demand.

**Pass example:**
```
SKILL.md: 180 lines of procedure + "for the full pattern catalog read references/patterns.md when needed".
```

**Fail example:**
```
SKILL.md: 1400 lines — procedure, three full templates pasted inline, a 400-row lookup table, and an FAQ.
```

**How to look:** Use the pre-check file inventory for sizes. A SKILL.md
carrying material that is only sometimes needed (bulk templates, catalogs,
FAQs) inline despite obvious split points = fail; compact SKILL.md with
on-demand references = pass. Long but genuinely sequential procedure with no
separable bulk = warning at worst, with a note. Judge structure, not raw line
count — that ceiling belongs to H05.

## Q08 — Determinism
severity: major
weight: 5

**Definition:** Two competent agents following the skill on the same input
would do materially the same thing: choices are ordered, defaults stated,
conditions decidable.

**Pass example:**
```
Prefer pnpm; if no lockfile, use npm. Default port 3000 unless PORT is set.
```

**Fail example:**
```
Use whichever package manager seems best. Pick a sensible port. Structure the output however feels most natural for the project.
```

**How to look:** Find every fork in the flow (tool choice, target choice,
format choice). Forks with a stated default or a decidable condition = pass.
Forks left to taste at points that change the outcome (different files
written, different tools invoked) = fail; cite the fork. Deliberate,
explicitly-delegated judgment ("choose tone appropriate to the audience" in a
writing skill) is not a violation — the skill must own the delegation, not
drift into it.

## Q09 — Examples where ambiguous
severity: minor
weight: 4

**Definition:** Wherever the skill demands a specific format or non-obvious
transformation, it shows at least one concrete example of the expected
input/output.

**Pass example:**
```
Commit format: `<type>(<scope>): <subject>` — e.g. `fix(parser): handle empty frontmatter`.
```

**Fail example:**
```
Verdicts must follow the canonical result notation used by the team. (Nowhere shown.)
```

**How to look:** List the formats/notations the skill requires (naming
schemes, message templates, structured outputs). Each accompanied by a
worked example = pass. A required bespoke format with zero examples = fail.
Formats that are universal standards (ISO dates, plain JSON) need no example
— not-applicable if that's all there is.

## Q10 — Re-run safety
severity: major
weight: 5

**Definition:** Running the skill twice is addressed: steps are idempotent,
or the skill detects prior state and says how to proceed (skip, update,
abort). Blind re-execution must not corrupt or duplicate.

**Pass example:**
```
If `.migration-done` exists, skip steps 2–4. Appending to CHANGELOG: check the entry isn't already present.
```

**Fail example:**
```
Step 3: append the license header to every source file. (Run twice → every file gets two headers; nothing checks for an existing one.)
```

**How to look:** Simulate a second run mentally over the mutating steps
(appends, inserts, creates, registrations). Naturally idempotent operations
(overwrite-in-full, `mkdir -p`, declarative configs) = pass. Accumulating or
duplicating effects with no existence check = fail; cite the step. Read-only
skills = not-applicable.
