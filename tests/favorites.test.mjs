import test from 'node:test';
import assert from 'node:assert/strict';
import { FAVORITES_KEY, MAX_FAVORITES, createFavoritesStore, favoriteSnapshot, parseFavorites, mountFavorites } from '../favorites.mjs';

const memoryStorage = (initial = {}) => {
  const data = { ...initial }, writes = [];
  return { data, writes, getItem: key => key in data ? data[key] : null, setItem(key, value) { data[key] = String(value); writes.push(key); } };
};
const place = (id, extra = {}) => ({ id, name: `Miejsce ${id}`, category: 'event', lat: 52.23, lng: 21.01, address: 'ul. Marszałkowska 1', district: 'Śródmieście', ...extra });

test('add, has, remove and toggle persist one snapshot per id under the versioned key', () => {
  const storage = memoryStorage(), store = createFavoritesStore({ storage, now: () => Date.parse('2026-10-18T10:00:00Z') });
  let notified = 0; store.subscribe(() => notified++);
  assert.equal(store.add(place('a')), true);
  assert.equal(store.add(place('a', { name: 'Inna nazwa' })), true);
  assert.equal(store.list().length, 1); assert.equal(notified, 1);
  assert.equal(store.has('a'), true); assert.equal(store.persistent, true);
  const saved = JSON.parse(storage.data[FAVORITES_KEY]);
  assert.deepEqual(saved, [{ id: 'a', name: 'Miejsce a', category: 'event', address: 'ul. Marszałkowska 1', district: 'Śródmieście', lat: 52.23, lng: 21.01, savedAt: '2026-10-18T10:00:00.000Z' }]);
  assert.equal(store.toggle(place('b')), true); assert.deepEqual(store.list().map(item => item.id), ['b', 'a']);
  assert.equal(store.toggle(place('b')), false); assert.equal(store.has('b'), false);
  assert.equal(store.remove('missing'), false); assert.equal(store.remove('a'), true);
  assert.deepEqual(JSON.parse(storage.data[FAVORITES_KEY]), []);
  assert.equal(store.add({ id: 'x' }), false); assert.equal(store.add(null), false);
  // Numeric ids are normalised so cards and stored entries match.
  store.add(place(7)); assert.equal(store.has(7), true); assert.equal(store.has('7'), true);
});

test('snapshot keeps only bounded card and map fields', () => {
  const snapshot = favoriteSnapshot({
    ...place('e1'), description: 'x'.repeat(5000), free: true, secret: 'nie zapisuj', provenance: { observedAt: ['t'] },
    activities: ['koncert', 5, ''], audience: ['rodziny'], dates: [{ from: '2026-10-18', to: '2026-10-18', sourceFrom: '2026-10-18T18:00:00+02', extra: 1 }, 'zła data', {}],
    weekdays: ['pon'], time: '18:00', addresses: ['A', 'B'], imageUrl: 'https://example.test/a.jpg', url: 'https://example.test', lat: 200,
  }, Date.parse('2026-01-01T00:00:00Z'));
  assert.equal(snapshot.description.length, 1500);
  assert.equal(snapshot.secret, undefined); assert.equal(snapshot.provenance, undefined);
  assert.deepEqual(snapshot.activities, ['koncert']);
  assert.deepEqual(snapshot.dates, [{ from: '2026-10-18', to: '2026-10-18', sourceFrom: '2026-10-18T18:00:00+02' }]);
  assert.equal(snapshot.lat, undefined); assert.equal(snapshot.lng, undefined, 'invalid coordinates drop both');
  assert.equal(snapshot.free, true); assert.equal(snapshot.savedAt, '2026-01-01T00:00:00.000Z');
});

test('corrupt, non-array and invalid stored data fall back without throwing', () => {
  for (const raw of ['{not json', '{"a":1}', 'null', '42', '']) {
    const store = createFavoritesStore({ storage: memoryStorage({ [FAVORITES_KEY]: raw }) });
    assert.deepEqual(store.list(), [], raw);
    assert.equal(store.add(place('a')), true);
  }
  const items = parseFavorites(JSON.stringify([place('a'), place('a'), { name: 'bez id' }, 'tekst', null, place('b', { savedAt: '2026-05-01T00:00:00.000Z' })]));
  assert.deepEqual(items.map(item => item.id), ['a', 'b']); assert.equal(items[1].savedAt, '2026-05-01T00:00:00.000Z');
  const many = parseFavorites(JSON.stringify(Array.from({ length: MAX_FAVORITES + 20 }, (_, i) => place('p' + i))));
  assert.equal(many.length, MAX_FAVORITES);
});

