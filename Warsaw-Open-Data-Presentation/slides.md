---
theme: default
title: Warsaw Pulse
info: |
  Prezentacja projektu na Warsaw Open Data Hackathon, 17-18 października.
colorSchema: dark
transition: fade
duration: 5min
drawings:
  persist: false
fonts:
  sans: Segoe UI, Helvetica Neue, Arial
  mono: Consolas, Menlo, Courier New
  provider: none
class: s s-title
---

<div class="eyebrow">Warsaw Open Data Hackathon · 17–18 października</div>

# Warsaw Pulse

<p class="lead">Czym żyje dziś miasto?<br>Złap w nim oddech w czasie, który masz.</p>

<!--
[0:10] NIE przedstawiaj się i nie tłumacz jeszcze, co to jest. Powiedz tylko: "Warsaw Pulse. Czym żyje dziś miasto?" i od razu przejdź dalej. Zespół przedstawicie na końcu.
-->

---
class: s s-problem
---

<div class="eyebrow">Problem</div>

# Jest 17:40. Masz godzinę dla siebie. I co?

<div class="cols">
<div class="col" v-click><h3>Szukanie zjada odpoczynek</h3><p>Kilka stron, kilka aplikacji. 15 minut z twojej wolnej godziny znika na scrollowanie.</p></div>
<div class="col" v-click><h3>Za dużo decyzji</h3><p>Po 8 godzinach pracy nikt nie ma siły porównywać 600 wydarzeń.</p></div>
<div class="col" v-click><h3>Wygrywa kanapa</h3><p>Nie wiesz, czy zdążysz dojechać, więc zostajesz w domu. Znowu.</p></div>
</div>

<!--
[0:35] To jest NASZ HOOK, mów do jury, nie do slajdu: "Jest 17:40. Wychodzicie z biura. Macie godzinę i jedną myśl: chcę coś zrobić dla siebie. Otwieracie trzy aplikacje, scrollujecie, sprawdzacie dojazd… i po 15 minutach jesteście w domu na kanapie." Potem kliknięcia: szukanie, decyzje, kanapa. Puenta: "Work-life balance nie przegrywa z pracą. Przegrywa z tarciem." Pauza.
-->

---
class: s s-who
---

<div class="eyebrow">Dla kogo</div>

# Dla ludzi, którym nie brakuje chęci. Brakuje im energii na planowanie.

<div class="cols">
<div class="col" v-click><h3>Po pracy</h3><p>Kasia, 29 lat, Mokotów. Ma godzinę wieczorem i nie chce jej spędzić na szukaniu.</p></div>
<div class="col" v-click><h3>Rodzic z dzieckiem</h3><p>Wyjdzie tylko wtedy, gdy wie, gdzie jest toaleta i plac zabaw.</p></div>
<div class="col" v-click><h3>Biegacz i senior</h3><p>Boisko po drodze, najbliższy defibrylator. Spokój, że miasto ma ich na oku.</p></div>
</div>

<!--
[0:25] Jedno zdanie na kolumnę. Kasia to nasza persona i wracamy do niej w demo ("Kasia pyta…"). Puenta: "WC, boiska i defibrylatory to dla nich nie dodatki. To warunek, żeby w ogóle wyjść z domu."
-->

---
class: s s-solution
---

<div class="eyebrow">Rozwiązanie</div>

# Od „mam chwilę” do „już idę” w 10 sekund.

<div class="cols">
<div class="col" v-click><h3>Napisz</h3><p>Po ludzku: ile masz czasu, gdzie jesteś, na co masz ochotę. Bez filtrów i kategorii.</p></div>
<div class="col" v-click><h3>Dostań 1–3 propozycje</h3><p>AI wybiera z prawdziwych danych miasta. Nie lista 600 pozycji, tylko decyzja.</p></div>
<div class="col" v-click><h3>Idź</h3><p>Dojazd ZTM z pojazdami na żywo. Wiesz, czy zdążysz, zanim wyjdziesz.</p></div>
</div>

<!--
[0:25] Trzy kroki: powiedz, dostań propozycje, idź. Kluczowe słowo to CZAS, nie "wydarzenia": "Inne aplikacje pokazują, co się dzieje. My oddajemy wam czas, który zjadało szukanie." Wspomnij jednym zdaniem: to strona w telefonie, nic nie trzeba instalować. Potem: "Zobaczcie, jak to robi Kasia."
-->

