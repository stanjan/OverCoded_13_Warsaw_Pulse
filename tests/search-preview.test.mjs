import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createAssistant } from '../server/assistant.mjs';
import { fitResultBudget, requestFits, RESULT_LIMITS } from '../server/result-budget.mjs';

const now = new Date('2026-10-17T21:30:00Z');
const location = { status: 'available', source: 'browser_geolocation', freshness: 'stale',
  latitude: 52.223923, longitude: 20.972058, accuracy: 8000, observedAt: '2026-10-01T12:00:00Z' };
const filters = { category: 'event', dateFrom: '2026-10-17', dateTo: '2026-10-18', audience: 'rodziny' };
const records = Array.from({ length: 175 }, (_, index) => ({
  id: 'event-' + index, name: 'Wydarzenie ' + index, category: 'event', description: 'Opis '.repeat(600),
  lat: location.latitude + 0.00001 * (174 - index), lng: location.longitude,
  dates: [{ from: index % 2 ? '2026-10-18' : '2026-10-17', to: index % 2 ? '2026-10-18' : '2026-10-17' }],
  districts: ['Wola'], district: 'Wola', audience: ['Dla dzieci'],
  activities: [index === 0 ? 'Warsztaty' : index % 2 ? 'Koncerty' : 'Wystawy'],
  addresses: ['ul. Testowa ' + index], source: 'Kalendarz miejski', sourceUrl: 'https://dane.um.warszawa.pl/pl/catalogue/test',
}));
const envelope = results => ({ results, total: results.length, complete: true, dataMode: 'official', errors: [],
  sources: [{ category: 'event', matched: results.length, fetched: results.length, complete: true }] });
const fit = (data, options = {}) => fitResultBudget(envelope(data), { now, location, filters, ...options });
const call = (name, args) => ({ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } });

test('175 weekend matches produce the largest fitting nearest preview, preserving both requested days and audience', () => {
  const fitted = fit(records);
  assert.equal(fitted.response.status, 'preview');
  assert.ok(fitted.records.length > 1 && fitted.records.length < 175);
  assert.equal(fitted.records[0].id, 'event-174');
  assert.ok(fitted.records.some(record => record.dates[0].from === '2026-10-18'));
  assert.ok(fitted.records.some(record => record.dates[0].from === '2026-10-17'));
  assert.deepEqual(fitted.response.narrowing.appliedFilters.requested, filters);
  assert.equal(fitted.response.narrowing.allMatchingRecordsProvided, false);
  assert.equal(fitted.response.narrowing.positionBasis, 'last_known_location');
  assert.equal(fitted.response.narrowing.observedAt, location.observedAt);
  assert.ok(fitted.response.suggestedRefinements.activities.includes('Warsztaty'));
  assert.equal(requestFits([{ role: 'tool', tool_call_id: 't', content: JSON.stringify(fitted.response) }]), true);
  // A further full record no longer fits the disclosed envelope.
  const next = { ...fitted.response, results: [...fitted.response.results, records[174 - fitted.records.length]] };
  assert.ok(JSON.stringify(next).length > RESULT_LIMITS.toolCharacters);
});

test('without GPS a representative preview uses actual source order and does not claim proximity', () => {
  const fitted = fit(records, { location: undefined });
  assert.equal(fitted.response.status, 'preview');
  assert.equal(fitted.records[0].id, records[0].id);
  assert.equal(fitted.response.narrowing.selection, 'source_order');
  assert.equal(fitted.response.narrowing.positionBasis, undefined);
  assert.equal(fitted.response.narrowing.farthestKnownDistanceKm, null);
});

test('empty automatic date and radius trials never replace actual original matches', () => {
  const distantFuture = records.map(record => ({ ...record, lat: 53.5,
    dates: [{ from: '2026-11-15', to: '2026-11-15' }] }));
  const fitted = fit(distantFuture, { filters: { category: 'event' } });
  assert.equal(fitted.response.status, 'preview');
  assert.ok(fitted.records.length > 0);
  assert.ok(fitted.response.narrowing.attempts.some(attempt => attempt.total === 0));
  assert.ok(fitted.records.every(record => record.dates[0].from === '2026-11-15'));
  assert.equal(fitted.response.narrowing.appliedFilters.eventDate, undefined);
  assert.equal(fitted.response.narrowing.appliedFilters.distance, undefined);
  assert.ok(fitted.response.narrowing.farthestKnownDistanceKm > 25);
});

