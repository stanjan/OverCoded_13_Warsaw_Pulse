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
let lastDisplayedAction;
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
let mapWasReplaced = false;
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
  mapWasReplaced = true;
  if (!map) { cityMap = undefined; showMapUnavailable(); return; }
  useMap(map);
  if (lastPosition) map.showUser(lastPosition);
  if (lastDisplayedAction) showResults(lastDisplayedAction);
}
const mapReady = (window.createCityMap ? window.createCityMap(mapCanvas, { onReplace: onMapReplaced }) : Promise.reject(new Error('map.js missing')))
  .then(map => {
    if (!mapWasReplaced) useMap(map);
    if (lastDisplayedAction) showResults(lastDisplayedAction);
    return cityMap;
  })
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

function showResults(action) {
  lastDisplayedAction = action;
  resultPanel.replaceChildren();
  cityMap?.clearMarkers();
  const title = document.createElement('h2'); title.textContent = action.title;
  const note = document.createElement('p'); note.className = 'results-note';
  note.textContent = action.complete === false ? 'Niepełne wyniki · część źródeł jest niedostępna' : 'Dane miejskie · sprawdź termin i czas aktualizacji';
  resultPanel.append(title, note);
  if (!action.results.length) { const empty = document.createElement('p'); empty.textContent = action.complete === false ? 'Nie można potwierdzić braku pasujących wyników.' : 'Brak pasujących wyników.'; resultPanel.append(empty); }
  const points = [], highlighted = new Set(action.highlightIds || []);
  for (const place of action.results) {
    const spatial = Number.isFinite(place.lat) && Number.isFinite(place.lng) && Math.abs(place.lat) <= 90 && Math.abs(place.lng) <= 180;
    const card = document.createElement('article'); card.className = 'place-card';
    const name = document.createElement('strong'); name.textContent = (highlighted.has(place.id) ? '★ Polecane: ' : '') + place.name;
    const detail = document.createElement('span'); detail.textContent = [place.district, place.description, place.address].filter(Boolean).join(' · ');
    card.append(name, detail);
    const timing = document.createElement('span');
    timing.textContent = [
      ...(place.dates || []).map(d => d.from === d.to ? d.from : d.from + ' – ' + d.to),
      ...(place.weekdays || []), place.time,
      ...Object.entries(place.schedule || {}).map(([day, hours]) => day + ': ' + hours),
      place.provenance?.observedAt?.length ? 'Pomiar: ' + place.provenance.observedAt.join(', ') + ' (Europe/Warsaw); aktualność niepotwierdzona' : '',
      place.provenance?.sourceUpdatedAt ? 'Aktualizacja źródła: ' + place.provenance.sourceUpdatedAt : '',
      place.provenance?.fetchedAt ? 'Pobrano: ' + place.provenance.fetchedAt : '',
    ].filter(Boolean).join(' · ');
    card.append(timing);
    if (place.measurements?.length) {
      const measurements = document.createElement('span'); measurements.textContent = place.measurements.map(m => m.parameter + ': ' + (m.value ?? 'brak pomiaru') + ' ' + m.unit).join(' · '); card.append(measurements);
    }
    const source = document.createElement('a'); source.textContent = place.source || 'Źródło miejskie'; source.href = place.url || place.sourceUrl; source.target = '_blank'; source.rel = 'noopener noreferrer'; card.append(source);
    resultPanel.append(card);
    if (cityMap && spatial) {
      const marker = cityMap.addMarker(place);
      const focus = document.createElement('button'); focus.type = 'button'; focus.textContent = 'Pokaż na mapie';
      focus.addEventListener('click', () => { if (!cityMap) return; setExpanded(false); cityMap.setView({ lat: place.lat, lng: place.lng }, 15); marker.open(); }); card.append(focus);
      points.push([place.lat, place.lng]);
    }
  }
  cityMap?.fitTo(points, { top: 70, left: 24, right: 24, bottom: cityMap.vendor === 'google' ? 24 : Math.min(drawer.offsetHeight + 80, mapCanvas.clientHeight * .6) });
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
async function* chatEvents(body) {
  const reader = body.getReader(), decoder = new TextDecoder(); let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer = (buffer + decoder.decode(value, { stream: !done })).replaceAll('\r\n', '\n');
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (data) yield JSON.parse(data);
      }
      if (buffer.length > 1000000) throw new Error('Odpowiedź jest zbyt długa.');
      if (done) break;
    }
  } finally { reader.releaseLock(); }
}
function applyAction(action) {
  if (action.type === 'display_results') showResults(action);
  if (action.type === 'focus_map' && cityMap) cityMap.setView({ lat: action.latitude, lng: action.longitude }, action.zoom);
}
async function send() {
  const value = input.value.trim();
  if (!value || pending) return;
  pending = true; submit.disabled = true; submit.setAttribute('aria-busy', 'true');
  addMessage(value, true); input.value = '';
  const progress = addMessage(''); progress.classList.add('stream-message');
  const status = document.createElement('span'); status.className = 'assistant-progress'; status.setAttribute('role', 'status');
  const activity = document.createElement('span'); activity.className = 'assistant-activity'; activity.setAttribute('aria-label', 'Wykonane kroki');
  const activities = [];
  const answer = document.createElement('span'); answer.className = 'assistant-answer';
  const stop = document.createElement('button'); stop.type = 'button'; stop.className = 'stop-response'; stop.textContent = 'Przerwij';
  progress.append(status, activity, answer, stop);
  let followResponse = true;
  const onScroll = () => { followResponse = content.scrollHeight - content.scrollTop - content.clientHeight < 80; };
  const keepVisible = () => { if (followResponse) content.scrollTop = content.scrollHeight; };
  content.addEventListener('scroll', onScroll, { passive: true });
  const controller = new AbortController(), startedAt = Date.now(); let stage = 'Łączę się z asystentem…', completed = false;
  stop.addEventListener('click', () => controller.abort());
  const renderStatus = () => { status.textContent = stage + ' · ' + Math.floor((Date.now() - startedAt) / 1000) + ' s'; };
  renderStatus(); const timer = setInterval(renderStatus, 1000), timeout = setTimeout(() => controller.abort('timeout'), 95000);
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ message: value, sessionId, stream: true }), signal: controller.signal });
    if (!response.ok) { const data = await response.json(); throw new Error(data.error || 'Nie udało się uzyskać odpowiedzi.'); }
    if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Serwer nie obsługuje transmisji odpowiedzi. Odśwież aplikację.');
    for await (const event of chatEvents(response.body)) {
      if (event.type === 'session') sessionId = event.sessionId;
      if (event.type === 'response_start') answer.textContent = '';
      if (event.type === 'progress') stage = event.label;
      if (event.type === 'activity') {
        activities.push(event.label); activity.textContent = activities.slice(-3).map(label => '✓ ' + label).join(' · ');
      }
      if (event.type === 'provider_progress') {
        if (event.stage === 'queued') stage = 'Czekam na wolne miejsce…';
        if (['session_started', 'session_reused', 'generating'].includes(event.stage)) stage = 'Przygotowuję odpowiedź…';
      }
      if (event.type === 'text') { stage = 'Asystent odpowiada…'; answer.textContent += event.delta; }
      if (event.type === 'action') applyAction(event.action);
      if (event.type === 'error') throw new Error(event.message);
      if (event.type === 'done') { sessionId = event.sessionId; answer.textContent = event.message; stage = 'Gotowe'; completed = true; }
      renderStatus(); keepVisible();
    }
    if (!completed) throw new Error('Połączenie zostało przerwane. Spróbuj ponownie.');
    keepVisible();
  } catch (error) {
    progress.classList.add('message-error');
    stage = controller.signal.aborted ? (controller.signal.reason === 'timeout' ? 'Odpowiedź trwa zbyt długo.' : 'Przerwano odpowiedź.') : error.message;
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Spróbuj ponownie';
    retry.addEventListener('click', () => { if (pending) return; input.value = value; progress.remove(); send(); });
    progress.append(retry); renderStatus();
  } finally { clearInterval(timer); clearTimeout(timeout); content.removeEventListener('scroll', onScroll); stop.remove(); pending = false; submit.disabled = false; submit.removeAttribute('aria-busy'); }
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
