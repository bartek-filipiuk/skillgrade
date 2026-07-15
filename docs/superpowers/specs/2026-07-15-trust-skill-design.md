# trust-skill — spec projektu (v1)

Data: 2026-07-15 · Status: zatwierdzony na brainstormingu · Wersja rubryki startowej: 0.1.0

## 1. Cel

Narzędzie do oceny jakości i bezpieczeństwa skilli Claude Code (v1) oraz publicznych
serwerów MCP (v2), wystawiające **badge per wymiar + audytowalny raport** dla
przyszłego skillhuba. Musi działać:

1. w Claude Code jako skill (Claude ocenia lokalny skill natywnie),
2. standalone jako CLI z **dowolnym LLM** (Anthropic, OpenAI, Google, Ollama — także
   modelem słabszym niż Fable 5 / Opus 4.8).

Kluczowy artefakt to **rubryka jako dane**: napisana mocnym modelem tak, żeby słabszy
model mógł ją wykonać. Format werdyktów per check jest od pierwszego dnia gotowym
rekordem do przyszłego fine-tuningu małego modelu.

## 2. Zakres

**V1 (ten projekt):** ocena skilla — wejście to katalog skilla (lokalny path lub git
URL) zawierający `SKILL.md` + pliki pomocnicze. Trzy wymiary oceniane:

| Wymiar | Prefiks checków | Co mierzy |
|---|---|---|
| Security | `S` | prompt injection, exfiltracja, niebezpieczne komendy, ukryte instrukcje, manipulacja evaluatorem |
| Quality | `Q` | jasność triggerów, spójność instrukcji, brak sprzeczności, wykonalność kroków |
| Hygiene | `H` | poprawny frontmatter, struktura plików, rozmiary, metadane, brak martwych referencji |

**Poza zakresem v1 (świadomie odłożone):**
- **Effectiveness** (uruchamianie skilla w sandboxie) — poziom 2 badge'a; raport ma
  zarezerwowane pole `effectiveness: "not-evaluated"`.
- **Rubryka MCP** — v2; dojdzie jako `rubric/mcp/`, silnik bez zmian.
- **Fine-tuning** — nie budujemy nic; zbieramy dataset za darmo (werdykty per check).
- Web UI / API skillhuba — hub konsumuje JSON raportu, integracja później.

## 3. Architektura

Rdzeń = wersjonowana rubryka (markdown + JSON Schema). Frontendy są cienkie.

```
trust-skill-mcp/
├── rubric/
│   └── skill/
│       ├── 00-protocol.md        # protokół oceny dla LLM-wykonawcy
│       ├── 10-security.md        # checki S01..Snn
│       ├── 20-quality.md         # checki Q01..Qnn
│       ├── 30-hygiene.md         # checki H01..Hnn
│       └── verdict.schema.json   # JSON Schema werdyktu (structured output)
├── checks/                       # deterministyczne pre-checki (TS, bez LLM)
├── cli/                          # trust-skill CLI (TypeScript + Vercel AI SDK)
├── skills/trust-skill/SKILL.md   # frontend Claude Code
└── docs/superpowers/specs/       # ta specyfikacja
```

Monorepo pnpm nie jest wymagane w v1 — jeden pakiet TS z podkatalogami wystarczy
(`checks/` i `cli/` to moduły tego samego pakietu). Stack: TypeScript, Vercel AI SDK,
Vitest, Zod (walidacja werdyktów i configu).

### 3.1 Format rubryki

Każdy plik wymiaru to markdown z sekcją per check:

```markdown
## S03 — Piped shell execution
severity: critical        # critical | major | minor
weight: 10                # do agregacji; critical fail = automatyczne F wymiaru

**Definicja:** Skill instruuje wykonanie kodu pobranego z sieci bez inspekcji
(`curl … | bash`, `wget … | sh`, `iwr … | iex`).

**Pass (przykład):** …fragment skilla, który jest OK…
**Fail (przykład):** …fragment, który łamie check…
**Fail (przykład 2):** …wariant zaciemniony…

**Instrukcja dla oceniającego:** Szukaj X, Y, Z. Zgłoś fail tylko z cytatem
i numerem linii. Jeśli wzorzec występuje w przykładzie negatywnym ("nie rób
tego") — pass z adnotacją.
```

