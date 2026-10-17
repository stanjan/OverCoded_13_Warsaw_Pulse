import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitResultBudget, warsawDate, requestFits, serializeBridgeRequest, compactHistory, RESULT_LIMITS } from '../server/result-budget.mjs';
import { createAssistant } from '../server/assistant.mjs';
import { normalizeRecord } from '../mcp/catalog.mjs';
import { runTool } from '../mcp/tools.mjs';

const now = new Date('2026-10-17T12:00:00Z');
const location = { status: 'available', source: 'browser_geolocation', freshness: 'recent',
  latitude: 52.23, longitude: 21.01, accuracy: 10, observedAt: now.toISOString() };
const event = (id, day, length = 40000, km = 0.1) => ({
  id, name: id, category: 'event', description: 'a'.repeat(length), districts: ['Wola'],
  dates: day ? [{ from: day, to: day }] : [], lat: location.latitude + km / 111.195, lng: location.longitude,
});
const envelope = results => ({ results, total: results.length, complete: false, dataMode: 'official',
  sources: [{ category: 'event', matched: results.length, fetched: results.length, complete: true, datasetId: 'official' }],
  errors: [{ category: 'sports', code: 'SOURCE_UNAVAILABLE' }] });
const fit = (records, options = {}) => fitResultBudget(envelope(records), { now, ...options });
const call = (name, args) => ({ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } });

test('a complete small set is returned unchanged with every record, field and warning', () => {
  const input = envelope([event('a', '2026-10-17', 100), event('b', '2026-11-25', 100)]);
  const fitted = fitResultBudget(input, { now, location });
  assert.equal(fitted.response, input);
  assert.equal(fitted.records, input.results);
  assert.equal(fitted.response.status, undefined);
  assert.deepEqual(fitted.response.errors, input.errors);
});

for (const days of [3, 2, 1]) test('automatic event narrowing fits the first acceptable ' + days + '-day window', () => {
  const length = days === 3 ? 25000 : days === 2 ? 40000 : 60000;
  const records = ['17', '18', '19', '25'].map(day => event(day, '2026-10-' + day, length));
  // Ensure even the 3-day case exceeds the full-response threshold.
  if (days === 3) records.at(-1).description = 'x'.repeat(80000);
  const fitted = fit(records);
  assert.equal(fitted.response.status, 'automatically_narrowed');
  assert.deepEqual(fitted.records.map(record => record.id), ['17', '18', '19'].slice(0, days));
  assert.deepEqual(fitted.response.narrowing.attempts.map(attempt => attempt.dateTo),
    ['2026-10-19', '2026-10-18', '2026-10-17'].slice(0, 4 - days));
  assert.equal(fitted.response.narrowing.originalTotal, 4);
  assert.equal(fitted.response.narrowing.effectiveTotal, days);
  assert.equal(fitted.response.sources[0].matchedBeforeNarrowing, 4);
  assert.equal(fitted.response.sources[0].matched, days);
  assert.deepEqual(fitted.response.errors, envelope([]).errors);
  assert.equal(records[3].description.length, days === 3 ? 80000 : length);
});

test('date narrowing discloses unknown event dates while preserving non-event categories', () => {
  const records = [event('known', '2026-10-17', 10000), event('unknown', null, 130000),
    { id: 'sports', category: 'sports', weekdays: ['Sobota'], description: 'Zajęcia', dates: [] }];
  const fitted = fit(records);
  assert.deepEqual(fitted.records.map(record => record.id), ['known', 'sports']);
  assert.equal(fitted.response.narrowing.excluded.unknownEventDate, 1);
  assert.equal(fitted.response.narrowing.appliedFilters.eventDate.from, '2026-10-17');
  assert.equal(fitted.records[1].dates.length, 0);
});

