import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('// Full-screen snap state'), app.indexOf('const mapCanvas ='));
function element() {
  const classes = new Set();
  return {
    children: [], dataset: {}, style: {}, attributes: {}, scrollTop: 0, listeners: {},
    classList: {
      add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value),
      toggle(value, enabled) { if (enabled) classes.add(value); else classes.delete(value); },
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } },
    prepend(node) { node.parent = this; this.children.unshift(node); },
    remove() { this.parent.children = this.parent.children.filter(node => node !== this); },
    querySelector() { return this.children.find(node => node.className === 'conversation-event'); },
    addEventListener(name, callback) { this.listeners[name] = callback; },
    focus() {}, getBoundingClientRect() { return { height: 300, width: 400, left: 0, top: 0 }; },
  };
}
function setup({ reducedMotion = true } = {}) {
  const content = element(), sheet = element(), drawer = element(), input = element(), toggle = element(), handle = element(), chevron = element();
  const chat = element(), results = element(), transport = element(), events = {}, docEvents = {}, animations = [];
  content.append(chat, results, transport);
  content.animate = (...args) => { animations.push(args); return { finished: Promise.resolve() }; };
  content.getBoundingClientRect = () => ({ height: Number.parseFloat(content.style.maxHeight) || (sheet.classList.contains('is-collapsed') ? 0 : sheet.classList.contains('is-full') ? 672 : 384) });
  const nodes = { '#ai-sheet': sheet, '#sheet-toggle': handle, '#sheet-chevron': chevron, '#search-bar-wrapper': element() };
  const window = { addEventListener(name, callback) { events[name] = callback; }, matchMedia: () => ({ matches: reducedMotion }) };
  const context = {
    window, document: { createElement: element, querySelector: selector => nodes[selector], addEventListener(name, callback) { docEvents[name] = callback; } },
    content, drawer, input, toggle, expanded: true, suppressHandleClick: false, innerHeight: 800,
    setTimeout() { throw new Error('Panel state must not be deferred to a timer'); },
  };
  runInNewContext(source, context);
  return { content, sheet, drawer, input, toggle, handle, chevron, events, docEvents, animations, context, originalChildren: [chat, results, transport], open: () => window.openEventInConversation(element(), { title: 'Wydarzenie' }) };
}
const clickChevron = env => env.toggle.listeners.click({ stopPropagation() {} });
const back = env => env.content.querySelector('.conversation-event').children[0].listeners.click();
function drag(env, fromY, toY) {
  env.handle.listeners.pointerdown({ target: { closest: () => null }, clientY: fromY, pointerId: 1 });
  env.handle.listeners.pointermove({ clientY: toY, pointerId: 1 });
  env.handle.listeners.pointerup({ clientY: toY, pointerId: 1 });
}
for (const event of ['city:transit', 'city:query']) test('external event view releases conversation synchronously for ' + event, () => {
  const env = setup(); env.open();
  assert.equal(env.sheet.classList.contains('is-event-open'), true);
  assert.equal(env.sheet.classList.contains('is-full'), true);
  env.events[event]();
  assert.equal(env.content.querySelector('.conversation-event'), undefined);
  assert.equal(env.sheet.classList.contains('is-event-open'), false);
  assert.equal(env.drawer.classList.contains('is-event-open'), false);
  assert.equal(env.sheet.classList.contains('is-full'), false);
  assert.deepEqual(env.content.children, env.originalChildren);
});
test('event chevron collapses the panel and restores the same event at full height', () => {
  const env = setup(); env.open(); const view = env.content.querySelector('.conversation-event');
  env.content.scrollTop = 460;
  clickChevron(env);
  assert.equal(env.sheet.classList.contains('is-collapsed'), true);
  assert.equal(env.sheet.classList.contains('is-full'), false);
  assert.equal(env.content.inert, true);
  assert.equal(env.toggle.attributes['aria-expanded'], 'false');
  assert.equal(env.chevron.textContent, 'keyboard_arrow_up');
  clickChevron(env);
  assert.equal(env.sheet.classList.contains('is-collapsed'), false);
  assert.equal(env.sheet.classList.contains('is-full'), true);
  assert.equal(env.content.querySelector('.conversation-event'), view);
  assert.equal(env.content.scrollTop, 460);
  assert.equal(env.content.inert, false);
});
test('event dragging snaps to half, collapsed and full without event-specific height locks', () => {
  const env = setup(); env.open();
  drag(env, 100, 350); // full 672 -> 422 -> half
  assert.equal(env.sheet.classList.contains('is-full'), false);
  assert.equal(env.context.expanded, true);
  assert.equal(env.content.style.maxHeight, '');
  drag(env, 100, 450); // half 384 -> 34 -> collapsed
  assert.equal(env.sheet.classList.contains('is-collapsed'), true);
  drag(env, 700, 40); // collapsed -> 660 -> full
  assert.equal(env.sheet.classList.contains('is-full'), true);
  assert.equal(env.sheet.classList.contains('is-collapsed'), false);
  assert.ok(env.content.querySelector('.conversation-event'));
});
test('back restores conversation scroll and its previous half or full snap', () => {
  for (const wasFull of [false, true]) {
    const env = setup(); env.context.setSheetFull(wasFull); env.content.scrollTop = 217;
    env.open(); env.content.scrollTop = 900; back(env);
    assert.equal(env.content.scrollTop, 217);
    assert.equal(env.sheet.classList.contains('is-full'), wasFull);
    assert.equal(env.context.expanded, true);
    assert.deepEqual(env.content.children, env.originalChildren);
  }
});
test('back during motion cannot later reopen a collapsed panel or remove a newer event', async () => {
  const env = setup({ reducedMotion: false });
  env.content.scrollTop = 185; env.open(); back(env); clickChevron(env);
  await Promise.resolve();
  assert.equal(env.sheet.classList.contains('is-collapsed'), true);
  assert.equal(env.content.style.maxHeight, undefined);
  assert.equal(env.content.style.minHeight, undefined);
  env.open(); const newer = env.content.querySelector('.conversation-event');
  await Promise.resolve();
  assert.equal(env.content.querySelector('.conversation-event'), newer);
  assert.equal(env.sheet.classList.contains('is-full'), true);
  assert.equal(env.animations.length, 1);
});
test('Escape returns to conversation and ordinary full conversation can collapse and reopen', () => {
  const env = setup(); env.context.setSheetFull(true); env.content.scrollTop = 94; env.open();
  env.docEvents.keydown({ key: 'Escape' });
  assert.equal(env.content.querySelector('.conversation-event'), undefined);
  assert.equal(env.content.scrollTop, 94);
  clickChevron(env); clickChevron(env);
  assert.equal(env.sheet.classList.contains('is-full'), true);
  assert.equal(env.sheet.classList.contains('is-collapsed'), false);
});

test('replacing an event keeps the original conversation scroll for the final back action', () => {
  const env = setup(); env.content.scrollTop = 143; env.open();
  env.content.scrollTop = 850; env.open(); env.content.scrollTop = 500; back(env);
  assert.equal(env.content.scrollTop, 143);
  assert.deepEqual(env.content.children, env.originalChildren);
});
