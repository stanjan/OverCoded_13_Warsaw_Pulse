// A demo receiver is opt-in for this tab only. Remove capability fragments before other app work.
const demoReceiverLocation = new URLSearchParams(location.hash.slice(1)).has('demo-receiver') ? { hash: location.hash, pathname: location.pathname, search: location.search } : null;
if (demoReceiverLocation) history.replaceState(null, '', location.pathname + location.search);
const presentationDemo = window.parent !== window && new URLSearchParams(location.search).get('presentationDemo') === '1';
// ?safeTop= / ?safeBottom= (0–100) override safe-area insets, e.g. inside an iframe where env() is always 0.
{
  const params = new URLSearchParams(location.search);
  for (const [param, prop] of [['safeTop', '--safe-top'], ['safeBottom', '--safe-bottom']]) {
    const raw = params.get(param);
    if (raw === null || !/^\d+(\.\d+)?$/.test(raw)) continue;
    const value = Number(raw);
    if (value <= 100) document.documentElement.style.setProperty(prop, `${value}px`);
  }
}

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
window.collapseCitySheet = () => setExpanded(false);
let lastDisplayedAction;
let suppressHandleClick = false;

// Full-screen snap state (drag the handle up from the expanded panel); it covers the weather bar.
let sheetFull = false;
let resumeSheetFull = false;
function setSheetFull(value) {
  sheetFull = value;
  document.querySelector('#ai-sheet').classList.toggle('is-full', value);
  drawer.classList.toggle('is-full', value);
}
function setExpanded(value) {
  if (!value && expanded) {
    resumeSheetFull = sheetFull;
    setSheetFull(false);
  } else if (value && !expanded) {
    setSheetFull(resumeSheetFull);
  }
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
// Drag the handle: the panel follows the finger, then snaps to collapsed, half or full screen.
// Pointer capture keeps the drag alive when the finger leaves the small handle area.
const handle = document.querySelector('#sheet-toggle');
let drag = null;
const sheetHeights = () => ({ half: Math.min(innerHeight * (innerHeight <= 550 ? 0.4 : 0.48), 480), full: Math.max(0, innerHeight - 128) });
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
  if (!drag.moved) { drag.moved = true; document.querySelector('#ai-sheet').classList.add('is-dragging'); content.inert = false; }
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
  const target = height + (event.clientY < y ? 60 : -60); // nudged in the drag direction
  if (target > (half + full) / 2) { setExpanded(true); setSheetFull(true); }
  else if (target > half / 2) { setExpanded(true); setSheetFull(false); }
  else setExpanded(false);
};
handle.addEventListener('pointerup', endDrag);
handle.addEventListener('pointercancel', endDrag);