test('throwing or missing storage keeps an in-memory list and reports it is not persistent', () => {
  const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } };
  const store = createFavoritesStore({ storage: throwing });
  assert.equal(store.persistent, false); assert.equal(store.add(place('a')), true); assert.equal(store.has('a'), true); assert.equal(store.persistent, false);
  const full = createFavoritesStore({ storage: { getItem: () => null, setItem() { throw new Error('QuotaExceeded'); } } });
  assert.equal(full.persistent, true); full.add(place('a')); assert.equal(full.persistent, false); assert.equal(full.list().length, 1);
  const none = createFavoritesStore(); assert.equal(none.persistent, false); none.toggle(place('a')); assert.equal(none.has('a'), true);
});

test('reload picks up changes written by another tab', () => {
  const storage = memoryStorage(), store = createFavoritesStore({ storage });
  let notified = 0; store.subscribe(() => notified++);
  storage.data[FAVORITES_KEY] = JSON.stringify([place('z')]);
  store.reload(); assert.equal(store.has('z'), true); assert.equal(notified, 1);
});

function element(tag = 'div') {
  const node = { tag, children: [], listeners: {}, attributes: {}, dataset: {}, style: { setProperty(k, v) { this[k] = v; } }, hidden: false, textContent: '', isConnected: true,
    append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; },
    setAttribute(k, v) { this.attributes[k] = String(v); }, getAttribute(k) { return this.attributes[k] ?? null; },
    addEventListener(k, v) { this.listeners[k] = v; }, focus() { focused = this; }, click() { return this.listeners.click?.({ stopPropagation() {} }); },
    find(predicate) { for (const child of this.children) { if (predicate(child)) return child; const found = child.find?.(predicate); if (found) return found; } return null; } };
  Object.defineProperty(node, 'innerHTML', { set() { throw new Error('use text nodes'); } });
  return node;
}
let focused = null;
function fixture(storage = memoryStorage()) {
  const shell = element(), events = {}, dispatched = [], focusedPlaces = [];
  const doc = { createElement: element, querySelector: selector => selector === '.app-shell' ? shell : null, body: shell };
  const host = { addEventListener: (key, handler) => { events[key] = handler; }, dispatchEvent: event => dispatched.push(event), getCityMap: () => ({}), focusCityPlace: item => focusedPlaces.push(item) };
  const store = createFavoritesStore({ storage });
  const ui = mountFavorites({ doc, host, store });
  return { shell, events, dispatched, focusedPlaces, store, ui, storage, host };
}

test('animated close cannot hide a reopened panel and closing immediately disables interaction', async () => {
  const {ui} = fixture(), animations = [];
  ui.panel.animate = () => { let resolve, reject; const finished = new Promise((yes, no) => { resolve = yes; reject = no; }); const animation = {finished, resolve, cancel(){reject(new Error('cancelled'));}}; animations.push(animation); return animation; };
  ui.open(); ui.close(); assert.equal(ui.panel.hidden, false); assert.equal(ui.panel.inert, true); assert.equal(ui.trigger.attributes['aria-expanded'], 'false');
  const closing = animations.at(-1); ui.trigger.click(); closing.resolve(); await Promise.resolve();
  assert.equal(ui.panel.hidden, false); assert.equal(ui.panel.inert, false); assert.equal(ui.trigger.attributes['aria-expanded'], 'true');
  ui.close(); animations.at(-1).resolve(); await Promise.resolve(); assert.equal(ui.panel.hidden, true); assert.equal(focused, ui.trigger);
});

test('reduced motion skips panel and heart animations while saving and focus still work', () => {
  const {ui,host,store} = fixture(); host.matchMedia = () => ({matches:true});
  ui.panel.animate = () => { throw new Error('reduced motion must not animate'); };
  const heart=ui.button(place('motion')); heart.children[0].animate=ui.panel.animate;
  heart.click(); assert.equal(store.has('motion'),true); ui.open(); ui.close(); assert.equal(ui.panel.hidden,true); assert.equal(focused,ui.trigger);
});

