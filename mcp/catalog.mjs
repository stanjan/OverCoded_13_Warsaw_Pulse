import { createHash } from 'node:crypto';
import { SOURCES } from './sources.mjs';
export const normalize = value => String(value ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l');
const text = value => typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : '';
const names = value => Array.isArray(value) ? value.map(v => text(v?.name)).filter(Boolean) : [];
const finite = value => (typeof value === 'number' || (typeof value === 'string' && value.trim())) && Number.isFinite(Number(value)) ? Number(value) : null;
export function coordinates(lat, lng) {
  lat = finite(lat); lng = finite(lng);
  return lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}
const days = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'];
function date(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null; }
function list(value) { return Array.isArray(value) ? value : []; }
export function eventImage(raw) {
  const candidates = [raw.image?.small?.path, raw.image?.highlighted?.path];
  for (const value of candidates) {
    if (typeof value !== 'string' || !value.trim()) continue;
    try {
      const url = new URL(value, 'https://um.warszawa.pl');
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
      url.protocol = 'https:';
      return url.href;
    } catch {}
  }
  return null;
}
export class SourceError extends Error {
  constructor(code, category) { super(code); this.code = code; this.category = category; }
}
export function normalizeRecord(raw, category, fetchedAt) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SourceError('SOURCE_SCHEMA', category);
  const source = SOURCES[category];
  let name, description, districts = [], position, locations = [], dates = [], schedule = {}, observedAt = [], details = {};
  const features = list(raw.map?.features);
  if (category === 'event' || category === 'sports') {
    name = text(raw.title); description = text(raw.text || raw.lead);
    districts = [...new Set([...names(raw.localization), ...features.map(f => text(f.properties?.district)).filter(Boolean)])];
    locations = features.flatMap(f => { const p = f.geometry?.type === 'Point' ? coordinates(f.geometry.coordinates?.[1], f.geometry.coordinates?.[0]) : null; return p ? [{...p, district:text(f.properties?.district)}] : []; });
    position = locations[0];
    dates = category === 'event' ? list(raw.occurrence).map(o => ({ from: date(o.from), to: date(o.to || o.from), sourceFrom: o.from, sourceTo: o.to })).filter(o => o.from && o.to) : list(raw.date).map(d => ({ from: date(d), to: date(d) })).filter(o => o.from);
    details = { imageUrl: eventImage(raw), activities: names(raw.category), audience: names(raw.dedicated), weekdays: names(raw.day), time: text(raw.time), addresses: list(raw.address).map(a => [text(a.name), text(a.street)].filter(Boolean).join(', ')) };
  } else if (category === 'pitch') {
    name = text(raw['Nazwa placówki oświatowej']); districts = [text(raw.Dzielnica)].filter(Boolean);
    description = [raw['Typ obiektu'], raw['Boisk uniwersalne zawiera'], raw.Uwagi].map(text).filter(Boolean).join('. ');
    schedule = Object.fromEntries(days.filter(d => typeof raw[d] === 'string').map(d => [d, text(raw[d])]));
    details = { address: text(raw['Adres obiektu']), surface: text(raw['Rodzaj nawierzchni']), updatedAt: text(raw['Data aktualizacji']), schedule };
  } else if (category === 'route') {
    name = text(raw.title); description = text(raw.description);
    position = coordinates(raw.traces?.[0]?.[0], raw.traces?.[0]?.[1]);
    details = { lengthKm: finite(raw.length), touristPoints: list(raw.tourist_points).map(p => ({ name: text(p.name), ...coordinates(p.latlng?.lat, p.latlng?.lng) })) };
  } else if (category === 'weather') {
    name = text(raw.lokalizacja); position = coordinates(raw.lat, raw.lon); observedAt = [text(raw.czas)].filter(Boolean);
    details = { airTemperatureC: finite(raw.temp_pow), surfaceTemperatureC: finite(raw.temp_naw), humidityPercent: finite(raw.wilg_pow), windSpeed: finite(raw.pred_wiatru), windDirection: finite(raw.kier_wiatru), precipitationIntensity: finite(raw.int_opadu) };
    description = details.airTemperatureC === null ? 'Brak temperatury w źródle.' : 'Temperatura powietrza: ' + details.airTemperatureC + ' °C.';
  } else {
    name = text(raw.name); position = coordinates(raw.lat, raw.lon); districts = [text(raw.address?.district)].filter(Boolean);
    observedAt = list(raw.data).map(m => text(m.time)).filter(Boolean);
    details = { index: text(raw.ijp?.name), recommendations: text(raw.ijp?.recommendations), measurements: list(raw.data).map(m => ({ parameter: text(m.param_code), value: finite(m.value), unit: text(m.unit), observedAt: text(m.time), index: text(m.ijp?.name) })) };
    description = details.index || 'Brak indeksu w źródle.';
  }
  if (!name) throw new SourceError('SOURCE_SCHEMA', category);
  const sourceUrl = 'https://dane.um.warszawa.pl/pl/catalogue/' + source.id;
  const id = category + ':' + createHash('sha256').update(JSON.stringify(raw)).digest('hex').slice(0, 24);
  return { id, name, description, category, district: districts.join(', '), districts, ...(position || {}), dates, locations, ...details,
    source: source.title, sourceUrl, url: /^https?:\/\//.test(raw.url || '') ? raw.url : sourceUrl,
    live: false, dataMode: 'official', provenance: { datasetId: source.id, fetchedAt, observedAt: [...new Set(observedAt)], sourceUpdatedAt: details.updatedAt || null, timeZone: 'Europe/Warsaw', freshness: observedAt.length ? 'unverified_source_time' : 'unknown' } };
}
export function selectLocations(record, filters) {
  const locations = record.locations?.length ? record.locations : coordinates(record.lat, record.lng) ? [{lat:record.lat,lng:record.lng,district:record.district}] : [];
  return locations.filter(p => (!filters.district || normalize(p.district).includes(normalize(filters.district))) && (!filters.bounds || (p.lat >= filters.bounds.south && p.lat <= filters.bounds.north && p.lng >= filters.bounds.west && p.lng <= filters.bounds.east)));
}
export function locate(record,filters) {
  const position = selectLocations(record,filters)[0];
  return position ? {...record,lat:position.lat,lng:position.lng} : record;
}
export function matches(record, filters) {
  if (filters.query && !normalize(JSON.stringify(record)).includes(normalize(filters.query))) return false;
  if (filters.category && record.category !== filters.category) return false;
  if (filters.district && !(record.districts || [record.district]).some(d => normalize(d).includes(normalize(filters.district)))) return false;
  if (filters.activity && !(record.activities || [record.description]).some(a => normalize(a).includes(normalize(filters.activity)))) return false;
  if (filters.audience && !(record.audience || []).some(a => normalize(a).includes(normalize(filters.audience)))) return false;
  if (filters.weekday && !(record.weekdays || Object.entries(record.schedule || {}).filter(([,hours]) => /\d{1,2}[:.]\d{2}/.test(hours) && !/zamkni|nieczyn|niedost/.test(normalize(hours))).map(([day])=>day)).some(d => normalize(d) === normalize(filters.weekday))) return false;
  if (filters.dateFrom || filters.dateTo) {
    const from = filters.dateFrom || '0000-01-01', to = filters.dateTo || '9999-12-31';
    // Undated recurring sports stay undated. A weekday filter can independently find these.
    if (!(record.dates || []).some(d => d.from <= to && d.to >= from)) return false;
  }
  if ((filters.bounds || (filters.district && record.locations?.length)) && !selectLocations(record,filters).length) return false;
  if (filters.maxLengthKm !== undefined && (record.lengthKm === null || record.lengthKm === undefined || record.lengthKm > filters.maxLengthKm)) return false;
  return true;
}
export function createCatalog({ fetchImpl = fetch, token = () => process.env.DATA_API_KEY, now = () => new Date().toISOString(), timeoutMs = 15000 } = {}) {
  return { async search(filters = {}) {
    const categories = filters.category ? [filters.category] : Object.keys(SOURCES);
    const results = [], sources = [], errors = [];
    for (const category of categories) {
      const source = SOURCES[category]; if (!source) throw new SourceError('INVALID_CATEGORY', category);
      try {
        const key = token(); if (!key) throw new SourceError('SOURCE_NOT_CONFIGURED', category);
        let response, payload;
        try { response = await fetchImpl('https://dane.um.warszawa.pl/api/action/' + source.action, { method: 'POST', headers: { Authorization: key, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' }); }
        catch { throw new SourceError('SOURCE_UNAVAILABLE', category); }
        if (!response.ok) throw new SourceError(response.status === 401 || response.status === 403 ? 'SOURCE_AUTH' : 'SOURCE_HTTP_' + response.status, category);
        try { payload = await response.json(); } catch { throw new SourceError('SOURCE_SCHEMA', category); }
        // These six endpoints document full datasets, no page/limit parameters.
        // Routes alone wrap their entire array in result. Unknown envelopes fail closed.
        const rows = Array.isArray(payload) ? payload : category === 'route' && payload && Object.keys(payload).length === 1 && Array.isArray(payload.result) ? payload.result : null;
        if (!rows) throw new SourceError('SOURCE_SCHEMA_OR_PAGINATION_CHANGED', category);
        const fetchedAt = now(), normalized = rows.map(row => normalizeRecord(row, category, fetchedAt));
        const matched = normalized.filter(r => matches(r, filters)).map(r => locate(r,filters));
        results.push(...matched);
        sources.push({ category, datasetId: source.id, sourceUrl: 'https://dane.um.warszawa.pl/pl/catalogue/' + source.id, fetchedAt, fetched: rows.length, matched: matched.length, complete: true, pagination: 'full_dataset_response' });
      } catch (error) { errors.push({ category, code: error instanceof SourceError ? error.code : 'SOURCE_SCHEMA', message: source.title + ': źródło niedostępne lub niezgodne; brak wyników nie oznacza pustego katalogu.' }); }
    }
    return { results, total: results.length, complete: errors.length === 0, dataMode: 'official', sources, errors,
      notice: 'Dane miejskie z oznaczeniem czasu źródłowego; pobranie nie potwierdza aktualności. Brakujące daty, współrzędne i cechy nie są zgadywane.' };
  } };
}
export const catalogProvider = createCatalog();
