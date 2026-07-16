# 151 ciekawych i użytecznych skilli dla agentów AI

**Autor opracowania:** Manus AI  
**Data zebrania:** 16 lipca 2026 r.

Zestaw zawiera **151 różnych skilli** wybranych przede wszystkim z katalogu ClawHub, uzupełnionych o oficjalne pozycje z kuratorowanej kolekcji Awesome Agent Skills. ClawHub deklarował w chwili zbierania około 69,4 tys. dostępnych skilli, dlatego lista nie jest prostym rankingiem popularności, lecz przekrojową selekcją narzędzi z wielu kategorii.[1] Kolekcja Awesome Agent Skills agreguje skille tworzone m.in. przez Anthropic, Cloudflare, Stripe, Supabase, Hugging Face i Figma.[2]

Każdy wpis został zachowany z bezpośrednim linkiem do strony skilla. Rekordy z ClawHub pobrano etapami z publicznej listy sortowanej według liczby gwiazdek, bez masowego otwierania podstron. Dodatkowe linki sprawdzono sekwencyjnie; wszystkie zwróciły poprawną odpowiedź HTTP. Nazwy i możliwości pozostawiono zgodne z opisami źródłowymi, natomiast kategorie ujednolicono, a opisy skrócono i zredagowano po polsku. Format Agent Skills jest otwartym sposobem pakowania wyspecjalizowanej wiedzy i procedur dla agentów AI.[3]

> **Ważne:** popularność nie jest równoznaczna z bezpieczeństwem. Przed instalacją skilla warto przeczytać jego plik `SKILL.md`, sprawdzić wymagane uprawnienia, polecenia powłoki, zależności i sposób obchodzenia się z danymi. Szczególnej ostrożności wymagają skille obsługujące finanse, pocztę, logowanie, automatyczne aktualizacje, przeglądarkę i zewnętrzne API.

## Podsumowanie zestawu

| Źródło | Liczba skilli |
|---|---:|
| ClawHub | 121 |
| Awesome Agent Skills / źródła oficjalne | 30 |
| **Razem** | **151** |

| Kategoria | Liczba |
|---|---:|
| Wyszukiwanie i research | 17 |
| Integracje i API | 14 |
| Dokumenty i biuro | 13 |
| Agenci AI | 11 |
| Automatyzacja | 11 |
| Finanse i handel | 11 |
| Kreatywność i multimedia | 9 |
| Komunikacja | 8 |
| Wiedza i pamięć | 8 |
| Programowanie i DevOps | 7 |
| Projektowanie UI/UX | 7 |
| Dane i bazy danych | 6 |
| Marketing i sprzedaż | 6 |
| Chmura i infrastruktura | 5 |
| AI i uczenie maszynowe | 4 |
| Bezpieczeństwo | 4 |
| Produktywność | 4 |
| Testowanie i jakość | 3 |
| Życie codzienne | 3 |

## Pełna lista