test('radius scopes retain Sunday matches rather than the last failed Saturday trial', () => {
  const mixed = records.map((record, index) => ({ ...record, lat: location.latitude + (index < 2 ? 0.001 : 0.3) }));
  const fitted = fit(mixed);
  assert.equal(fitted.response.status, 'automatically_narrowed');
  assert.deepEqual(fitted.records.map(record => record.id), ['event-0', 'event-1']);
  assert.equal(fitted.response.narrowing.appliedFilters.eventDate, undefined);
  assert.deepEqual(fitted.response.narrowing.appliedFilters.requested, filters);
});

for (const mode of ['question', 'empty_display']) test('server guarantees a real preview when model returns ' + mode, async () => {
  let step = 0;
  const events = [];
  const assistant = createAssistant({ now: () => now, provider: { search: async () => envelope(records) }, completion: async history => {
    assert.equal(requestFits(history), true);
    if (++step === 1) return { tool_calls: [call('search_places', filters)] };
    if (mode === 'empty_display' && step === 2) return { tool_calls: [call('display_results', { ids: [], highlightIds: [], title: 'Pusto' })] };
    return { content: 'Potrzebuję zawężenia. Jakie wydarzenia Cię interesują?' };
  } });
  const answer = await assistant.chat({ message: 'podaj najlepsze wydarzenia na ten weekend', location }, undefined, event => events.push(event));
  assert.equal(answer.actions.length, 1);
  const display = answer.actions[0];
  assert.equal(display.type, 'display_results');
  assert.ok(display.results.length > 0);
  assert.equal(display.narrowing.originalTotal, 175);
  assert.equal(display.narrowing.preview, true);
  assert.equal(display.results[0].description, records[174].description);
  assert.deepEqual(display.results[0].audience, ['Dla dzieci']);
  assert.deepEqual(display.results[0].addresses, records[174].addresses);
  assert.ok(events.some(event => event.type === 'action' && event.action.results.length));
  assert.match(answer.message, /przykładów z 175/);
  assert.match(answer.message, /Koncerty|Wystawy|Warsztaty/);
  assert.doesNotMatch(answer.message, /Potrzebuję zawężenia/);
});

test('guard also covers a complete automatically narrowed nonempty scope', async () => {
  let step = 0;
  const dated = records.map((record, index) => ({ ...record,
    dates: [{ from: index < 2 ? '2026-10-17' : '2026-11-20', to: index < 2 ? '2026-10-17' : '2026-11-20' }] }));
  const assistant = createAssistant({ now: () => now, provider: { search: async () => envelope(dated) },
    completion: async () => ++step === 1 ? { tool_calls: [call('search_places', { category: 'event' })] } : { content: 'Która dzielnica?' } });
  const result = await assistant.chat({ message: 'pokaż wydarzenia', location });
  assert.equal(result.actions[0].results.length, 2);
  assert.equal(result.actions[0].narrowing.preview, undefined);
  assert.match(result.message, /zawężonego zakresu/);
});

test('follow-up filters use the retained full original set and only visible IDs can be displayed', async () => {
  let step = 0, searches = 0;
  const assistant = createAssistant({ now: () => now, provider: { search: async () => { searches++; return envelope(records); } },
    completion: async history => {
      assert.equal(requestFits(history), true);
      if (++step === 1) return { tool_calls: [call('search_places', filters)] };
      if (step === 2) {
        assert.ok(!JSON.parse(history.at(-1).content).results.some(record => record.id === 'event-0'));
        return { tool_calls: [call('display_results', { ids: ['event-0'], highlightIds: ['event-0'], title: 'Niewidoczny' })] };
      }
      if (step === 3) { assert.ok(JSON.parse(history.at(-1).content).error); return { content: 'Który temat?' }; }
      if (step === 4) return { tool_calls: [call('filter_results', { activity: 'Warsztaty' })] };
      assert.deepEqual(JSON.parse(history.at(-1).content).results.map(record => record.id), ['event-0']);
      return { content: 'Warsztaty.' };
    } });
  const first = await assistant.chat({ message: 'Wydarzenia rodzinne na weekend', location });
  assert.ok(first.actions[0].results.every(record => record.id !== 'event-0'));
  const next = await assistant.chat({ message: 'Warsztaty', location, sessionId: first.sessionId });
  assert.equal(searches, 1);
  assert.deepEqual(next.actions[0].results.map(record => record.id), ['event-0']);
  assert.deepEqual(next.actions[0].results[0].dates, records[0].dates);
});

