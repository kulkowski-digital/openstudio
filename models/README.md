# Katalog modeli

Jeden model = jeden plik JSON. Aplikacja buduje z niego cały formularz, więc **dodanie modelu nie wymaga pisania kodu**.

## Pola manifestu

| Pole | Znaczenie |
|---|---|
| `schemaVersion` | zawsze `1` |
| `id` | unikalny identyfikator w tym repo (zwykle taki sam jak `model`) |
| `provider` | na razie `kie` |
| `model` | dokładna nazwa modelu u dostawcy (idzie w `createTask`) |
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

- `label` — pytanie, nie nazwa parametru („Co ma być na obrazie?”, nie „prompt”).
- `help` / `hint` — zdanie wyjaśniające, po co to komu.
- `required`, `default`, `min`, `max`, `maxLength`, `maxItems`.
- `advanced: true` — pole chowa się pod „ustawienia zaawansowane”.
- `clientOnly: true` — pole **nie** jest wysyłane do API (np. `count`, czyli ile wersji naraz).
- `affectsPrice: true` — zmiana tego pola przelicza cenę na przycisku.
- opcje `select`: `{ "value": "...", "label": "...", "hint": "..." }`.

## Cena

Kie.ai nie ma endpointu wyceny, więc cena pochodzi z `pricing.values`, a `pricing.estimated` mówi, czy to tylko szacunek. Po pierwszej udanej generacji aplikacja zapisuje **prawdziwy** koszt z pola `creditsConsumed` i od tej pory pokazuje go zamiast szacunku.

Nie zgaduj cen w PR-ze: wpisz szacunek i zostaw `"estimated": true`.

## Sprawdzenie

```bash
npm test     # walidacja wszystkich manifestów jest częścią testów
```
