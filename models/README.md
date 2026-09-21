# Katalog modeli

Jeden model = jeden plik JSON. Aplikacja buduje z niego cały formularz, więc **dodanie modelu nie wymaga pisania kodu**.

## Pola manifestu

| Pole | Znaczenie |
|---|---|
| `schemaVersion` | zawsze `1` |
| `id` | unikalny identyfikator w tym repo (zwykle taki sam jak `model`) |
| `provider` | na razie `kie` |
| `model` | dokładna nazwa modelu u dostawcy (idzie w `createTask`) |

Dwa manifesty mogą mieć **ten sam `model`, a różne `id`** — tak jest z Nano Banana 2, gdzie dostawca ma jeden endpoint na generowanie i na edycję, a my rozdzielamy je na dwie pozycje w katalogu („z tekstu” i „z inspiracji”), bo to dwie różne sytuacje dla użytkownika.

Żeby „ponów z poprawką” samo znalazło wariant edycyjny, trzymaj się nazewnictwa `<coś>-text-to-image` i `<coś>-image-to-image`.
| `title`, `subtitle` | co widzi użytkownik. Pisz po ludzku: „szybki, dobrze składa napisy”, a nie „SOTA diffusion” |
| `kind` | `t2i` (z tekstu) albo `i2i` (z obrazów referencyjnych) |
| `recommended` | czy model ma odznakę „polecany” |
| `badges` | 2–3 krótkie cechy, np. `["napisy na grafice", "do 4K"]` |
| `refs` | `{ "max": 16, "mode": "multi" }` — ile obrazów referencyjnych model przyjmie |
| `typicalSeconds` | ile zwykle trwa generacja (UI mówi to użytkownikowi) |
| `pricing` | `{ "unit": "credits", "by": "resolution", "values": {...}, "estimated": {...} }` |
| `fields` | lista pól formularza |

## Pola formularza

`type`: `textarea`, `text`, `select`, `number`, `toggle`, `images`.

**Nazwa pola jest nazwą parametru u dostawcy** — leci do API dokładnie tak, jak ją wpiszesz. Dotyczy to też pola z obrazami, a tam każdy model nazywa się inaczej: `input_urls` w GPT Image, `image_input` w Nano Banana 2, `image_urls` w Grok Imagine. Serwer wpisuje adresy wysłanych referencji w to pole, które znajdzie w manifeście, więc pomyłka w nazwie = model dostaje prompt bez obrazów i po cichu robi coś innego.

- `label` — pytanie, nie nazwa parametru („Co ma być na obrazie?”, nie „prompt”).
- `help` / `hint` — zdanie wyjaśniające, po co to komu.
- `required`, `default`, `min`, `max`, `maxLength`, `maxItems`.
- `advanced: true` — pole chowa się pod „ustawienia zaawansowane”.
- `clientOnly: true` — pole **nie** jest wysyłane do API (np. `count`, czyli ile wersji naraz).
- `affectsPrice: true` — zmiana tego pola przelicza cenę na przycisku.
- opcje `select`: `{ "value": "...", "label": "...", "hint": "..." }`.

## Cena

Kie.ai nie ma endpointu wyceny, więc cena pochodzi z `pricing.values`, a `pricing.estimated` mówi, czy to tylko szacunek. Po pierwszej udanej generacji aplikacja zapisuje **prawdziwy** koszt z pola `creditsConsumed` i od tej pory pokazuje go zamiast szacunku.

Model z wyborem jakości ma ceny pod kluczami `1K` / `2K` / `4K` (`"by": "resolution"`). Model, który takiego wyboru nie ma — jak Grok Imagine — ma jedną cenę pod kluczem `flat`:

```json
"pricing": { "unit": "credits", "by": "flat", "values": { "flat": 4 }, "estimated": { "flat": true } }
```

Nie zgaduj cen w PR-ze: wpisz szacunek i zostaw `"estimated": true`.

## Sprawdzenie

```bash
npm test     # walidacja wszystkich manifestów jest częścią testów
```
