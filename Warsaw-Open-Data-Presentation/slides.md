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

<p class="lead">Czym żyje dziś miasto?</p>

<!--
[0:10] Przywitaj się: "To jest Warsaw Pulse". Jedno zdanie, co to jest: strona w telefonie, która dzięki AI pokazuje najlepsze wydarzenia w Warszawie na dziś i jak tam dojechać. Nie rozwijaj, od razu przejdź do problemu.
-->

---
class: s s-problem
---

<div class="eyebrow">Problem</div>

# Jest 18:00. W Warszawie coś się dzieje. Gdzie?

<div class="cols">
<div class="col" v-click><h3>Rozproszone</h3><p>Wydarzenia są na wielu stronach i w wielu źródłach.</p></div>
<div class="col" v-click><h3>Bez rankingu</h3><p>Długie listy i nikt nie mówi, co dziś naprawdę warto zobaczyć.</p></div>
<div class="col" v-click><h3>Pół drogi</h3><p>Po wyborze wydarzenia trzeba jeszcze sprawdzić, jak tam dojechać.</p></div>
</div>

<!--
[0:35] Zacznij od sytuacji, którą każdy zna: wieczór, chcesz wyjść, nie wiesz dokąd. Wymień trzy bolączki po kolei (każde kliknięcie odsłania kolejną kolumnę) i zrób pauzę po ostatniej, bo prowadzi prosto do rozwiązania.
-->

---
class: s s-solution
---

<div class="eyebrow">Rozwiązanie</div>

# Jedna strona. Najlepsze wydarzenia na dziś. Dojazd w komplecie.

<div class="cols">
<div class="col" v-click><h3>Otwórz</h3><p>Jeden link w telefonie. Bez instalowania aplikacji.</p></div>
<div class="col" v-click><h3>Wybierz</h3><p>AI wskazuje najlepsze wydarzenia w Warszawie na dziś.</p></div>
<div class="col" v-click><h3>Jedź</h3><p>Pokazujemy, jak tam dojechać.</p></div>
</div>

<!--
[0:25] Trzy kroki, trzy słowa: otwórz, wybierz, jedź (każde kliknięcie odsłania kolejną kolumnę). Podkreśl, że to strona internetowa nastawiona na telefon, więc nic nie trzeba instalować. Potem: "zobaczcie, jak to wygląda".
-->

---
class: s s-demo
---

<div class="demo">
<div class="demo-text">
<div class="eyebrow">Demo · 1/3 · Wydarzenia</div>
<h1>Pytasz, co dziś się dzieje.</h1>
<ul class="callouts">
<li>Po polsku albo gotowym przyciskiem.</li>
<li>AI wybiera 1–3 propozycje z danych miasta.</li>
<li>Karty i pinezki na mapie całego miasta.</li>
</ul>
</div>
<PhoneFrame video="/demo-events.mp4" />
</div>

<!--
[0:40] Nagranie startuje samo po wejściu na slajd (kliknięcie w telefon zatrzymuje i wznawia). Mów na bieżąco: pytam "co dziś wieczorem w pobliżu?", AI odpowiada krótko po polsku i pokazuje 1–3 propozycje jako karty i pinezki. Podkreśl: to prawdziwe rekordy z danych miasta, nie wymyślone miejsca.
Nagranie: public/demo-events.mp4 (pionowe, 15–25 s, kilka MB). Sprawdź, czy nie widać na nim twojego adresu.
-->

---
class: s s-demo
---

<div class="demo">
<div class="demo-text">
<div class="eyebrow">Demo · 2/3 · Dojazd</div>
<h1>Jeden przycisk i wiesz, jak dojechać.</h1>
<ul class="callouts">
<li>Start z Twojej lokalizacji, cel prosto z mapy.</li>
<li>Połączenia z rozkładu ZTM i dojście pieszo.</li>
<li>Szacowany przyjazd i pojazdy na żywo w pobliżu.</li>
</ul>
</div>
<PhoneFrame video="/demo-routes.mp4" />
</div>

<!--
[0:40] Pokaż "Wyznacz trasę" przy wydarzeniu: start bierze się z GPS, cel z mapy. Aplikacja liczy połączenia z rozkładu ZTM i dojście pieszo, pokazuje szacowany przyjazd i autobusy/tramwaje na żywo w pobliżu. Dodaj zdanie: wszystko z danych miejskich, bez tras z Google.
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
[0:25] Dodaj wydarzenie do ulubionych sercem, otwórz listę "Ulubione" i z niej wyznacz trasę albo pokaż miejsce na mapie. Krótko: nie trzeba zakładać konta, lista zapisuje się w przeglądarce telefonu.
Nagranie: public/demo-favorites.mp4.
-->

---
class: s s-demo
---

<div class="demo">
<div class="demo-text">
<div class="eyebrow">Demo na żywo</div>
<h1>A teraz prawdziwa strona.</h1>
<!--<p class="addr"><span class="tbd">http://localhost:[PORT]</span></p>!-->
</div>
<PhoneFrame src="http://localhost:5173?safeTop=35&safeBottom=0" />
</div>

<!--
[0:20] Pokaż żywą stronę tylko wtedy, gdy wszystko działa. Jeśli nic się nie ładuje po 5 sekundach, wróć do poprzedniego slajdu z nagraniem i nie próbuj naprawiać na scenie.
Adres w slides.md: <PhoneFrame src="http://localhost:5173?safeTop=59&safeBottom=34" />. safeTop i safeBottom to odstępy (w px), które aplikacja zostawia na górze i na dole, jak na prawdziwym telefonie.
Jeśli telefon jest pusty, strona może blokować osadzanie w ramce (nagłówki X-Frame-Options lub CSP frame-ancestors). Backendowiec to wyłączy dla tego adresu.
-->

---
class: s s-data
---

<div class="eyebrow">Otwarte dane</div>

# Na jakich danych to stoi

<div class="rows">
<div class="row"><div class="k">Wydarzenia i aktywności</div><div class="v">Portal otwartych danych Warszawy: kalendarz wydarzeń, zajęcia sportowe, otwarte boiska, trasy turystyczne i toalety. Około 3 tys. rekordów.</div></div>
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

# Dziękujemy

<p class="lead">Pytania?</p>

<!--
[0:20] Podziękuj jury, przedstaw zespół jednym zdaniem na osobę i powiedz, kto co robił. Jeśli zostało kilka sekund, dodaj jedno zdanie, co dalej (np. publiczne wdrożenie albo więcej zbiorów otwartych danych). Potem zamilknij i przyjmij pytania.
-->
