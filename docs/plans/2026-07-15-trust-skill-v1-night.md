# trust-skill v1 — plan nocny (format pętli)

Źródło prawdy dla treści tasków: **`docs/superpowers/plans/2026-07-15-trust-skill-v1.md`** (pełny kod, testy, inwentarze checków — sekcje "Task N"). Ten plik mapuje taski na gate'y i modele. `## Global Constraints` z planu źródłowego obowiązują w każdym tasku.

Pole **Model** mówi, kto wykonuje task (patrz PLAN.md → "Twarde reguły"):
- `claude-opus-4-8` → deleguj przez Agent tool z `model: "opus"`,
- `claude-fable-5` → wykonaj inline (konduktor) albo Agent `model: "fable"`.

### Task t1
**Tytuł:** Scaffold + typy + schema werdyktu
**Model:** claude-opus-4-8
**Files:** `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/types.ts`, `rubric/skill/verdict.schema.json`
**Podejście:** Dokładnie wg "Task 1" planu źródłowego (pełny kod `src/types.ts` tam). pnpm, ESM, strict.
**Test:** `test/types.test.ts` (kod w planie źródłowym)
**Gate:** `pnpm vitest run test/types.test.ts && pnpm typecheck && test -s rubric/skill/verdict.schema.json`
**deps:** —

