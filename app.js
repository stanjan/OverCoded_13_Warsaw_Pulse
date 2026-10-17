const input = document.querySelector('#search-bar-input');
const messages = document.querySelector('#chat-messages');
const resultPanel = document.querySelector('#place-results');
const content = document.querySelector('#sheet-content');
const toggle = document.querySelector('#collapse-toggle-btn');
const submit = document.querySelector('#ai-submit-btn');
const welcome = document.querySelector('#welcome-prompts');
const drawer = document.querySelector('.drawer-container');
let sessionId = null;
let pending = false;
let expanded = true;
let cityMap;
let suppressHandleClick = false;

function setExpanded(value) {
  expanded = value;
  content.inert = !value;
  content.setAttribute('aria-hidden', String(!value));
  document.querySelector('#ai-sheet').classList.toggle('is-collapsed', !value);
  toggle.setAttribute('aria-expanded', String(value));
  toggle.setAttribute('aria-label', value ? 'Zwiń panel' : 'Rozwiń panel');
  toggle.title = value ? 'Zwiń panel' : 'Rozwiń panel';
  document.querySelector('#sheet-chevron').textContent = value ? 'keyboard_arrow_down' : 'keyboard_arrow_up';
}
setExpanded(true);
document.querySelector('#sheet-toggle').addEventListener('click', () => {
  if (suppressHandleClick) { suppressHandleClick = false; return; }
  setExpanded(!expanded);
});
toggle.addEventListener('click', event => { event.stopPropagation(); setExpanded(!expanded); });
input.addEventListener('focus', () => setExpanded(true));
document.querySelector('#search-bar-wrapper').addEventListener('click', () => input.focus());
// Match the drawer's touch affordance without interfering with map gestures.
let touchStart;
document.querySelector('#sheet-toggle').addEventListener('pointerdown', event => { touchStart = event.clientY; suppressHandleClick = false; });
document.querySelector('#sheet-toggle').addEventListener('pointerup', event => {
  if (touchStart !== undefined && Math.abs(event.clientY - touchStart) > 30) { suppressHandleClick = true; setExpanded(event.clientY < touchStart); }
  touchStart = undefined;
});

const mapCanvas = document.querySelector('#city-map');
const appShell = document.querySelector('.app-shell');
// Keep the map's usable area (markers, fitting, attribution) above the bottom sheet.
new ResizeObserver(() => {
  const obstruction = document.querySelector('#ai-sheet').offsetHeight + document.querySelector('nav').offsetHeight + 4;
  appShell.style.setProperty('--map-obstruction', `${obstruction}px`);
}).observe(document.querySelector('#ai-sheet'));
const mapContainer = document.querySelector('#map-canvas-container');
function showMapUnavailable() {
  mapContainer.classList.remove('map-ready', 'map-google', 'map-leaflet');
  document.querySelector('#map-canvas-container .pointer-events-none span:last-child').textContent = 'Mapa jest chwilowo niedostępna';
}
function useMap(map) {
  cityMap = map;
  mapContainer.classList.remove('map-google', 'map-leaflet');
  mapContainer.classList.add('map-ready', `map-${map.vendor}`);
  return map;
}
// If Google rejects the key after loading, continue on OpenStreetMap with the same state.
function onMapReplaced(map) {
  if (!map) { cityMap = undefined; showMapUnavailable(); return; }
  useMap(map);
  if (lastPosition) map.showUser(lastPosition);
  if (lastResults) drawMarkers(lastResults);
}
const mapReady = (window.createCityMap ? window.createCityMap(mapCanvas, { onReplace: onMapReplaced }) : Promise.reject(new Error('map.js missing')))
  .then(useMap)
  .catch(error => { console.warn('[map]', error.message); showMapUnavailable(); });