// Event details opened from a map cloud: shown inside the conversation panel, which grows to full height.
// The card "expands" out of the cloud (FLIP: it starts at the cloud's rectangle and grows into place).
window.openEventInConversation = (details, { title, fromRect } = {}) => {
  const sheet = document.querySelector('#ai-sheet');
  closeEventInConversation(false);
  const view = document.createElement('section'); view.className = 'conversation-event'; view.setAttribute('aria-label', title || 'Wydarzenie');
  const back = document.createElement('button'); back.type = 'button'; back.className = 'conversation-event__back';
  const backIcon = document.createElement('span'); backIcon.className = 'material-symbols-outlined'; backIcon.setAttribute('aria-hidden', 'true'); backIcon.textContent = 'keyboard_arrow_down';
  const backText = document.createElement('span'); backText.textContent = 'Wróć do rozmowy';
  back.append(backIcon, backText);
  back.addEventListener('click', () => closeEventInConversation(true));
  view.append(back, details);
  eventReturn = { wasFull: expanded ? sheetFull : resumeSheetFull, scrollTop: content.scrollTop };
  setExpanded(true);
  setSheetFull(true);
  sheet.classList.add('is-event-open');
  drawer.classList.add('is-event-open');
  content.prepend(view);
  content.scrollTop = 0;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (fromRect && view.animate && !reduce) {
    const to = view.getBoundingClientRect();
    const dx = fromRect.left - to.left, dy = fromRect.top - to.top;
    const sx = fromRect.width / to.width, sy = Math.max(fromRect.height / Math.max(to.height, 1), 0.05);
    view.animate([
      { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, borderRadius: '18px', opacity: 0.6 },
      { transformOrigin: '0 0', transform: 'none', borderRadius: '0px', opacity: 1 },
    ], { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
    details.animate([{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }], { duration: 380, easing: 'ease-out' });
  }
  back.focus({ preventScroll: true });
};
let eventReturn = null;
function closeEventInConversation(restore) {
  const view = content.querySelector('.conversation-event');
  if (!view) return;
  const back = eventReturn; eventReturn = null;
  const transition = content.style.transition || '';
  content.style.transition = 'none';
  // Restore state synchronously. A late animation callback must never reopen a
  // collapsed panel or overwrite the height of a new drag, query or event.
  view.remove();
  document.querySelector('#ai-sheet').classList.remove('is-event-open');
  drawer.classList.remove('is-event-open');
  if (restore) setExpanded(true); // "Wróć do rozmowy" always opens the conversation.
  setSheetFull(Boolean(back?.wasFull) && expanded);
  resumeSheetFull = Boolean(back?.wasFull);
  // Settle full -> half geometry before restoring scroll: a still-tall scroll
  // viewport would clamp a saved position near the bottom of the conversation.
  content.getBoundingClientRect();
  if (back) content.scrollTop = back.scrollTop;
  content.style.transition = transition;
  if (restore && content.animate && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    content.animate([
      { opacity: 0.6, transform: 'translateY(12px)' },
      { opacity: 1, transform: 'none' },
    ], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }
}

document.addEventListener('keydown', event => { if (event.key === 'Escape') closeEventInConversation(true); });
window.addEventListener('city:transit', () => closeEventInConversation(false));
window.addEventListener('city:query', () => closeEventInConversation(false));

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
// Marker handles by place id, so the favourites list reuses a result's marker instead of stacking a second one.
// The adapter is wrapped once; every clearMarkers() drops the handles with the markers.
const placeMarkers = new Map();
function trackPlaceMarkers(map) {
  if (map.tracksPlaces || typeof map.addMarker !== 'function' || typeof map.clearMarkers !== 'function') return;
  const add = map.addMarker.bind(map), clear = map.clearMarkers.bind(map);
  map.addMarker = (place, options) => { const marker = add(place, options); if (marker) placeMarkers.set(String(place.id), marker); return marker; };
  map.clearMarkers = () => { placeMarkers.clear(); return clear(); };
  map.tracksPlaces = true;
}
window.focusCityPlace = place => {
  if (!cityMap || !Number.isFinite(place?.lat) || !Number.isFinite(place?.lng)) return false;
  if (place.category === 'route') {
    // A saved route starts a new map context: stop live transit sessions and
    // their board/vehicle camera before fitting the tourist trail.
    window.dispatchEvent?.(new CustomEvent('city:query'));
    cityMap.clearRoute?.();
    // Replay through the normal tourist layer, so pins, details, provider
    // replacement and final full-trail camera fitting share the same state.
    showResults({ type: 'display_results', results: [place], highlightIds: [], selectedTouristId: place.id, complete: true });
    setExpanded(false); placeMarkers.get(String(place.id))?.open();
    cityMap.showTouristRoutes?.([place], { selectedId: place.id });
    return true;
  }
  const marker = placeMarkers.get(String(place.id)) || cityMap.addMarker(place, { onOpen: () => setExpanded(false) });
  setExpanded(false); cityMap.setView({ lat: place.lat, lng: place.lng }, 16); marker?.open();
  return true;
};
function useMap(map) {
  // Keep handles when re-using the current map (replacement replays results before this call).
  if (cityMap !== map) placeMarkers.clear();
  cityMap = map; trackPlaceMarkers(map);
  mapContainer.classList.remove('map-google', 'map-leaflet');
  mapContainer.classList.add('map-ready', `map-${map.vendor}`);
  window.dispatchEvent?.(new CustomEvent('city:map', { detail: { vendor: map.vendor } }));
  return map;
}
// If Google rejects the key after loading, continue on OpenStreetMap with the same state.
function onMapReplaced(map) {
  mapWasReplaced = true;
  if (!map) { cityMap = undefined; placeMarkers.clear(); window.dispatchEvent?.(new CustomEvent('city:map', { detail: { vendor: null } })); showMapUnavailable(); return; }
  placeMarkers.clear(); cityMap = map; trackPlaceMarkers(map);
  if (lastPosition) map.showUser(lastPosition);
  if (lastDisplayedAction) showResults(lastDisplayedAction);
  // Replay an active journey after result layers, so its framing owns the map.
  useMap(map);
}
const mapReady = (window.createCityMap ? window.createCityMap(mapCanvas, { onReplace: onMapReplaced }) : Promise.reject(new Error('map.js missing')))
  .then(map => {
    if (mapWasReplaced) return cityMap; // Replacement already restored state.
    cityMap = map;
    // The location can arrive before the map: show it now that the map exists.
    if (lastPosition) { cityMap?.showUser(lastPosition); if (!lastDisplayedAction) centerOnUser(); }
    if (lastDisplayedAction) showResults(lastDisplayedAction);
    useMap(map);
    return cityMap;
  })
  .catch(error => { console.warn('[map]', error.message); showMapUnavailable(); });
const CENTER = window.CITY_CENTER || { lat: 52.2318, lng: 21.006, zoom: 12 };
const gpsButton = document.querySelector('#gps-button');
const LOCATION_MAX_AGE = 60000, LOCATION_REFRESH_TIMEOUT = 5000;
let watchId = null, locationGeneration = 0, firstFixTimer = null;
let lastPosition = null, permissionDenied = false, permissionGranted = false;
let locationRequest = null;
let locationSnapshot = { status: 'unavailable', reason: 'not_requested' };
window.getCityLocation = () => ({ ...locationSnapshot });
function updateLocationSnapshot(snapshot) {
  locationSnapshot = snapshot;
  window.dispatchEvent(new CustomEvent('city:location', { detail: { ...snapshot } }));
}
function hasKnownLocation() {
  return locationSnapshot.status === 'available' && Number.isFinite(locationSnapshot.latitude) && Math.abs(locationSnapshot.latitude) <= 90 && Number.isFinite(locationSnapshot.longitude) && Math.abs(locationSnapshot.longitude) <= 180;
}
function hasRecentLocation() {
  const measured = Date.parse(locationSnapshot.observedAt);
  const age = Date.now() - measured;
  return locationSnapshot.status === 'available' && Number.isFinite(age) && age >= -60000 && age <= LOCATION_MAX_AGE;
}
function setGpsState(state) {
  gpsButton.dataset.state = state;
  const labels = { idle: 'Pokaż moją lokalizację', locating: 'Odświeżam lokalizację…', active: 'Wyśrodkuj na mojej lokalizacji', stale: 'Odśwież moją lokalizację', denied: 'Lokalizacja niedostępna — spróbuj ponownie' };
  gpsButton.setAttribute('aria-label', labels[state]);
  gpsButton.title = labels[state];
}
setGpsState('idle');
function centerOnUser() {
  if (lastPosition) cityMap?.setView({ lat: lastPosition.lat, lng: lastPosition.lng }, 15);
}
function finishLocationRequest() {
  if (!locationRequest) return;
  const request = locationRequest;
  locationRequest = null;
  clearTimeout(request.timer);
  request.resolve(window.getCityLocation());
}
function denyLocation() {
  permissionDenied = true; permissionGranted = false; locationGeneration++;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null; lastPosition = null;
  clearTimeout(firstFixTimer);
  updateLocationSnapshot({ status: 'unavailable', reason: 'denied' });
  setGpsState('denied'); finishLocationRequest();
}
function acceptPosition(position, generation) {
  if (generation !== locationGeneration || permissionDenied) return false;
  const { latitude: lat, longitude: lng, accuracy, altitude, altitudeAccuracy, heading, speed } = position.coords || {};
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180 || !Number.isFinite(accuracy) || accuracy < 0) return false;
  const measured = position.timestamp, previous = Date.parse(locationSnapshot.observedAt);
  // Keep the actual measurement time; an old callback must never move a newer fix backwards.
  if (Number.isFinite(previous) && (!Number.isFinite(measured) || measured < previous)) return false;
  const observedAt = Number.isFinite(measured) && Math.abs(measured) <= 8640000000000000 && measured <= Date.now() + 60000 ? new Date(measured).toISOString() : null;
  const first = !lastPosition;
  lastPosition = { lat, lng, accuracy }; permissionGranted = true;
  updateLocationSnapshot({ status: 'available', latitude: lat, longitude: lng, accuracy, observedAt, altitude, altitudeAccuracy, heading, speed });
  cityMap?.showUser(lastPosition);
  setGpsState(hasRecentLocation() ? 'active' : 'stale');
  if (hasRecentLocation()) { clearTimeout(firstFixTimer); finishLocationRequest(); }
  if (first) centerOnUser();
  return true;
}
// A stationary/backgrounded browser can stop watch callbacks. Refresh the measurement,
// share concurrent callers, and bound the wait even if the browser never calls back.
function refreshLocation({ force = false } = {}) {
  if (presentationDemo && !permissionGranted && !force) return Promise.resolve(window.getCityLocation());
  if (permissionDenied || !navigator.geolocation) return Promise.resolve(window.getCityLocation());
  if (locationRequest) return locationRequest.promise;
  if (!force && hasRecentLocation()) return Promise.resolve(window.getCityLocation());
  const generation = locationGeneration;
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  const request = { promise, resolve, generation, timer: null };
  locationRequest = request;
  setGpsState('locating');
  const fail = error => {
    if (locationRequest !== request || generation !== locationGeneration) return;
    if (error?.code === 1) { denyLocation(); return; }
    if (!hasKnownLocation()) updateLocationSnapshot({ status: 'unavailable', reason: 'unavailable' });
    setGpsState(hasRecentLocation() ? 'active' : 'stale');
    finishLocationRequest();
  };
  request.timer = setTimeout(() => fail(), LOCATION_REFRESH_TIMEOUT);
  try {
    navigator.geolocation.getCurrentPosition(position => {
      if (locationRequest !== request || generation !== locationGeneration) return;
      acceptPosition(position, generation);
      if (locationRequest === request) fail();
    }, fail, { enableHighAccuracy: false, timeout: LOCATION_REFRESH_TIMEOUT - 250, maximumAge: 0 });
  } catch { fail(); }
  return promise;
}
window.refreshCityLocation = refreshLocation;
function startLocating({ auto = false } = {}) {
  if (auto && presentationDemo && !permissionGranted) return;
  if (!navigator.geolocation) { updateLocationSnapshot({ status: 'unavailable', reason: 'unavailable' }); setGpsState('denied'); return; }
  if (auto && permissionDenied) return;
  if (!auto) permissionDenied = false;
  if (watchId !== null) { refreshLocation({ force: !auto }).then(() => { if (!auto && hasRecentLocation()) centerOnUser(); }); return; }
  const generation = ++locationGeneration;
  setGpsState('locating'); updateLocationSnapshot({ status: 'unavailable', reason: 'locating' });
  firstFixTimer = setTimeout(() => {
    if (generation !== locationGeneration || hasKnownLocation()) return;
    updateLocationSnapshot({ status: 'unavailable', reason: 'unavailable' }); setGpsState('stale');
  }, 30000);
  watchId = navigator.geolocation.watchPosition(position => acceptPosition(position, generation), error => {
    if (generation !== locationGeneration) return;
    if (error.code === 1) { denyLocation(); return; }
    if (!hasRecentLocation()) refreshLocation();
  }, { enableHighAccuracy: false, timeout: 20000, maximumAge: LOCATION_MAX_AGE });
}
// In-panel actions request GPS without collapsing the conversation.
window.requestCityLocation = () => { startLocating(); return refreshLocation(); };
gpsButton.addEventListener('click', () => { setExpanded(false); startLocating(); });
function refreshVisibleLocation() {
  if (document.visibilityState === 'hidden' || permissionDenied || !permissionGranted) return;
  if (!hasRecentLocation()) setGpsState('stale');
  refreshLocation();
}
window.addEventListener('focus', refreshVisibleLocation);
document.addEventListener('visibilitychange', refreshVisibleLocation);
setInterval(refreshVisibleLocation, 30000);
// Permission revocation invalidates queued callbacks as well as the current context.
if (navigator.permissions?.query) navigator.permissions.query({ name: 'geolocation' }).then(permission => {
  const changed = () => {
    if (permission.state === 'denied') denyLocation();
    if (permission.state === 'granted') { permissionDenied = false; permissionGranted = true; startLocating({ auto: true }); refreshVisibleLocation(); }
  };
  permission.addEventListener('change', changed); changed();
}).catch(() => {});
startLocating({ auto: true });

function showResults(action) {
  const revealCards = action !== lastDisplayedAction;
  lastDisplayedAction = action;
  resultPanel.replaceChildren();
  cityMap?.clearMarkers();
  if (!action.results.length) { const empty = document.createElement('p'); empty.textContent = action.complete === false ? 'Nie można potwierdzić braku pasujących wyników.' : 'Brak pasujących wyników.'; resultPanel.append(empty); }
  const points = [], highlighted = new Set(action.highlightIds || []);
  // The conversation lists at most 3 recommended (★) results; every result with a point is still drawn on the map.
  // Without recommendations, the first 3 results are listed instead.
  const recommended = action.results.filter(place => highlighted.has(place.id));
  const listed = new Set((recommended.length ? recommended : action.results).slice(0, 3));
  for (const place of action.results) {
    const spatial = Number.isFinite(place.lat) && Number.isFinite(place.lng) && Math.abs(place.lat) <= 90 && Math.abs(place.lng) <= 180;
    const isRecommended = highlighted.has(place.id);
    const marker = cityMap && spatial ? cityMap.addMarker(place, { recommended: isRecommended, onOpen: () => { action.selectedTouristId = place.category === 'route' ? place.id : undefined; setExpanded(false); } }) : null;
    if (spatial) points.push([place.lat, place.lng]);
    if (!listed.has(place)) continue;
    // Recommended card (Stitch prototype, our warm style): tag + when/price, title, address, photo, actions.
    const info = globalThis.cityCardInfo?.(place) || {};
    const card = document.createElement('article'); card.className = 'place-card rec-card' + (info.theme ? ' rec-card--' + info.theme : '') + (revealCards ? ' rec-card--reveal' : '');
    const focusMap = () => { if (!cityMap || !marker) return; setExpanded(false); if(place.category !== 'route')cityMap.setView({ lat: place.lat, lng: place.lng }, 16); marker.open(); };
    const title = document.createElement(marker ? 'button' : 'strong'); title.className = 'place-card__title rec-card__title'; title.textContent = place.name;
    if (marker) { title.type = 'button'; title.addEventListener('click', focusMap); }
    const meta = document.createElement('div'); meta.className = 'rec-card__meta';
    const tag = document.createElement('span'); tag.className = 'rec-card__tag'; tag.textContent = (isRecommended ? '★ ' : '') + (info.themeLabel || 'Polecane');
    const when = document.createElement('span'); when.className = 'rec-card__when'; when.textContent = [info.when, info.price].filter(Boolean).join(' · ');
    meta.append(tag, when);
    card.append(title, meta);
    if (place.category === 'route') {
      const note=document.createElement('span');note.className='tourist-card-note';
      note.textContent=[Number.isFinite(place.lengthKm)?place.lengthKm+' km':'',place.geometryStatus==='saved_unavailable'?'Przebieg nie został zapisany lokalnie':place.geometryStatus==='partial'?'Ślad ma przerwy':place.geometryStatus!=='published'?'Brak pełnego śladu na mapie':''].filter(Boolean).join(' · ');
      if(note.textContent)card.append(note);
    }
    const where = [place.address || (place.addresses || []).join(', '), place.district].filter(Boolean).join(' · ');
    if (where) { const address = document.createElement('span'); address.className = 'place-card__address'; address.textContent = where; card.append(address); }
    const thumb = document.createElement('div'); thumb.className = 'rec-card__thumb';
    if (info.imageUrl) { const img = document.createElement('img'); img.src = info.imageUrl; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.addEventListener('error', () => img.remove()); thumb.append(img); }
    const glyph = document.createElement('span'); glyph.className = 'material-symbols-outlined rec-card__glyph'; glyph.textContent = info.icon || 'local_activity';
    thumb.append(glyph); card.append(thumb);
    const favorite = globalThis.cityFavorites?.button(place);
    if (spatial) {
      const actions = document.createElement('div'); actions.className = 'rec-card__actions';
      const transit = document.createElement('button'); transit.type = 'button'; transit.className = 'rec-card__transit';
      const transitIcon = document.createElement('span'); transitIcon.className = 'material-symbols-outlined'; transitIcon.textContent = 'near_me';
      const transitText = document.createElement('span'); transitText.textContent = 'Wyznacz trasę';
      transit.append(transitIcon, transitText);
      transit.addEventListener('click', () => window.dispatchEvent(new CustomEvent('city:transit', { detail: { destination: { latitude: place.lat, longitude: place.lng, label: place.name } } })));
      actions.append(transit);
      if (marker) {
        const show = document.createElement('button'); show.type = 'button'; show.className = 'rec-card__map'; show.setAttribute?.('aria-label', 'Pokaż na mapie');
        const showIcon = document.createElement('span'); showIcon.className = 'material-symbols-outlined'; showIcon.textContent = 'map';
        show.append(showIcon); show.addEventListener('click', focusMap); actions.append(show);
      }
      if (favorite) actions.append(favorite);
      card.append(actions);
    } else if (favorite) {
      const actions = document.createElement('div'); actions.className = 'rec-card__actions';
      actions.append(favorite); card.append(actions);
    }
    resultPanel.append(card);
  }
  cityMap?.fitTo(points, { top: 70, left: 24, right: 24, bottom: cityMap.vendor === 'google' ? 24 : Math.min(drawer.offsetHeight + 80, mapCanvas.clientHeight * .6) });
  cityMap?.showTouristRoutes?.(action.results, {selectedId:action.selectedTouristId,recommendedId:action.results.find(place=>place.category==='route'&&highlighted.has(place.id))?.id});
}

const prompts = [...document.querySelectorAll('.prompt-chip')];
// Each quick prompt card carries its own question (data-prompt), matched to data the assistant can really search.
prompts.forEach(button => button.addEventListener('click', () => {
  if (pending) return;
  input.value = button.dataset.prompt || '';
  send();
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
  // Results of this answer are placed right after it in the conversation (in finally), so anything
  // that follows (e.g. transit options opened from a card) comes below the recommended cards.
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
    // A known point is enough to answer; refresh it in the background without
    // holding up the message or discarding it after a temporary provider error.
    const refreshing = refreshLocation();
    if (!hasKnownLocation()) await refreshing;
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
  } finally { clearInterval(timer); clearTimeout(timeout); content.removeEventListener('scroll', onScroll); progress.classList.add('is-finished'); if (resultPanel.childElementCount) progress.after?.(resultPanel); resultPanel.hidden = false; keepVisible(); pending = false; submit.disabled = false; submit.removeAttribute('aria-busy'); }
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

import('/demo-receiver.mjs').then(({ installDemoReceiver }) => installDemoReceiver({
  input, location: demoReceiverLocation || window.location, isReady: () => !pending && !input.value.trim(),
  start: prompt => {
    if (pending || input.value.trim()) return null;
    input.value = prompt;
    setExpanded(true);
    return { completion: send() };
  },
})).catch(() => {});

if (presentationDemo) import('/presentation-receiver.mjs').then(({ installPresentationReceiver }) => installPresentationReceiver({
  input, isReady: () => !pending && !input.value.trim(),
  start: prompt => {
    if (pending || input.value.trim()) return null;
    input.value = prompt;
    setExpanded(true);
    return { completion: send() };
  },
})).catch(error => console.error('Nie udało się połączyć prezentacji.', error));