### Task t2
**Tytuł:** Meta rubryki + protokół oceny
**Model:** claude-fable-5
**Files:** `rubric/skill/meta.json`, `rubric/skill/00-protocol.md`
**Podejście:** Wg "Task 2" planu źródłowego — 7 obowiązkowych sekcji protokołu, po angielsku. Wymagane markery (gate ich szuka): `skill-content`, `verdict.schema.json`, `not-applicable`, `precheck-report`.
**Test:** brak (artefakt tekstowy — walidacja strukturalna gate'em)
**Gate:** `python3 scripts/check_rubric.py protocol`
**deps:** —

### Task t3
**Tytuł:** Rubryka Security S01–S12
**Model:** claude-fable-5
**Files:** `rubric/skill/10-security.md`
**Podejście:** Wg "Task 3" planu źródłowego — zamknięty inwentarz S01–S12, format sekcji z `severity:`/`weight:`, `**Definition:**`, `**How to look:**`, przykłady pass/fail (w tym zaciemnione). Samokontrola adwersaryjna → `## Known gaps`.
**Test:** brak (walidacja strukturalna gate'em; semantyka — t13 kalibracja)
**Gate:** `python3 scripts/check_rubric.py security`
**deps:** t2

### Task t4
**Tytuł:** Rubryki Quality Q01–Q10 + Hygiene H01–H08
**Model:** claude-fable-5
**Files:** `rubric/skill/20-quality.md`, `rubric/skill/30-hygiene.md`
**Podejście:** Wg "Task 4" planu źródłowego — inwentarze Q01–Q10 i H01–H08, ten sam format co t3.
**Test:** brak (jw.)
**Gate:** `python3 scripts/check_rubric.py quality hygiene`
**deps:** t2

### Task t5
**Tytuł:** Parser rubryki
**Model:** claude-opus-4-8
**Files:** `src/rubric.ts`
**Podejście:** Wg "Task 5" planu źródłowego (pełny kod parsera i testów tam). Test `loadRubric` czyta realną rubrykę — stąd deps na t2–t4.
**Test:** `test/rubric.test.ts`
**Gate:** `pnpm vitest run test/rubric.test.ts && pnpm typecheck`
**deps:** t1, t2, t3, t4

### Task t6
**Tytuł:** Pre-checki (inwentarz, frontmatter, wzorce, canary)
**Model:** claude-opus-4-8
**Files:** `checks/prechecks.ts`, `checks/patterns.ts`
**Podejście:** Wg "Task 6" planu źródłowego (wzorce regex podane tam w całości). Fixtures testowe inline przez `mkdtempSync` — NIE zależy od t7.
**Test:** `test/prechecks.test.ts`
**Gate:** `pnpm vitest run test/prechecks.test.ts && pnpm typecheck`
**deps:** t1

### Task t7
**Tytuł:** Fixtures — korpus przynęt + EXPECTED.json
**Model:** claude-fable-5
**Files:** `checks/fixtures/*/SKILL.md` (6 fixtures), `checks/fixtures/EXPECTED.json`
**Podejście:** Wg "Task 7" planu źródłowego — 6 fixtures (benign-minimal, benign-rich, malicious-exfil, malicious-injection, malicious-hidden, sloppy-but-safe). UWAGA: treści malicious pisz jako oczywiste atrapy (fikcyjne hosty `evil.example`), bez działających payloadów.
**Test:** `test/fixtures.test.ts`
**Gate:** `pnpm vitest run test/fixtures.test.ts`
**deps:** t6

### Task t8
**Tytuł:** Agregacja score
**Model:** claude-opus-4-8
**Files:** `src/aggregate.ts`
**Podejście:** Wg "Task 8" planu źródłowego (pełny kod tam). Przypadki brzegowe a–h z planu.
**Test:** `test/aggregate.test.ts`
**Gate:** `pnpm vitest run test/aggregate.test.ts && pnpm typecheck`
**deps:** t1

### Task t9
**Tytuł:** Loader ocenianego skilla + contentHash
**Model:** claude-opus-4-8
**Files:** `src/loadSkill.ts`
**Podejście:** Wg "Task 9" planu źródłowego. Klon gita w teście zmockowany — gate offline.
**Test:** `test/loadSkill.test.ts`
**Gate:** `pnpm vitest run test/loadSkill.test.ts && pnpm typecheck`
**deps:** t1, t6

### Task t10
**Tytuł:** Warstwa LLM + weryfikacja dowodów
**Model:** claude-opus-4-8
**Files:** `src/llm.ts`, `src/models.ts`
**Podejście:** Wg "Task 10" planu źródłowego. Testy WYŁĄCZNIE na `MockLanguageModel` z `ai/test` — zero sieci i kluczy.
**Test:** `test/llm.test.ts`
**Gate:** `pnpm vitest run test/llm.test.ts && pnpm typecheck`
**deps:** t1

### Task t11
**Tytuł:** Raport + render + CLI
**Model:** claude-opus-4-8
**Files:** `src/report.ts`, `src/cli.ts`, `bin/trust-skill.js`
**Podejście:** Wg "Task 11" planu źródłowego. E2E w teście: tryb `--no-llm` na `checks/fixtures/malicious-exfil` → exit 2.
**Test:** `test/report.test.ts`, `test/cli.test.ts`
**Gate:** `pnpm vitest run test/report.test.ts test/cli.test.ts && pnpm typecheck`
**deps:** t5, t7, t8, t9, t10

### Task t12
**Tytuł:** Skill-frontend Claude Code + entrypointy
**Model:** claude-opus-4-8
**Files:** `skills/trust-skill/SKILL.md`, `checks/run.ts`, `src/aggregate-cli.ts`
**Podejście:** Wg "Task 12" planu źródłowego. `checks/run.ts <dir>` → PreCheckReport JSON na stdout; `aggregate-cli` czyta ze stdin `{"dimension":"...","verdicts":[...]}` i drukuje `{"score":...,"letter":"..."}` (rubryka z `rubric/skill`).
**Test:** smoke w gate (poniżej); ocena ręczna fixture'a → checklist poranna
**Gate:** `pnpm tsx checks/run.ts checks/fixtures/benign-minimal | python3 -c "import json,sys; json.load(sys.stdin)" && echo '{"dimension":"hygiene","verdicts":[]}' | pnpm tsx src/aggregate-cli.ts | python3 -c "import json,sys; assert json.load(sys.stdin)[\"letter\"]" && grep -q 'name: trust-skill' skills/trust-skill/SKILL.md`
**deps:** t5, t6, t7, t8

### Task t13
**Tytuł:** Kalibracja rubryki na fixtures + realnych skillach
**Model:** claude-fable-5
**Files:** `docs/calibration/2026-07-16-run-01.md`; Modify: `rubric/skill/*.md`, `meta.json` (bump przy zmianach)
**Podejście:** Wg "Task 13" planu źródłowego, ALE w nocy bez sieci/kluczy: oceniaj NATYWNIE w trybie skill-frontend (t12) — 6 fixtures + min. 5 realnych skilli z `~/.claude/skills/` (czytaj je READ-ONLY). Zgodność słabszego modelu: dispatch Agent `model: "haiku"` na 2 fixtures, porównaj werdykty per check z własnymi, tabela zgodności. Rozbieżność z EXPECTED.json → poprawka rubryki (przykłady/How-to-look), nie progów. Kroki wymagające `ANTHROPIC_API_KEY`/CLI → checklist poranna.
**Test:** brak (dokument kalibracyjny — gate strukturalny)
**Gate:** `python3 -c "t=open('docs/calibration/2026-07-16-run-01.md').read(); [t.index(s) for s in ('benign-minimal','benign-rich','malicious-exfil','malicious-injection','malicious-hidden','sloppy-but-safe','agreement')]"`
**deps:** t11, t12
