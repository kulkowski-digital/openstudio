# Jak zdobyć klucz API (5 minut)

1. Wejdź na [kie.ai](https://kie.ai?ref=e0629a803712280df41ecba044a8cdf4) ([wersja bez linku polecającego](https://kie.ai)) i załóż konto.
2. Doładuj konto najmniejszą kwotą, jaka jest dostępna. Jedna grafika w jakości 1K to około **6 kredytów** — na próby wystarczy naprawdę niewiele.
3. Na stronie „API Key” kliknij **Create / Copy**. Klucz to długi ciąg znaków.
4. Wróć do OpenStudio i wklej go w jedyne pole na ekranie. Aplikacja od razu sprawdzi, czy działa, i pokaże saldo.

## Dobre nawyki

- Załóż **osobny klucz** dla tej aplikacji. Jeśli kiedyś wycieknie, skasujesz go bez ruszania reszty.
- Klucz zostaje na Twoim komputerze (`~/OpenStudio/config.json`, prawa tylko dla Ciebie). Nie wysyłamy go nigdzie poza samo API dostawcy.
- Nie wklejaj klucza w czacie z agentem AI ani w zgłoszeniu błędu. Raport z „Diagnostyki” jest specjalnie przygotowany tak, żeby klucza nie zawierał.

## Ile to kosztuje naprawdę

| Co | Kredyty (orientacyjnie) |
|---|---|
| GPT Image 2.5 Flare, 1K | 6 (sprawdzone) |
| GPT Image 2.5 Flare, 2K | ~12 (szacunek, aplikacja sama się skalibruje) |
| GPT Image 2.5 Flare, 4K | ~24 (szacunek) |

Po każdej generacji aplikacja zapisuje prawdziwy koszt zwrócony przez API, więc cena na przycisku z czasem staje się dokładna.