for (const cancel of ['empty_search', 'failed_search', 'focus_map', 'plan_transit']) test('later ' + cancel + ' cancels any pending search display', async () => {
  let step = 0, searches = 0;
  const assistant = createAssistant({ now: () => now, provider: { search: async () => {
    if (++searches === 1) return envelope(records);
    if (cancel === 'failed_search') throw new Error('Source unavailable');
    return envelope([]);
  } }, completion: async () => {
    if (++step === 1) return { tool_calls: [call('search_places', filters)] };
    if (step === 2) return { tool_calls: [call(cancel.endsWith('search') ? 'search_places' : cancel,
      cancel === 'focus_map' ? { latitude: 52.23, longitude: 21, zoom: 13 } : cancel === 'plan_transit' ?
        { destinationCoordinates: { latitude: 52.23, longitude: 21 } } : { category: 'event', query: 'nieistniejący' })] };
    return { content: 'Zgodnie z ostatnią operacją.' };
  } });
  const result = await assistant.chat({ message: 'pokaż wydarzenia', location });
  assert.equal(result.actions.some(action => action.type === 'display_results'), false);
});

for (const complete of [true, false]) test('a genuine zero result is never replaced with fabricated examples (complete=' + complete + ')', async () => {
  let step = 0;
  const assistant = createAssistant({ provider: { search: async () => ({ ...envelope([]), complete,
    errors: complete ? [] : [{ code: 'SOURCE_UNAVAILABLE' }] }) }, completion: async () =>
    ++step === 1 ? { tool_calls: [call('search_places', { category: 'event' })] } : { content: 'Brak potwierdzonych wyników.' } });
  const result = await assistant.chat({ message: 'pokaż wydarzenia' });
  assert.deepEqual(result.actions, []);
});

test('a request only for a count does not trigger automatic cards', async () => {
  let step = 0;
  const assistant = createAssistant({ provider: { search: async () => envelope(records) }, completion: async () =>
    ++step === 1 ? { tool_calls: [call('search_places', filters)] } : { content: 'Znaleziono 175 dopasowań.' } });
  assert.deepEqual((await assistant.chat({ message: 'Ile wydarzeń jest w weekend?' })).actions, []);
});

test('8 MB record descriptions cannot overflow browser SSE, while follow-up filtering still sees the original tail', async () => {
  const huge = { ...records[0], description: '😀'.repeat(2000000) + ' Ukryty pełny opis',
    dates: records[0].dates, audience: ['Dla dzieci'], imageUrl: 'https://um.warszawa.pl/photo.jpg' };
  let step = 0, searches = 0;
  const events = [];
  const assistant = createAssistant({ now: () => now, provider: { search: async () => { searches++; return envelope([huge]); } },
    completion: async history => {
      assert.equal(requestFits(history), true);
      if (++step === 1) return { tool_calls: [call('search_places', filters)] };
      if (step === 2) return { content: 'Który temat?' };
      if (step === 3) return { tool_calls: [call('filter_results', { query: 'Ukryty pełny opis' })] };
      assert.deepEqual(JSON.parse(history.at(-1).content).results.map(record => record.id), [huge.id]);
      return { content: 'Pokazuję dopasowanie.' };
    } });
  const first = await assistant.chat({ message: 'pokaż rodzinne wydarzenia', location }, undefined, event => events.push(event));
  const action = first.actions[0];
  assert.equal(action.displayProjection.fieldsProjected, true);
  assert.ok(JSON.stringify(action).length < 250000);
  assert.ok(events.every(event => JSON.stringify(event).length < 250000));
  assert.equal(action.results[0].id, huge.id);
  assert.deepEqual(action.results[0].dates, huge.dates);
  assert.deepEqual(action.results[0].audience, huge.audience);
  assert.deepEqual(action.results[0].addresses, huge.addresses);
  assert.equal(action.results[0].imageUrl, huge.imageUrl);
  const next = await assistant.chat({ message: 'znajdź Ukryty pełny opis', location, sessionId: first.sessionId });
  assert.equal(searches, 1);
  assert.equal(next.actions[0].results[0].id, huge.id);
  assert.equal(huge.description.endsWith('Ukryty pełny opis'), true);
});

test('result cards omit the removed heading and diagnostics while retaining search metadata', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const render = app.slice(app.indexOf('function showResults(action)'), app.indexOf('\nconst prompts'));
  const element = tag => ({ tag, children: [], append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; }, addEventListener() {} });
  const panel = element('section');
  const context = { document: { createElement: element }, resultPanel: panel, lastDisplayedAction: null,
    cityMap: undefined, action: { title: 'Przykłady', results: [{ ...records[0], lat: undefined, lng: undefined }], highlightIds: [], complete: true,
      narrowing: { preview: true, originalTotal: 175, selection: 'source_order' } } };
  runInNewContext(render + '\nshowResults(action);', context);
  assert.equal(panel.children.every(child => child.tag === 'article'), true);
  assert.equal(context.lastDisplayedAction, context.action);
  assert.equal(context.action.narrowing.originalTotal, 175);
  assert.equal(context.action.narrowing.preview, true);
  assert.equal(panel.children.filter(child => child.tag === 'article').length, 1);
});
