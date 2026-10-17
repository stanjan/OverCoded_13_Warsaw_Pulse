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
    return item ? { label: item[0], icon: isDay === false ? item[2] || item[1] : isDay === true || !item[2] ? item[1] : 'cloud' } : { label: 'Brak opisu pogody', icon: 'help' };
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
      const age = location?.observedAt ? now() - Date.parse(location.observedAt) : Infinity;
      const available = location?.status === 'available' && age >= -60000 && age <= 300000 && Number.isFinite(location.latitude) && Number.isFinite(location.longitude);
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
    const field = name => doc.querySelector(`#environment-${name}`);
    const weatherEl = field('weather'), airEl = field('air'), sunEl = field('sun'), locationEl = field('location'), infoEl = field('info'), icon = field('icon');
    function render(state) {
      bar.dataset.state = state.status;
      bar.dataset.stale = 'false';
      if (state.status !== 'ready') {
        icon.title = ''; weatherEl.title = ''; airEl.title = ''; sunEl.title = '';
        icon.textContent = state.status === 'loading' ? 'hourglass_top' : 'cloud_off';
        weatherEl.textContent = state.status === 'loading' ? 'Pobieram pogodę…' : 'Pogoda niedostępna';
        airEl.textContent = 'AQI —'; airEl.dataset.level = 'unknown'; sunEl.textContent = 'Wschód — · Zachód —';
        locationEl.textContent = state.basis === 'gps' ? 'Twoja okolica' : 'Centrum Warszawy';
        infoEl.textContent = state.status === 'loading' ? 'Ładowanie danych dla wybranej lokalizacji.' : 'Nie udało się pobrać danych. Ponowna próba za kilka minut.';
        return;
      }
      const { weather = {}, air = {}, sun = {}, location = {} } = state.data;
      const condition = weatherCondition(weather.weatherCode, weather.isDay);
      icon.textContent = weather.status === 'unavailable' ? 'cloud_off' : condition.icon;
      icon.title = condition.label;
      weatherEl.textContent = Number.isFinite(weather.temperatureC) ? `${Math.round(weather.temperatureC)}°C` : 'Pogoda —';
      weatherEl.title = `${condition.label} · czas danych ${stamp(weather.validAt)}${weather.freshness === 'stale' ? ' · dane nieaktualne' : ''}`;
      airEl.textContent = Number.isFinite(air.europeanAqi) ? `AQI EU ${Math.round(air.europeanAqi)}` : 'AQI —';
      const category = aqiCategory(air.europeanAqi); airEl.dataset.level = category.level;
      airEl.title = `${category.label} · europejski indeks · ${stamp(air.validAt)}`;
      sunEl.textContent = `↑ ${time(sun.sunrise)} · ↓ ${time(sun.sunset)}`; sunEl.title = 'Wschód i zachód słońca · czas Warszawy';
      locationEl.textContent = location.basis === 'gps' ? 'Twoja okolica' : 'Centrum Warszawy';
      const status = part => part.status === 'unavailable' ? 'brak danych' : part.freshness === 'stale' ? 'dane nieaktualne' : part.freshness === 'unknown' ? 'nieznana aktualność' : part.status === 'partial' ? 'dane częściowe' : 'dane modelowe';
      infoEl.textContent = `${condition.label}. Pogoda: ${stamp(weather.validAt)} (${status(weather)}). Powietrze: ${stamp(air.validAt)} (${status(air)}). Słońce: ${sun.date || '—'} (${sun.status === 'ok' ? 'wschód i zachód' : 'dane niepełne'}). Modele dla siatki w okolicy lokalizacji, nie pomiary w Twoim punkcie. Pobrano ${stamp(state.data.fetchedAt)}.`;
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