test('card hearts, badge and panel stay in sync; panel actions map, route and remove', () => {
  const f = fixture(), { ui, store } = f;
  assert.equal(f.shell.children[0], ui.trigger); assert.equal(ui.trigger.attributes['aria-label'], 'Ulubione');
  const heart = ui.button(place('a')), other = ui.button(place('b'));
  assert.equal(ui.button({ name: 'bez id' }), null);
  assert.equal(heart.attributes['aria-pressed'], 'false'); assert.equal(heart.attributes['aria-label'], 'Dodaj do ulubionych');
  heart.click();
  assert.equal(heart.attributes['aria-pressed'], 'true'); assert.equal(heart.attributes['aria-label'], 'Usuń z ulubionych');
  assert.equal(other.attributes['aria-pressed'], 'false');
  const badge = ui.trigger.children[1]; assert.equal(badge.hidden, false); assert.equal(badge.textContent, '1');
  assert.equal(ui.trigger.attributes['aria-label'], 'Ulubione (1)');

  ui.trigger.click();
  assert.equal(ui.panel.hidden, false); assert.equal(ui.trigger.attributes['aria-expanded'], 'true');
  const empty = ui.panel.find(n => n.className === 'favorites-panel__empty'), list = ui.panel.find(n => n.className === 'favorites-panel__list');
  assert.equal(empty.hidden, true); assert.equal(list.children.length, 1);
  const row = list.children[0];
  assert.equal(row.find(n => n.className === 'favorites-item__name').textContent, 'Miejsce a');
  assert.equal(row.find(n => n.className === 'favorites-item__address').textContent, 'ul. Marszałkowska 1 · Śródmieście');

  row.find(n => n.className === 'favorites-item__transit').click();
  assert.equal(ui.panel.hidden, true);
  assert.equal(f.dispatched[0].type, 'city:transit');
  assert.deepEqual(f.dispatched[0].detail, { destination: { latitude: 52.23, longitude: 21.01, label: 'Miejsce a' } });

  ui.open(); list.children[0].find(n => n.className === 'favorites-item__map').click();
  assert.equal(f.focusedPlaces[0].id, 'a'); assert.equal(ui.panel.hidden, true);

  ui.open(); list.children[0].find(n => n.className === 'favorites-item__remove').click();
  assert.equal(store.has('a'), false); assert.equal(heart.attributes['aria-pressed'], 'false');
  assert.equal(empty.hidden, false); assert.equal(badge.hidden, true); assert.equal(list.children.length, 0);
  assert.equal(focused, ui.panel.find(n => n.className === 'favorites-panel__close'), 'focus stays in the panel');
});

test('Escape and the close button close the panel and return focus; storage events reload', () => {
  const f = fixture(), { ui } = f;
  ui.open(); const close = ui.panel.find(n => n.className === 'favorites-panel__close');
  assert.equal(focused, close);
  let stopped = false; ui.panel.listeners.keydown({ key: 'Escape', stopPropagation() { stopped = true; } });
  assert.equal(ui.panel.hidden, true); assert.equal(stopped, true); assert.equal(focused, ui.trigger);
  ui.open(); close.click(); assert.equal(ui.panel.hidden, true); assert.equal(focused, ui.trigger);
  ui.trigger.click(); ui.trigger.click(); assert.equal(ui.panel.hidden, true, 'the trigger toggles the panel');

  const heart = ui.button(place('q'));
  f.storage.data[FAVORITES_KEY] = JSON.stringify([place('q')]);
  f.events.storage({ key: 'other' }); assert.equal(heart.attributes['aria-pressed'], 'false');
  f.events.storage({ key: FAVORITES_KEY }); assert.equal(heart.attributes['aria-pressed'], 'true');
});

test('panel warns when favourites cannot be saved and omits map/route actions without coordinates', () => {
  const f = fixture({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
  f.store.add({ id: 'n', name: 'Bez punktu' }); f.ui.open();
  assert.equal(f.ui.panel.find(n => n.className === 'favorites-panel__note').hidden, false);
  const row = f.ui.panel.find(n => n.className === 'favorites-panel__list').children[0];
  assert.equal(row.find(n => n.className === 'favorites-item__transit'), null);
  assert.equal(row.find(n => n.className === 'favorites-item__map'), null);
  assert.ok(row.find(n => n.className === 'favorites-item__remove'));
});

test('detached map-popup hearts keep syncing so a reopened popup shows the current state', () => {
  const { ui, store } = fixture();
  const popupHeart = ui.button(place('p')); popupHeart.isConnected = false;
  ui.button(place('later'));
  store.toggle(place('p'));
  assert.equal(popupHeart.attributes['aria-pressed'], 'true');
  store.remove('p');
  assert.equal(popupHeart.attributes['aria-pressed'], 'false');
});
