import { selectLocations } from '../mcp/catalog.mjs';
import { toolDefinitions } from './tools.mjs';

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

// No top-N truncation. Every record that matches each disclosed scope is sent.
// The caller retains the original records independently of this effective set.
export function fitResultBudget(result, {
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
    if (toolFits(response, context)) return { response, records };
    return null;
  };
  if (original.some(record => record.category === 'event')) {
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
  const freshLocation = location?.status === 'available' && location.freshness === 'recent' &&
    location.source === 'browser_geolocation' && Number.isFinite(location.latitude) && Number.isFinite(location.longitude);
  if (freshLocation) {
    const dated = records;
    for (const radiusKm of [25, 10, 5, 2, 1, 0.5, 0.25]) {
      const nearby = withinRadius(dated, location, radiusKm, filters);
      records = nearby.records;
      excluded = { ...excluded, missingCoordinates: 0, outsideRadius: nearby.outsideRadius };
      preserved = { missingCoordinates: nearby.missingCoordinates };
      applied = { ...applied, distance: { radiusKm, basis: 'browser_geolocation', latitude: location.latitude,
        longitude: location.longitude, accuracyMeters: location.accuracy, observedAt: location.observedAt,
        unlocatedIncluded: nearby.missingCoordinates > 0 } };
      const fitted = attempt({ radiusKm });
      if (fitted) return fitted;
    }
  }
  const missingCoordinates = records.filter(record => !selectLocations(record, filters).length).length;
  if (missingCoordinates) preserved = { missingCoordinates };
  return {
    records: [],
    response: {
      status: 'refinement_required', total: originalTotal, originalTotal, effectiveTotal: 0, recordsProvided: 0,
      complete: result.complete, dataMode: result.dataMode, errors: result.errors || [], sources: result.sources || [],
      countsByCategory,
      narrowing: { reason: 'conversation_capacity', originalTotal, effectiveTotal: 0, candidateTotal: records.length,
        appliedFilters: applied, excluded, preserved, attempts, allMatchingRecordsProvided: false,
        fallbackReason: missingCoordinates ? 'missing_coordinates' : freshLocation ? 'no_scope_fits' : 'no_recent_user_location' },
      message: missingCoordinates
        ? 'Zbiór jest zbyt duży do oceny w rozmowie, a ' + missingCoordinates + ' rekordów nie ma współrzędnych. Nie odrzucono ich z tego powodu ani nie potwierdzono ich odległości. Pełny zbiór pozostaje na serwerze. Poproś o dzielnicę, nazwę, adres lub rodzaj aktywności i użyj filter_results; nie pokazuj pustej listy ani nie rekomenduj niewidzianych rekordów.'
        : 'Automatyczne zawężanie nie dało zbioru mieszczącego się w rozmowie. Pełny zbiór pozostaje na serwerze; żadne rekordy nie zostały przekazane do oceny. Poproś o dzielnicę, temat lub węższe daty; przy braku świeżej lokalizacji można też poprosić o jej udostępnienie. Nie rekomenduj niewidzianych rekordów.',
    },
  };
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
