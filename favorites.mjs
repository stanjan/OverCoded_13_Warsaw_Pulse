// Favourite places: a small model persisted in localStorage plus the top-right list panel.
// Storage is optional — a missing, full, blocked or corrupt store falls back to an in-memory list.
export const FAVORITES_KEY = 'warsaw-ai:favorites:v1';
export const MAX_FAVORITES = 200;

const text = (value, max = 300) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
const texts = (value, max = 20, length = 200) => Array.isArray(value) ? value.map(item => text(item, length)).filter(Boolean).slice(0, max) : undefined;
const clean = object => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && !(Array.isArray(value) && !value.length)));

export function favoriteId(value) {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 200);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

// Only the fields the cards, map bubbles and details read; nothing else from the result is stored.
export function favoriteSnapshot(place, now = Date.now()) {
  if (!place || typeof place !== 'object') return null;
  const id = favoriteId(place.id), name = text(place.name);
  if (!id || !name) return null;
  const spatial = Number.isFinite(place.lat) && Math.abs(place.lat) <= 90 && Number.isFinite(place.lng) && Math.abs(place.lng) <= 180;
  const dates = Array.isArray(place.dates) ? place.dates.filter(date => date && typeof date === 'object').slice(0, 10)
    .map(date => clean({ from: text(date.from, 40), to: text(date.to, 40), sourceFrom: text(date.sourceFrom, 40), sourceTo: text(date.sourceTo, 40) })).filter(date => date.from) : undefined;
  const saved = typeof place.savedAt === 'string' && Number.isFinite(Date.parse(place.savedAt)) ? place.savedAt : new Date(now).toISOString();
  return clean({
    id, name, category: text(place.category, 40), activities: texts(place.activities), audience: texts(place.audience),
    description: text(place.description, 1500), free: typeof place.free === 'boolean' ? place.free : undefined, dates,
    weekdays: texts(place.weekdays, 7, 40), time: text(place.time, 80), address: text(place.address), addresses: texts(place.addresses, 5),
    district: text(place.district, 80), lat: spatial ? place.lat : undefined, lng: spatial ? place.lng : undefined,
    imageUrl: text(place.imageUrl, 2000), url: text(place.url, 2000), sourceUrl: text(place.sourceUrl, 2000), savedAt: saved,
  });
}

export function parseFavorites(raw) {
  if (typeof raw !== 'string' || !raw) return [];
  let data;
  try { data = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(data)) return [];
  const seen = new Set(), items = [];
  for (const entry of data) {
    const snapshot = favoriteSnapshot(entry);
    if (!snapshot || seen.has(snapshot.id)) continue;
    seen.add(snapshot.id); items.push(snapshot);
    if (items.length >= MAX_FAVORITES) break;
  }
  return items;
}