---
class: s s-demo
---

<div class="demo">
<div class="demo-text">
<div class="eyebrow">Demo · 1/3 · Wydarzenia</div>
<h1>Kasia pyta po ludzku.</h1>
<ul class="callouts">
<li>Po polsku albo gotowym przyciskiem.</li>
<li>AI wybiera 1–3 propozycje z danych miasta.</li>
<li>Karty i pinezki na mapie całego miasta.</li>
</ul>
</div>
<PhoneFrame video="/demo-events.mp4" />
</div>

<!--
[0:40] Nagranie startuje samo po wejściu na slajd (kliknięcie w telefon zatrzymuje i wznawia). Opowiadaj jako Kasia, nie jako opis funkcji. Mów na bieżąco: pytam "co dziś wieczorem w pobliżu?", AI odpowiada krótko po polsku i pokazuje 1–3 propozycje jako karty i pinezki. Podkreśl: to prawdziwe rekordy z danych miasta, nie wymyślone miejsca.
Nagranie: public/demo-events.mp4 (pionowe, 15–25 s, kilka MB). Sprawdź, czy nie widać na nim twojego adresu.
-->

---
class: s s-demo
---

<div class="demo">
<div class="demo-text">
<div class="eyebrow">Demo · 2/3 · Dojazd</div>
<h1>I od razu wie, czy zdąży.</h1>
<ul class="callouts">
<li>Start z Twojej lokalizacji, cel prosto z mapy.</li>
<li>Połączenia z rozkładu ZTM i dojście pieszo.</li>
<li>Szacowany przyjazd i pojazdy na żywo w pobliżu.</li>
</ul>
</div>
<PhoneFrame video="/demo-routes.mp4" />
</div>

<!--
[0:40] Pokaż "Wyznacz trasę" przy wydarzeniu: start bierze się z GPS, cel z mapy. Aplikacja liczy połączenia z rozkładu ZTM i dojście pieszo, pokazuje szacowany przyjazd i autobusy/tramwaje na żywo w pobliżu. Pokaż pojazd w ruchu, to nasz najmocniejszy wyróżnik: "To nie jest 'tramwaj co 10 minut'. To jest TEN tramwaj, dwa przystanki stąd." Dodaj zdanie: wszystko z danych miejskich, bez tras z Google.
Nagranie: public/demo-routes.mp4.
-->

---
class: s s-demo
---

<div class="demo">
<div class="demo-text">
<div class="eyebrow">Demo · 3/3 · Ulubione</div>
<h1>Zapisz na później.</h1>
<ul class="callouts">
<li>Serce na karcie albo w szczegółach wydarzenia.</li>
<li>Z listy ulubionych: pokaż na mapie albo wyznacz trasę.</li>
<li>Bez zakładania konta, lista zostaje w telefonie.</li>
</ul>
</div>
<PhoneFrame video="/demo-favorites.mp4" />
</div>

<!--
[0:15] Skróć do jednego zdania, to najmniej wyróżniająca funkcja (pierwszy kandydat do wycięcia, jeśli brakuje czasu). Dodaj wydarzenie do ulubionych sercem, otwórz listę "Ulubione" i z niej wyznacz trasę albo pokaż miejsce na mapie. Krótko: nie trzeba zakładać konta, lista zapisuje się w przeglądarce telefonu.
Nagranie: public/demo-favorites.mp4.
-->

---
class: s s-demo
---

<LiveDemo />

<!--
[0:20] Kliknij jeden z sześciu kafelków. Pytanie trafia bezpośrednio do aplikacji w telefonie, a przyjęty kafelek podświetla się. Kolejne pytanie można wysłać po zakończeniu odpowiedzi. Prezentacja: http://localhost:3030 lub http://127.0.0.1:3030; aplikacja: http://localhost:5173. Kafelki podają dzielnicę, więc nie potrzebują zgody na GPS. Ręcznie wpisany tekst w telefonie ma pierwszeństwo; usuń szkic przed kliknięciem kafelka. Po przeładowaniu ramki połączenie odtwarza się samo, ale poprzednie pytanie nie jest wysyłane ponownie.
-->