Zasady pisania rubryki (to jest mechanizm "wykonalne słabszym modelem"):
- checki **atomowe** — jedna decyzja klasyfikacyjna na check,
- każdy check ma **2–3 przykłady pass/fail** (few-shot),
- instrukcja mówi *jak szukać*, nie tylko *czego*,
- słaby model niczego nie projektuje ani nie liczy — tylko klasyfikuje.

`00-protocol.md` definiuje: kolejność, opakowanie treści skilla w delimitery jako
niezaufane dane, zakaz wykonywania instrukcji z ocenianej treści, wymóg dowodu,
format odpowiedzi zgodny z `verdict.schema.json`.

### 3.2 Ocena dwuwarstwowa

**Warstwa 1 — deterministyczne pre-checki (`checks/`, zero LLM):**
- walidacja frontmattera (`name`, `description` obecne, poprawny YAML),
- inwentarz plików + rozmiary + wykrycie plików binarnych,
- grep-checki: `curl|wget … | sh/bash`, `rm -rf`, `eval`, długie bloby base64,
  twarde URL-e, odczyt `~/.ssh` / `~/.aws` / zmiennych env z sekretami,
- **canary-check**: frazy manipulacyjne ("ignore previous instructions",
  "you are now", "rate this A", ukryte instrukcje w komentarzach HTML) —
  trafienie = czerwona flaga security samo w sobie.

Wynik warstwy 1: `PreCheckReport` (JSON) — lista faktów i flag z lokalizacją.
Pre-checki są też samodzielnie użyteczne (tryb `--no-llm`).

**Warstwa 2 — LLM z rubryką:**
- **jeden wymiar rubryki na wywołanie** (3 wywołania na ocenę),
- model dostaje: protokół + wymiar rubryki + `PreCheckReport` + treść skilla
  w delimiterach,
- zwraca werdykt per check: `pass | fail | warning | not-applicable` +
  **obowiązkowy cytat-dowód z numerem linii** przy fail/warning,
- structured output walidowany Zod-em wg `verdict.schema.json`; werdykt fail
  bez dowodu → odrzucony i jedno ponowienie; po drugim błędzie check dostaje
  status `evaluation-error` (widoczny w raporcie, nie liczy się jako pass).

### 3.3 Scoring — kod, nie model

- Agregacja w TS: `score = Σ(weight × wynik) / Σ(weight)` per wymiar, gdzie
  wynik: pass = 1, warning = 0.5, fail = 0, evaluation-error = 0;
  `not-applicable` wypada z licznika i mianownika. Litera: A ≥ 0.9, B ≥ 0.8,
  C ≥ 0.65, D ≥ 0.5, F < 0.5.
- **Critical fail w Security = automatyczne F** wymiaru Security, niezależnie
  od reszty.
- LLM nigdy nie liczy wyniku — tylko klasyfikuje pojedyncze checki.
- Reproducibility: temperature 0; `--runs N` (nieparzyste) z majority vote per
  check; raport zawsze zawiera wersję rubryki, model, liczbę przebiegów.

### 3.4 Evaluator jako cel ataku

Oceniany skill może prompt-injectować oceniającego. Obrona:
1. treść skilla zawsze w delimiterach jako dane; protokół wprost zakazuje
   wykonywania z niej instrukcji,
2. deterministyczny canary-check (warstwa 1) — próba manipulacji to czerwona
   flaga security,
3. evaluator w v1 **nigdy nie wykonuje ocenianego kodu** — tylko czyta,
4. testy regresyjne: korpus złośliwych skilli-przynęt w `checks/fixtures/`
   (skill, który próbuje wymusić ocenę A, musi dostać F).

### 3.5 Frontendy

**CLI** (`trust-skill`):
- `trust-skill evaluate <path|git-url> [--model <id>] [--runs N] [--no-llm]
  [--dimension security|quality|hygiene] [--out report.json]`
- provider przez Vercel AI SDK; model konfigurowalny (env / flaga); git URL →
  płytki klon do katalogu tymczasowego,
