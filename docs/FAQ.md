# Coś nie działa

Zacznij od **Ustawienia → Diagnostyka** (albo `npx openstudio doctor`). Raport nie zawiera klucza API, więc możesz go bezpiecznie wkleić w zgłoszeniu.

### „Aplikacja nie odpowiada”
Najczęściej znaczy dokładnie to, co mówi: proces w terminalu został zamknięty (Ctrl+C, zamknięte okno, uśpiony komputer). Strona zostaje otwarta, ale nie ma z kim rozmawiać. Uruchom `npx openstudio` ponownie — karta wróci sama w ciągu kilku sekund, bez przeładowania.

### „Brak ważnego tokenu sesji”
Normalnie nie powinieneś tego zobaczyć: wchodząc na `http://127.0.0.1:4321` z paska adresu albo z zakładki, dostajesz token automatycznie. Komunikat pojawia się, gdy strona została otwarta inaczej — np. z ramki na innej stronie albo przez program. Wróć do terminala i użyj adresu z `?t=…`. Token **nie** zmienia się przy każdym uruchomieniu, więc raz zapisana zakładka działa dalej. Jeśli chcesz unieważnić stare linki: `npx openstudio reset-token`.

### Wklejam link do obrazka i dostaję błąd 403
Część serwisów (Canva, Instagram, niektóre sklepy) blokuje pobieranie przez programy. Otwórz stronę w przeglądarce, zapisz obraz na dysk i przeciągnij plik na tablicę — albo przeciągnij go prosto z tamtej karty do okna OpenStudio.

### Strona się nie otwiera
Sprawdź w terminalu, na którym porcie wystartowała aplikacja (sama szuka wolnego od 4321 w górę). Możesz wymusić swój: `OPENSTUDIO_PORT=5000 npx openstudio`.

### „Ten klucz API nie działa”
Skopiuj klucz jeszcze raz w całości ze strony kie.ai/api-key. Częsty błąd to ucięty początek lub spacja na końcu.

### „Skończyły się kredyty”
Doładuj konto u dostawcy. OpenStudio nie sprzedaje kredytów i nie pośredniczy w płatnościach.

### Zadanie ma status „nieznany los”
Połączenie padło w trakcie wysyłania i **nie wiemy**, czy generacja ruszyła. Zajrzyj do panelu kie.ai. Jeśli zadania tam nie ma, kliknij „Wyślij ponownie (świadomie)”. Aplikacja nigdy nie robi tego sama, żeby nie zapłacić dwa razy.

### „Opłacone, ale niepobrane”
Obraz powstał, ale pobieranie padło. Kliknij „Pobierz ponownie”. Linki u dostawcy żyją około 24 godzin — po tym czasie plik przepada, choć w historii zostaje ślad.

### Obrazy nie pokazują się w bibliotece
Biblioteka czyta **z Twojego dysku**, nie z internetu. Sprawdź, czy pliki są w `~/OpenStudio/library/`. Jeśli przeniosłeś folder, aplikacja ich nie znajdzie.

### Instalacja się wysypuje
Sprawdź `node --version` (potrzebne ≥ 20.11). Projekt nie ma zależności wymagających kompilacji, więc typowe błędy z `node-gyp` tu nie występują — jeśli je widzisz, instalujesz coś innego niż OpenStudio.

### Włączyłem styl, a obrazy i tak wychodzą różne
Sprawdź **„pokaż pełny prompt”** w generatorze — tam widać dokładnie to, co idzie do modelu. Jeśli styl ma tylko paletę bez opisu, trzyma kolory, ale nie kompozycję. Dołóż chipy (rodzaj, światło, kadr) i ustaw siłę stylu na „mocno”.

### Styl ma referencje, ale wybrałem model „z tekstu”
Modele „z tekstu” nie przyjmują obrazów, więc referencje stylu są wtedy pomijane — aplikacja mówi o tym po wysłaniu. Opis i paleta działają normalnie. Chcesz, żeby referencje jechały z każdą generacją? Wybierz model „z inspiracji”.

### Kolory z palety nie zgadzają się co do odcienia
Tak działają modele obrazu: kod koloru traktują jak wskazówkę, nie jak farbę z puszki. Paleta przesuwa całość w Twoją stronę. Jeśli potrzebujesz dokładnego koloru marki, popraw go później w edytorze graficznym.

### Chcę wstawić swoje zdjęcie albo logo, nie tylko inspiracje
W generatorze, przy modelu „z inspiracji”, jest panel **Obrazy do tej generacji**. Wrzuć plik i wybierz rolę: *osoba* (model zachowa twarz), *logo* (wstawi bez zmian), *produkt*, *tło*, *obraz do edycji* albo *własna instrukcja* (piszesz sam). Kolejność na liście to kolejność, w jakiej model dostaje obrazy — i w tej samej kolejności są opisane w prompcie.

### Model zignorował moje logo / zmienił twarz
Sprawdź „pokaż pełny prompt”: czy obraz ma właściwą rolę i numer. Modele obrazu bywają uparte — pomaga krótsza lista obrazów (2–3 zamiast 8), dopisanie uwagi przy roli („logo w prawym dolnym rogu, małe”) i wariant Sunburst, który precyzyjniej trzyma się instrukcji.
