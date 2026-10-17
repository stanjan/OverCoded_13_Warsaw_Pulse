const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
export const CENTRAL_WARSAW = Object.freeze({ latitude: 52.2318, longitude: 21.006 });
export class EnvironmentError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const finite = value => typeof value === 'number' && Number.isFinite(value);
const value = number => finite(number) ? number : null;
const instant = seconds => finite(seconds) && seconds > 0 && seconds < 8640000000000 ? new Date(seconds * 1000).toISOString() : null;
const dateInWarsaw = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
function point(input) {
  if (!input || input.status === 'unavailable') return { ...CENTRAL_WARSAW, basis: 'central_warsaw' };
  const { latitude, longitude } = input;
  if (!finite(latitude) || !finite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new EnvironmentError('Nieprawidłowe współrzędne lokalizacji.');
  return { latitude, longitude, basis: 'gps', positionBasis: 'last_known_location', observedAt: input.observedAt ?? null, freshness: input.freshness || 'unknown' };
}
const sources = {
  weather: { name: 'Open-Meteo', url: 'https://open-meteo.com/en/docs', kind: 'weather_model' },
  air: { name: 'Open-Meteo · CAMS ENSEMBLE', url: 'https://open-meteo.com/en/docs/air-quality-api', kind: 'air_quality_model', attributionUrl: 'https://confluence.ecmwf.int/display/CKB/CAMS+Regional%3A+European+air+quality+analysis+and+forecast+data+documentation' }
};
function metadata(data, source, fetchedAt, validAt) {
  const age = validAt ? Date.parse(fetchedAt) - Date.parse(validAt) : null;
  return { source, fetchedAt, validAt, freshness: age === null ? 'unknown' : age > 2 * 3600000 || age < -3600000 ? 'stale' : 'current', grid: { latitude: value(data.latitude), longitude: value(data.longitude) } };
}
function weather(data, fetchedAt) {
  const current = data.current || {};
  const temperatureC = data.current_units?.temperature_2m === '°C' ? value(current.temperature_2m) : null;
  const weatherCode = Number.isInteger(current.weather_code) ? current.weather_code : null;
  const validAt = instant(current.time);
  return { ...metadata(data, sources.weather, fetchedAt, validAt), status: temperatureC !== null && weatherCode !== null && validAt ? 'ok' : temperatureC !== null || weatherCode !== null ? 'partial' : 'unavailable', temperatureC, weatherCode, isDay: current.is_day === 1 ? true : current.is_day === 0 ? false : null };
}
function sun(data, fetchedAt, now) {
  const daily = data.daily || {}, date = dateInWarsaw(now);
  const index = Array.isArray(daily.time) ? daily.time.findIndex(time => instant(time) && dateInWarsaw(new Date(time * 1000)) === date) : -1;
  const sunrise = index >= 0 ? instant(daily.sunrise?.[index]) : null;
  const sunset = index >= 0 ? instant(daily.sunset?.[index]) : null;
  return { source: sources.weather, fetchedAt, date, timeZone: 'Europe/Warsaw', status: sunrise && sunset ? 'ok' : sunrise || sunset ? 'partial' : 'unavailable', sunrise, sunset };
}
function air(data, fetchedAt) {
  const current = data.current || {}, validAt = instant(current.time);
  const europeanAqi = finite(current.european_aqi) && current.european_aqi >= 0 ? current.european_aqi : null;
  const pm25 = data.current_units?.pm2_5 === 'μg/m³' && finite(current.pm2_5) && current.pm2_5 >= 0 ? current.pm2_5 : null;
  return { ...metadata(data, sources.air, fetchedAt, validAt), status: europeanAqi !== null && validAt ? 'ok' : 'unavailable', europeanAqi, pm25, index: 'European AQI', pm25Unit: 'μg/m³' };
}
export function createEnvironmentService({ fetchImpl = fetch, now = () => new Date(), cacheTtlMs = 300000, timeoutMs = 8000, cacheLimit = 100 } = {}) {
  const cache = new Map();
  async function request(url, signal) {
    const response = await fetchImpl(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Provider unavailable');
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.error) throw new Error('Invalid provider response');
    return data;
  }
  return async function getEnvironment(input, { signal } = {}) {
    const location = point(input), start = now(), sample = { latitude: Number(location.latitude.toFixed(3)), longitude: Number(location.longitude.toFixed(3)) }, key = `${sample.latitude},${sample.longitude}`;
    signal?.throwIfAborted();
    const cached = cache.get(key);
    if (cached && cached.expiresAt > start.getTime() && cached.value.sun.date === dateInWarsaw(start)) return structuredClone({ ...cached.value, location, cached: true });
    const common = { latitude: String(sample.latitude), longitude: String(sample.longitude), timezone: 'Europe/Warsaw', timeformat: 'unixtime', forecast_days: '1' };
    const weatherUrl = new URL(WEATHER_URL); weatherUrl.search = new URLSearchParams({ ...common, current: 'temperature_2m,weather_code,is_day', daily: 'sunrise,sunset', temperature_unit: 'celsius' });
    const airUrl = new URL(AIR_URL); airUrl.search = new URLSearchParams({ ...common, current: 'european_aqi,pm2_5', domains: 'cams_europe' });
    const [weatherResult, airResult] = await Promise.allSettled([request(weatherUrl, signal), request(airUrl, signal)]);
    signal?.throwIfAborted();
    const fetched = now(), fetchedAt = fetched.toISOString();
    const unavailable = source => ({ status: 'unavailable', source, fetchedAt, validAt: null, freshness: 'unknown', error: 'Źródło jest chwilowo niedostępne.' });
    const result = { location, timeZone: 'Europe/Warsaw', fetchedAt, cached: false,
      weather: weatherResult.status === 'fulfilled' ? weather(weatherResult.value, fetchedAt) : unavailable(sources.weather),
      sun: weatherResult.status === 'fulfilled' ? sun(weatherResult.value, fetchedAt, fetched) : { ...unavailable(sources.weather), date: dateInWarsaw(fetched), sunrise: null, sunset: null },
      air: airResult.status === 'fulfilled' ? air(airResult.value, fetchedAt) : unavailable(sources.air) };
    result.complete = [result.weather, result.air, result.sun].every(part => part.status === 'ok' && part.freshness !== 'stale');
    // Only complete responses are cached; a partial outage can recover on the next request.
    if (result.complete && cacheLimit > 0) {
      cache.delete(key); cache.set(key, { expiresAt: fetched.getTime() + cacheTtlMs, value: result });
      while (cache.size > cacheLimit) cache.delete(cache.keys().next().value);
    }
    return structuredClone(result);
  };
}
export const getEnvironment = createEnvironmentService();