---
class: s s-data
---

<div class="eyebrow">Otwarte dane</div>

# Na jakich danych to stoi

<div class="rows">
<div class="row"><div class="k">Wydarzenia i aktywności</div><div class="v">Portal otwartych danych Warszawy: kalendarz wydarzeń, zajęcia sportowe, otwarte boiska, trasy turystyczne, toalety i defibrylatory (AED). Około 3 tys. rekordów.</div></div>
<div class="row"><div class="k">Dojazd</div><div class="v">ZTM: rozkład jazdy (GTFS) i pozycje autobusów i tramwajów na żywo. Adresy z GUGiK. Bez tras z Google.</div></div>
<div class="row"><div class="k">Warunki teraz</div><div class="v">Pogoda, jakość powietrza, wschód i zachód słońca (Open-Meteo).</div></div>
<div class="row"><div class="k">Uczciwie</div><div class="v">Brak danych albo nieaktualna pozycja autobusu są wyraźnie oznaczone. Niczego nie zgadujemy.</div></div>
</div>

<!--
[0:35] To slajd dla jury hackathonu o otwartych danych. Powiedz konkretnie: wydarzenia, zajęcia, boiska, trasy i toalety bierzemy z portalu otwartych danych miasta, łącznie około 3 tysięcy rekordów (17.10: 649 wydarzeń, 1 227 boisk). Dojazd liczymy z rozkładu ZTM i pozycji pojazdów na żywo, bez Google. Na koniec podkreśl uczciwość: jeśli danych brakuje, aplikacja to mówi, zamiast zgadywać.
-->

---
class: s s-flow
---

<div class="eyebrow">Jak to działa</div>

# Od danych miasta do mapy w telefonie

<div class="flow">
<div class="node"><h3>Dane miasta</h3><p>Portal otwartych danych, rozkład i pozycje pojazdów ZTM.</p><span class="tag">API miasta · GTFS</span></div>
<div class="arrow">→</div>
<div class="node"><h3>Serwer</h3><p>Pobiera dane i trzyma klucze API poza telefonem.</p><span class="tag">Node.js</span></div>
<div class="arrow">→</div>
<div class="node"><h3>AI przez MCP</h3><p>7 narzędzi, każde wywołanie sprawdzane. Pokazuje tylko prawdziwe rekordy.</p><span class="tag">MCP</span></div>
<div class="arrow">→</div>
<div class="node"><h3>Mapa w telefonie</h3><p>Karty z propozycjami, pinezki i dojazd ZTM.</p><span class="tag">Google Maps / OSM</span></div>
</div>

<!--
[0:30] Od lewej do prawej, po jednym zdaniu na kwadrat. Najważniejsze dla jury: AI nie ma bezpośredniego dostępu do niczego. Działa tylko przez nasz serwer MCP z 7 narzędziami, każde wywołanie jest sprawdzane, więc nie może wymyślić miejsca, którego nie ma w danych miasta.
Jeśli brakuje czasu, ten slajd i poprzedni można połączyć w jedną wypowiedź.
Pytanie o koszty AI: na hackathonie działa lokalnie przez zalogowane subskrypcje; w wersji publicznej podłączymy zwykłe API, reszta systemu się nie zmienia.
-->

---
class: s s-title s-thanks
---

<div class="eyebrow">Warsaw Pulse · Warsaw Open Data Hackathon</div>

# Złap oddech.

<p class="lead">Inni pokazują, czym żyje miasto.<br>My pomagamy w nim naprawdę odpocząć.</p>

<p class="lead" style="margin-top:28px">Dziękujemy · Pytania?</p>

<!--
[0:20] Najpierw puenta, powoli: "Czym żyje miasto? Od dziś także waszym odpoczynkiem." Dwie sekundy ciszy. Potem podziękuj jury, przedstaw zespół jednym zdaniem na osobę i powiedz, kto co robił. Jeśli zostało kilka sekund, dodaj jedno zdanie, co dalej (np. publiczne wdrożenie albo więcej zbiorów otwartych danych). Potem zamilknij i przyjmij pytania.
-->