const CENTER = window.CITY_CENTER || { lat: 52.2318, lng: 21.006, zoom: 12 };
// User location: first tap asks permission, then the blue dot follows the user.
const gpsButton = document.querySelector('#gps-button');
let watchId = null;
let lastPosition = null; // { lat, lng, accuracy }
function setGpsState(state) {
  gpsButton.dataset.state = state;
  const labels = { idle: 'Pokaż moją lokalizację', locating: 'Szukam lokalizacji…', active: 'Wyśrodkuj na mojej lokalizacji', denied: 'Lokalizacja niedostępna — wyśrodkuj mapę Warszawy' };
  gpsButton.setAttribute('aria-label', labels[state]);
  gpsButton.title = labels[state];
}
setGpsState('idle');
function centerOnUser() {
  if (lastPosition) cityMap?.setView({ lat: lastPosition.lat, lng: lastPosition.lng }, 15);
}
gpsButton.addEventListener('click', () => {
  setExpanded(false);
  if (!('geolocation' in navigator)) { setGpsState('denied'); cityMap?.setView(CENTER, CENTER.zoom); return; }
  if (watchId !== null) { lastPosition ? centerOnUser() : cityMap?.setView(CENTER, CENTER.zoom); return; }
  setGpsState('locating');
  let first = true;
  watchId = navigator.geolocation.watchPosition(position => {
    const { latitude: lat, longitude: lng, accuracy } = position.coords;
    lastPosition = { lat, lng, accuracy };
    cityMap?.showUser(lastPosition);
    setGpsState('active');
    if (first) { first = false; centerOnUser(); }
  }, error => {
    // After a first fix, a timeout or lost signal is temporary: keep watching and keep the dot.
    if (!first && error.code !== error.PERMISSION_DENIED) return;
    navigator.geolocation.clearWatch(watchId); watchId = null;
    setGpsState('denied');
    cityMap?.setView(CENTER, CENTER.zoom);
    addMessage(error.code === error.PERMISSION_DENIED
      ? 'Brak zgody na lokalizację. Możesz ją włączyć w ustawieniach przeglądarki dla tej strony.'
      : 'Nie udało się ustalić Twojej lokalizacji. Spróbuj ponownie za chwilę.');
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
});

let lastResults = null;
let resultCards = [];
function drawMarkers(results) {
  if (!cityMap) return;
  cityMap.clearMarkers();
  const points = [];
  results.forEach((place, index) => {
    const marker = cityMap.addMarker(place);
    if (resultCards[index]) resultCards[index].marker = marker;
    points.push([place.lat, place.lng]);
  });
  cityMap.fitTo(points, { top: 70, left: 24, right: 24, bottom: cityMap.vendor === 'google' ? 24 : Math.min(drawer.offsetHeight + 80, mapCanvas.clientHeight * .6) });
}
function showResults(action) {
  resultPanel.replaceChildren();
  cityMap?.clearMarkers();
  lastResults = action.results;
  const title = document.createElement('h2'); title.textContent = action.title;
  const note = document.createElement('p'); note.className = 'results-note'; note.textContent = 'Dane demonstracyjne · bez informacji na żywo';
  resultPanel.append(title, note);
  if (!action.results.length) { const empty = document.createElement('p'); empty.textContent = 'Brak pasujących miejsc.'; resultPanel.append(empty); }
  resultCards = action.results.map(place => {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'place-card';
    const name = document.createElement('strong'); name.textContent = place.name;
    const detail = document.createElement('span'); detail.textContent = `${place.district} · ${place.description}`;
    card.append(name, detail); resultPanel.append(card);
    const entry = { marker: null };
    card.addEventListener('click', () => {
      if (!cityMap) return;
      setExpanded(false);
      cityMap.setView({ lat: place.lat, lng: place.lng }, 15);
      entry.marker?.open();
    });
    return entry;
  });
  // The map loads asynchronously: draw markers once it is ready (immediately if it already is).
  const results = action.results;
  mapReady.then(() => { if (lastResults === results) drawMarkers(results); });
}

const prompts = ['Zaproponuj spacer nad Wisłą.', 'Czy są teraz opóźnienia komunikacji ZTM?', 'Gdzie znajdę najbliższe Veturilo?'];
document.querySelectorAll('.prompt-chip').forEach((button, index) => button.addEventListener('click', () => {
  input.value = prompts[index]; input.focus();
}));
function addMessage(text, user = false) {
  setExpanded(true);
  welcome.hidden = true;
  const bubble = document.createElement('p');
  bubble.className = user ? 'message user' : 'message';
  bubble.textContent = text;
  messages.append(bubble);
  requestAnimationFrame(() => { content.scrollTop = content.scrollHeight; });
  return bubble;
}
async function send() {
  const value = input.value.trim();
  if (!value || pending) return;
  pending = true; submit.disabled = true; submit.setAttribute('aria-busy', 'true');
  addMessage(value, true); input.value = '';
  const progress = addMessage('Chwilę…');
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: value, sessionId }), signal: AbortSignal.timeout(95000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Nie udało się uzyskać odpowiedzi.');
    sessionId = data.sessionId; progress.textContent = data.message;
    for (const action of data.actions || []) {
      if (action.type === 'display_results') showResults(action);
      if (action.type === 'focus_map' && cityMap) cityMap.setView({ lat: action.latitude, lng: action.longitude }, action.zoom);
    }
    // Keep result cards immediately discoverable while the map shows their markers.
    content.scrollTop = resultPanel.childElementCount ? 0 : content.scrollHeight;
  } catch (error) {
    progress.classList.add('message-error');
    progress.textContent = error.name === 'TimeoutError' ? 'Odpowiedź trwa zbyt długo. Spróbuj ponownie.' : error.message;
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Spróbuj ponownie';
    retry.addEventListener('click', () => { if (pending) return; input.value = value; progress.remove(); send(); });
    progress.append(document.createElement('br'), retry);
  } finally { pending = false; submit.disabled = false; submit.removeAttribute('aria-busy'); }
}
submit.addEventListener('click', event => { event.stopPropagation(); send(); });
input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); send(); } });
document.querySelector('#mic-btn').addEventListener('click', event => {
  event.stopPropagation(); addMessage('Wprowadzanie głosowe nie jest jeszcze dostępne. Wpisz pytanie w polu poniżej.'); input.focus();
});
document.querySelectorAll('nav a').forEach(link => link.addEventListener('click', event => {
  event.preventDefault();
  if (link.dataset.path === 'city-pulse') { setExpanded(true); return; }
  addMessage(`Sekcja ${link.querySelector('span:last-child').textContent.trim()} będzie dostępna w kolejnej wersji aplikacji.`);
}));
