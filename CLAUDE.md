# Instrukcja dla agenta AI (Claude Code, Codex, Cursor)

Ten plik jest po to, żeby użytkownik mógł napisać Ci **„uruchom”** i mieć działającą aplikację, nie dotykając terminala.

## Gdy użytkownik mówi „uruchom”

1. Sprawdź Node: `node --version`. Wymagane **≥ 20.11**, zalecane 22 LTS.
   Gdy brak albo za stara wersja → powiedz wprost: „Zainstaluj Node.js 22 LTS z nodejs.org, potem wróć i napisz «uruchom»”. Nie instaluj Node'a za użytkownika bez pytania.
2. `npm install` w katalogu repo.
3. `npm --prefix web install && npm run build` (jeśli nie ma `web/dist/index.html`).
4. `npm start`.
5. W terminalu pojawi się adres `http://127.0.0.1:PORT/?t=TOKEN`. **Podaj użytkownikowi ten adres w całości** — bez tokenu aplikacja nie wpuści.
6. Powiedz, że przy pierwszym uruchomieniu trzeba wkleić klucz API z kie.ai (link w README).

## Gdy coś nie działa

Uruchom `npm run doctor` i czytaj raport (nie zawiera klucza API):

| Objaw w raporcie | Co zrobić |
|---|---|
| `dataDirWritable: false` | Brak praw do `~/OpenStudio`. Zaproponuj inny katalog przez `OPENSTUDIO_HOME=/ścieżka npm start`. |
| `webBuilt: false` | `npm --prefix web install && npm run build`. |
| `apiKeyValid: false` | Klucz zły albo wygasł. Poproś użytkownika o nowy z kie.ai/api-key, wklejony w Ustawieniach. |
| `apiError` mówi o kredytach | Konto u dostawcy jest puste. Doładowanie jest po stronie użytkownika. |
| `manifestProblems` niepuste | Zepsuty plik w `models/`. Napraw według komunikatu albo usuń plik. |
| port zajęty | Aplikacja sama szuka wolnego portu w górę od 4321. Gdy nadal nie działa: `OPENSTUDIO_PORT=5000 npm start`. |
| „Aplikacja nie odpowiada” w przeglądarce | Proces serwera nie działa. Uruchom `npm start` — otwarta karta wróci sama, bo token sesji jest trwały. |
| „ta karta pamięta token z poprzedniego uruchomienia” | Ktoś wywołał `reset-token` albo skasował `config.json`. Podaj użytkownikowi nowy adres z terminala. |

## Czego NIGDY nie robić

- **Nie wypisuj klucza API** użytkownika w odpowiedzi, w logu ani w commicie. W repo nie ma i nie może być pliku z kluczem.
- **Nie wołaj modelu czatu Kie (`provider.chat`) bez kliknięcia użytkownika.** To też kosztuje kredyty; heurystyka („ułóż plan”) jest darmowa i domyślna.
- **Nie ponawiaj automatycznie** żądania generacji (`POST /api/generate`, `createTask`). Dostawca nie ma idempotencji: powtórka = druga opłata. Zadanie ze statusem `unknown` ponawia **tylko użytkownik**, świadomie.
- **Nie wysyłaj inspiracji z tablicy do dostawcy „na zapas”.** Obietnica z UI brzmi: pliki idą dopiero przy generacji i tylko te wybrane. Upload robi wyłącznie `references.js`.
- **Nie dopisuj niczego do promptu poza `composePrompt` (server/prompt.js).** Użytkownik ma pod „pokaż pełny prompt" widzieć dokładnie to, co idzie do API — cicha dopiska psuje jedyne miejsce, w którym aplikacja mówi całą prawdę.
- Nie zmieniaj bindowania serwera z `127.0.0.1` na `0.0.0.0`. To zabezpieczenie, nie ograniczenie.
- Nie dopisuj zależności wymagających kompilacji (np. `better-sqlite3`, `sharp`) — psują instalację u osób nietechnicznych, a to główna grupa użytkowników.

## Struktura projektu

```
bin/openstudio.js     uruchamianie + komenda doctor
server/
  app.js              trasy HTTP (Hono)
  security.js         token sesji, kontrola Host/Origin
  queue.js            kolejka, polling, pobieranie plików
  boards.js           tablice inspiracji (pliki na dysku, deduplikacja, og:image)
  references.js       leniwy upload inspiracji do dostawcy z cache na 20 h
  styles.js           style: zapis, walidacja, fragment promptu ze stylu, eksport/import
  reference-roles.js  role obrazów (osoba, logo, produkt…) i ich zdania dla modelu
  prompt.js           composePrompt — JEDYNE miejsce składania promptu do wysyłki
  style-chips.js      katalog określeń, z których powstaje opis stylu
  infographic.js      infografika z tekstu: plan (heurystyka albo model czatu Kie), układy, prompt
  documents.js        .docx/.md/.html/.txt → tekst, własny czytnik ZIP (bez zależności)
  models.js           wczytywanie i walidacja manifestów, wycena
  store.js            config.json / jobs.json / ledger.json
  providers/kie.js    adapter API dostawcy (interfejs: submit, status, credits, upload)
models/*.json         katalog modeli — nowy model to nowy plik, zero kodu
web/                  interfejs (Vite + React + Tailwind)
test/                 testy: `npm test`
```

## Dodanie modelu

Skopiuj `models/gpt-image-2-5-flare-text-to-image.json`, zmień `id`, `model`, `title`, `fields` i `pricing`. Uruchom `npm test` — walidacja manifestów jest jednym z testów. Opis pól: `models/README.md`.
