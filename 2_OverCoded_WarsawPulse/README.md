# Warsaw Pulse: prezentacja

Prezentacja projektu **Warsaw Pulse** na Warsaw Open Data Hackathon (17–18 października 2026). Zbudowana w [Slidev](https://sli.dev), czyli jako strona internetowa: slajdy są w pliku Markdown, a demo aplikacji działa w ramce telefonu.

## Najszybciej: PDF

**`Warsaw-Pulse-prezentacja.pdf`** w tym folderze zawiera wszystkie 11 slajdów i nie wymaga niczego instalować. W telefonach na slajdach demo są kluczowe klatki z nagrań, a slajd z demo na żywo ma zrzut ekranu aplikacji. Pełne nagrania demo leżą w `public/` (`demo-events.mp4`, `demo-routes.mp4`, `demo-favorites.mp4`).

## Uruchomienie prezentacji

Wymagany Node.js 20 lub nowszy.

```bash
cd 2_OverCoded_WarsawPulse
npm install
npm run dev
```

Prezentacja otworzy się pod adresem **http://localhost:3030**. Działa bez internetu (używa czcionek systemowych).

### Sterowanie

| Klawisz | Działanie |
| --- | --- |
| strzałka w prawo / spacja | dalej (na slajdach 2–4 kolejne kliknięcia odsłaniają kolumny) |
| strzałka w lewo | wstecz |
| `F` | pełny ekran |
| `O` | przegląd wszystkich slajdów |

Widok prezentera z notatkami i czasem: **http://localhost:3030/presenter**.

Nagrania na slajdach 5–7 startują same po wejściu na slajd. Kliknięcie w telefon zatrzymuje je albo wznawia.

## Demo na żywo (slajd 8)

Ten slajd pokazuje prawdziwą aplikację w ramce telefonu, a kafelki obok wysyłają do niej gotowe pytania. Wymaga to uruchomionej aplikacji pod **http://localhost:5173**. Instrukcja jest w głównym `README.md` repozytorium (most AI: `npm run bridge:start`, aplikacja: `npm run dev`, oba w głównym folderze repo).

Bez działającej aplikacji telefon na tym slajdzie jest pusty, a reszta prezentacji działa normalnie.

## Co jest w folderze

| Plik | Zawartość |
| --- | --- |
| `slides.md` | treść slajdów i notatki prelegenta |
| `style.css` | kolory i układ (paleta z materiałów hackathonu) |
| `global-bottom.vue` | animowane piksele, które przesuwają się między slajdami |
| `components/PhoneFrame.vue` | ramka telefonu (nagranie, żywa strona albo obrazek w PDF) |
| `components/LiveDemo.vue`, `components/live-demo-controller.mjs` | slajd demo na żywo z kafelkami pytań |
| `public/` | nagrania demo i klatki używane w PDF |

## Eksport do PDF

```bash
npm install -D playwright-chromium
npx slidev export --output Warsaw-Pulse-prezentacja.pdf
```

W PDF zamiast nagrań i żywej strony pojawiają się obrazki z `public/` (`demo-*.jpg`).
