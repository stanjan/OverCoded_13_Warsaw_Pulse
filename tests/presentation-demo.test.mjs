import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { installPresentationReceiver, PRESENTATION_CHANNEL } from '../presentation-receiver.mjs';
import { createSlideDemoController, demoPrompts } from '../Warsaw-Open-Data-Presentation/components/live-demo-controller.mjs';

class Host extends EventTarget {
  location = { search: '?presentationDemo=1' };
  timers = new Map();
  setInterval(fn) { const id = this.timers.size; this.timers.set(id, fn); return id; }
  clearInterval(id) { this.timers.delete(id); }
  message(source, origin, data) { const event = new Event('message'); Object.assign(event, { source, origin, data }); this.dispatchEvent(event); }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function receiverSetup() {
  const host = new Host(), input = new EventTarget(), messages = [], starts = [];
  host.parent = { postMessage: (data, origin) => messages.push({ data, origin }) };
  let ready = true, complete;
  const receiver = installPresentationReceiver({ host, input, isReady: () => ready, start: prompt => { starts.push(prompt); ready = false; return { completion: new Promise(resolve => { complete = () => { ready = true; resolve(); }; }) }; } });
  const send = data => host.message(host.parent, 'http://localhost:3030', { channel: PRESENTATION_CHANNEL, ...data });
  return { host, input, messages, starts, receiver, send, draft: () => { ready = false; }, complete: () => complete() };
}
test('presentation receiver is opt-in and binds only its parent from an exact local slide origin', () => {
  const a = receiverSetup();
  a.host.message({}, 'http://localhost:3030', { channel: PRESENTATION_CHANNEL, type: 'prompt', id: 'request_1', prompt: 'Hello' });
  a.host.message(a.host.parent, 'https://evil.example', { channel: PRESENTATION_CHANNEL, type: 'prompt', id: 'request_1', prompt: 'Hello' });
  assert.equal(a.starts.length, 0); assert.equal(a.messages.length, 0);
  a.send({ type: 'hello' }); assert.deepEqual(a.messages.at(-1), { origin: 'http://localhost:3030', data: { channel: PRESENTATION_CHANNEL, type: 'status', ready: true } }); a.receiver.stop();
  a.host.location.search = ''; assert.equal(installPresentationReceiver({ host: a.host }), null);
  a.host.location.search = '?presentationDemo=1'; a.host.parent = a.host; assert.equal(installPresentationReceiver({ host: a.host }), null);
});
test('normal send seam receives once; busy, manual draft and duplicate requests cannot overwrite conversation', async () => {
  const a = receiverSetup(), command = { type: 'prompt', id: 'request_1', prompt: 'Pokaż boiska' };
  a.send(command); a.send(command); a.send({ ...command, id: 'request_2' });
  assert.deepEqual(a.starts, ['Pokaż boiska']);
  assert.ok(a.messages.some(({ data }) => data.id === 'request_2' && data.state === 'rejected'));
  a.complete(); await flush(); a.send(command); assert.equal(a.starts.length, 1);
  a.draft(); a.send({ ...command, id: 'request_3' }); assert.equal(a.starts.length, 1);
  a.receiver.stop(); a.send({ ...command, id: 'request_4' }); assert.equal(a.starts.length, 1);
});
test('controller and receiver handshake, all six prompts, selection acknowledgement and reload without replay', async () => {
  const slides = new Host(), app = new Host(), input = new EventTarget(), started = [], states = [];
  let ready = true, finish;
  const frame = { postMessage: (data, origin) => { assert.equal(origin, 'http://localhost:5173'); app.message(parent, 'http://localhost:3030', data); } };
  const parent = { postMessage: (data, origin) => { assert.equal(origin, 'http://localhost:3030'); slides.message(frame, 'http://localhost:5173', data); } };
  app.parent = parent;
  let receiver = installPresentationReceiver({ host: app, input, isReady: () => ready, start: prompt => { ready = false; started.push(prompt); return { completion: new Promise(resolve => { finish = () => { ready = true; resolve(); }; }) }; } });
  let seq = 0;
  const controller = createSlideDemoController({ host: slides, getFrame: () => frame, appOrigin: 'http://localhost:5173', onChange: value => states.push(value), uuid: () => `request_${++seq}` });
  assert.equal(states.at(-1).ready, true);
  for (const tile of demoPrompts) {
    assert.equal(controller.send(tile), true); assert.equal(states.at(-1).selected, tile.id);
    assert.equal(controller.send(demoPrompts[0]), false); finish(); await flush();
    assert.equal(states.at(-1).ready, true); assert.equal(states.at(-1).pending, null);
  }
  assert.deepEqual(started, demoPrompts.map(tile => tile.prompt));
  receiver.stop(); controller.reset(); assert.equal(states.at(-1).ready, false);
  receiver = installPresentationReceiver({ host: app, input, isReady: () => true, start: () => { throw Error('must not replay'); } });
  [...slides.timers.values()][0](); assert.equal(states.at(-1).ready, true); assert.equal(started.length, 6);
  controller.stop(); receiver.stop();
});
test('controller rejects foreign acknowledgements and never resends an unacknowledged click', () => {
  const host = new Host(), sent = [], states = []; let clock = 0;
  const frame = { postMessage: data => sent.push(data) };
  const controller = createSlideDemoController({ host, getFrame: () => frame, appOrigin: 'http://localhost:5173', onChange: value => states.push(value), uuid: () => 'request_123', now: () => clock });
  const message = data => host.message(frame, 'http://localhost:5173', { channel: PRESENTATION_CHANNEL, ...data });
  host.message({}, 'http://localhost:5173', { channel: PRESENTATION_CHANNEL, type: 'status', ready: true }); assert.equal(states.at(-1).ready, false);
  message({ type: 'status', ready: true }); controller.send(demoPrompts[0]);
  assert.equal(states.at(-1).selected, null);
  host.message(frame, 'https://evil.example', { channel: PRESENTATION_CHANNEL, type: 'command', id: 'request_123', state: 'started' }); assert.equal(states.at(-1).selected, null);
  clock = 6000; [...host.timers.values()][0](); assert.equal(states.at(-1).pending, null); assert.match(states.at(-1).error, /Brak potwierdzenia/);
  assert.equal(sent.filter(value => value.type === 'prompt').length, 1); controller.stop();
});
test('presentation avoids automatic geolocation permissions; normal app and manual GPS keep current behavior', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const refresh = source.slice(source.indexOf('function refreshLocation('), source.indexOf('window.refreshCityLocation'));
  const locate = source.slice(source.indexOf('function startLocating('), source.indexOf('// In-panel actions'));
  function calls(presentationDemo, permissionGranted, force = false, auto = true) {
    const count = { get: 0, watch: 0 };
    const scope = { presentationDemo, permissionGranted, permissionDenied: false, locationRequest: null, locationGeneration: 0, watchId: null, firstFixTimer: null, navigator: { geolocation: { getCurrentPosition() { count.get++; }, watchPosition() { count.watch++; return 1; } } }, window: { getCityLocation: () => ({ status: 'unavailable' }) }, LOCATION_REFRESH_TIMEOUT: 5000, LOCATION_MAX_AGE: 60000, hasRecentLocation: () => false, hasKnownLocation: () => false, setGpsState() {}, updateLocationSnapshot() {}, setTimeout: () => 1, clearTimeout() {} };
    runInNewContext(`${refresh}\n${locate}\nrefreshLocation({force:${force}});startLocating({auto:${auto}});`, scope);
    return count;
  }
  assert.deepEqual(calls(true, false), { get: 0, watch: 0 });
  assert.deepEqual(calls(false, false), { get: 1, watch: 1 });
  assert.deepEqual(calls(true, true), { get: 1, watch: 1 });
  assert.deepEqual(calls(true, false, true, false), { get: 1, watch: 1 });
});

