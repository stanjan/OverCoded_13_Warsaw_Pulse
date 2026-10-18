/* Shared location-based top bar. Provider values are models, never station measurements. */
(function () {
  const conditions = {
    0: ['Bezchmurnie', 'clear_day', 'clear_night'], 1: ['Prawie bezchmurnie', 'partly_cloudy_day', 'partly_cloudy_night'],
    2: ['Częściowe zachmurzenie', 'partly_cloudy_day', 'partly_cloudy_night'], 3: ['Pochmurno', 'cloud'],
    45: ['Mgła', 'foggy'], 48: ['Mgła osadzająca szadź', 'foggy'],
    51: ['Lekka mżawka', 'rainy_light'], 53: ['Umiarkowana mżawka', 'rainy'], 55: ['Gęsta mżawka', 'rainy_heavy'],
    56: ['Lekka marznąca mżawka', 'weather_mix'], 57: ['Gęsta marznąca mżawka', 'weather_mix'],
    61: ['Lekki deszcz', 'rainy_light'], 63: ['Deszcz', 'rainy'], 65: ['Ulewny deszcz', 'rainy_heavy'],
    66: ['Lekki marznący deszcz', 'weather_mix'], 67: ['Silny marznący deszcz', 'weather_mix'],
    71: ['Lekki śnieg', 'weather_snowy'], 73: ['Śnieg', 'weather_snowy'], 75: ['Intensywny śnieg', 'snowing_heavy'], 77: ['Śnieg ziarnisty', 'grain'],
    80: ['Lekkie przelotne opady', 'rainy_light'], 81: ['Przelotny deszcz', 'rainy'], 82: ['Silne przelotne opady', 'rainy_heavy'],
    85: ['Przelotny śnieg', 'weather_snowy'], 86: ['Silny przelotny śnieg', 'snowing_heavy'],
    95: ['Burza', 'thunderstorm'], 96: ['Burza z gradem', 'thunderstorm'], 97: ['Silna burza', 'thunderstorm'], 99: ['Silna burza z gradem', 'thunderstorm']
  };
  function weatherCondition(code, isDay) {
    const item = Object.hasOwn(conditions, code) ? conditions[code] : null;
    const tone = code <= 2 ? (isDay === false ? 'night' : isDay === true ? 'sun' : 'cloud') : code >= 95 ? 'storm' : [71,73,75,77,85,86].includes(code) ? 'snow' : code >= 51 ? 'rain' : code === 45 || code === 48 ? 'fog' : 'cloud';
    return item ? { label: item[0], tone, icon: isDay === false ? item[2] || item[1] : isDay === true || !item[2] ? item[1] : 'cloud' } : { label: 'Brak opisu pogody', icon: 'help', tone: 'unknown' };
  }
  function aqiCategory(aqi) {
    if (!Number.isFinite(aqi) || aqi < 0) return { label: 'Brak danych', level: 'unknown' };
    const bands = [[20, 'Dobra', 'good'], [40, 'Dostateczna', 'fair'], [60, 'Umiarkowana', 'moderate'], [80, 'Zła', 'poor'], [100, 'Bardzo zła', 'very-poor'], [Infinity, 'Skrajnie zła', 'extreme']];
    const band = bands.find(([max]) => aqi <= max); return { label: band[1], level: band[2] };
  }
  const time = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';
  const stamp = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : 'brak czasu danych';
  function createEnvironmentController({ fetchImpl = fetch, render, initialLocation, now = () => Date.now(), setTimer = setInterval, clearTimer = clearInterval } = {}) {
    let location = initialLocation, generation = 0, active, stopped = false;
    async function update(next = location) {
      if (stopped) return;
      location = next; const current = ++generation; active?.abort(); active = new AbortController();
      const available = location?.status === 'available' && Number.isFinite(location.latitude) && Math.abs(location.latitude) <= 90 && Number.isFinite(location.longitude) && Math.abs(location.longitude) <= 180;
      const query = available ? `?latitude=${encodeURIComponent(location.latitude)}&longitude=${encodeURIComponent(location.longitude)}` : '';
      render({ status: 'loading', basis: available ? 'gps' : 'central_warsaw' });
      try {
        const response = await fetchImpl(`/api/environment${query}`, { signal: active.signal });
        if (!response.ok) throw new Error('Environment unavailable');
        const data = await response.json();
        if (current === generation && !stopped) render({ status: 'ready', data });
      } catch (error) { if (current === generation && !stopped) render({ status: 'error', basis: available ? 'gps' : 'central_warsaw' }); }
    }
    const timer = setTimer(() => update(), 300000);
    return { update, stop() { stopped = true; generation++; active?.abort(); clearTimer(timer); } };
  }
  function mountEnvironment(doc = document, win = window) {
    const bar = doc.querySelector('#environment-bar'); if (!bar) return;
    // The capsule is display-only: no expanding details panel.
    bar.querySelector?.('summary')?.addEventListener('click', event => event.preventDefault());
    const field = name => doc.querySelector(`#environment-${name}`);
    const weatherEl = field('weather'), airEl = field('air'), sunEl = field('sun'), locationEl = field('location'), infoEl = field('info'), icon = field('icon');
    const airLabel = field('air-label'), airValue = field('air-value'), sunriseEl = field('sunrise'), sunsetEl = field('sunset');
    const freshness = part => part.status === 'unavailable' ? 'brak danych' : part.freshness === 'stale' ? 'nieaktualne' : part.freshness === 'unknown' ? 'aktualność nieznana' : part.status === 'partial' ? 'dane częściowe' : '';
    function render(state) {
      bar.dataset.state = state.status;
      bar.dataset.stale = 'false';
      if (state.status !== 'ready') {
        icon.title = ''; weatherEl.title = ''; airEl.title = ''; sunEl.title = '';
        icon.textContent = state.status === 'loading' ? 'hourglass_top' : 'cloud_off';
        icon.dataset.tone = 'unknown';
        weatherEl.textContent = state.status === 'loading' ? 'Pobieram pogodę…' : 'Pogoda niedostępna';
        airLabel.textContent = 'Brak danych'; airValue.textContent = 'AQI —'; airEl.dataset.level = 'unknown'; sunriseEl.textContent = '—'; sunsetEl.textContent = '—';
        locationEl.textContent = state.basis === 'gps' ? 'Twoja okolica' : 'Centrum Warszawy';
        infoEl.textContent = state.status === 'loading' ? 'Ładowanie danych dla wybranej lokalizacji.' : 'Nie udało się pobrać danych. Ponowna próba za kilka minut.';
        return;
      }
      const { weather = {}, air = {}, sun = {}, location = {} } = state.data;
      const condition = weatherCondition(weather.weatherCode, weather.isDay);
      icon.textContent = weather.status === 'unavailable' ? 'cloud_off' : condition.icon;
      icon.dataset.tone = weather.status === 'unavailable' ? 'unknown' : condition.tone;
      weatherEl.textContent = Number.isFinite(weather.temperatureC) ? `${Math.round(weather.temperatureC)}°C` : 'Pogoda —';
      const category = aqiCategory(air.europeanAqi);
      const usableAir = Number.isFinite(air.europeanAqi) && air.status !== 'unavailable';
      airValue.textContent = usableAir ? `AQI EU ${Math.round(air.europeanAqi)}` : 'AQI —';
      airLabel.textContent = !usableAir ? 'Brak danych' : air.freshness === 'stale' ? 'Nieaktualne' : air.freshness === 'unknown' ? 'Niepotwierdzone' : category.label;
      airEl.dataset.level = !usableAir || ['stale','unknown'].includes(air.freshness) ? 'unknown' : category.level;
      sunriseEl.textContent = time(sun.sunrise); sunsetEl.textContent = time(sun.sunset);
      locationEl.textContent = location.basis === 'gps' ? 'Twoja okolica' : 'Centrum Warszawy';
      infoEl.textContent = `${condition.label}. Pogoda: ${stamp(weather.validAt)}${freshness(weather) ? ' — ' + freshness(weather) : ''}. Powietrze: ${stamp(air.validAt)}${freshness(air) ? ' — ' + freshness(air) : ''}. Dane modelowe dla okolicy.`;
      bar.dataset.stale = String(weather.freshness === 'stale' || air.freshness === 'stale');
    }
    const controller = createEnvironmentController({ render, initialLocation: win.getCityLocation?.() });
    const changed = event => controller.update(event.detail);
    win.addEventListener('city:location', changed); controller.update();
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') controller.update(win.getCityLocation?.()); });
    return controller;
  }
  // Kept on one small namespace for fixture tests and optional embed reuse.
  window.CityEnvironment = { weatherCondition, aqiCategory, createEnvironmentController, mountEnvironment };
  mountEnvironment();
})();
