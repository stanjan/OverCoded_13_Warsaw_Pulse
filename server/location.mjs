// Browser coordinates are measurements, not proof of an exact address.
export function normalizeLocation(input, now = new Date()) {
  const unavailable = reason => ({ status: 'unavailable', reason });
  if (!input || typeof input !== 'object') return unavailable('not_provided');
  if (input.status !== 'available') {
    const reasons = ['not_requested', 'locating', 'denied', 'unavailable'];
    return unavailable(reasons.includes(input.reason) ? input.reason : 'not_provided');
  }
  const { latitude, longitude, accuracy } = input;
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return unavailable('invalid_measurement');
  const result = { status: 'available', source: 'browser_geolocation', latitude, longitude };
  if (Number.isFinite(accuracy) && accuracy >= 0) result.accuracy = accuracy;
  const measured = typeof input.observedAt === 'string' && /^\d{4}-\d\d-\d\dT/.test(input.observedAt) ? Date.parse(input.observedAt) : NaN;
  const age = now.getTime() - measured;
  result.observedAt = Number.isFinite(age) && age >= -60000 ? new Date(measured).toISOString() : null;
  result.ageSeconds = result.observedAt ? Math.max(0, Math.floor(age / 1000)) : null;
  result.freshness = result.observedAt ? (age > 300000 ? 'stale' : 'recent') : 'unknown';
  for (const key of ['altitude', 'altitudeAccuracy', 'heading', 'speed']) {
    const value = input[key];
    if (!Number.isFinite(value) || (['altitudeAccuracy','speed','heading'].includes(key) && value < 0) || (key === 'heading' && value >= 360)) continue;
    result[key] = value;
  }
  return result;
}

export function locationContext(location) {
  return 'Lokalizacja użytkownika (aktualny stan dla tej tury): ' + JSON.stringify(location) + '\naccuracy i altitudeAccuracy są w metrach, altitude w metrach nad poziomem morza, heading w stopniach, speed w m/s. To przybliżony pomiar przeglądarki; nie wywnioskuj dokładnego adresu ani dzielnicy bez źródła. Współrzędne status=available są ostatnią znaną lokalizacją: używaj ich do wyszukiwania w pobliżu i jako start trasy niezależnie od wieku pomiaru lub dokładności. Nie wymagaj odświeżenia GPS, gdy punkt jest dostępny. freshness=stale lub unknown opisuje niepewność czasu, a nie brak punktu; w razie potrzeby mów „ostatnia znana lokalizacja”, nie potwierdzaj obecnego położenia. status=unavailable oznacza brak lokalizacji użytkownika; nie zastępuj jej środkiem mapy ani wcześniejszym pomiarem.';
}