test('actual app bootstrap enables presentation only on opt-in and calls existing send without replacing draft', async () => {
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const entry = source.slice(source.indexOf("if (presentationDemo) import('/presentation-receiver.mjs')"))
    .replace("import('/presentation-receiver.mjs')", 'Promise.resolve({ installPresentationReceiver })');
  let installed, sends = 0, expanded = 0;
  const scope = { presentationDemo: false, pending: false, input: { value: '' }, console, installPresentationReceiver: options => { installed = options; }, setExpanded: () => expanded++, send: () => { sends++; return Promise.resolve(); } };
  runInNewContext(entry, scope); await flush(); assert.equal(installed, undefined);
  scope.presentationDemo = true; runInNewContext(entry, scope); await flush(); assert.equal(installed.isReady(), true);
  scope.input.value = 'Własny szkic'; assert.equal(installed.start('Nie zastępuj'), null); assert.equal(scope.input.value, 'Własny szkic'); assert.equal(sends, 0);
  scope.input.value = ''; scope.pending = true; assert.equal(installed.start('Zajęty'), null); assert.equal(sends, 0);
  scope.pending = false; await installed.start('Pokaż wydarzenia').completion;
  assert.equal(scope.input.value, 'Pokaż wydarzenia'); assert.equal(sends, 1); assert.equal(expanded, 1);
});
