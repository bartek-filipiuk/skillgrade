# SkillHub — brief dla Claude Design

Cel: strona-hub prezentująca skille Claude Code (i w przyszłości MCP) z oceną/badge nadaną automatycznie przez narzędzie **trust-skill**. Użytkownik odkrywa skille, filtruje po kategorii i jakości, i widzi *dlaczego* dany skill dostał taką ocenę — z dowodami, nie samym wynikiem.

Design robisz w Claude Design. Ten dokument opisuje **co** prezentujemy i **jakie elementy** są w danych; wygląd (typografia, kolor, layout) należy do Ciebie. Źródło danych: `hub/catalog.json` (kontrakt niżej). Podgląd rusztowania: `hub/preview.html`.

---

## 1. Zasada nadrzędna designu

To jest **hub zaufania**, nie katalog marketingowy. Trzy rzeczy muszą być wizualnie natychmiastowe:

1. **Badge** — ocena per wymiar (Security / Quality / Hygiene), litera A–F. To jest bohater ekranu.
2. **Dowód** — każdy skill ma highlights: konkretne werdykty z checków (np. „S03 warning: `curl|bash` cytowany jako zakazany"). Ocena jest audytowalna, nie magiczna.
3. **Kategoria** — jedna z 10 stałych, nadana automatycznie. Filtr i porządek.

Jeśli coś ma dominować kolorem — to skala badge. Reszta interfejsu ma być spokojna, żeby litery A–F i statusy pass/warning/fail niosły znaczenie.

---

## 2. Ekrany

### 2.1 Landing / hero
- Nazwa produktu (**SkillHub**), jedno zdanie wartości: „Oceniane automatycznie skille Claude Code — bezpieczeństwo, jakość, higiena, z dowodami".
- Pasek statystyk (dane z `catalog.json`): liczba ocenionych skilli, liczba kategorii, ile A, ile odrzuconych (F), wersja rubryki (`rubricVersion`).
- CTA: „Przeglądaj skille" → lista. Ewentualnie „Jak oceniamy?" → sekcja metodologii (opcjonalna, treść z rubryki).

### 2.2 Lista / grid skilli (główny ekran)
- Karta na skill (patrz 3). Grid responsywny.
- **Filtry:** chipsy kategorii (10 + „Wszystkie"); dodatkowo warto: filtr po minimalnej ocenie (A / ≥B / ≥C), przełącznik „pokaż fixture'y" (skille demonstracyjne — patrz `kind`).
- **Sort:** domyślnie po `overall` (A→F), alternatywnie alfabetycznie / po kategorii.
- Pusty stan filtra: „Brak skilli w tej kategorii".

### 2.3 Szczegóły skilla (widok karty rozwiniętej / osobna strona)
- Pełne badge per wymiar + `overall`.
- **Wszystkie** highlights (na karcie listy pokazujemy 2–3, tu komplet ≤6), pogrupowane lub posortowane wg statusu (fail → warning → pass).
- Fakty pre-check (`preCheck`): czy frontmatter poprawny, liczba plików, rozmiar SKILL.md, liczba flag critical/major z warstwy 1 (deterministycznej).
- Metadane: `rubricVersion`, `evaluatedAt`, `evaluator` (model + tryb), `source` (ścieżka/URL), `contentHash` w przyszłości (unieważnia badge przy zmianie treści).
- Tagline jako podtytuł.

---

## 3. Anatomia karty skilla

Elementy (wszystkie w danych wpisu katalogu):

| Element | Pole | Uwaga wizualna |
|---|---|---|
| Nazwa | `name` | nagłówek karty |
| Kategoria | `category` → label z `taxonomy` | mała etykieta/eyebrow nad nazwą |
| Znacznik fixture | `kind` = `fixture` | wizualnie odróżnij (np. ramka przerywana, plakietka „przykład") — to nie są prawdziwe skille, tylko demonstracja spektrum ocen |
| Tagline | `tagline` | 1 zdanie, ≤140 znaków, po polsku |
| Badge ×3 | `badges.security` / `.quality` / `.hygiene` | **główny akcent**; litera A–F; `not-evaluated` = stan neutralny (myślnik/szary) |
| Ocena zbiorcza | `overall` | najgorszy z ocenionych wymiarów; do sortu i ewentualnej dużej litery |
| Highlights | `highlights[]` | lista: `check` (np. S03), `status`, `summary`; na karcie 2–3, reszta w szczegółach |
| Effectiveness | `badges.effectiveness` | zawsze `not-evaluated` w v1 — pokaż jako „wkrótce"/zablokowany, to celowa rezerwa |

### Skala badge (kolor niesie znaczenie)
- **A** — najlepsza; **B** dobra; **C** dostateczna; **D** słaba; **F** odrzucona (krytyczny problem, zwykle bezpieczeństwa).
- `not-evaluated` — nieoceniane (neutralny, NIE czerwony — brak oceny ≠ zła ocena).
- Sugerowana semantyka: A/B zieleń→limonka, C żółty, D pomarańcz, F czerwony, not-evaluated szary. Kolory dobierasz sam; ważna jest **monotoniczność** (A najlepiej, F najgorzej) i odróżnialność F.

### Statusy highlightów (mikro-etykiety przy checku)
- `pass` (zielony), `warning` (żółty), `fail` (czerwony), `not-applicable` (szary), `evaluation-error` (szary/ostrzegawczy — błąd oceny, rzadki).
- Format checku: `S`=Security, `Q`=Quality, `H`=Hygiene + numer (np. `S03`, `Q10`, `H05`).

---

## 4. Taksonomia (10 kategorii — stałe)

Z `catalog.json.taxonomy`; każdy skill ma dokładnie jedną. `id` → `label` → `description`:

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

Zaprojektuj tak, by chipsy zmieściły się na jednym–dwóch rzędach; rozważ ikonę per kategoria (opcjonalne).

---

## 5. Kontrakt danych — `hub/catalog.json`

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
      "category": "code-quality",      // jedno z taxonomy.id
      "tagline": "…jedno zdanie…",
      "badges": { "security": "A", "quality": "A", "hygiene": "A", "effectiveness": "not-evaluated" },
      "overall": "A",                  // najgorszy z ocenionych wymiarów (liczony w kodzie)
      "highlights": [
        { "check": "S03", "status": "warning", "summary": "…dlaczego…" }
      ],
      "preCheck": {                    // fakty deterministyczne (warstwa 1, bez LLM)
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

Wszystkie litery ograniczone do `A|B|C|D|F|not-evaluated`. `status` highlightu: `pass|fail|warning|not-applicable|evaluation-error`.

---

## 6. Stany, które design musi obsłużyć

- Badge `not-evaluated` (Effectiveness zawsze; czasem Quality/Hygiene przy fixture'ach czysto-security jak `malicious-exfil`).
- Skill z oceną **F** — musi być czytelnie „odrzucony", ale nie krzykliwie brzydki; F to informacja, nie kara wizualna.
- Fixture (`kind: fixture`) — odróżniony od prawdziwych skilli; hub domyślnie może je chować za przełącznikiem.
- Highlight ze statusem `warning` niosący deeskalację false-positive (np. benign-rich S03) — to *pozytywna* historia („narzędzie nie karze za dokumentowanie zagrożeń"); warto, by dało się to opowiedzieć.
- Karta bez highlightów fail/warning (same pass) — spokojna, „czysto".
- Długie taglines / dużo kategorii — layout nie może się sypać (patrz responsywność).

---

## 7. Czego NIE robić

- Nie pokazuj `overall` jako jedynej liczby — to ukrywa, że skill może być świetny jakościowo, a niebezpieczny. Per-wymiar jest istotą.
- Nie koloruj `not-evaluated` na czerwono/zielono — to brak danych, nie ocena.
- Nie prezentuj fixture'ów jako rekomendowanych skilli.
- Nie chowaj dowodów (highlights) — bez nich badge jest nieaudytowalny i traci sens „trust".

---

## 8. Dane demo w tej wersji

`catalog.json` zawiera 13 wpisów: 9 prawdziwych skilli (uczciwe oceny — większość A, `idea-to-mvp` B przez rozmiar SKILL.md) + 4 fixture'y demonstrujące pełne spektrum: `benign-minimal` (A/A/A), `benign-rich` (A, z warning-deeskalacją S03), `sloppy-but-safe` (A/C/C — rozjazd wymiarów), `malicious-exfil` (F). To pokrywa wszystkie stany badge z §6. Wygenerowane oceną natywną w Claude Code (bez API key); produkcyjnie ten sam `catalog.json` powstaje z CLI `trust-skill` na dowolnym modelu.
