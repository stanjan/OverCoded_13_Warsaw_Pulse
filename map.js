// City map adapter: Google Maps when configured, Leaflet/OpenStreetMap otherwise.
// Both expose the same small API so app.js does not depend on a map vendor.
(() => {
  const WARSAW = { lat: 52.2318, lng: 21.006 };
  const START_ZOOM = 12;

  // Google reports a rejected key (wrong referrer, API disabled, billing off) through
  // window.gm_authFailure, often AFTER the script loaded and the map was created.
  let authFailed = false;
  const authFailureHandlers = new Set();
  window.gm_authFailure = () => { authFailed = true; authFailureHandlers.forEach(handler => handler()); };

  function loadGoogle(key) {
    if (window.google?.maps?.importLibrary) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const callback = '__warsawMapsReady';
      window[callback] = () => { delete window[callback]; cleanup(); resolve(); };
      const onAuthFailure = () => { cleanup(); reject(new Error('Google Maps odrzuciło klucz API.')); };
      const cleanup = () => { authFailureHandlers.delete(onAuthFailure); };
      authFailureHandlers.add(onAuthFailure);
      const script = document.createElement('script');
      const params = new URLSearchParams({ key, v: 'weekly', loading: 'async', callback, language: 'pl', region: 'PL' });
      script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
      script.async = true;
      script.onerror = () => { cleanup(); delete window[callback]; reject(new Error('Nie udało się załadować Google Maps.')); };
      document.head.append(script);
    });
  }

  async function createGoogleMap(element, { apiKey, mapId }) {
    await loadGoogle(apiKey);
    const { Map, InfoWindow } = await google.maps.importLibrary('maps');
    const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');
    const map = new Map(element, {
      center: WARSAW,
      zoom: START_ZOOM,
      mapId: mapId || 'DEMO_MAP_ID',
      gestureHandling: 'greedy', // one-finger pan, pinch zoom: the map fills the screen
      disableDefaultUI: true,
      clickableIcons: false,
      keyboardShortcuts: false, // hides the "Skróty klawiszowe" button; logo, map data and Terms must stay (Google ToS)
    });
    // No elapsed-time fallback: a slow provider remains pending until it renders.
    const ready = new Promise(resolve => google.maps.event.addListenerOnce(map, 'tilesloaded', resolve));
    const info = new InfoWindow({ maxWidth: 290 });
    let activeBubble, activeMarker;
    const optionalCollision = google.maps.CollisionBehavior?.OPTIONAL_AND_HIDES_LOWER_PRIORITY;
    info.addListener('closeclick', () => { activeBubble?.setAttribute('aria-expanded', 'false'); if (activeMarker) activeMarker.collisionBehavior = optionalCollision; });
    let markers = [];
    let userDot, userAccuracy;

    return {
      vendor: 'google',
      ready,
      setView({ lat, lng }, zoom) { map.panTo({ lat, lng }); map.setZoom(zoom); },
      clearMarkers() { info.close(); activeBubble?.setAttribute('aria-expanded', 'false'); markers.forEach(m => { m.map = null; }); markers = []; },
      addMarker(place, { recommended = false, onOpen } = {}) {
        const bubble = resultBubble(place, recommended);
        const marker = new AdvancedMarkerElement({ map, position: { lat: place.lat, lng: place.lng }, title: place.name, content: bubble, gmpClickable: true, zIndex: recommended ? 200 : 100, collisionBehavior: optionalCollision });
        const open = () => {
          onOpen?.();
          activeBubble?.setAttribute('aria-expanded', 'false');
          if (activeMarker) activeMarker.collisionBehavior = optionalCollision;
          activeBubble = bubble;
          activeMarker = marker;
          marker.collisionBehavior = google.maps.CollisionBehavior?.REQUIRED_AND_HIDES_OPTIONAL;
          bubble.setAttribute('aria-expanded', 'true');
          info.setContent(resultDetails(place, recommended));
          info.open({ map, anchor: marker, shouldFocus: true });
        };
        bubble.addEventListener('click', event => { event.stopPropagation(); open(); });
        marker.addEventListener('gmp-click', open);
        markers.push(marker);
        return { open };
      },
      fitTo(points, padding) {
        if (!points.length) return;
        const bounds = new google.maps.LatLngBounds();
        points.forEach(p => bounds.extend({ lat: p[0], lng: p[1] }));
        map.fitBounds(bounds, padding);
        google.maps.event.addListenerOnce(map, 'idle', () => { if (map.getZoom() > 15) map.setZoom(15); });
      },
      showUser({ lat, lng, accuracy }) {
        const position = { lat, lng };
        if (!userDot) {
          userDot = new AdvancedMarkerElement({ map, position, title: 'Twoja lokalizacja', content: userDotElement('google'), zIndex: 1000 });
          userAccuracy = new google.maps.Circle({ map, center: position, radius: accuracy, strokeColor: '#0051d5', strokeOpacity: 0.3, strokeWeight: 1, fillColor: '#0051d5', fillOpacity: 0.1, clickable: false });
        } else {
          userDot.position = position;
          userAccuracy.setCenter(position);
          userAccuracy.setRadius(accuracy);
        }
      },
    };
  }

  function createLeafletMap(element) {
    if (!window.L) throw new Error('Leaflet niedostępny.');
    const map = L.map(element, { zoomControl: false }).setView([WARSAW.lat, WARSAW.lng], START_ZOOM);
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' });
    const ready = new Promise((resolve, reject) => {
      if (!tiles.once) { resolve(); return; }
      let loaded = 0, failed = 0;
      tiles.on('tileload', () => loaded++);
      tiles.on('tileerror', () => failed++);
      tiles.once('load', () => failed && !loaded ? reject(new Error('Nie udało się pobrać kafelków mapy.')) : resolve());
    });
    tiles.addTo(map);
    const layer = L.layerGroup().addTo(map);
    const results = [];
    let activeMarker;
    function arrangeBubbles() {
      const occupied = [];
      const ordered = [...results].sort((a, b) => Number(b.marker === activeMarker) - Number(a.marker === activeMarker) || Number(b.recommended) - Number(a.recommended));
      for (const entry of ordered) {
        const point = map.latLngToContainerPoint(entry.marker.getLatLng());
        const box = { left: point.x - 89, right: point.x + 89, top: point.y - 78, bottom: point.y + 2 };
        const visible = !occupied.some(other => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top);
        const icon = entry.marker.getElement();
        if (icon) icon.style.visibility = visible ? '' : 'hidden';
        entry.bubble.tabIndex = visible ? 0 : -1;
        if (visible) occupied.push(box);
      }
    }
    map.on('zoomend moveend resize', arrangeBubbles);
    let userDot, userAccuracy;
    new ResizeObserver(() => map.invalidateSize()).observe(element);
    return {
      vendor: 'leaflet',
      ready,
      setView({ lat, lng }, zoom) { map.setView([lat, lng], zoom); },
      clearMarkers() { layer.clearLayers(); results.length = 0; activeMarker = undefined; },
      addMarker(place, { recommended = false, onOpen } = {}) {
        const bubble = resultBubble(place, recommended);
        const icon = L.divIcon({ className: 'result-marker', html: bubble, iconSize: [174, 76], iconAnchor: [87, 76], popupAnchor: [0, -70] });
        const marker = L.marker([place.lat, place.lng], { icon, keyboard: false, zIndexOffset: recommended ? 200 : 100 })
          .bindPopup(resultDetails(place, recommended), { className: 'result-info-popup', minWidth: 230, maxWidth: 290, autoPanPaddingTopLeft: [12, 70], autoPanPaddingBottomRight: [12, 150] })
          .on('popupopen', () => { activeMarker = marker; bubble.setAttribute('aria-expanded', 'true'); arrangeBubbles(); onOpen?.(); })
          .on('popupclose', () => { bubble.setAttribute('aria-expanded', 'false'); if (activeMarker === marker) activeMarker = undefined; arrangeBubbles(); })
          .addTo(layer);
        const open = () => marker.openPopup();
        L.DomEvent.disableClickPropagation(bubble);
        bubble.addEventListener('click', event => { event.stopPropagation(); open(); });
        results.push({ marker, bubble, recommended });
        arrangeBubbles();
        return { open };
      },
      fitTo(points, padding) {
        if (!points.length) return;
        map.fitBounds(points, { paddingTopLeft: [padding.left, padding.top], paddingBottomRight: [padding.right, padding.bottom], maxZoom: 15 });
      },
      showUser({ lat, lng, accuracy }) {
        if (!userDot) {
          userAccuracy = L.circle([lat, lng], { radius: accuracy, color: '#0051d5', weight: 1, opacity: 0.3, fillOpacity: 0.1, interactive: false }).addTo(map);
          userDot = L.marker([lat, lng], { icon: L.divIcon({ className: '', html: userDotElement('leaflet').outerHTML, iconSize: [22, 22], iconAnchor: [11, 11] }), title: 'Twoja lokalizacja', zIndexOffset: 1000 }).addTo(map);
        } else {
          userDot.setLatLng([lat, lng]);
          userAccuracy.setLatLng([lat, lng]).setRadius(accuracy);
        }
      },
    };
  }

  function userDotElement(vendor) {
    const wrap = document.createElement('div');
    wrap.className = `user-loc user-loc--${vendor}`;
    wrap.setAttribute('aria-hidden', 'true');
    const pulse = document.createElement('span'); pulse.className = 'user-loc__pulse';
    const dot = document.createElement('span'); dot.className = 'user-loc__dot';
    wrap.append(pulse, dot);
    return wrap;
  }

  const categoryLabels = { event: 'Wydarzenie', sports: 'Zajęcia sportowe', pitch: 'Boisko', route: 'Trasa', weather: 'Pogoda', air_quality: 'Jakość powietrza' };
  const categoryIcons = { event: 'local_activity', sports: 'sports_soccer', pitch: 'sports_basketball', route: 'forest', weather: 'partly_cloudy_day', air_quality: 'air' };
  function safeUrl(value, image = false) {
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
      if (image) url.protocol = 'https:';
      return url.href;
    } catch { return null; }
  }
  function thumbnail(place, large = false) {
    const frame = document.createElement('div');
    frame.className = 'result-image' + (large ? ' result-image--large' : '');
    frame.dataset.category = place.category || 'event';
    const fallback = document.createElement('span');
    fallback.className = 'material-symbols-outlined result-image__fallback';
    fallback.textContent = categoryIcons[place.category] || 'local_activity';
    fallback.setAttribute('aria-hidden', 'true');
    frame.append(fallback);
    const url = safeUrl(place.imageUrl, true);
    if (url) {
      const image = document.createElement('img');
      image.src = url; image.alt = ''; image.referrerPolicy = 'no-referrer'; image.decoding = 'async';
      image.addEventListener('load', () => { image.dataset.loaded = 'true'; }, { once: true });
      image.addEventListener('error', () => image.remove(), { once: true });
      frame.append(image);
    }
    return frame;
  }
  function resultBubble(place, recommended) {
    const button = document.createElement('button'); button.type = 'button';
    button.className = 'result-bubble' + (recommended ? ' result-bubble--recommended' : '');
    button.setAttribute('aria-label', 'Zobacz szczegóły: ' + place.name);
    button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false');
    const copy = document.createElement('span'); copy.className = 'result-bubble__copy';
    const title = document.createElement('strong'); title.className = 'result-bubble__title'; title.textContent = place.name;
    const caption = document.createElement('span'); caption.className = 'result-bubble__caption';
    caption.textContent = recommended ? '★ Polecane' : categoryLabels[place.category] || 'Miejsce';
    copy.append(title, caption); button.append(thumbnail(place), copy);
    return button;
  }
  function eventDate(date) {
    const day = value => {
      const parsed = new Date(value + 'T12:00:00Z');
      return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Warsaw' }).format(parsed) : value;
    };
    const time = value => {
      if (typeof value !== 'string' || !value.includes('T')) return '';
      const parsed = new Date(value.replace(/([+-]\d{2})$/, '$1:00'));
      if (!Number.isFinite(parsed.getTime())) return '';
      const label = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' }).format(parsed);
      return label === '00:00' || label === '23:59' ? '' : label;
    };
    const from = time(date.sourceFrom), to = time(date.sourceTo);
    const range = date.from === date.to ? day(date.from) : day(date.from) + ' – ' + day(date.to);
    return [range, from ? from + (to && to !== from && date.from === date.to ? '–' + to : '') : ''].filter(Boolean).join(' · ');
  }
  function resultDetails(place, recommended) {
    const card = document.createElement('article'); card.className = 'result-detail';
    card.append(thumbnail(place, true));
    const body = document.createElement('div'); body.className = 'result-detail__body';
    const tag = document.createElement('span'); tag.className = 'result-detail__tag';
    tag.textContent = (recommended ? '★ Polecane · ' : '') + (categoryLabels[place.category] || 'Miejsce');
    const title = document.createElement('h3'); title.textContent = place.name;
    body.append(tag, title);
    const location = [place.district, ...(place.addresses || []), place.address].filter(Boolean).join(' · ');
    const dates = (place.dates || []).map(eventDate);
    const timing = [...dates, ...(place.weekdays || []), place.time].filter(Boolean).join(' · ');
    for (const [className, value] of [['result-detail__meta', timing], ['result-detail__meta', location], ['result-detail__description', place.description]]) {
      if (!value) continue;
      const paragraph = document.createElement('p'); paragraph.className = className; paragraph.textContent = value; body.append(paragraph);
    }
    if (place.provenance?.observedAt?.length) {
      const note = document.createElement('p'); note.className = 'result-detail__meta';
      note.textContent = 'Pomiar: ' + place.provenance.observedAt.join(', ') + ' (Europe/Warsaw). Aktualność niepotwierdzona.'; body.append(note);
    }
    const url = safeUrl(place.url || place.sourceUrl);
    if (url) {
      const source = document.createElement('a'); source.className = 'result-detail__link'; source.href = url;
      source.textContent = place.category === 'event' || place.category === 'sports' ? 'Szczegóły u organizatora ↗' : 'Zobacz źródło ↗';
      source.target = '_blank'; source.rel = 'noopener noreferrer'; body.append(source);
    }
    card.append(body); return card;
  }

  async function readConfig() {
    try {
      const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Map configuration unavailable');
      const config = await response.json();
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid map configuration');
      return config;
    } catch { throw new Error('Nie udało się pobrać konfiguracji mapy.'); }
  }

  // Swap a broken Google map for OpenStreetMap in the same container.
  async function replaceWithLeaflet(element) {
    element.replaceChildren();
    element.removeAttribute('style'); // drop inline styles Google set on the container
    const holder = document.createElement('div');
    holder.style.cssText = 'position:absolute;inset:0;';
    element.append(holder);
    const leaflet = createLeafletMap(holder);
    await leaflet.ready;
    return leaflet;
  }

  // onReplace(map) is called if Google fails after the map was already returned.
  window.createCityMap = async (element, { onReplace } = {}) => {
    const config = await readConfig();
    if (config.googleMapsApiKey && !authFailed) {
      try {
        const google = await createGoogleMap(element, { apiKey: config.googleMapsApiKey, mapId: config.googleMapsMapId });
        let replaced = false, finishReplacement;
        const replacementReady = new Promise(resolve => { finishReplacement = resolve; });
        const fallBack = async () => {
          if (replaced) return;
          replaced = true;
          authFailureHandlers.delete(fallBack);
          console.warn('[map] Google Maps rejected the API key, switching to OpenStreetMap.');
          let replacement = null;
          try { replacement = await replaceWithLeaflet(element); } catch (error) { console.warn('[map]', error.message); }
          // Consumer callback errors must not turn one handoff into a second callback.
          try { onReplace?.(replacement); } catch (error) { console.warn('[map]', error.message); }
          finally { finishReplacement(replacement); }
        };
        if (authFailed) { queueMicrotask(fallBack); } else { authFailureHandlers.add(fallBack); }
        await Promise.race([google.ready, replacementReady]);
        // Once fallback owns the container, old Google readiness cannot complete
        // startup. Wait for the replacement's ready adapter or unavailable result.
        return replaced ? await replacementReady : google;
      } catch (error) {
        console.warn('[map] Google Maps unavailable, using OpenStreetMap:', error.message);
        if (element.childElementCount) return replaceWithLeaflet(element);
      }
    }
    const leaflet = createLeafletMap(element);
    await leaflet.ready;
    return leaflet;
  };
  window.CITY_CENTER = { ...WARSAW, zoom: START_ZOOM };
})();
