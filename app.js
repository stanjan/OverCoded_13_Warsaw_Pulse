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
let cityMap, markers;
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
if (window.L) {
  cityMap = L.map(mapCanvas, { zoomControl: false }).setView([52.2318, 21.006], 12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(cityMap);
  markers = L.layerGroup().addTo(cityMap);
  document.querySelector('#map-canvas-container').classList.add('map-ready');
  new ResizeObserver(() => cityMap.invalidateSize()).observe(mapCanvas);
  new ResizeObserver(() => {
    const obstruction = document.querySelector('#ai-sheet').offsetHeight + document.querySelector('nav').offsetHeight + 4;
    document.querySelector('.app-shell').style.setProperty('--map-obstruction', `${obstruction}px`);
  }).observe(document.querySelector('#ai-sheet'));
} else {
  document.querySelector('#map-canvas-container .pointer-events-none span:last-child').textContent = 'Mapa jest chwilowo niedostępna';
}
document.querySelector('#gps-button').addEventListener('click', () => { setExpanded(false); cityMap?.setView([52.2318, 21.006], 12); });

function showResults(action) {
  resultPanel.replaceChildren();
  markers?.clearLayers();
  const title = document.createElement('h2'); title.textContent = action.title;
  const note = document.createElement('p'); note.className = 'results-note'; note.textContent = 'Dane demonstracyjne · bez informacji na żywo';
  resultPanel.append(title, note);
  if (!action.results.length) { const empty = document.createElement('p'); empty.textContent = 'Brak pasujących miejsc.'; resultPanel.append(empty); }
  const points = [];
  for (const place of action.results) {
    const card = document.createElement('button'); card.type = 'button'; card.className = 'place-card';
    const name = document.createElement('strong'); name.textContent = place.name;
    const detail = document.createElement('span'); detail.textContent = `${place.district} · ${place.description}`;
    card.append(name, detail); resultPanel.append(card);
    if (cityMap) {
      const popup = document.createElement('div'); popup.textContent = place.name;
      const marker = L.circleMarker([place.lat, place.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#0051d5', fillOpacity: 1 }).bindPopup(popup).addTo(markers);
      card.addEventListener('click', () => { setExpanded(false); cityMap.setView([place.lat, place.lng], 15); marker.openPopup(); });
      points.push([place.lat, place.lng]);
    }
  }
  if (cityMap && points.length) cityMap.fitBounds(points, { paddingTopLeft: [24, 70], paddingBottomRight: [24, Math.min(drawer.offsetHeight + 80, mapCanvas.clientHeight * .6)], maxZoom: 15 });
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
      if (action.type === 'focus_map' && cityMap) cityMap.setView([action.latitude, action.longitude], action.zoom);
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
