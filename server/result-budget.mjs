import { selectLocations } from '../mcp/catalog.mjs';
import { toolDefinitions } from './tools.mjs';
import { touristHighlightIds } from '../mcp/tourism.mjs';

// Keep headroom for the model's next tool call and final answer. Limits apply
// to the real escaped request, including schemas and UTF-8 encoding.
export const RESULT_LIMITS = Object.freeze({ toolCharacters: 120000, messageCharacters: 700000, requestBytes: 1400000 });
export const BRIDGE_LIMITS = Object.freeze({ messageCharacters: 1000000, requestBytes: 2 * 1024 * 1024 });
export function serializeBridgeRequest(messages, { onEvent, sessionId } = {}) {
  return JSON.stringify({
    ...(process.env.CODEX_BRIDGE_MODEL?.trim() ? { model: process.env.CODEX_BRIDGE_MODEL.trim() } : {}),
    messages, tools: toolDefinitions, tool_choice: 'auto', stream: Boolean(onEvent), bridge_session_id: sessionId,
  });
}
export function requestFits(messages, options = {}, limits = RESULT_LIMITS) {
  return JSON.stringify(messages).length <= limits.messageCharacters &&
    Buffer.byteLength(serializeBridgeRequest(messages, options)) <= limits.requestBytes;
}
function toolFits(result, { history, toolCallId, requestOptions, limits }) {
  const content = JSON.stringify(result);
  return content.length <= limits.toolCharacters &&
    requestFits([...history, { role: 'tool', tool_call_id: toolCallId, content }], requestOptions, limits);
}
export function warsawDate(now) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function addDays(day, count) {
  return new Date(Date.parse(day + 'T12:00:00Z') + count * 86400000).toISOString().slice(0, 10);
}
function categoryCounts(records) {
  const counts = {};
  for (const record of records) counts[record.category] = (counts[record.category] || 0) + 1;
  return counts;
}
function datedIn(record, from, to) {
  return (record.dates || []).some(d => typeof d.from === 'string' && typeof d.to === 'string' && d.from <= to && d.to >= from);
}
export function distanceKm(latitude, longitude, lat, lng) {
  const radians = degrees => degrees * Math.PI / 180;
  const a = Math.sin(radians(lat - latitude) / 2) ** 2 +
    Math.cos(radians(latitude)) * Math.cos(radians(lat)) * Math.sin(radians(lng - longitude) / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}
function withinRadius(records, location, radiusKm, filters) {
  const kept = [];
  let missingCoordinates = 0;
  for (const record of records) {
    const points = selectLocations(record, filters);
    // An automatic radius may exclude a measured distant point, but cannot
    // establish that an unlocated record is distant. Keep it for assessment.
    if (!points.length) { missingCoordinates++; kept.push(record); continue; }
    const nearest = points.map(point => ({ ...point, distance: distanceKm(location.latitude, location.longitude, point.lat, point.lng) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearest.distance <= radiusKm) kept.push({ ...record, lat: nearest.lat, lng: nearest.lng });
  }
  return { records: kept, missingCoordinates, outsideRadius: records.length - kept.length };
}
function sourceCounts(sources, counts) {
  return sources?.map(source => ({ ...source, matchedBeforeNarrowing: source.matched, matched: counts[source.category] || 0 }));
}

const categoryLabels = { event: 'wydarzenia', sports: 'zajęcia sportowe', pitch: 'boiska', route: 'trasy rekreacyjne', toilet: 'toalety', aed: 'defibrylatory AED' };
function refinementExamples(records) {
  const values = key => {
    const counts = new Map();
    for (const record of records) for (const value of record[key] || []) {
      if (typeof value === 'string' && value.trim() && value.length <= 80) counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pl')).slice(0, 6).map(([value]) => value);
  };
  return { categories: [...new Set(records.map(record => record.category))].map(value => ({ value, label: categoryLabels[value] || value })),
    activities: values('activities'), districts: values('districts') };
}

// Only the model's copy is projected when a single record is too large. The
// selected original records (including descriptions, dates and provenance)
// remain available to cards and subsequent manual filtering on the server.
function projectRecord(record, browser = false) {
  const short = (value, length = 500) => typeof value === 'string' ? value.slice(0, length) : value;
  const list = (value, count = 8) => Array.isArray(value) ? value.slice(0, count).map(item => short(item)) : undefined;
  return Object.fromEntries(Object.entries({
    id: record.id, name: short(record.name), category: record.category, description: short(record.description, 1500),
    lat: record.lat, lng: record.lng, district: short(record.district), districts: list(record.districts),
    address: short(record.address), addresses: list(record.addresses), activities: list(record.activities), audience: list(record.audience),
    dates: record.dates?.slice(0, 12).map(date => Object.fromEntries(Object.entries({ from: short(date.from, 80), to: short(date.to, 80),
      sourceFrom: short(date.sourceFrom, 80), sourceTo: short(date.sourceTo, 80) }).filter(([, value]) => value !== undefined))),
    time: short(record.time), weekdays: list(record.weekdays), source: short(record.source),
    imageUrl: typeof record.imageUrl === 'string' && record.imageUrl.length <= 2000 ? record.imageUrl : undefined,
    paid: record.paid, accessible: record.accessible, changingTable: record.changingTable,
    openingHours: short(record.openingHours), toiletType: short(record.toiletType), operator: short(record.operator),
    updatedAt: short(record.updatedAt), surface: short(record.surface), lengthKm: record.lengthKm,
    ...(record.category === 'aed' ? { aedId: short(record.aedId), availability: short(record.availability), publicAccess: short(record.publicAccess), deviceLocation: short(record.deviceLocation), locationDescription: short(record.locationDescription), manufacturer: short(record.manufacturer), city: short(record.city), postcode: short(record.postcode) } : {}),
    ...(record.category === 'route' ? { geometryStatus: record.geometryStatus, traceVertexCount: record.traceVertexCount,
      ...(browser ? { traceSegments: record.traceSegments, touristPoints: record.touristPoints } : {}) } : {}),
    schedule: record.schedule && Object.fromEntries(Object.entries(record.schedule).slice(0, 7).map(([day, hours]) => [day, short(hours)])),
    sourceUrl: typeof record.sourceUrl === 'string' && record.sourceUrl.length <= 2000 ? record.sourceUrl : undefined,
    url: typeof record.url === 'string' && record.url.length <= 2000 ? record.url : undefined,
    dataMode: record.dataMode, live: record.live,
    provenance: record.provenance && { datasetId: short(record.provenance.datasetId), fetchedAt: short(record.provenance.fetchedAt, 80),
      sourceUpdatedAt: short(record.provenance.sourceUpdatedAt, 80), freshness: short(record.provenance.freshness), timeZone: short(record.provenance.timeZone, 80) },
  }).filter(([, value]) => value !== undefined));
}

export function boundDisplayAction(action) {
  if (action.type !== 'display_results') return action;
  action.highlightIds=touristHighlightIds(action.results,action.highlightIds);
  action.highlights=action.highlightIds.map(id=>action.results.find(record=>record.id===id));
  if (JSON.stringify(action).length <= 250000) return action;
  // Full descriptions can be megabytes even when the model's copy fits. Keep
  // the browser's SSE frame bounded too, without altering retained originals.
  action.results = action.results.map(record => projectRecord(record, true));
  // Unusually large future feeds remain bounded without drawing truncated paths.
  for (const record of [...action.results].sort((a,b) => (b.traceVertexCount || 0) - (a.traceVertexCount || 0))) {
    if (JSON.stringify(action.results).length <= 110000) break;
    if (record.traceSegments?.length) { record.traceSegments = []; record.geometryStatus = 'browser_capacity'; }
    if (JSON.stringify(action.results).length > 110000 && record.touristPoints?.length) { record.touristPoints = []; record.geometryStatus = 'browser_capacity'; }
  }
  const byId = new Map(action.results.map(record => [record.id, record]));
  action.highlights = action.highlightIds.map(id => byId.get(id));
  action.displayProjection = { reason: 'conversation_capacity', fieldsProjected: true, originalRecordsRetained: true };
  return action;
}

// Complete scopes are preferred. If none fits, disclose a bounded preview.
// The caller retains the original records independently of this effective set.
export function fitResultBudget(result, options = {}) {
  if (!result.results.some(record => record.category === 'route' && record.traceSegments)) return fitModelResultBudget(result, options);
  const originals = new Map(result.results.map(record => [record.id, record]));
  const modelResults = result.results.map(record => {
    if (record.category !== 'route') return record;
    const { traceSegments, ...summary } = record; return summary;
  });
  const fitted = fitModelResultBudget({ ...result, results: modelResults }, options);
  return { ...fitted, records: fitted.records.map(record => {
    const original=originals.get(record.id);
    return record.lat === original.lat && record.lng === original.lng ? original : { ...original, lat: record.lat, lng: record.lng };
  }) };
}
function fitModelResultBudget(result, {
  history = [], toolCallId, now = new Date(), location, filters = {}, requestOptions = {}, limits = RESULT_LIMITS,
} = {}) {
  const context = { history, toolCallId, requestOptions, limits };
  if (toolFits(result, context)) return { response: result, records: result.results };
  // A small complete set should not lose dates merely because old tool
  // payloads occupy the conversation. Reclaim historical data first.
  const content = JSON.stringify(result);
  if (content.length <= limits.toolCharacters) {
    compactHistory(history, requestOptions, limits, [{ role: 'tool', tool_call_id: toolCallId, content }]);
    if (toolFits(result, context)) return { response: result, records: result.results };
  }
  const original = result.results;
  // Alternative categories have independent date/length scopes. Do not apply
  // a shared automatic date/radius that could erase a whole category.
  const varied = Array.isArray(filters.alternatives);
  const filtersFor = record => varied ? filters.alternatives.find(item => item.category === record.category) || {} : filters;
  const originalTotal = original.length, countsByCategory = categoryCounts(original);
  const attempts = [];
  let records = original, applied = { requested: filters }, excluded = {}, preserved = {};
  const envelope = candidate => {
    const counts = categoryCounts(candidate);
    return {
      ...result, status: 'automatically_narrowed', results: candidate, total: candidate.length,
      sources: sourceCounts(result.sources, counts),
      narrowing: { reason: 'conversation_capacity', originalTotal, effectiveTotal: candidate.length,
        appliedFilters: applied, excluded, preserved, attempts, allMatchingRecordsProvided: true },
    };
  };
  const attempt = scope => {
    // Include the attempt itself in the serialized budget measurement.
    const entry = { ...scope, total: records.length };
    attempts.push(entry);
    const response = envelope(records);
    // An empty automatic scope says nothing about the original matches.
    if (records.length && toolFits(response, context)) return { response, records };
    return null;
  };
  if (!varied && original.some(record => record.category === 'event')) {
    const today = warsawDate(now);
    // An explicit future/past trip is anchored to its requested date, never
    // silently replaced with today. dateTo-only requests remain within that cap.
    const anchor = filters.dateFrom || (filters.dateTo && filters.dateTo < today ? filters.dateTo : today);
    const seen = new Set();
    for (const days of [3, 2, 1]) {
      const to = filters.dateTo && filters.dateTo < addDays(anchor, days - 1) ? filters.dateTo : addDays(anchor, days - 1);
      const key = anchor + '/' + to;
      if (seen.has(key)) continue;
      seen.add(key);
      records = original.filter(record => record.category !== 'event' || datedIn(record, anchor, to));
      const events = original.filter(record => record.category === 'event');
      const unknownEventDate = events.filter(record => !(record.dates || []).length).length;
      excluded = { unknownEventDate, outsideDateWindow: original.length - records.length - unknownEventDate };
      applied = { requested: filters, eventDate: { from: anchor, to, timeZone: 'Europe/Warsaw' } };
      const fitted = attempt({ dateFrom: anchor, dateTo: to });
      if (fitted) return fitted;
    }
  }
  const knownLocation = location?.status === 'available' &&
    location.source === 'browser_geolocation' && Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90 && Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180;
  if (knownLocation && !varied) {
    // Spatial narrowing starts from the entire requested date/audience scope,
    // rather than inheriting the last failed one-day trial.
    const dated = original;
    applied = { requested: filters }; excluded = {}; preserved = {};
    for (const radiusKm of [25, 10, 5, 2, 1, 0.5, 0.25]) {
      const nearby = withinRadius(dated, location, radiusKm, filters);
      records = nearby.records;
      excluded = { ...excluded, missingCoordinates: 0, outsideRadius: nearby.outsideRadius };
      preserved = { missingCoordinates: nearby.missingCoordinates };
      applied = { ...applied, distance: { radiusKm, basis: 'browser_geolocation', latitude: location.latitude,
        longitude: location.longitude, accuracyMeters: location.accuracy ?? null, observedAt: location.observedAt ?? null,
        positionBasis: 'last_known_location', freshness: location.freshness || 'unknown',
        unlocatedIncluded: nearby.missingCoordinates > 0 } };
      const fitted = attempt({ radiusKm });
      if (fitted) return fitted;
    }
  }
  // Return to the original user-filtered set: failed automatic dates/radii
  // must never hide every real match. GPS orders known positions nearest first;
  // unlocated records remain eligible but never acquire an invented distance.
  let ranked = original.map((record, index) => {
    const nearest = knownLocation ? selectLocations(record, filtersFor(record)).map(point => ({ ...point,
      distance: distanceKm(location.latitude, location.longitude, point.lat, point.lng) })).sort((a, b) => a.distance - b.distance)[0] : null;
    return { record: nearest ? { ...record, lat: nearest.lat, lng: nearest.lng } : record, index, distance: nearest?.distance ?? Infinity };
  }).sort((a, b) => a.distance - b.distance || a.index - b.index);
  // Keep nearest/source order within each category while giving each a turn.
  if (varied) {
    const queues = filters.alternatives.map(filters => ranked.filter(item => item.record.category === filters.category));
    ranked = [];
    while (queues.some(queue => queue.length)) for (const queue of queues) if (queue.length) ranked.push(queue.shift());
  }
  const suggestions = refinementExamples(original);
  const missingCoordinates = original.filter(record => !selectLocations(record, filters).length).length;
  const preview = (selected, projected = false) => ({
    ...result, status: 'preview', total: selected.length, originalTotal, recordsProvided: selected.length,
    results: selected.map(item => projected ? projectRecord(item.record) : item.record), countsByCategory,
    sources: sourceCounts(result.sources, categoryCounts(selected.map(item => item.record))),
    suggestedRefinements: suggestions,
    narrowing: { reason: 'conversation_capacity', preview: true, originalTotal, effectiveTotal: selected.length,
      candidateTotal: originalTotal, appliedFilters: { requested: filters }, attempts,
      selection: varied ? 'category_balanced_examples' : knownLocation && ranked.some(item => Number.isFinite(item.distance)) ? 'nearest_known_locations_first' : 'source_order',
      ...(knownLocation ? { positionBasis: 'last_known_location', observedAt: location.observedAt ?? null, accuracyMeters: location.accuracy ?? null,
        freshness: location.freshness || 'unknown' } : {}),
      farthestKnownDistanceKm: selected.reduce((distance, item) => Number.isFinite(item.distance) ? Math.max(distance ?? 0, item.distance) : distance, null),
      excluded: { notInPreview: originalTotal - selected.length, missingCoordinates: 0 }, preserved: { missingCoordinates },
      allMatchingRecordsProvided: selected.length === originalTotal, fieldsProjected: projected,
      fallbackReason: missingCoordinates === originalTotal ? 'missing_coordinates' : knownLocation ? 'no_scope_fits' : 'no_user_location' },
    message: 'To jawny podgląd rzeczywistych dopasowań, nie pełny zbiór ani ranking najlepszych. Pokaż te przykłady na mapie i liście przez display_results, potem krótko zapytaj o preferencje z przykładami z suggestedRefinements. Pełny pierwotny zbiór pozostaje na serwerze do filter_results. Brak współrzędnych oznacza listę bez pinezki i nieznaną odległość. Nie twierdź, że nic nie pominięto.',
  });
  // The largest fitting prefix has an explicit count and deterministic order.
  // If even its first full record is huge, use a disclosed bounded model copy.
  for (const projected of varied ? [true] : [false, true]) {
    const first = preview(ranked.slice(0, 1), projected);
    compactHistory(history, requestOptions, limits, [{ role: 'tool', tool_call_id: toolCallId, content: JSON.stringify(first) }]);
    if (!toolFits(first, context)) continue;
    let low = 1, high = ranked.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (toolFits(preview(ranked.slice(0, middle), projected), context)) low = middle; else high = middle - 1;
    }
    const selected = ranked.slice(0, low);
    return { response: preview(selected, projected), records: selected.map(item => item.record) };
  }
  // Only an already exhausted request envelope can reach this branch; never
  // misrepresent it as no matching records or a successful empty radius.
  return { records: [], response: { status: 'refinement_required', total: originalTotal, originalTotal, recordsProvided: 0,
    complete: result.complete, dataMode: result.dataMode, errors: result.errors || [],
    message: 'Brak miejsca nawet na pojedynczy podgląd w tej rozmowie. Rozpocznij nową rozmowę; pasujące dane istnieją.' } };
}

// Preserve normal CLI conversation prefixes exactly. Only when capacity is at
// risk, explicitly replace old tool payloads with bounded historical summaries;
// current effective records continue to live in server state.
export function compactHistory(history, requestOptions = {}, limits = RESULT_LIMITS, additionalMessages = []) {
  const fits = () => requestFits([...history, ...additionalMessages], requestOptions, limits);
  if (fits()) return true;
  for (let index = 0; index < history.length; index++) {
    const message = history[index];
    if (message.role !== 'tool' || typeof message.content !== 'string' || message.content.length < 2000) continue;
    let payload; try { payload = JSON.parse(message.content); } catch { payload = {}; }
    history[index] = { ...message, content: JSON.stringify({
      status: 'historical_context_compacted', total: payload.total, complete: payload.complete,
      errors: payload.errors || [], narrowing: payload.narrowing,
      message: 'Historyczna treść narzędzia została pominięta ze względu na pojemność rozmowy. To nie są bieżące rekordy do rekomendacji. Użyj filter_results lub nowego wyszukiwania, aby otrzymać aktualny zbiór.',
    }) };
    if (fits()) return true;
  }
  return fits();
}