test('Warsaw day boundaries and daylight-saving changes use calendar dates', () => {
  assert.equal(warsawDate(new Date('2026-10-24T22:30:00Z')), '2026-10-25');
  assert.equal(warsawDate(new Date('2026-10-25T23:30:00Z')), '2026-10-26');
  assert.equal(warsawDate(new Date('2026-03-28T23:30:00Z')), '2026-03-29');
  assert.equal(warsawDate(new Date('2026-03-29T22:30:00Z')), '2026-03-30');
  const records = ['25', '26', '27', '28'].map(day => event(day, '2026-10-' + day, 40000));
  const fitted = fit(records, { now: new Date('2026-10-24T22:30:00Z') });
  assert.equal(fitted.response.narrowing.appliedFilters.eventDate.from, '2026-10-25');
  assert.equal(fitted.response.narrowing.appliedFilters.eventDate.to, '2026-10-26');
});

test('an explicit future trip is narrowed inside its requested range, never to today', () => {
  const records = ['10', '11', '12', '13'].map(day => event(day, '2026-11-' + day, 40000));
  const fitted = fit(records, { filters: { category: 'event', dateFrom: '2026-11-10', dateTo: '2026-11-20' } });
  assert.deepEqual(fitted.records.map(record => record.id), ['10', '11']);
  assert.equal(fitted.response.narrowing.appliedFilters.eventDate.from, '2026-11-10');
  assert.equal(fitted.response.narrowing.appliedFilters.eventDate.to, '2026-11-11');
  const singleDay = fit([event('huge', '2026-11-10', 150000)], {
    filters: { dateFrom: '2026-11-10', dateTo: '2026-11-10' },
  });
  assert.deepEqual(singleDay.response.narrowing.attempts.map(attempt => attempt.dateTo), ['2026-11-10']);
  const pastCap = fit([event('past', '2026-10-10', 150000)], { filters: { dateTo: '2026-10-10' } });
  assert.equal(pastCap.response.narrowing.appliedFilters.eventDate.to, '2026-10-10');
});

test('date windows precede progressively smaller measured-GPS radii, retaining every nearby match', () => {
  const records = [0.1, 2.5, 7, 18].map((km, i) => event('e' + i, '2026-10-17', 50000, km));
  const fitted = fit(records, { location });
  assert.equal(fitted.response.status, 'automatically_narrowed');
  assert.deepEqual(fitted.records.map(record => record.id), ['e0', 'e1']);
  assert.deepEqual(fitted.response.narrowing.attempts.slice(0, 3).map(attempt => attempt.dateTo),
    ['2026-10-19', '2026-10-18', '2026-10-17']);
  assert.deepEqual(fitted.response.narrowing.attempts.slice(3).map(attempt => attempt.radiusKm), [25, 10, 5]);
  assert.equal(fitted.response.narrowing.appliedFilters.distance.radiusKm, 5);
  assert.equal(fitted.response.narrowing.appliedFilters.distance.basis, 'browser_geolocation');
  assert.equal(fitted.response.narrowing.appliedFilters.distance.accuracyMeters, 10);
});

test('distance matching honors all allowed source locations and discloses missing coordinates', () => {
  const nearby = event('multi', '2026-10-17', 40000, 30);
  nearby.locations = [{ lat: location.latitude + 0.001, lng: location.longitude, district: 'Wola' },
    { lat: location.latitude + 0.4, lng: location.longitude, district: 'Ochota' }];
  const missing = { ...event('missing', '2026-10-17', 40000), lat: undefined, lng: undefined };
  const distant = { ...event('distant', '2026-10-17', 130000, 40), district: 'Wola' };
  const fitted = fit([nearby, missing, distant], { location, filters: { district: 'Wola' } });
  assert.deepEqual(fitted.records.map(record => record.id), ['multi', 'missing']);
  assert.equal(fitted.records[0].lat, nearby.locations[0].lat);
  assert.equal(fitted.response.narrowing.excluded.missingCoordinates, 0);
  assert.equal(fitted.response.narrowing.preserved.missingCoordinates, 1);
  assert.equal(fitted.response.narrowing.excluded.outsideRadius, 1);
  assert.equal(fitted.response.narrowing.appliedFilters.distance.unlocatedIncluded, true);
  assert.equal(nearby.lat, location.latitude + 30 / 111.195);
});

