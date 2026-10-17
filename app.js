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
window.getCityMap = () => cityMap;
window.expandCitySheet = () => setExpanded(true);
let lastDisplayedAction;
let suppressHandleClick = false;

// Full-screen snap state (swipe the handle up from the expanded panel); it covers the weather bar.
let sheetFull = false;
function setSheetFull(value) {
  sheetFull = value;
  document.querySelector('#ai-sheet').classList.toggle('is-full', value);
  drawer.classList.toggle('is-full', value);
}
function setExpanded(value) {
  expanded = value;
  if (!value && sheetFull) setSheetFull(false);
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
// Drag the handle: the panel follows the finger, then snaps to collapsed, half or full screen.
// Pointer capture keeps the drag alive when the finger leaves the small handle area.
const handle = document.querySelector('#sheet-toggle');
let drag = null;
const sheetHeights = () => ({
  half: Math.min(innerHeight * (innerHeight <= 550 ? 0.4 : 0.48), 480),
  full: Math.max(0, innerHeight - 128),
});
handle.addEventListener('pointerdown', event => {
  if (event.target.closest('button')) return; // the chevron keeps its own click
  drag = { y: event.clientY, start: expanded ? content.getBoundingClientRect().height : 0, moved: false, id: event.pointerId };
  suppressHandleClick = false;
  handle.setPointerCapture?.(event.pointerId);
});
handle.addEventListener('pointermove', event => {
  if (!drag || event.pointerId !== drag.id) return;
  const dy = drag.y - event.clientY;
  if (!drag.moved && Math.abs(dy) < 6) return;
  if (!drag.moved) {
    drag.moved = true;
    document.querySelector('#ai-sheet').classList.add('is-dragging');
    content.inert = false;
  }
  const height = Math.min(Math.max(drag.start + dy, 0), sheetHeights().full);
  Object.assign(content.style, { maxHeight: height + 'px', minHeight: height + 'px', opacity: '1', transform: 'none' });
});
const endDrag = event => {
  if (!drag || event.pointerId !== drag.id) return;
  const { moved, y } = drag; drag = null;
  document.querySelector('#ai-sheet').classList.remove('is-dragging');
  if (!moved) return; // a tap: the click handler toggles the panel
  suppressHandleClick = true;
  const height = content.getBoundingClientRect().height;
  Object.assign(content.style, { maxHeight: '', minHeight: '', opacity: '', transform: '' });
  const { half, full } = sheetHeights();
  const goingUp = event.clientY < y;
  // Snap to the nearest height, nudged in the drag direction.
  const target = height + (goingUp ? 60 : -60);
  if (target > (half + full) / 2) { setExpanded(true); setSheetFull(true); }
  else if (target > half / 2) { setSheetFull(false); setExpanded(true); }
  else setExpanded(false);
};
handle.addEventListener('pointerup', endDrag);
handle.addEventListener('pointercancel', endDrag);

const mapCanvas = document.querySelector('#city-map');
const appShell = document.querySelector('.app-shell');
// Keep the map's usable area (markers, fitting, attribution) above the bottom sheet.
new ResizeObserver(() => {
  const obstruction = document.querySelector('#ai-sheet').offsetHeight + 4;
  appShell.style.setProperty('--map-obstruction', `${obstruction}px`);
}).observe(document.querySelector('#ai-sheet'));
let mapWasReplaced = false;
const mapContainer = document.querySelector('#map-canvas-container');
function showMapUnavailable() {
  mapContainer.classList.remove('map-ready', 'map-google', 'map-leaflet');
  document.querySelector('#map-loading-label').textContent = 'Mapa jest chwilowo niedostępna';
  mapContainer.classList.add('map-unavailable');
}
function useMap(map) {
  cityMap = map;
  mapContainer.classList.remove('map-google', 'map-leaflet');
  mapContainer.classList.add('map-ready', `map-${map.vendor}`);
  window.dispatchEvent?.(new CustomEvent('city:map', { detail: { vendor: map.vendor } }));
  return map;
}
// If Google rejects the key after loading, continue on OpenStreetMap with the same state.
function onMapReplaced(map) {
  mapWasReplaced = true;
  if (!map) { cityMap = undefined; window.dispatchEvent?.(new CustomEvent('city:map', { detail: { vendor: null } })); showMapUnavailable(); return; }
  useMap(map);
  if (lastPosition) map.showUser(lastPosition);
  if (lastDisplayedAction) showResults(lastDisplayedAction);
}
const mapReady = (window.createCityMap ? window.createCityMap(mapCanvas, { onReplace: onMapReplaced }) : Promise.reject(new Error('map.js missing')))
  .then(map => {
    if (!mapWasReplaced) useMap(map);
    // The location can arrive before the map: show it now that the map exists.
    if (lastPosition) { cityMap?.showUser(lastPosition); if (!lastDisplayedAction) centerOnUser(); }
    if (lastDisplayedAction) showResults(lastDisplayedAction);
    return cityMap;
  })
  .catch(error => { console.warn('[map]', error.message); showMapUnavailable(); });
const CENTER = window.CITY_CENTER || { lat: 52.2318, lng: 21.006, zoom: 12 };
// User location: first tap asks permission, then the blue dot follows the user.
const gpsButton = document.querySelector('#gps-button');
let watchId = null;
let lastPosition = null; // { lat, lng, accuracy }
let locationSnapshot = { status: 'unavailable', reason: 'not_requested' };
window.getCityLocation = () => ({ ...locationSnapshot });
function updateLocationSnapshot(snapshot) {
  locationSnapshot = snapshot;
  window.dispatchEvent(new CustomEvent('city:location', { detail: { ...snapshot } }));
}
function setGpsState(state) {
  gpsButton.dataset.state = state;
  const labels = { idle: 'Pokaż moją lokalizację', locating: 'Szukam lokalizacji…', active: 'Wyśrodkuj na mojej lokalizacji', denied: 'Lokalizacja niedostępna — wyśrodkuj mapę Warszawy' };
  gpsButton.setAttribute('aria-label', labels[state]);
  gpsButton.title = labels[state];
  if (state !== 'active') updateLocationSnapshot({ status: 'unavailable', reason: { idle: 'not_requested', locating: 'locating', denied: 'unavailable' }[state] || 'unavailable' });
}
setGpsState('idle');
function centerOnUser() {
  if (lastPosition) cityMap?.setView({ lat: lastPosition.lat, lng: lastPosition.lng }, 15);
}
// auto: started on page load (no panel change, no recentring or message on failure).
function startLocating({ auto = false } = {}) {
  if (!('geolocation' in navigator)) { setGpsState('denied'); if (!auto) cityMap?.setView(CENTER, CENTER.zoom); return; }
  if (watchId !== null) { if (lastPosition) centerOnUser(); return; } // still searching or tracking
  setGpsState('locating');
  let first = true;
  let retried = false;
  // Browsers can stay silent forever (e.g. a pending macOS location prompt): stop after 30 s.
  const stuckTimer = setTimeout(() => {
    if (!first) return;
    console.warn('[location] no answer from the browser after 30 s');
    giveUp({ code: 3, PERMISSION_DENIED: 1 });
  }, 30000);
  const onPosition = position => {
    clearTimeout(stuckTimer);
    const { latitude: lat, longitude: lng, accuracy } = position.coords;
    lastPosition = { lat, lng, accuracy };
    const observedAt = Number.isFinite(position.timestamp) && Math.abs(position.timestamp) <= 8640000000000000 ? new Date(position.timestamp).toISOString() : null;
    const { altitude, altitudeAccuracy, heading, speed } = position.coords;
    updateLocationSnapshot({ status: 'available', latitude: lat, longitude: lng, accuracy, observedAt, altitude, altitudeAccuracy, heading, speed });
    cityMap?.showUser(lastPosition);
    setGpsState('active');
    if (first) { first = false; centerOnUser(); }
  };
  const giveUp = error => {
    clearTimeout(stuckTimer);
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    setGpsState('denied');
    if (error.code === error.PERMISSION_DENIED) updateLocationSnapshot({ status: 'unavailable', reason: 'denied' });
    if (auto) return;
    cityMap?.setView(CENTER, CENTER.zoom);
    // No chat message on location failure or refusal: the red location button shows it.
  };
  // Laptops have no GPS: ask for a Wi-Fi based position (fast) instead of high accuracy.
  const options = { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 };
  watchId = navigator.geolocation.watchPosition(onPosition, error => {
    console.warn('[location]', error.code, error.message);
    if (error.code === error.PERMISSION_DENIED) return giveUp(error);
    // After a first fix, a timeout or lost signal is temporary: keep watching and keep the dot.
    if (!first) return;
    // Before the first fix, macOS/Chrome often report "position unavailable" once; retry once with any cached position.
    if (!retried) {
      retried = true;
      navigator.geolocation.getCurrentPosition(onPosition, retryError => {
        console.warn('[location] retry', retryError.code, retryError.message);
        if (first) giveUp(retryError);
      }, { enableHighAccuracy: false, timeout: 20000, maximumAge: Infinity });
    }
  }, options);
}
gpsButton.addEventListener('click', () => { setExpanded(false); startLocating(); });
// Ask for the user's location as soon as the app opens; the map centres on them once found.
startLocating({ auto: true });

function showResults(action) {
  lastDisplayedAction = action;
  resultPanel.replaceChildren();
  cityMap?.clearMarkers();
  const title = document.createElement('h2'); title.textContent = action.title;
  const note = document.createElement('p'); note.className = 'results-note';
  note.textContent = action.complete === false ? 'Niepełne wyniki · część źródeł jest niedostępna' : 'Dane miejskie · sprawdź termin i czas aktualizacji';
  if (action.results.some(place => !Number.isFinite(place.lat) || !Number.isFinite(place.lng) || Math.abs(place.lat) > 90 || Math.abs(place.lng) > 180)) note.textContent += ' · Wyniki bez punktu na mapie pozostają na liście; ich odległość jest nieznana.';
  if (action.audienceFilterMapping) note.textContent += ' · Filtr rodzinny uwzględnia oznaczenie „Dla dzieci”.';
  resultPanel.append(title, note);
  if (!action.results.length) { const empty = document.createElement('p'); empty.textContent = action.complete === false ? 'Nie można potwierdzić braku pasujących wyników.' : 'Brak pasujących wyników.'; resultPanel.append(empty); }
  const points = [], highlighted = new Set(action.highlightIds || []);
  // The conversation lists at most 3 recommended (★) results; every result with a point is still drawn on the map.
  // Without recommendations, the first 3 results are listed instead.
  const recommended = action.results.filter(place => highlighted.has(place.id));
  const listed = new Set((recommended.length ? recommended : action.results).slice(0, 3));
  for (const place of action.results) {
    const spatial = Number.isFinite(place.lat) && Number.isFinite(place.lng) && Math.abs(place.lat) <= 90 && Math.abs(place.lng) <= 180;
    // Cards show only the event title; details live in the map cloud. A title with a map point is a button that focuses it.
    const card = document.createElement('article'); card.className = 'place-card';
    const label = (highlighted.has(place.id) ? '★ Polecane: ' : '') + place.name;
    if (cityMap && spatial) {
      const marker = cityMap.addMarker(place, { recommended: highlighted.has(place.id), onOpen: () => setExpanded(false) });
      const focus = document.createElement('button'); focus.type = 'button'; focus.className = 'place-card__title'; focus.textContent = label;
      focus.addEventListener('click', () => { if (!cityMap) return; setExpanded(false); cityMap.setView({ lat: place.lat, lng: place.lng }, 16); marker.open(); });
      card.append(focus);
      if (listed.has(place)) resultPanel.append(card);
      points.push([place.lat, place.lng]);
    } else if (listed.has(place)) {
      const name = document.createElement('strong'); name.className = 'place-card__title'; name.textContent = label;
      card.append(name);
      resultPanel.append(card);
    }
    if (!spatial && listed.has(place) && (place.address || place.addresses?.length)) {
      const address = document.createElement('span'); address.className = 'place-card__address';
      address.textContent = [place.address || place.addresses.join(', '), place.district].filter(Boolean).join(' · ');
      card.append(address);
    }
    if (spatial) {
      const transit = document.createElement('button');transit.type='button';transit.textContent='Dojedź komunikacją';
      transit.addEventListener('click',()=>window.dispatchEvent(new CustomEvent('city:transit',{detail:{destination:{latitude:place.lat,longitude:place.lng,label:place.name}}})));
      card.append(transit);
    }
  }
  cityMap?.fitTo(points, { top: 70, left: 24, right: 24, bottom: cityMap.vendor === 'google' ? 24 : Math.min(drawer.offsetHeight + 80, mapCanvas.clientHeight * .6) });
}

const prompts = ['Zaproponuj spacer nad Wisłą.', 'Czy są teraz opóźnienia komunikacji ZTM?', 'Gdzie znajdę najbliższe Veturilo?'];
document.querySelectorAll('.prompt-chip').forEach((button, index) => button.addEventListener('click', () => {
  input.value = prompts[index]; input.focus();
}));

// Quick prompts row: on a laptop, let the mouse wheel and click-drag scroll it sideways
// (touch and trackpad swipes already scroll it natively).
const promptRow = document.querySelector('.prompt-chip')?.parentElement;
if (promptRow) {
  promptRow.addEventListener('wheel', event => {
    const canScroll = promptRow.scrollWidth > promptRow.clientWidth;
    if (!canScroll || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    promptRow.scrollLeft += event.deltaY;
  }, { passive: false });
  let drag = null;
  promptRow.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    drag = { x: event.clientX, left: promptRow.scrollLeft, moved: false };
  });
  window.addEventListener('pointermove', event => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    if (Math.abs(dx) > 5) drag.moved = true;
    if (drag.moved) promptRow.scrollLeft = drag.left - dx;
  });
  window.addEventListener('pointerup', () => {
    if (drag?.moved) promptRow.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); }, { capture: true, once: true });
    drag = null;
  });
}
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
function applyAction(action, anchor) {
  if (action.type === 'plan_transit') window.dispatchEvent(new CustomEvent('city:transit', { detail: { ...action, anchor } }));
  if (action.type === 'display_results') showResults(action);
  if (action.type === 'focus_map' && cityMap) cityMap.setView({ lat: action.latitude, lng: action.longitude }, action.zoom);
}
async function send() {
  const value = input.value.trim();
  if (!value || pending) return;
  pending = true; submit.disabled = true; submit.setAttribute('aria-busy', 'true');
  window.dispatchEvent(new CustomEvent('city:query'));
  resultPanel.replaceChildren(); lastDisplayedAction = null;
  cityMap?.clearMarkers?.();
  addMessage(value, true); input.value = '';
  const progress = addMessage(''); progress.classList.add('stream-message');
  // Thinking indicator: three pulsing dots plus the current stage with a soft shimmer.
  const status = document.createElement('span'); status.className = 'assistant-progress'; status.setAttribute('role', 'status');
  const dots = document.createElement('span'); dots.className = 'thinking-dots'; dots.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) dots.append(document.createElement('span'));
  const stageLabel = document.createElement('span'); stageLabel.className = 'thinking-label';
  status.append(dots, stageLabel);
  // Recommended results and source info appear under the answer once it is complete.
  resultPanel.hidden = true;
  const activity = document.createElement('span'); activity.className = 'assistant-activity'; activity.setAttribute('aria-label', 'Wykonane kroki');
  const activities = [];
  const transitActions = [];
  const answer = document.createElement('span'); answer.className = 'assistant-answer';
  progress.append(status, activity, answer);
  let followResponse = true;
  const onScroll = () => { followResponse = content.scrollHeight - content.scrollTop - content.clientHeight < 80; };
  const keepVisible = () => { if (followResponse) content.scrollTop = content.scrollHeight; };
  content.addEventListener('scroll', onScroll, { passive: true });
  const controller = new AbortController(), startedAt = Date.now(); let stage = 'Łączę się z asystentem…', completed = false;
  // While thinking only the dots show; the stage text is used for error messages.
  const renderStatus = () => { stageLabel.textContent = stage; status.setAttribute('aria-label', stage); };
  renderStatus(); const timer = setInterval(renderStatus, 1000), timeout = setTimeout(() => controller.abort('timeout'), 95000);
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ message: value, sessionId, stream: true, location: window.getCityLocation() }), signal: controller.signal });
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
      if (event.type === 'text') { stage = 'Asystent odpowiada…'; answer.textContent += event.delta; progress.classList.add('is-answering'); }
      if (event.type === 'action') {
        // A route belongs to this answer, and appears only once the answer is complete.
        if (event.action.type === 'plan_transit') transitActions.push(event.action);
        else applyAction(event.action);
      }
      if (event.type === 'error') throw new Error(event.message);
      if (event.type === 'done') { sessionId = event.sessionId; answer.textContent = event.message; stage = 'Gotowe'; completed = true; progress.classList.add('is-done'); }
      renderStatus(); keepVisible();
    }
    if (!completed) throw new Error('Połączenie zostało przerwane. Spróbuj ponownie.');
    for (const action of transitActions) applyAction(action, progress);
    keepVisible();
  } catch (error) {
    progress.classList.add('message-error');
    stage = controller.signal.aborted ? (controller.signal.reason === 'timeout' ? 'Odpowiedź trwa zbyt długo.' : 'Przerwano odpowiedź.') : error.message;
    const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Spróbuj ponownie';
    retry.addEventListener('click', () => { if (pending) return; input.value = value; progress.remove(); send(); });
    progress.append(retry); renderStatus();
  } finally { clearInterval(timer); clearTimeout(timeout); content.removeEventListener('scroll', onScroll); progress.classList.add('is-finished'); resultPanel.hidden = false; keepVisible(); pending = false; submit.disabled = false; submit.removeAttribute('aria-busy'); }
}
submit.addEventListener('click', event => { event.stopPropagation(); send(); });
input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); send(); } });
document.querySelector('#mic-btn').addEventListener('click', event => {
  event.stopPropagation(); addMessage('Wprowadzanie głosowe nie jest jeszcze dostępne. Wpisz pytanie w polu poniżej.'); input.focus();
});
document.querySelectorAll('nav a').forEach(link => link.addEventListener('click', event => {
  event.preventDefault();
  if (link.dataset.path === 'transit-live') { window.dispatchEvent(new CustomEvent('city:transit', { detail: {} })); return; }
  if (link.dataset.path === 'city-pulse') { window.dispatchEvent(new CustomEvent('city:pulse')); setExpanded(true); return; }
  addMessage(`Sekcja ${link.querySelector('span:last-child').textContent.trim()} będzie dostępna w kolejnej wersji aplikacji.`);
}));
