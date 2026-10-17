import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const source = await readFile(new URL('../map.js', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function fixture(config = { googleMapsApiKey: 'public-test-key' }, { tileReadiness = false, configFailure = false } = {}) {
  const scripts = [], listeners = new Map(), tileEvents = {}; let leafletCount = 0;
  const element = () => ({ children: [], style: {}, append(node) { this.children.push(node); }, replaceChildren() { this.children = []; }, removeAttribute() {}, setAttribute() {}, addEventListener() {} });
  const map = { setView() { return this; }, on() {}, invalidateSize() {} };
  const L = { map() { leafletCount++; return map; }, tileLayer: () => ({ addTo() {}, ...(tileReadiness ? { on(name, callback) { tileEvents[name] = callback; }, once(name, callback) { tileEvents[name] = callback; } } : {}) }), layerGroup: () => ({ addTo() { return this; } }) };
  const google = { maps: { importLibrary: async name => name === 'maps' ? { Map: class { addListener() {} getZoom() { return 12; } }, InfoWindow: class { addListener() {} } } : { AdvancedMarkerElement: class {} }, event: { addListenerOnce(_map, name, callback) { listeners.set(name, callback); } } } };
  const window = { L };
  const context = { window, google, L, URL, URLSearchParams, queueMicrotask, Promise, console: { warn() {} }, ResizeObserver: class { observe() {} }, document: { createElement: element, head: { append(script) { scripts.push(script); } } }, fetch: async () => ({ ok: !configFailure, json: async () => config }) };
  runInNewContext(source, context);
  return { window, google, scripts, listeners, tileEvents, element, get leafletCount() { return leafletCount; } };
}

test('slow Google script and first tiles remain pending without switching to Leaflet', async () => {
  const f = fixture(); let settled = false;
  const result = f.window.createCityMap(f.element()).then(value => { settled = true; return value; });
  await flush(); assert.equal(f.scripts.length, 1); assert.equal(f.leafletCount, 0); assert.equal(settled, false);
  // There is deliberately no clock-based provider failure in this path.
  await flush(); assert.equal(f.leafletCount, 0); assert.equal(settled, false);
  f.window.google = f.google; f.window.__warsawMapsReady(); await flush();
  assert.equal(f.leafletCount, 0); assert.equal(settled, false); assert.ok(f.listeners.has('tilesloaded'));
  f.listeners.get('tilesloaded')(); assert.equal((await result).vendor, 'google'); assert.equal(f.leafletCount, 0);
});

test('actual Google script failure activates OpenStreetMap', async () => {
  const f = fixture(); const result = f.window.createCityMap(f.element()); await flush();
  f.scripts[0].onerror(); assert.equal((await result).vendor, 'leaflet'); assert.equal(f.leafletCount, 1);
});

test('Google authentication failure while waiting for first tiles hands ownership to replacement', async () => {
  const f = fixture(); const replacements = [];
  const result = f.window.createCityMap(f.element(), { onReplace: map => replacements.push(map) }); await flush();
  f.window.google = f.google; f.window.__warsawMapsReady(); await flush(); f.window.gm_authFailure(); await flush();
  await result; assert.equal(replacements.length, 1); assert.equal(replacements[0].vendor, 'leaflet'); assert.equal(f.leafletCount, 1);
  f.window.gm_authFailure(); assert.equal(replacements.length, 1);
});

test('unconfigured Google uses Leaflet without requesting Google script', async () => {
  const f = fixture({}); assert.equal((await f.window.createCityMap(f.element())).vendor, 'leaflet'); assert.equal(f.scripts.length, 0);
});

test('local SVGs replace ligature text initially and after dynamic icon updates', async () => {
  const iconSource = await readFile(new URL('../loading.js', import.meta.url), 'utf8'); let observe;
  const make = name => ({ nodeType: 1, localName: name, children: [], attrs: {}, textContent: '', setAttribute(key, value) { this.attrs[key] = value; }, append(child) { this.children.push(child); }, replaceChildren(child) { this.children = [child]; this.textContent = ''; this.firstElementChild = child; }, matches(selector) { return selector === '.material-symbols-outlined' && this.isIcon; }, querySelectorAll() { return []; } });
  const icon = make('span'); icon.isIcon = true; icon.textContent = 'keyboard_arrow_up';
  const doc = { querySelectorAll: () => [icon], createElementNS: (_, name) => make(name), documentElement: make('html') };
  runInNewContext(iconSource, { document: doc, MutationObserver: class { constructor(callback) { observe = callback; } observe() {} } });
  assert.equal(icon.textContent, ''); assert.equal(icon.firstElementChild.localName, 'svg'); assert.equal(icon.attrs['aria-hidden'], 'true');
  const firstPath = icon.firstElementChild.children[0].attrs.d;
  icon.firstElementChild = null; icon.textContent = 'keyboard_arrow_down'; observe([{ target: icon, addedNodes: [] }]);
  assert.equal(icon.textContent, ''); assert.notEqual(icon.firstElementChild.children[0].attrs.d, firstPath);
  icon.firstElementChild = null; icon.textContent = 'unknown_future_icon'; observe([{ target: icon, addedNodes: [] }]);
  assert.equal(icon.textContent, ''); assert.ok(icon.firstElementChild.children[0].attrs.d);
  const unknownPath = icon.firstElementChild.children[0].attrs.d;
  for (const name of ['palette', 'directions_run', 'school', 'forum', 'family_restroom', 'wc', 'elderly', 'park']) {
    icon.firstElementChild = null; icon.textContent = name; observe([{ target: icon, addedNodes: [] }]);
    assert.equal(icon.textContent, '');
    assert.notEqual(icon.firstElementChild.children[0].attrs.d, unknownPath, name + ' has its own local glyph');
    if (name === 'wc') {
      assert.equal(icon.firstElementChild.attrs.viewBox, '0 0 24 24');
      assert.equal(icon.firstElementChild.children[0].attrs.d, 'M2 6l2 12 3-8 3 8 2-12m10 2a5 5 0 0 0-8 4 5 5 0 0 0 8 4');
    }
  }
});


test('configuration failure does not pretend Google is unconfigured or initialize Leaflet', async () => {
  const f = fixture({}, { configFailure: true });
  await assert.rejects(f.window.createCityMap(f.element()), /konfiguracji/);
  assert.equal(f.leafletCount, 0); assert.equal(f.scripts.length, 0);
});

test('Leaflet stays pending until its real tiles load and rejects an all-tile failure', async () => {
  const f = fixture({}, { tileReadiness: true }); let settled = false;
  const result = f.window.createCityMap(f.element()).then(value => { settled = true; return value; });
  await flush(); assert.equal(settled, false); f.tileEvents.tileload(); f.tileEvents.load();
  assert.equal((await result).vendor, 'leaflet');
  const broken = fixture({}, { tileReadiness: true }); const failure = broken.window.createCityMap(broken.element());
  await flush(); broken.tileEvents.tileerror(); broken.tileEvents.load();
  await assert.rejects(failure, /kafelków/);
});


for (const outcome of ['success', 'all-tile-failure']) test('auth fallback supersedes old Google tile readiness: ' + outcome, async () => {
  const f = fixture(undefined, { tileReadiness: true }); const replacements = []; let settled = false;
  const result = f.window.createCityMap(f.element(), { onReplace: map => replacements.push(map) }).then(map => { settled = true; return map; });
  await flush(); f.window.google = f.google; f.window.__warsawMapsReady(); await flush();
  f.window.gm_authFailure(); await flush();
  assert.equal(f.leafletCount, 1); assert.equal(settled, false); assert.equal(replacements.length, 0);
  f.listeners.get('tilesloaded')(); await flush();
  assert.equal(settled, false); assert.equal(replacements.length, 0);
  f.window.gm_authFailure(); assert.equal(f.leafletCount, 1);
  f.tileEvents[outcome === 'success' ? 'tileload' : 'tileerror'](); f.tileEvents.load();
  const map = await result;
  assert.equal(replacements.length, 1);
  if (outcome === 'success') { assert.equal(map.vendor, 'leaflet'); assert.equal(map, replacements[0]); }
  else { assert.equal(map, null); assert.equal(replacements[0], null); }
  f.window.gm_authFailure(); assert.equal(replacements.length, 1); assert.equal(f.leafletCount, 1);
});

test('already-ready Google reports one ready replacement even if consumer callback throws', async () => {
  const f = fixture(undefined, { tileReadiness: true }); let callbacks = 0;
  const result = f.window.createCityMap(f.element(), { onReplace() { callbacks++; throw new Error('consumer failed'); } });
  await flush(); f.window.google = f.google; f.window.__warsawMapsReady(); await flush(); f.listeners.get('tilesloaded')();
  assert.equal((await result).vendor, 'google');
  f.window.gm_authFailure(); await flush(); assert.equal(callbacks, 0);
  f.tileEvents.tileload(); f.tileEvents.load(); await flush();
  assert.equal(callbacks, 1); f.window.gm_authFailure(); assert.equal(callbacks, 1); assert.equal(f.leafletCount, 1);
});