const pitch = index => normalizeRecord({
  'Nazwa placówki oświatowej': 'Szkoła Podstawowa ' + index,
  Dzielnica: index === 0 ? 'Wola' : 'Mokotów',
  'Adres obiektu': 'ul. Szkolna ' + index,
  'Typ obiektu': 'Boisko do piłki nożnej',
  'Rodzaj nawierzchni': 'Trawa syntetyczna',
  'Data aktualizacji': '2026-10-17', Sobota: '10:00–18:00',
}, 'pitch', now.toISOString());
const pitches = Array.from({ length: 1227 }, (_, index) => pitch(index));
const pitchEnvelope = records => ({ results: records, total: records.length, complete: true, dataMode: 'official',
  sources: [{ category: 'pitch', matched: records.length, fetched: records.length, complete: true }], errors: [] });

test('automatic distance keeps unlocated pitches alongside nearby events across categories', () => {
  const unlocated = { ...pitches[0], description: 'x'.repeat(50000) };
  const records = [event('near', '2026-10-17', 50000), unlocated, event('far', '2026-10-17', 130000, 40)];
  const fitted = fit(records, { location });
  assert.equal(fitted.response.status, 'automatically_narrowed');
  assert.deepEqual(fitted.records.map(record => record.id), ['near', unlocated.id]);
  assert.equal(fitted.response.narrowing.preserved.missingCoordinates, 1);
  assert.equal(fitted.response.narrowing.excluded.outsideRadius, 1);
  assert.equal(fitted.response.narrowing.appliedFilters.distance.unlocatedIncluded, true);
  assert.equal(fitted.records[1].lat, undefined);
});

for (const gps of [location, undefined]) test('1227 unlocated pitches require textual refinement without claiming an empty radius (GPS=' + Boolean(gps) + ')', () => {
  const original = pitchEnvelope(pitches);
  assert.ok(JSON.stringify(original).length > RESULT_LIMITS.toolCharacters);
  const fitted = fitResultBudget(original, { now, location: gps, filters: { category: 'pitch' } });
  assert.equal(fitted.response.status, 'refinement_required');
  assert.equal(fitted.response.total, 1227);
  assert.equal(fitted.response.narrowing.fallbackReason, 'missing_coordinates');
  assert.equal(fitted.response.narrowing.candidateTotal, 1227);
  assert.equal(fitted.response.narrowing.preserved.missingCoordinates, 1227);
  assert.equal(fitted.response.narrowing.excluded.missingCoordinates || 0, 0);
  assert.ok(fitted.response.narrowing.attempts.every(attempt => attempt.total === 1227));
  assert.match(fitted.response.message, /dzielnicę, nazwę, adres/);
  assert.deepEqual(original.results, pitches);
  assert.ok(JSON.stringify(fitted.response).length < 4000);
});

test('a small unlocated pitch set stays complete and can be displayed without pins', async () => {
  const original = pitchEnvelope(pitches.slice(0, 2));
  const fitted = fitResultBudget(original, { now, location });
  assert.equal(fitted.response, original);
  assert.equal(fitted.records, original.results);
  const state = { results: fitted.records, searchMeta: original, actions: [] };
  await runTool('display_results', { ids: fitted.records.map(record => record.id), highlightIds: [pitches[0].id], title: 'Boiska' }, state);
  assert.equal(state.actions[0].results.length, 2);
  assert.ok(state.actions[0].results.every(record => record.lat === undefined && record.lng === undefined));
});

test('an explicit bounds filter still excludes locations that cannot be verified inside it', async () => {
  const inside = { ...pitch(1227), lat: location.latitude, lng: location.longitude };
  const outside = { ...pitch(1228), lat: location.latitude + 1, lng: location.longitude };
  const state = { results: [pitches[0], inside, outside], searchMeta: pitchEnvelope([]), actions: [] };
  const result = await runTool('filter_results', { bounds: { south: 52.22, west: 21, north: 52.24, east: 21.02 } }, state);
  const fitted = fitResultBudget(result, { now, location });
  assert.deepEqual(fitted.records.map(record => record.id), [inside.id]);
});

