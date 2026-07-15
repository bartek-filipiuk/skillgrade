# Przegląd końcowy nocy — trust-skill v1

Data: 2026-07-16 · Zakres: cały diff `main..build/trust-skill-v1` (src/, checks/, skills/, bin/) · Model: Fable 5 · Suita: 100/100, typecheck czysty.

Kod: 1009 LOC w 12 plikach TS, żaden nie przekracza 178 linii. Zero `as any`, jeden uzasadniony `eslint-disable` (regex control-chars w walidacji URL). Trzy soczewki poniżej; jedno znalezisko naprawione w tym runie, reszta to noty na przyszłość.

## Architektura

Kierunek zależności zdrowy, bez cykli runtime:

- `checks/` importuje z `src/` **wyłącznie typy** (`type Severity`, `type PreCheckReport`) — type-only, znika po kompilacji. `src/` importuje z `checks/` runtime (`runPreChecks`, `listSkillFiles`). Zależność jednokierunkowa na poziomie wykonania.
- Rdzeń domenowy (`aggregate`, `rubric`, `types`) nie zależy od warstwy I/O (CLI, LLM, loader). `cli.ts` jest kompozytorem na szczycie — importuje wszystko, nic nie importuje jego. To poprawny kierunek: reguły w środku, wejście/wyjście na brzegu.
- **Score liczony w jednym miejscu.** `aggregate()` ma dwa wywołania (`report.ts:31`, `aggregate-cli.ts:29`) i to jedyne miejsce z progami liter. Tryb CLI i tryb skill-frontend liczą tak samo — brak dryfu między frontendami, dokładnie jak zakładał spec §3.3. LLM nigdy nie liczy.
- `verifyEvidence` (anty-halucynacja) jest w ścieżce produkcyjnej `llm.ts`, nie tylko w testach — werdykt bez zweryfikowanego cytatu nie wchodzi do raportu.

Granice modułów czyste; nie znalazłem warstwy do usunięcia ani abstrakcji z jedną implementacją.

## Ponytail

**Znalezisko (naprawione): `STATUS_RANK` zduplikowany** w `aggregate.ts` i `report.ts`. Oba egzemplarze były dziś identyczne (fail:0 → not-applicable:4), więc bez buga — ale komentarze w obu plikach wprost prosiły „musi być spójne z tym drugim", co jest zapachem: dodanie statusu w jednym miejscu po cichu rozjechałoby dedup werdyktów (aggregate) z majority-vote między runami (report). Naprawa: `STATUS_RANK` wyeksportowany z `aggregate.ts` jako jedyne źródło, `report.ts` go importuje. −8 linii, zachowanie bez zmian (100/100 po zmianie).

Reszta jest chuda: pliki małe i jednoodpowiedzialne, `patterns.ts` trzyma reguły jako dane (nie kod), entrypointy `run.ts`/`aggregate-cli.ts` to cienkie adaptery stdin/stdout. Nie ma boilerplate „na później". Nie znalazłem nic więcej do wycięcia bez utraty funkcji.

## Security

To narzędzie z założenia przetwarza wrogie wejście (oceniane skille) — powierzchnia była przeorana adwersaryjnie w każdym tasku kodowym. Weryfikacja końcowa granic:

- **Klonowanie obcego repo** (`loadSkill.ts`) — `isGitUrl` whitelistuje wyłącznie `https/ssh + .git` i scp-like; `ext::`, `--upload-pack`, dash-leading URL-e nie są rozpoznawane jako git → traktowane jako ścieżka lokalna (nie trafiają do `git`). Obrona w głąb: `execFile` tablicowy (nigdy `shell:true`), separator `--`, `GIT_ALLOW_PROTOCOL`, `core.hooksPath=/dev/null`, `GIT_TERMINAL_PROMPT=0`. Kod z repo **nigdy nie jest wykonywany**.
- **Path traversal** — `listSkillFiles` nie podąża za symlinkami (escape + loop guard), binaria (NUL w 8 KB) inwentaryzowane ale nieskanowane; `verifyEvidence` szuka pliku po dokładnej ścieżce relatywnej i bounds-checkuje numer linii → `evidence.file: "../../etc/passwd"` daje `evaluation-error`, nie odczyt.
- **Output LLM jako niezaufany** — `file`/`line`/`quote`/`check`/`status` re-walidowane; cytat weryfikowany dosłownie (trim tak, case-fold nie — nie da się „udowodnić" cytatu, którego nie ma); `check` spoza wymiaru odrzucony; `evaluation-error` przyjmowany tylko od harnessu, nigdy od modelu.
- **Manipulacja evaluatora** — treść skilla zawsze w `<skill-content>` jako dane (protokół §2), `path="…"` escapowany przeciw wyjściu z atrybutu, canary-check warstwy 1 traktuje próbę sterowania oceną jako dowód S06. Kalibracja potwierdziła: `malicious-injection` → F.
- **Fixtures** — wszystkie payloady to atrapy z fikcyjnym `evil.example`, bez działających hostów; oznaczone jako inert w nagłówkach testów.

Nie znalazłem otwartej granicy. Znany sufit (z t6, zaakceptowany): `runPreChecks` czyta pliki w całości do pamięci — bez limitu rozmiaru. Dla realnych skilli nieistotne; wielogigabajtowy plik byłby ryzykiem pamięci. Ścieżka naprawy: strumieniowy/limitowany odczyt, jeśli hub kiedyś przyjmie nieograniczone wejście.

## Werdykt

| # | Soczewka | Znalezisko | Severity | Status |
|---|---|---|---|---|
| 1 | Ponytail | `STATUS_RANK` zduplikowany (aggregate.ts + report.ts), ryzyko dryfu dedup vs majority-vote | minor | **naprawione** (eksport z aggregate) |
| 2 | Security | `runPreChecks` czyta pliki bez limitu rozmiaru | minor | odłożone (YAGNI dla realnych skilli; strumień gdy hub przyjmie nieograniczone wejście) |
| 3 | Security | `secret-paths` warstwy 1 czuły na słowo `.env` w dokumentacji (dużo false-positive) | minor | odłożone do v0.2 (rubryka i tak deeskaluje; szum tylko w `--no-llm`) |
| 4 | Architektura | brak | — | — |

Diff nocy jest czysty: kierunek zależności poprawny, jedno źródło liczenia score, granice zaufania domknięte i przetestowane adwersaryjnie. Jedyna naprawa (STATUS_RANK) była prewencyjna. Nie ma znaleziska krytycznego ani blokującego merge. Pełny `/security-audit` + `/architect-review` interaktywnie — do decyzji rano, ale na tym rozmiarze i powierzchni nie jest wymogiem.
