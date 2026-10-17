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
      window[callback] = () => { delete window[callback]; resolve(); };
      authFailureHandlers.add(() => reject(new Error('Google Maps odrzuciło klucz API.')));
      const script = document.createElement('script');
      const params = new URLSearchParams({ key, v: 'weekly', loading: 'async', callback, language: 'pl', region: 'PL' });
      script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
      script.async = true;
      script.onerror = () => reject(new Error('Nie udało się załadować Google Maps.'));
      document.head.append(script);
    });
  }

  async function createGoogleMap(element, { apiKey, mapId }) {
    await loadGoogle(apiKey);
    const { Map, InfoWindow } = await google.maps.importLibrary('maps');
    const { AdvancedMarkerElement, PinElement } = await google.maps.importLibrary('marker');
    const map = new Map(element, {
      center: WARSAW,
      zoom: START_ZOOM,
      mapId: mapId || 'DEMO_MAP_ID',
      gestureHandling: 'greedy', // one-finger pan, pinch zoom: the map fills the screen
      disableDefaultUI: true,
      clickableIcons: false,
      keyboardShortcuts: false, // hides the "Skróty klawiszowe" button; logo, map data and Terms must stay (Google ToS)
    });
    const info = new InfoWindow();
    let markers = [];
    let userDot, userAccuracy;

    return {
      vendor: 'google',
      setView({ lat, lng }, zoom) { map.panTo({ lat, lng }); map.setZoom(zoom); },
      clearMarkers() { info.close(); markers.forEach(m => { m.map = null; }); markers = []; },
      addMarker(place) {
        const pin = new PinElement({ background: '#0051d5', borderColor: '#ffffff', glyphColor: '#ffffff' });
        const marker = new AdvancedMarkerElement({ map, position: { lat: place.lat, lng: place.lng }, title: place.name, content: pin.element, gmpClickable: true });
        const open = () => {
          const label = document.createElement('div');
          label.className = 'map-popup';
          label.textContent = place.name; // provider text stays untrusted: never HTML
          info.setContent(label);
          info.open({ map, anchor: marker });
        };
        marker.addListener('gmp-click', open);
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
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
    const layer = L.layerGroup().addTo(map);
    let userDot, userAccuracy;
    new ResizeObserver(() => map.invalidateSize()).observe(element);
    return {
      vendor: 'leaflet',
      setView({ lat, lng }, zoom) { map.setView([lat, lng], zoom); },
      clearMarkers() { layer.clearLayers(); },
      addMarker(place) {
        const popup = document.createElement('div'); popup.textContent = place.name;
        const marker = L.circleMarker([place.lat, place.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#0051d5', fillOpacity: 1 }).bindPopup(popup).addTo(layer);
        return { open: () => marker.openPopup() };
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

  async function readConfig() {
    try {
      const response = await fetch('/api/config', { headers: { Accept: 'application/json' } });
      return response.ok ? await response.json() : {};
    } catch { return {}; }
  }

  // Swap a broken Google map for OpenStreetMap in the same container.
  function replaceWithLeaflet(element) {
    element.replaceChildren();
    element.removeAttribute('style'); // drop inline styles Google set on the container
    const holder = document.createElement('div');
    holder.style.cssText = 'position:absolute;inset:0;';
    element.append(holder);
    return createLeafletMap(holder);
  }

  // onReplace(map) is called if Google fails after the map was already returned.
  window.createCityMap = async (element, { onReplace } = {}) => {
    const config = await readConfig();
    if (config.googleMapsApiKey && !authFailed) {
      try {
        const google = await createGoogleMap(element, { apiKey: config.googleMapsApiKey, mapId: config.googleMapsMapId });
        let replaced = false;
        const fallBack = () => {
          if (replaced) return;
          replaced = true;
          console.warn('[map] Google Maps rejected the API key, switching to OpenStreetMap.');
          try { onReplace?.(replaceWithLeaflet(element)); } catch (error) { console.warn('[map]', error.message); onReplace?.(null); }
        };
        if (authFailed) { queueMicrotask(fallBack); } else { authFailureHandlers.add(fallBack); }
        return google;
      } catch (error) {
        console.warn('[map] Google Maps unavailable, using OpenStreetMap:', error.message);
        if (element.childElementCount) return replaceWithLeaflet(element);
      }
    }
    return createLeafletMap(element);
  };
  window.CITY_CENTER = { ...WARSAW, zoom: START_ZOOM };
})();