test('a district follow-up recovers unlocated pitches from the retained full set without another fetch', async () => {
  let step = 0, searches = 0;
  const assistant = createAssistant({ now: () => now, provider: { search: async () => { searches++; return pitchEnvelope(pitches); } },
    completion: async history => {
      assert.equal(requestFits(history), true);
      if (++step === 1) return { tool_calls: [call('search_places', { category: 'pitch' })] };
      if (step === 2) {
        const result = JSON.parse(history.at(-1).content);
        assert.equal(result.narrowing.fallbackReason, 'missing_coordinates');
        assert.equal(result.total, 1227);
        return { content: 'W której dzielnicy szukasz boiska?' };
      }
      if (step === 3) return { tool_calls: [call('filter_results', { district: 'Wola' })] };
      if (step === 4) {
        const result = JSON.parse(history.at(-1).content);
        assert.deepEqual(result.results.map(record => record.id), [pitches[0].id]);
        assert.equal(result.results[0].address, 'ul. Szkolna 0');
        return { tool_calls: [call('display_results', { ids: [pitches[0].id], highlightIds: [pitches[0].id], title: 'Boisko na Woli' })] };
      }
      return { content: 'To boisko ma podany adres, ale nie ma punktu na mapie.' };
    } });
  const first = await assistant.chat({ message: 'Pokaż mi boiska', location });
  assert.deepEqual(first.actions, []);
  const next = await assistant.chat({ message: 'Na Woli', sessionId: first.sessionId, location });
  assert.equal(searches, 1);
  assert.deepEqual(next.actions[0].results.map(record => record.id), [pitches[0].id]);
  assert.equal(next.actions[0].results[0].lat, undefined);
});

for (const unavailable of [undefined, { ...location, freshness: 'stale' }, { ...location, freshness: 'unknown' },
  { ...location, source: 'central_warsaw' }]) test('no usable GPS gives an explicit bounded refinement response (' + unavailable?.freshness + ')', () => {
  const fitted = fit([event('huge', '2026-10-17', 150000)], { location: unavailable });
  assert.equal(fitted.response.status, 'refinement_required');
  assert.equal(fitted.response.recordsProvided, 0);
  assert.deepEqual(fitted.records, []);
  assert.equal(fitted.response.narrowing.fallbackReason, 'no_recent_user_location');
  assert.equal(fitted.response.narrowing.appliedFilters.distance, undefined);
  assert.ok(JSON.stringify(fitted.response).length < 4000);
});

test('a huge single record inside the smallest radius is never silently sliced or claimed visible', () => {
  const records = [event('huge', '2026-10-17', 200000)];
  const fitted = fit(records, { location });
  assert.equal(fitted.response.status, 'refinement_required');
  assert.equal(fitted.response.narrowing.fallbackReason, 'no_scope_fits');
  assert.equal(fitted.response.narrowing.candidateTotal, 1);
  assert.equal(fitted.response.narrowing.attempts.at(-1).radiusKm, 0.25);
  assert.equal(fitted.response.effectiveTotal, 0);
  assert.equal(records[0].description.length, 200000);
});

test('capacity measures actual escaped UTF-8 body, schemas and session overhead', () => {
  const messages = [{ role: 'tool', content: JSON.stringify({ results: [{ description: '😀"\\\n'.repeat(1000) }] }) }];
  const options = { sessionId: 'conversation', onEvent: true };
  const bytes = Buffer.byteLength(serializeBridgeRequest(messages, options));
  const chars = JSON.stringify(messages).length;
  assert.ok(bytes > chars);
  assert.equal(requestFits(messages, options, { requestBytes: bytes, messageCharacters: chars }), true);
  assert.equal(requestFits(messages, options, { requestBytes: bytes - 1, messageCharacters: chars }), false);
  assert.equal(requestFits(messages, options, { requestBytes: bytes, messageCharacters: chars - 1 }), false);
  const result = envelope([{ ...event('large-bytes', '2026-10-17', 0), description: '😀'.repeat(15000) }]);
  const limits = { ...RESULT_LIMITS, requestBytes: 50000 };
  const fitted = fitResultBudget(result, { now, limits });
  assert.equal(fitted.response.status, 'refinement_required');
  assert.equal(requestFits([{ role: 'tool', content: JSON.stringify(fitted.response) }], {}, limits), true);
});