| Lp. | Nazwa | Kategoria | Krótki opis | Link |
|---:|---|---|---|---|
| 1 | **self-improving agent** | Agenci AI | Agent zbiera obserwacje, błędy i poprawki, tworząc mechanizm ciągłego uczenia się, przydatny do stopniowego ulepszania zachowań agenta w dłuższych zadaniach. | [ClawHub](https://clawhub.ai/pskoett/self-improving-agent) |
| 2 | **Skill Vetter** | Bezpieczeństwo | Narzędzie oceniające bezpieczeństwo umiejętności dla agentów AI przed instalacją, wykrywające nadmiarowe uprawnienia i potencjalne zagrożenia. | [ClawHub](https://clawhub.ai/spclaudehome/skill-vetter) |
| 4 | **Gog** | Komunikacja | Interfejs CLI do usług Google Workspace: Gmail, Calendar, Drive, Contacts, Sheets i Docs, przydatny do automatyzacji i skryptowania pracy biurowej. | [ClawHub](https://clawhub.ai/steipete/gog) |
| 7 | **Humanizer** | Dokumenty i biuro | Usuwa cechy tekstu wygenerowanego przez AI, pomagając przy redakcji i przeglądzie materiałów, gdy trzeba uzyskać bardziej naturalny styl pisania. | [ClawHub](https://clawhub.ai/biostartechnology/humanizer) |
| 9 | **ontology** | Wiedza i pamięć | Typowany graf wiedzy do strukturyzowanej pamięci agenta i komponowania umiejętności, przydatny do przechowywania relacji i kontekstu dla agentów. | [ClawHub](https://clawhub.ai/oswalpalash/ontology) |
| 14 | **Weather** | Życie codzienne | Dostarcza aktualną pogodę i prognozy bez potrzeby klucza API; użyteczne do planowania dnia, podróży i aktywności na zewnątrz. | [ClawHub](https://clawhub.ai/steipete/weather) |
| 37 | **SuperDesign** | Projektowanie UI/UX | Zestaw ekspertowych wytycznych front-end do tworzenia nowoczesnych, estetycznych interfejsów; przydatny podczas projektowania i dopracowywania UI. | [ClawHub](https://clawhub.ai/mpociot/superdesign) |
| 74 | **imap-smtp-email** | Komunikacja | Czyta i wysyła maile przez IMAP/SMTP, sprawdza nowe i nieprzeczytane wiadomości oraz pobiera treści; użyteczne do automatyzacji obsługi skrzynki pocztowej. | [ClawHub](https://clawhub.ai/gzlicanyi/imap-smtp-email) |
| 121 | **Pdf** | Dokumenty i biuro | Zestaw narzędzi do pracy z PDF: ekstrakcja tekstu i tabel oraz operacje na dokumentach, przydatny do przetwarzania i analizy zawartości plików. | [ClawHub](https://clawhub.ai/awspace/pdf) |
| 122 | **Algorithmic Art** | Kreatywność i multimedia | Generuje sztukę algorytmiczną przy użyciu p5.js z kontrolowanym ziarniem losowości, przydatne do eksperymentów z generatywną grafiką. | [Oficjalne źródło](https://officialskills.sh/anthropics/skills/algorithmic-art) |
| 123 | **Canvas Design** | Kreatywność i multimedia | Projektuje obrazy i grafiki przygotowane do eksportu jako PNG lub PDF, przydatne do tworzenia materiałów wizualnych i drukowych. | [Oficjalne źródło](https://officialskills.sh/anthropics/skills/canvas-design) |
| 124 | **Frontend Design** | Projektowanie UI/UX | Narzędzia do projektowania interfejsów oraz rozwoju frontendu, przydatne przy tworzeniu i prototypowaniu UI/UX dla aplikacji webowych. | [Oficjalne źródło](https://officialskills.sh/anthropics/skills/frontend-design) |
| 125 | **Slack GIF Creator** | Kreatywność i multimedia | Tworzy animowane GIFy zoptymalizowane pod limity rozmiaru Slacka, przydatne do szybkiego udostępniania krótkich animacji w kanałach. | [Oficjalne źródło](https://officialskills.sh/anthropics/skills/slack-gif-creator) |
| 126 | **Theme Factory** | Projektowanie UI/UX | Nakłada profesjonalne motywy lub generuje niestandardowe style dla artefaktów, przydatne do ujednolicenia wyglądu projektów i materiałów. | [Oficjalne źródło](https://officialskills.sh/anthropics/skills/theme-factory) |
| 127 | **Web Artifacts Builder** | Programowanie i DevOps | Buduje złożone komponenty HTML używając React i Tailwind, przydatne przy tworzeniu interaktywnych elementów i stron frontendowych. | [Oficjalne źródło](https://officialskills.sh/anthropics/skills/web-artifacts-builder) |
| 128 | **MCP Builder** | Integracje i API | Tworzy serwery MCP do integracji z zewnętrznymi API i usługami, przydatne gdy potrzebna jest łączność między systemami i rozszerzenie funkcji. | [Oficjalne źródło](https://officialskills.sh/anthropics/skills/mcp-builder) |
| 129 | **Webapp Testing** | Testowanie i jakość | Testuje lokalne aplikacje webowe przy użyciu Playwright, przydatne do automatycznego sprawdzania funkcjonalności i regresji przed wdrożeniem. | [Oficjalne źródło](https://officialskills.sh/anthropics/skills/webapp-testing) |
| 130 | **Internal Comms** | Komunikacja | Tworzy raporty statusowe, newslettery i sekcje FAQ, ułatwiając komunikację zespołową i informowanie interesariuszy. | [Oficjalne źródło](https://officialskills.sh/anthropics/skills/internal-comms) |
| 131 | **Postgres Best Practices** | Dane i bazy danych | Zastosowuje najlepsze praktyki PostgreSQL w projektach Supabase, poprawiając wydajność, stabilność i strukturę bazy danych. | [Oficjalne źródło](https://officialskills.sh/supabase/skills/postgres-best-practices) |
| 132 | **Stripe Best Practices** | Integracje i API | Stosuje rekomendowane wzorce przy budowie integracji Stripe, pomagając unikać typowych błędów i zapewnić zgodność płatności. | [Oficjalne źródło](https://officialskills.sh/stripe/skills/stripe-best-practices) |
| 133 | **Upgrade Stripe** | Integracje i API | Bezpiecznie aktualizuje SDK i wersje API Stripe, minimalizując ryzyko przerwania usług płatniczych podczas migracji. | [Oficjalne źródło](https://officialskills.sh/stripe/skills/upgrade-stripe) |
| 134 | **Cloudflare Agents SDK** | Agenci AI | Buduje stanowe AI agentów z obsługą harmonogramów, RPC i serwerów MCP do zarządzania stanem i komunikacją między agentami. | [Oficjalne źródło](https://officialskills.sh/cloudflare/skills/agents-sdk) |
| 135 | **Cloudflare Platform** | Chmura i infrastruktura | Pracuje z Workers, Pages, storage, AI, siecią, bezpieczeństwem oraz infrastrukturą jako kod, integrując różne warstwy platformy. | [Oficjalne źródło](https://officialskills.sh/cloudflare/skills/cloudflare) |
| 136 | **Cloudflare Email Service** | Komunikacja | Wysyła emaile transakcyjne i kieruje pocztę przychodzącą przez Cloudflare, przydatne do powiadomień i obsługi korespondencji aplikacji. | [Oficjalne źródło](https://officialskills.sh/cloudflare/skills/cloudflare-email-service) |
| 137 | **Durable Objects** | Chmura i infrastruktura | Tworzy stanową koordynację z RPC, SQLite i WebSockets, umożliwiając współdzielenie stanu i komunikację w rozproszonych aplikacjach. | [Oficjalne źródło](https://officialskills.sh/cloudflare/skills/durable-objects) |
| 138 | **Cloudflare Sandbox SDK** | Bezpieczeństwo | Tworzy piaskownicowe aplikacje do bezpiecznego, izolowanego wykonywania kodu, ograniczając wpływ potencjalnie niebezpiecznych skryptów. | [Oficjalne źródło](https://officialskills.sh/cloudflare/skills/sandbox-sdk) |
| 139 | **Web Performance** | Testowanie i jakość | Analizuje Core Web Vitals i zasoby blokujące renderowanie, pomagając zidentyfikować i usunąć problemy wydajności stron WWW. | [Oficjalne źródło](https://officialskills.sh/cloudflare/skills/web-perf) |
| 140 | **Wrangler** | Chmura i infrastruktura | Wdraża i zarządza Workers, KV, R2, D1, Vectorize, Queues i Workflows, usprawniając obsługę zasobów i funkcji na platformie Cloudflare. | [Oficjalne źródło](https://officialskills.sh/cloudflare/skills/wrangler) |
| 141 | **Hugging Face Dataset Viewer** | Dane i bazy danych | Przegląda i zapytuje zbiory danych Hugging Face za pomocą API Dataset Viewer, ułatwiając badania i eksplorację danych. | [Oficjalne źródło](https://officialskills.sh/huggingface/skills/hugging-face-dataset-viewer) |
| 142 | **Hugging Face Evaluation** | AI i uczenie maszynowe | Ocena modeli z użyciem vLLM, lighteval oraz tabel ewaluacyjnych; przydatna do porównywania wyników, wydajności i jakości modeli podczas eksperymentów. | [Oficjalne źródło](https://officialskills.sh/huggingface/skills/hugging-face-evaluation) |
| 143 | **Hugging Face Jobs** | Chmura i infrastruktura | Uruchamianie zadań obliczeniowych i skryptów Pythona na infrastrukturze Hugging Face; przydatne przy wykonywaniu zdalnych obliczeń i eksperymentów. | [Oficjalne źródło](https://officialskills.sh/huggingface/skills/hugging-face-jobs) |
| 144 | **Hugging Face Model Trainer** | AI i uczenie maszynowe | Trenowanie modeli z wykorzystaniem TRL, w tym metod SFT, DPO, GRPO oraz konwersji do formatu GGUF; użyteczne przy eksperymentach treningowych. | [Oficjalne źródło](https://officialskills.sh/huggingface/skills/hugging-face-model-trainer) |
| 145 | **Hugging Face Trackio** | AI i uczenie maszynowe | Śledzenie eksperymentów uczenia maszynowego za pomocą paneli aktualizowanych w czasie rzeczywistym; przydatne do monitorowania metryk i przebiegu eksperymentów. | [Oficjalne źródło](https://officialskills.sh/huggingface/skills/hugging-face-trackio) |
| 146 | **Hugging Face Gradio** | Programowanie i DevOps | Tworzenie aplikacji Gradio i wdrażanie ich na Hugging Face Spaces; przydatne do udostępniania interaktywnych prototypów i demonstracji modeli. | [Oficjalne źródło](https://officialskills.sh/huggingface/skills/huggingface-gradio) |
| 147 | **Transformers.js** | Programowanie i DevOps | Uruchamianie modeli uczenia maszynowego w przeglądarce za pomocą Transformers.js; przydatne gdy potrzebna jest inferencja po stronie klienta bez serwera. | [Oficjalne źródło](https://officialskills.sh/huggingface/skills/transformers.js) |
| 148 | **Figma Code Connect Components** | Projektowanie UI/UX | Łączenie komponentów projektowych z Figma z odpowiadającymi komponentami kodowymi przez Code Connect, ułatwiające synchronizację designu i implementacji. | [Oficjalne źródło](https://officialskills.sh/figma/skills/figma-code-connect-components) |
| 149 | **Figma Design System Rules** | Projektowanie UI/UX | Generowanie reguł systemu projektowego dopasowanych do konkretnego projektu w workflow Figma-to-code, pomagające zachować spójność elementów interfejsu. | [Oficjalne źródło](https://officialskills.sh/figma/skills/figma-create-design-system-rules) |
| 150 | **Figma Generate Design** | Projektowanie UI/UX | Tworzenie lub aktualizacja ekranów w Figma na podstawie kodu lub opisów, wykorzystując komponenty systemu projektowego do szybkiego prototypowania i iteracji. | [Oficjalne źródło](https://officialskills.sh/figma/skills/figma-generate-design) |
| 151 | **API Testing Skill** | Testowanie i jakość | Projektowanie, mockowanie, dokumentowanie, zabezpieczanie i testowanie API REST, GraphQL i gRPC; przydatne przy kompleksowej weryfikacji interfejsów sieciowych. | [Oficjalne źródło](https://github.com/LambdaTest/agent-skills/tree/main/api-skill) |

## Jak korzystać z listy

Najpraktyczniej zacząć od kategorii odpowiadającej bieżącemu problemowi, a następnie porównać dwa lub trzy skille o podobnym przeznaczeniu. Przy wyborze należy zwrócić uwagę na aktualność repozytorium, przejrzystość instrukcji, liczbę wymaganych integracji oraz zakres dostępu do plików i usług. W przypadku automatyzacji produkcyjnych rozsądne jest najpierw uruchomienie skilla w izolowanym środowisku i sprawdzenie jego zachowania na danych testowych.

Publiczny ranking instalacji w skills.sh może pomóc ocenić rozpowszechnienie skilla, ale nie zastępuje audytu technicznego ani bezpieczeństwa.[4] Katalog MCP Servers stanowi dodatkowe miejsce do porównania kategorii, autorów i wariantów podobnych skilli.[5]

## Źródła

[1]: https://clawhub.ai/skills?sort=stars&dir=desc "ClawHub — Skills sorted by stars"
[2]: https://github.com/VoltAgent/awesome-agent-skills "VoltAgent — Awesome Agent Skills"
[3]: https://agentskills.io/home "Agent Skills — open format overview"
[4]: https://www.skills.sh/ "skills.sh — Open Agent Skills Ecosystem"
[5]: https://mcpservers.org/agent-skills "MCP Servers — Agent Skills Library"