export function createFavoritesStore({ storage, key = FAVORITES_KEY, now = () => Date.now() } = {}) {
  let items = [], persistent = Boolean(storage);
  const listeners = new Set();
  const read = () => {
    try { items = parseFavorites(storage?.getItem(key)); }
    catch { items = []; persistent = false; }
  };
  const write = () => {
    try { if (!storage) throw new Error('no storage'); storage.setItem(key, JSON.stringify(items)); persistent = true; }
    catch { persistent = false; }
  };
  const notify = () => { for (const listener of listeners) { try { listener(); } catch (error) { console.warn('[favorites]', error); } } };
  read();
  const store = {
    key,
    get persistent() { return persistent; },
    list: () => items.map(item => ({ ...item })),
    has: id => { const wanted = favoriteId(id); return Boolean(wanted) && items.some(item => item.id === wanted); },
    add(place) {
      const snapshot = favoriteSnapshot(place, now());
      if (!snapshot) return false;
      if (store.has(snapshot.id)) return true;
      items = [snapshot, ...items].slice(0, MAX_FAVORITES); write(); notify(); return true;
    },
    remove(id) {
      const wanted = favoriteId(id), before = items.length;
      items = items.filter(item => item.id !== wanted);
      if (items.length !== before) { write(); notify(); }
      return items.length !== before;
    },
    toggle(place) { return store.has(place?.id) ? !store.remove(place.id) : store.add(place); },
    // Another tab changed the list: read it again.
    reload() { read(); notify(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return store;
}

// The top-right button, its count badge, the list panel and the heart buttons on place cards.
export function mountFavorites({ doc, host, store }) {
  const el = (tag, className, content) => { const node = doc.createElement(tag); if (className) node.className = className; if (content != null) node.textContent = content; return node; };
  const icon = name => { const node = el('span', 'material-symbols-outlined', name); node.setAttribute('aria-hidden', 'true'); return node; };
  const shell = doc.querySelector('.app-shell') || doc.body;
  const trigger = el('button', 'favorites-trigger'); trigger.type = 'button'; trigger.id = 'favorites-button';
  trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-controls', 'favorites-panel');
  const badge = el('span', 'favorites-trigger__badge'); badge.setAttribute('aria-hidden', 'true'); badge.hidden = true;
  trigger.append(icon('favorite'), badge);
  const panel = el('section', 'favorites-panel'); panel.id = 'favorites-panel'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-labelledby', 'favorites-heading');
  const head = el('div', 'favorites-panel__head'), heading = el('h2', null, 'Ulubione'); heading.id = 'favorites-heading';
  const close = el('button', 'favorites-panel__close'); close.type = 'button'; close.setAttribute('aria-label', 'Zamknij ulubione'); close.title = 'Zamknij ulubione';
  close.append(icon('close')); head.append(heading, close);
  const note = el('p', 'favorites-panel__note', 'Nie udało się zapisać w pamięci przeglądarki — lista zniknie po zamknięciu strony.'); note.setAttribute('role', 'status'); note.hidden = true;
  const empty = el('p', 'favorites-panel__empty', 'Nie masz jeszcze ulubionych miejsc. Dodaj je sercem na karcie miejsca.');
  const list = el('ul', 'favorites-panel__list'); list.setAttribute('aria-label', 'Ulubione miejsca');
  panel.append(head, note, empty, list);
  shell.append(trigger, panel);

  // Weakly held: map popups build their heart before they are attached and reattach it on every open,
  // so detached buttons must keep syncing until they are garbage-collected.
  const cardButtons = new Set(), weak = typeof WeakRef === 'function';
  const motions = new WeakMap();
  const motion = (node, frames, options) => {
    motions.get(node)?.cancel();
    if (host.matchMedia?.('(prefers-reduced-motion: reduce)').matches || !node.animate) return null;
    const animation = node.animate(frames, options); motions.set(node, animation);
    animation.finished?.catch(() => {}); return animation;
  };
  const heartMotion = (button, saved) => motion(button.firstElementChild || button.children[0], saved ?
    [{ transform: 'scale(1)' }, { transform: 'scale(.78)', offset: .18 }, { transform: 'scale(1.3) rotate(-9deg)', offset: .5 }, { transform: 'scale(.95) rotate(3deg)', offset: .78 }, { transform: 'scale(1)' }] :
    [{ transform: 'scale(1)' }, { transform: 'scale(.8)', opacity: .5 }, { transform: 'scale(1)', opacity: 1 }], { duration: saved ? 480 : 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
  const trackButton = button => cardButtons.add(weak ? new WeakRef(button) : button);
  const syncButtons = () => { for (const ref of cardButtons) { const button = weak ? ref.deref() : ref; if (button) syncButton(button); else cardButtons.delete(ref); } };
  let removeButtons = new Map();
  const syncButton = button => {
    const on = store.has(button.dataset.favoriteId), label = on ? 'Usuń z ulubionych' : 'Dodaj do ulubionych';
    button.setAttribute('aria-pressed', String(on)); button.setAttribute('aria-label', label); button.title = label;
  };
  let opened = false, panelVersion = 0;
  const closePanel = (restoreFocus = true) => {
    if (!opened) return;
    opened = false; const version = ++panelVersion;
    panel.inert = true; panel.dataset.closing = 'true'; trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
    const finish = () => { if (version === panelVersion) { panel.hidden = true; panel.inert = false; delete panel.dataset.closing; } };
    const animation = motion(panel, [{ opacity: 1, transform: 'translateY(0) scale(1)' }, { opacity: 0, transform: 'translateY(-7px) scale(.97)' }], { duration: 160, easing: 'cubic-bezier(.4,0,1,1)', fill: 'both' });
    if (animation?.finished) animation.finished.then(finish, () => {}); else finish();
  };
  const action = (className, iconName, label, onClick, visibleText) => {
    const button = el('button', className); button.type = 'button'; button.append(icon(iconName));
    if (visibleText) button.append(el('span', null, label)); else { button.setAttribute('aria-label', label); button.title = label; }
    button.addEventListener('click', onClick); return button;
  };
  const entry = item => {
    const row = el('li', 'favorites-item'); row.dataset.favoriteId = item.id;
    row.append(el('strong', 'favorites-item__name', item.name));
    const where = [item.address || (item.addresses || []).join(', '), item.district].filter(Boolean).join(' · ');
    if (where) row.append(el('span', 'favorites-item__address', where));
    const actions = el('div', 'favorites-item__actions');
    if (Number.isFinite(item.lat) && Number.isFinite(item.lng)) {
      actions.append(action('favorites-item__transit', 'near_me', 'Wyznacz trasę', () => {
        closePanel(false);
        host.dispatchEvent(new (host.CustomEvent || CustomEvent)('city:transit', { detail: { destination: { latitude: item.lat, longitude: item.lng, label: item.name } } }));
      }, true));
      if (host.focusCityPlace && host.getCityMap?.()) actions.append(action('favorites-item__map', 'map', 'Pokaż na mapie', () => { closePanel(false); host.focusCityPlace(item); }));
    }
    const remove = action('favorites-item__remove', 'close', `Usuń z ulubionych: ${item.name}`, () => {
      const ids = [...removeButtons.keys()], index = ids.indexOf(item.id), next = ids[index + 1] || ids[index - 1];
      store.remove(item.id);
      // Keep keyboard focus inside the panel after the row disappears.
      (removeButtons.get(next) || close).focus();
    });
    removeButtons.set(item.id, remove); actions.append(remove);
    row.append(actions); return row;
  };
  const render = () => {
    const items = store.list(), count = items.length;
    const label = count ? `Ulubione (${count})` : 'Ulubione';
    trigger.setAttribute('aria-label', label); trigger.title = label; trigger.dataset.count = String(count);
    badge.textContent = count > 99 ? '99+' : String(count); badge.hidden = !count;
    note.hidden = store.persistent; empty.hidden = count > 0;
    removeButtons = new Map(); list.replaceChildren(...items.map(entry));
    syncButtons();
  };
  const open = () => {
    ++panelVersion; opened = true; render(); panel.hidden = false; panel.inert = false; delete panel.dataset.closing;
    trigger.setAttribute('aria-expanded', 'true'); close.focus();
    motion(panel, [{ opacity: 0, transform: 'translateY(-10px) scale(.95)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { duration: 280, easing: 'cubic-bezier(.16,1,.3,1)' });
    [...list.children].slice(0, 10).forEach((row, index) => motion(row, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 240, delay: 35 + index * 24, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }));
  };
  trigger.addEventListener('click', () => opened ? closePanel() : open());
  close.addEventListener('click', () => closePanel());
  const onKey = event => { if (event.key === 'Escape' && !panel.hidden) { event.stopPropagation(); closePanel(); } };
  panel.addEventListener('keydown', onKey); trigger.addEventListener('keydown', onKey);
  store.subscribe(render);
  host.addEventListener?.('storage', event => { if (event.key === null || event.key === store.key) store.reload(); });
  host.addEventListener?.('city:map', () => { if (!panel.hidden) render(); });

  // Sit just below the centred weather bar on phones; level with it when the shell leaves room beside it.
  const summary = doc.querySelector('#environment-bar summary');
  const place = () => {
    if (!summary?.getBoundingClientRect || !shell.getBoundingClientRect) return;
    const frame = shell.getBoundingClientRect(), bar = summary.getBoundingClientRect();
    if (!bar.height) return;
    const level = bar.right + 64 <= frame.right;
    const top = level ? bar.top - frame.top + Math.max(0, (bar.height - 44) / 2) : bar.bottom - frame.top + 8;
    shell.style?.setProperty?.('--favorites-top', `${Math.round(top)}px`);
  };
  if (summary && host.ResizeObserver) { const observer = new host.ResizeObserver(place); observer.observe(summary); observer.observe(shell); }
  host.addEventListener?.('resize', place);
  place(); render();

  return {
    open, close: closePanel, render, trigger, panel,
    // Heart toggle for a place card or map detail; null when the place cannot be saved (no id or name).
    button(place) {
      const id = favoriteId(place?.id);
      if (!id || !favoriteSnapshot(place)) return null;
      const button = el('button', 'rec-card__favorite'); button.type = 'button'; button.dataset.favoriteId = id;
      button.append(icon('favorite'));
      button.addEventListener('click', event => {
        event?.stopPropagation?.(); const wasSaved = store.has(id); store.toggle(place); const saved = store.has(id);
        if (saved !== wasSaved) { heartMotion(button, saved); if (saved) { heartMotion(trigger, true); motion(badge, [{ transform: 'scale(.65)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 360, easing: 'ease-out' }); } }
      });
      syncButton(button); trackButton(button);
      return button;
    },
  };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.cityFavorites) {
  let storage;
  try { storage = window.localStorage; } catch { storage = undefined; }
  window.cityFavorites = mountFavorites({ doc: document, host: window, store: createFavoritesStore({ storage }) });
}
