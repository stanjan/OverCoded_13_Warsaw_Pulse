import { randomUUID } from 'node:crypto';
import { normalize } from './catalog.mjs';

export const ADDRESS_SOURCE = Object.freeze({ name: 'GUGiK UUG', url: 'https://services.gugik.gov.pl/uug/', documentation: 'https://services.gugik.gov.pl/uug/opis.html', crs: 'EPSG:4326' });
export const ADDRESS_TTL_MS = 10 * 60 * 1000;
const MAX_BYTES = 256 * 1024;
const plain = value => typeof value === 'string' && value.length <= 200 && !/[<>\u0000-\u001f]/u.test(value) ? value.replace(/\s+/g, ' ').trim() : '';
const streetKey = value => normalize(value).trim().replace(/^(?:ulica|ul\.?|aleja|aleje|al\.?|plac|pl\.?)\s+/u, '').replace(/[.]/g, '').replace(/\s+/g, ' ').trim();
const numberKey = value => normalize(value).replace(/\s+/g, '');
const numeric = value => typeof value === 'number' || typeof value === 'string' && value.trim() ? Number(value) : NaN;

export class AddressError extends Error {
  constructor(code) { super('Nie udało się zweryfikować adresu w GUGiK. Spróbuj ponownie lub podaj przystanek.'); this.code = code; }
}
export function addressRequest({ street, number, city = 'Warszawa' }) {
  street = plain(street); city = plain(city); number = plain(number);
  if (!streetKey(street) || !/^\d{1,6}[a-z]?(?:[/-]\d{1,6}[a-z]?)?$/iu.test(numberKey(number)) || normalize(city) !== 'warszawa') throw new AddressError('ADDRESS_QUERY_INVALID');
  return { street, number: number.replace(/\s+/g, ''), city: 'Warszawa' };
}
export const addressQueryKey = query => [normalize(query.city), streetKey(query.street), numberKey(query.number)].join('|');

async function readJson(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES || !response.body) throw new AddressError('ADDRESS_RESPONSE_INVALID');
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > MAX_BYTES) throw new AddressError('ADDRESS_RESPONSE_TOO_LARGE');
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new AddressError('ADDRESS_RESPONSE_INVALID'); }
}

// No persistent cache: each search verifies a building against the official UUG.
export function createAddressProvider({ fetchImpl = fetch, now = () => Date.now(), timeoutMs = 10000 } = {}) {
  return { async search(args) {
    const query = addressRequest(args);
    const url = new URL(ADDRESS_SOURCE.url);
    url.search = new URLSearchParams({ request: 'GetAddress', address: `${query.city}, ${query.street} ${query.number}`, exact_number: '1', srid: '4326' });
    let payload;
    try {
      const response = await fetchImpl(url.href, { headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new AddressError('ADDRESS_SOURCE_UNAVAILABLE');
      payload = await readJson(response);
    } catch (error) { throw error instanceof AddressError ? error : new AddressError('ADDRESS_SOURCE_UNAVAILABLE'); }
    const count = payload?.['returned objects'];
    if (payload?.type !== 'address' || !Number.isInteger(count) || count < 0 || count > 15 ||
      (payload.results !== null && (!payload.results || typeof payload.results !== 'object' || Array.isArray(payload.results))) ||
      Object.keys(payload.results || {}).length !== count) throw new AddressError('ADDRESS_RESPONSE_INVALID');
    const fetchedAt = new Date(now()).toISOString(), unique = new Map();
    for (const raw of Object.values(payload.results || {})) {
      if (!raw || typeof raw !== 'object') throw new AddressError('ADDRESS_RESPONSE_INVALID');
      const city = plain(raw.city), street = plain(raw.street), number = plain(raw.number);
      const longitude = numeric(raw.x), latitude = numeric(raw.y);
      if (!city || !street || !number || !Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new AddressError('ADDRESS_RESPONSE_INVALID');
      if (normalize(city) !== 'warszawa') continue;
      // x=longitude, y=latitude with requested srid=4326. Reject axis swaps,
      // projected coordinates and points outside the Warsaw region.
      if (latitude < 51.9 || latitude > 52.5 || longitude < 20.5 || longitude > 21.5) throw new AddressError('ADDRESS_RESPONSE_INVALID');
      const exact = streetKey(street) === streetKey(query.street) && numberKey(number) === numberKey(query.number);
      const label = `${street} ${number}, ${city}`;
      const key = [normalize(city), streetKey(street), numberKey(number), latitude, longitude].join('|');
      unique.set(key, { id: `address-${randomUUID()}`, label, city, street, number, latitude, longitude, match: exact ? 'exact' : 'approximate',
        provenance: { ...ADDRESS_SOURCE, fetchedAt } });
    }
    const candidates = [...unique.values()], exact = candidates.filter(c => c.match === 'exact');
    return { status: exact.length === 1 ? 'exact_match' : candidates.length ? 'clarification_required' : 'not_found', query, candidates,
      ...(exact.length === 1 ? { addressId: exact[0].id } : {}), returned: candidates.length, source: { ...ADDRESS_SOURCE, fetchedAt },
      message: exact.length === 1 ? 'Znaleziono dokładny adres; użyj addressId w plan_transit.' : candidates.length ? 'Poproś o doprecyzowanie. Przybliżone ulice lub numery wymagają potwierdzenia użytkownika i nowego dokładnego wyszukania; nie wyznaczaj do nich trasy.' : 'Brak zweryfikowanego numeru budynku. Poproś o poprawienie ulicy lub numeru; nie zastępuj ich środkiem ulicy.' };
  } };
}
export const addressProvider = createAddressProvider();

export function retainedAddresses(state, now = Date.now()) {
  return (state.addressSearches || []).filter(set => Number.isFinite(set.expiresAt) && set.expiresAt > now).slice(-4);
}
export function addressWaypoint(id, state) {
  const candidate = retainedAddresses(state).flatMap(set => set.candidates).find(item => item.id === id && item.match === 'exact');
  if (!candidate) throw new AddressError('ADDRESS_ID_INVALID_OR_EXPIRED');
  return { latitude: candidate.latitude, longitude: candidate.longitude, label: candidate.label };
}
