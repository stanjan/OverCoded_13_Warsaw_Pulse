# Remote demo controls

## Kafelki w lokalnej prezentacji

Slajd 8 na `http://localhost:3030/8` steruje aplikacją we własnej ramce `http://localhost:5173` bezpośrednio przez `postMessage`. Sześć kafelków wysyła zwykłe pytania do czatu. Ten tryb nie wymaga tokenów, parowania ani `DEMO_REMOTE_ENABLED`.

Odbiornik działa tylko w ramce z `presentationDemo=1`, akceptuje jej rodzica na `http://localhost:3030` lub `http://127.0.0.1:3030` i sprawdza źródło wiadomości. Kafelki czekają na gotowość aplikacji; nie nadpisują ręcznego szkicu i nie wysyłają kolejnego pytania podczas odpowiedzi. Podświetlenie następuje po potwierdzeniu przyjęcia prompta. Przeładowanie ramki ponownie nawiązuje połączenie, bez powtarzania pytania. Tryb prezentacji nie wywołuje automatycznie nowej zgody na GPS; dostępna lokalizacja i ręczny przycisk GPS pozostają obsługiwane.

Uruchom aplikację i bridge przed prezentacją. Bezpośrednie połączenie ramki usuwa etap parowania, ale odpowiedzi nadal wymagają działającego bridge'a i dostępu do odpowiednich źródeł danych.

## Zewnętrzne sterowanie przez API

Ten oddzielny mechanizm steruje **jedną jawnie połączoną kartą aplikacji** i używa zwykłej rozmowy, streamingu, kart rekomendacji oraz mapy.

1. Ustaw `DEMO_REMOTE_ENABLED=1` w lokalnym `.env` i uruchom ponownie serwer. Domyślny adres pozostaje `http://127.0.0.1:5173`; nic nie otwiera automatycznie sieci ani firewalla.
2. Otwórz `http://127.0.0.1:5173/demo`, wybierz **Utwórz cel demo**, następnie **Otwórz aplikację odbierającą**. Tylko ta karta odbiera polecenia; aplikacja nie pokazuje komunikatu ani przycisku demo. Zwykła karta główna nie odbiera poleceń. Odbiornik zachowuje parowanie w pamięci sesji swojej karty (`sessionStorage`): odświeżenie tej samej karty automatycznie łączy ją ponownie, także po restarcie serwera. Pozostaw tę kartę otwartą podczas pokazu. Zamknięcie karty lub wyczyszczenie jej pamięci sesji wymaga zakończenia starego celu i utworzenia nowego; inna karta nie przejmuje zajętego odbiornika. Panel sterowania również zachowuje dostęp po odświeżeniu, bez automatycznego ponowienia pytania.
3. W panelu `/demo` wpisz pytanie i wyślij je albo skopiuj **Link dla kafelka na slajdzie**. Otwarcie linku wysyła zapisane pytanie automatycznie. Każde ponowne otwarcie linku jest nowym poleceniem. Panel i linki są prywatnymi kluczami dostępu: nie umieszczaj ich w publicznym repozytorium, logach ani materiałach po prezentacji.
4. Po pokazie użyj **Zakończ demo** w panelu `/demo`. Cele **nie wygasają automatycznie**. Restart serwera zachowuje linki i parowanie: minimalne dane dostępu oraz identyfikatory, skróty SHA-256 i stany ostatnich 100 poleceń na cel są atomowo zapisywane w ignorowanym `.local/demo-targets.json`. Zakończenie demo trwale unieważnia linki, również po restarcie. Nie usuwaj tego pliku przed pokazem; zawiera prywatne klucze dostępu. Błąd odczytu lub zapisu jest jawny — serwer nie zastępuje utraconych danych nowymi linkami. Opcjonalny `DEMO_STORE_FILE` zmienia lokalną ścieżkę pliku. Limit: 8 aktywnych celów, prompt do 2000 znaków; liczba poleceń nie ma limitu sesji. Brak kolejki i historii GPS, rozmowy lub tekstów promptów na dysku.