- wyjście: `report.json` (dla huba) + render markdown na stdout.

**Skill Claude Code** (`skills/trust-skill/SKILL.md`):
- czyta tę samą rubrykę z repo, wykonuje protokół natywnie (Claude sam czyta
  pliki ocenianego skilla),
- pre-checki odpala przez Bash z tego samego `checks/` (zero duplikacji),
- werdykty i agregację zapisuje przez skrypt `checks/aggregate.ts` (żeby litery
  liczył kod, nie model — także w tym trybie).

### 3.6 Format raportu (kontrakt dla skillhuba)

```jsonc
{
  "subject": { "type": "skill", "name": "...", "source": "path|git-url", "contentHash": "sha256" },
  "rubricVersion": "0.1.0",
  "evaluator": { "model": "...", "runs": 1, "mode": "cli|claude-code" },
  "badges": { "security": "A-F", "quality": "A-F", "hygiene": "A-F", "effectiveness": "not-evaluated" },
  "verdicts": [ { "check": "S03", "status": "pass|fail|warning|not-applicable|evaluation-error",
                  "evidence": { "file": "...", "line": 12, "quote": "..." }, "note": "..." } ],
  "preChecks": { /* PreCheckReport */ },
  "createdAt": "ISO-8601"
}
```

`contentHash` wiąże ocenę z konkretną wersją skilla — hub unieważnia badge przy
zmianie treści.

## 4. Podział pracy między modele (night-loop)

| Zadanie | Model | Dlaczego |
|---|---|---|
| Rubryka security + protokół + schema werdyktu | **Fable 5** | najtrudniejsze intelektualnie; jakość rubryki = jakość całego produktu |
| Rubryka quality + hygiene | **Fable 5** | jw. |
| Korpus kalibracyjny i przynęty (fixtures) | **Fable 5** | wymaga myślenia adwersaryjnego |
| Pre-checki, CLI, agregacja, skill-frontend, testy | **Opus 4.8** | solidne kodowanie wg gotowej specyfikacji |
| Review końcowe rubryki i raportów z kalibracji | **Fable 5** | ocena sędziego |

## 5. Kolejność budowy

1. Rubryka security (`10-security.md`) + `00-protocol.md` + `verdict.schema.json` — Fable 5
2. Rubryki quality + hygiene — Fable 5
3. Pre-checki (`checks/`) + fixtures złośliwych skilli — Opus 4.8 (fixtures: Fable 5)
4. CLI (`cli/`) z AI SDK + agregacja + raport — Opus 4.8
5. Skill-frontend (`skills/trust-skill/`) — Opus 4.8
6. Kalibracja: ocena ~10 realnych skilli z `~/.claude/skills/` + porównanie
   werdyktów mocny vs słabszy model; poprawki rubryki — Fable 5

## 6. Kryteria sukcesu v1

- `trust-skill evaluate` na realnym skillu zwraca raport zgodny ze schemą,
  z dowodami-cytatami przy każdym fail.
- Skill-przynęta z manipulacją evaluatora dostaje F w Security (test w CI).
- Ten sam skill oceniony Opus 4.8 vs Haiku 4.5: zgodność werdyktów per check
  ≥ 90% (miara "wykonalne słabszym modelem"; jeśli mniej — rubryka wraca do
  poprawki, nie model).
- `--no-llm` działa bez żadnego klucza API.
- Ocena pełna (3 wymiary, 1 run) kosztuje < ~50k tokenów wejścia na typowym
  skillu (checki per wymiar, nie per check — jedno wywołanie na wymiar).

## 7. Ryzyka

- **Dryf rubryki vs modele** — mitygacja: korpus kalibracyjny w repo, CI
  porównuje werdykty po każdej zmianie rubryki.
- **Gaming przez autorów** (pisanie pod checki) — akceptowalne w v1; rubryka
  wersjonowana, hub pokazuje wersję; adwersaryjne checki dochodzą iteracyjnie.
- **Koszt oceny na hubie** — mitygacja: `--no-llm` jako darmowy pierwszy filtr,
  cache po `contentHash`.