test('old tool data is compacted only under pressure, preserving a complete small result', () => {
  const unchanged = [{ role: 'user', content: 'Pytanie' }, { role: 'tool', content: '{"total":1}' }];
  const prior = structuredClone(unchanged);
  assert.equal(compactHistory(unchanged), true);
  assert.deepEqual(unchanged, prior);
  const history = [{ role: 'assistant', tool_calls: [call('search_places', {})] },
    { role: 'tool', content: JSON.stringify({ results: [{ description: 'x'.repeat(690000) }], total: 1, complete: false, errors: [{ code: 'SOURCE_UNAVAILABLE' }] }) }];
  const small = envelope([event('future', '2026-11-10', 20000)]);
  const fitted = fitResultBudget(small, { history, now });
  assert.equal(fitted.response, small);
  assert.equal(JSON.parse(history[1].content).status, 'historical_context_compacted');
  assert.deepEqual(JSON.parse(history[1].content).errors, small.errors.map(() => ({ code: 'SOURCE_UNAVAILABLE' })));
});

test('assistant display IDs follow the effective set while next-turn filtering can recover retained full matches', async () => {
  const records = ['17', '18', '19', '25'].map(day => event(day, '2026-10-' + day));
  let step = 0, searches = 0;
  const assistant = createAssistant({ now: () => now, provider: { search: async () => { searches++; return envelope(records); } },
    completion: async history => {
      assert.equal(requestFits(history), true);
      step++;
      if (step === 1) return { tool_calls: [call('search_places', { category: 'event' })] };
      if (step === 2) {
        const result = JSON.parse(history.at(-1).content);
        assert.deepEqual(result.results.map(record => record.id), ['17', '18']);
        return { tool_calls: [call('display_results', { ids: ['25'], highlightIds: ['25'], title: 'Invalid' })] };
      }
      if (step === 3) {
        assert.ok(JSON.parse(history.at(-1).content).error);
        return { tool_calls: [call('display_results', { ids: ['17', '18'], highlightIds: ['17'], title: 'Dwa dni' })] };
      }
      if (step === 4) return { content: 'Zawęziłem wyniki do 17–18 października.' };
      if (step === 5) return { tool_calls: [call('filter_results', { dateFrom: '2026-10-25', dateTo: '2026-10-25' })] };
      if (step === 6) {
        assert.deepEqual(JSON.parse(history.at(-1).content).results.map(record => record.id), ['25']);
        return { tool_calls: [call('display_results', { ids: ['25'], highlightIds: ['25'], title: 'Później' })] };
      }
      return { content: 'Pokazuję wydarzenie 25 października.' };
    } });
  const first = await assistant.chat({ message: 'Wydarzenia' });
  assert.equal(first.actions.length, 1);
  assert.equal(first.actions[0].narrowing.originalTotal, 4);
  assert.equal(first.actions[0].narrowing.effectiveTotal, 2);
  assert.deepEqual(first.actions[0].errors, envelope([]).errors);
  const next = await assistant.chat({ message: 'Pokaż 25 października', sessionId: first.sessionId });
  assert.deepEqual(next.actions[0].results.map(record => record.id), ['25']);
  assert.equal(searches, 1);
});

test('multiple result calls in one round remain within serialized request capacity', async () => {
  let step = 0;
  const records = Array.from({ length: 2 }, (_, i) => event('e' + i, '2026-10-17', 55000));
  const assistant = createAssistant({ now: () => now, provider: { search: async () => envelope(records) },
    completion: async history => {
      assert.equal(requestFits(history), true);
      if (++step === 1) return { tool_calls: Array.from({ length: 8 }, () => call('search_places', { category: 'event' })) };
      const payloads = history.filter(message => message.role === 'tool').map(message => JSON.parse(message.content));
      assert.equal(payloads.length, 8);
      assert.ok(payloads.some(payload => payload.status === 'historical_context_compacted' || payload.status === 'refinement_required'));
      return { content: 'Wyniki są gotowe.' };
    } });
  await assistant.chat({ message: 'Szukaj' });
});

