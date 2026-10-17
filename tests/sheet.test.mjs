import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const controller = source.slice(0, source.indexOf("const mapCanvas ="));
function fixture() {
  const nodes = new Map();
  function node(selector) {
    if (nodes.has(selector)) return nodes.get(selector);
    const classes = new Set(), listeners = new Map();
    const element = { attrs: {}, dataset: {}, inert: false, focused: false, textContent: '',
      classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); }, contains(name) { return classes.has(name); } },
      setAttribute(name, value) { this.attrs[name] = value; }, getAttribute(name) { return this.attrs[name]; }, removeAttribute(name) { delete this.attrs[name]; },
      querySelector(name) { return node(selector + ' ' + name); }, focus() { this.focused = true; this.fire('focus'); },
      setPointerCapture(id) { this.capturedPointer = id; },
      addEventListener(name, listener, capture) { const key = capture ? name + ':capture' : name; const list = listeners.get(key) || []; list.push(listener); listeners.set(key, list); },
      fire(name, data = {}) { const event = { target: this, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...data }; for (const listener of listeners.get(name) || []) listener(event); return event; }
    };
    nodes.set(selector, element); return element;
  }
  const context = { window: {}, document: { querySelector: node } };
  runInNewContext(controller, context);
  return { node, window: context.window, get state() { return node('#ai-sheet').dataset.snap; } };
}
test('sheet offers full screen and preserves it when composer/transit opens, with accessible return', () => {
  const f = fixture(); assert.equal(f.state, 'normal');
  f.node('#sheet-fullscreen-btn').fire('click'); assert.equal(f.state, 'fullscreen');
  assert.equal(f.node('.drawer-container').classList.contains('is-fullscreen'), true);
  assert.equal(f.node('#environment-bar').inert, true);
  assert.equal(f.node('#environment-bar').attrs['aria-hidden'], 'true');
  assert.equal(f.node('#sheet-fullscreen-btn').attrs['aria-pressed'], 'true');
  f.node('#search-bar-input').focus(); f.window.expandCitySheet(); assert.equal(f.state, 'fullscreen');
  f.node('#ai-sheet').fire('keydown', { key: 'Escape' }); assert.equal(f.state, 'normal');
  assert.equal(f.node('#environment-bar').inert, false); assert.equal(f.node('#environment-bar').attrs['aria-hidden'], undefined);
  assert.equal(f.node('#sheet-fullscreen-btn').focused, true);
  f.node('#collapse-toggle-btn').fire('click'); assert.equal(f.state, 'collapsed');
  assert.equal(f.node('#sheet-content').inert, true); assert.equal(f.node('#sheet-content').attrs['aria-hidden'], 'true');
  f.node('#search-bar-input').focus(); assert.equal(f.state, 'normal'); assert.equal(f.node('#sheet-content').inert, false);
});
test('keyboard snap controls are bounded and preserve native Enter/Space activation', () => {
  const f = fixture(), handle = f.node('#sheet-handle');
  assert.equal(handle.fire('keydown', { key: 'End' }).defaultPrevented, true); assert.equal(f.state, 'fullscreen');
  handle.fire('keydown', { key: 'ArrowUp' }); assert.equal(f.state, 'fullscreen');
  handle.fire('keydown', { key: 'ArrowDown' }); assert.equal(f.state, 'normal');
  handle.fire('keydown', { key: 'Home' }); handle.fire('keydown', { key: 'ArrowDown' }); assert.equal(f.state, 'collapsed');
  assert.equal(handle.fire('keydown', { key: 'Enter' }).defaultPrevented, undefined);
  handle.fire('click'); assert.equal(f.state, 'normal'); handle.fire('click'); assert.equal(f.state, 'fullscreen'); handle.fire('click'); assert.equal(f.state, 'normal');
});
test('pointer swipes advance one state, suppress their synthetic click and cancel cleanly', () => {
  const f = fixture(), bar = f.node('#sheet-toggle'), handle = f.node('#sheet-handle');
  function down(y, id = 1) { bar.fire('pointerdown', { target: handle, pointerId: id, clientY: y, button: 0 }); }
  down(250); assert.equal(handle.capturedPointer, 1); // Capture stays on the clicked control, so a stationary button click is not retargeted to the header.
  bar.fire('pointerup', { pointerId: 1, clientY: 180 }); assert.equal(f.state, 'fullscreen');
  assert.equal(bar.fire('click:capture', { detail: 1 }).stopped, true);
  down(100); bar.fire('pointercancel'); bar.fire('pointerup', { pointerId: 1, clientY: 200 }); assert.equal(f.state, 'fullscreen');
  down(100); bar.fire('pointerup', { pointerId: 99, clientY: 200 }); assert.equal(f.state, 'fullscreen');
  bar.fire('pointerup', { pointerId: 1, clientY: 200 }); assert.equal(f.state, 'normal');
  assert.equal(bar.fire('click:capture', { detail: 0 }).stopped, undefined); // Keyboard click must remain usable after a swipe.
  down(100); bar.fire('pointerup', { pointerId: 1, clientY: 110 }); assert.equal(f.state, 'normal');
  assert.equal(bar.fire('click:capture', { detail: 1 }).stopped, undefined);
});