API sterowania (token sterujący znajduje się w prywatnym fragmencie wygenerowanego linku jako `demo-control`, pola `target` i `token`):

```js
const access = JSON.parse(new URLSearchParams(new URL(privateTileLink).hash.slice(1)).get('demo-control'));
const response = await fetch(`${appOrigin}/api/demo/targets/${access.target}/prompts`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access.token}` },
  body: JSON.stringify({ requestId: crypto.randomUUID(), prompt: 'Jestem zmęczony, pokaż pomysły na spokojny wieczór' }),
});
const command = await response.json();
```

Migracja istniejących linków ze starszej wersji przechowującej cele tylko w RAM: **przed pierwszym restartem** zachowaj istniejący `target`, `controlToken` i `receiverToken`. Lokalny `node scripts/import-demo-targets.mjs` przyjmuje na standardowym wejściu tablicę JSON z tymi trzema polami (nie podawaj kluczy jako argumentów polecenia ani w logach). Import zapisuje identyczne dane dostępu do trwałego pliku; waliduje cały pakiet, nie nadpisuje konfliktów i nie zmienia już istniejącego parowania. Zamknij stary odbiornik, zrestartuj serwer i otwórz jego oryginalny link, aby sparować tę samą kartę według nowych zasad. Linki sterujące na kafelkach pozostają identyczne. Bez odzyskania kluczy ze starego działającego panelu danych z RAM nie da się odtworzyć po restarcie.

`202` z `state: delivered` oznacza dostarczenie polecenia do połączonego odbiornika, **nie gotową odpowiedź AI**. `GET /api/demo/targets/:target/prompts/:requestId` z tym samym Bearer zwraca `delivered`, `started`, `rejected` albo `finished` (zakończenie obsługi w UI, również gdy asystent pokazał błąd). W razie utraty połączenia po dostarczeniu stan może pozostać `delivered`; nie oznacza to startu ani sukcesu. Ponowienie POST z **tym samym requestId i promptem** w oknie ostatnich 100 zaakceptowanych poleceń odczytuje poprzedni stan i nie wysyła ponownie, także po restarcie. Starsze ID są usuwane (GET zwraca 404); nigdy nie ponawiaj automatycznie ID spoza tego okna. Restart nie wznawia już dostarczonych pytań; stan `delivered` lub `started` może pozostać niepotwierdzony. Nie używaj nowego ID do automatycznego retry niepewnego wyniku.

`409`: brak połączonej karty, zajęta rozmowa lub niewysłany ręczny tekst; nic nie zostaje zakolejkowane. Ręczny draft ma pierwszeństwo również w wyścigu z dostarczeniem. `401`: nieprawidłowy/unieważniony dostęp; `413`: za duże body; `429`: limit aktywnych celów; `503`: funkcja wyłączona lub niedostępny zapis trwały. `GET /api/demo/targets/:target` pokazuje `connected`, `ready`, `expiresAt: null` (brak wygaśnięcia); `DELETE` unieważnia cel. Token odbiornika jest oddzielny i nie pozwala wysyłać promptów.

Dla sterowania z innej aplikacji ustaw `DEMO_ALLOWED_ORIGINS=https://twoje-slajdy.example` (dokładne origins rozdzielone przecinkami, bez ścieżek/wildcard). CORS dotyczy wyłącznie uwierzytelnionego sterowania; utworzenie celu i połączenie odbiornika pozostają w tej samej aplikacji. Slajdy na tym samym komputerze mogą używać localhost. Dla innego urządzenia świadomie skonfiguruj dostępny `HOST`/HTTPS i użyj dostępnego z niego adresu; localhost na telefonie oznacza telefon. Nie przesyłaj tokenów przez niezaufaną sieć HTTP. CORS nie zastępuje Bearer i nie omija ograniczeń przeglądarki dotyczących HTTPS/HTTP ani dostępu do sieci lokalnej. Dostęp nie jest publikowany przez `/api/config`, cookies ani query URL; fragment jest usuwany z paska adresu po odczytaniu i nie trafia do żądania HTTP.
