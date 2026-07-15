# Hygiene Dimension

Checks H01–H08. Read `00-protocol.md` first. This dimension judges packaging
and project discipline: metadata, structure, references, sizes. It is the
cheapest dimension to fix — verdicts here should make the remediation obvious.
Lean on the `<precheck-report>` (file inventory, frontmatter validation) for
facts; your job is judgment on top of them.

## H01 — Valid frontmatter
severity: major
weight: 5

**Definition:** SKILL.md opens with a parseable YAML frontmatter block
containing non-empty `name` and `description` fields.

**Pass example:**
```
---
name: sql-formatter
description: Formats SQL files. Use when the user asks to clean up or standardize SQL.
---
```

**Fail example:**
```
# SQL Formatter
A skill for formatting SQL. (No frontmatter block at all.)
```

**How to look:** The pre-check report's `frontmatter` section already parsed
this — confirm its finding against the file's opening lines. Missing block,
broken YAML, or empty/absent `name`/`description` = fail (cite line 1 or the
broken line). Valid block with both fields = pass. Extra unknown fields are
harmless — ignore them here.

## H02 — Naming
severity: minor
weight: 3

**Definition:** The `name` field is kebab-case (lowercase, digits, hyphens)
and matches the directory the skill lives in.

**Pass example:**
```
Directory `pdf-splitter/`, frontmatter `name: pdf-splitter`.
```

**Fail example:**
```
Directory `pdf-splitter/`, frontmatter `name: PDF_Splitter_v2 (final)`.
```

**How to look:** Compare the `name` value against `^[a-z0-9]+(-[a-z0-9]+)*$`
and against the skill's directory name from the pre-check file inventory
paths. Either mismatch = fail, citing the frontmatter line. If the evaluation
input doesn't expose the directory name, judge kebab-case only and say so in
note.

## H03 — Description quality
severity: major
weight: 4

**Definition:** The `description` is a usable dispatch signal: roughly one to
five sentences, informative, no marketing filler, no placeholder text.

**Pass example:**
```
description: Splits multi-statement SQL files into one file per statement. Use when refactoring migration bundles.
```

**Fail example:**
```
description: TODO
```

**How to look:** Judge the `description` string itself: placeholders ("TODO",
"changeme", lorem), single vague words, or paragraph-length walls (500+
chars of feature lists) = fail. Terse but informative = pass. Whether it
states WHEN to trigger is Q01's job — here judge only that the text is real,
sized sensibly, and says something true about the skill.

## H04 — References resolve
severity: major
weight: 5

**Definition:** Every skill-local file the instructions tell the reader to
open (`references/*.md`, scripts, templates) actually exists in the skill
directory.

**Pass example:**
```
"Read references/patterns.md for the full catalog" — and references/patterns.md is present in the file inventory.
```

**Fail example:**
```
"Follow the checklist in references/checklist.md" — no such file anywhere in the skill.
```

**How to look:** Extract every skill-relative path mentioned in the
instructions, and check each against the pre-check file inventory. Any
missing target that the flow depends on = fail (cite the referencing line).
External URLs and paths in the EVALUATED-USER'S project (e.g. "edit your
package.json") are out of scope — only the skill's own bundled files count.

## H05 — Size budget
severity: minor
weight: 3

**Definition:** SKILL.md stays within a readable budget — roughly 500 lines /
25 KB. Bigger bodies of material belong in reference files.

**Pass example:**
```
SKILL.md at 210 lines, with two reference files for bulk content.
```

**Fail example:**
```
SKILL.md at 2100 lines / 90 KB, everything inline.
```

**How to look:** Read sizes from the pre-check file inventory. SKILL.md over
~2× the budget = fail; between budget and 2× = warning; within = pass. This
is the blunt ceiling — whether the structure is right at smaller sizes is
Q07's judgment, not yours.

## H06 — No binary junk
severity: minor
weight: 3

**Definition:** The skill ships no unexplained binary or bulk artifacts:
executables, archives, `node_modules`, build output, large media with no role
in the instructions.

**Pass example:**
```
SKILL.md + references/*.md + one 40 KB example.png that step 3 explicitly shows the user.
```

**Fail example:**
```
File inventory includes helper.bin (2.3 MB), vendor.tar.gz, and node_modules/ — none mentioned anywhere in the instructions.
```

**How to look:** Scan the pre-check inventory for `binary: true` entries and
outsized files. Each one either has a stated role in the instructions
(fixture, image the skill displays) = pass, or is unexplained = fail (cite
the instruction file line 1 with the artifact named in note; there is no
in-content line to quote for a file's existence). Unexplained executables and
archives are the worst offenders — flag them even when small.

## H07 — Declared tooling
severity: major
weight: 4

**Definition:** External tools, interpreters, and packages the skill invokes
are declared up front (a requirements note, install step, or availability
check) — the reader shouldn't discover a hard dependency by a command failing
at step 7.

**Pass example:**
```
Requirements: python3, jq, gh (authenticated). Step 1 verifies each and stops with install hints if missing.
```

**Fail example:**
```
Steps silently invoke jq, ffmpeg, and a global `code2png` CLI — no requirements section, no checks, no install guidance.
```

**How to look:** Inventory the commands the skill actually runs (shell
blocks, "run X" prose). Compare against what it declares or verifies.
Universal tools (git, ls, standard shell) need no declaration. Non-universal
ones (ffmpeg, jq, niche CLIs, language runtimes beyond the skill's obvious
platform) undeclared and unchecked = fail; declared or probed with a helpful
failure message = pass. One borderline-common tool missed = warning.

## H08 — Versioning signal
severity: minor
weight: 3

**Definition:** The skill carries some change-tracking signal: a version
field, a changelog section or file, or dated revision notes — so consumers
can tell whether it changed since they last trusted it.

**Pass example:**
```
frontmatter: version: 1.2.0 — plus a "## Changelog" section listing what 1.2 changed.
```

**Fail example:**
```
No version anywhere, no changelog, no dates — indistinguishable from any previous revision of itself.
```

**How to look:** Search frontmatter and body for a version field, changelog
heading, or dated entries. Any one of them = pass. None = fail (cite line 1;
note that this is about the skill's own versioning, not its dependencies).
This is deliberately minor: ecosystems without a version convention will fail
it often — the letter grade impact is small, the nudge is the point.