test('capacity pressure from an uncompactable tool-call history returns a normal clarification, never a bridge error', async () => {
  let completions = 0;
  const assistant = createAssistant({ now: () => now, completion: async () => {
    completions++;
    return { tool_calls: [call('search_places', { query: 'x'.repeat(800000) })] };
  } });
  const answer = await assistant.chat({ message: 'Szukaj' });
  assert.equal(completions, 1);
  assert.match(answer.message, /dzielnicę, temat lub daty/);
  assert.deepEqual(answer.actions, []);
});

test('automatic distance uses normalized current-turn GPS in the assistant, never a map-center fallback', async () => {
  let step = 0;
  const records = [0.1, 2.5, 7, 18].map((km, i) => event('e' + i, '2026-10-17', 50000, km));
  const assistant = createAssistant({ now: () => now, provider: { search: async () => envelope(records) }, completion: async history => {
    if (++step === 1) return { tool_calls: [call('search_places', {})] };
    const payload = JSON.parse(history.at(-1).content);
    assert.equal(payload.narrowing.appliedFilters.distance.radiusKm, 5);
    assert.equal(payload.narrowing.appliedFilters.distance.latitude, location.latitude);
    assert.deepEqual(payload.results.map(record => record.id), ['e0', 'e1']);
    return { content: 'Zawęziłem wydarzenia do dziś w promieniu 5 km od Twojej przybliżonej lokalizacji.' };
  } });
  await assistant.chat({ message: 'Wydarzenia', location: { ...location, source: 'untrusted-browser-label' } });
});

for (const publish of [true, false]) test('failed streamed turn restores effective and retained full sets together (published=' + publish + ')', async () => {
  let step = 0, searches = 0;
  const records = prefix => ['17', '18', '19', '25'].map(day => event(prefix + day, '2026-10-' + day));
  const sets = [records('old-'), records('new-'), records('unseen-')];
  const expected = publish ? 'new-' : 'old-';
  const assistant = createAssistant({ now: () => now, provider: { search: async () => envelope(sets[searches++]) }, completion: async history => {
    step++;
    if ([1, 4, 6].includes(step)) return { tool_calls: [call('search_places', {})] };
    if (step === 2) return { tool_calls: [call('display_results', { ids: ['old-17', 'old-18'], highlightIds: ['old-17'], title: 'Pierwsze' })] };
    if (step === 3) return { content: 'Pierwsze wyniki z dwóch dni.' };
    if (step === 5) return { tool_calls: [call(publish ? 'display_results' : 'focus_map', publish ?
      { ids: ['new-17', 'new-18'], highlightIds: ['new-17'], title: 'Nowe' } : { latitude: 52, longitude: 21, zoom: 12 })] };
    if (step === 7) throw new Error('Disconnected after an undisplayed search');
    if (step === 8) return { tool_calls: [call('filter_results', { dateFrom: '2026-10-25', dateTo: '2026-10-25' })] };
    if (step === 9) {
      assert.deepEqual(JSON.parse(history.at(-1).content).results.map(record => record.id), [expected + '25']);
      return { tool_calls: [call('display_results', { ids: [expected + '25'], highlightIds: [expected + '25'], title: 'Później' })] };
    }
    return { content: 'Wydarzenie z zachowanego pełnego zbioru.' };
  } });
  const first = await assistant.chat({ message: 'Szukaj' });
  const events = [];
  await assert.rejects(assistant.chat({ message: 'Szukaj ponownie', sessionId: first.sessionId }, undefined, event => events.push(event)), /Disconnected/);
  const result = await assistant.chat({ message: 'Pokaż 25 października', sessionId: first.sessionId });
  assert.deepEqual(result.actions[0].results.map(record => record.id), [expected + '25']);
  assert.deepEqual(result.actions[0].errors, envelope([]).errors);
});
