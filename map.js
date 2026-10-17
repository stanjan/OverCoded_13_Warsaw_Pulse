// City map adapter: Google Maps when configured, Leaflet/OpenStreetMap otherwise.
// Both expose the same small API so app.js does not depend on a map vendor.
(() => {
  const WARSAW = { lat: 52.2318, lng: 21.006 };
  const START_ZOOM = 12;
  // Below this zoom results are small icons; zooming in turns them into bubbles with photo and name.
  const DETAIL_ZOOM = 16;
  const DESTINATION_PIN = { width: 36, height: 44 };

  function routePadding(element, { top = 65, bottom = 24 } = {}) {
    // The coordinate anchor sits at the tip of the destination pin.
    // Reserve the whole marker plus a small gap below the floating route bar.
    const bar = document.querySelector?.('#environment-bar')?.getBoundingClientRect?.();
    const canvas = element.getBoundingClientRect?.();
    top = Math.max(0, Number.isFinite(bar?.bottom) && Number.isFinite(canvas?.top) ? bar.bottom - canvas.top : top) + DESTINATION_PIN.height + 8;
    const rect = element.getBoundingClientRect?.();
    const sheet = document.querySelector?.('#ai-sheet')?.getBoundingClientRect?.();
    if (rect && sheet) bottom = Math.max(bottom, rect.bottom - sheet.top + 24);
    return { top, bottom, left: 24, right: 24 };
  }

  function observeRouteViewport(element, fit) {
    let timer;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(fit, 80);
    });
    for (const target of [element, document.querySelector?.('#ai-sheet'), document.querySelector?.('#environment-bar')]) if (target) observer.observe(target);
  }
  function canFitRoute(element, padding) { return !(element.clientHeight > 0) || element.clientHeight - padding.top - padding.bottom >= 64; }

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
    // headerDisabled removes Google's empty title row; the cloud draws its own close button over the photo.
    const info = new InfoWindow({ maxWidth: 290, headerDisabled: true });
    let activeBubble, activeMarker;
    // Every result pin stays visible, even when pins overlap.
    const optionalCollision = google.maps.CollisionBehavior?.REQUIRED;
    info.addListener('closeclick', () => { activeBubble?.setAttribute('aria-expanded', 'false'); if (activeMarker) activeMarker.collisionBehavior = optionalCollision; });
    let markers = [];
    let routeLines = [], routeMarkers = [], vehicleMarkers = [], routeView;
    const fitRoute = () => {
      if (!routeView) return;
      const padding = routePadding(element, routeView.options);
      if (!canFitRoute(element, padding)) return;
      const bounds = new google.maps.LatLngBounds();routeView.points.forEach(point => bounds.extend({lat:point.latitude,lng:point.longitude}));
      map.fitBounds(bounds, padding);
    };
    observeRouteViewport(element, fitRoute);
    const clearRoute = () => { routeView = null; routeLines.forEach(line => line.setMap(null)); [...routeMarkers,...vehicleMarkers].forEach(marker => { marker.map = null; }); routeLines = []; routeMarkers = []; vehicleMarkers = []; };
    let userDot, userAccuracy;
    const syncDetail = () => element.classList?.toggle('markers-compact', Math.round(map.getZoom()) < DETAIL_ZOOM);
    map.addListener('zoom_changed', syncDetail);
    syncDetail();

    return {
      vendor: 'google',
      ready,
      clearRoute,
      showRoute(route, { top = 65 } = {}) {
        info.close();activeBubble?.setAttribute('aria-expanded','false');
        clearRoute();
        for (const step of route?.steps || []) {
          const path = transitContextPath(step).map(point => ({ lat: point.latitude, lng: point.longitude }));
          if (path.length < 2) continue;
          routeLines.push(new google.maps.Polyline({ map, path, strokeColor: transitColor(step), strokeOpacity: .2, strokeWeight: 5, clickable: false, zIndex: 0 }));
        }
        for (const step of route?.steps || []) {
          const path = validTransitPath(step.path).map(point => ({ lat: point.latitude, lng: point.longitude }));
          if (path.length < 2) continue;
          const networkWalk=step.mode==='WALK'&&step.geometry==='osm_pedestrian';
          routeLines.push(new google.maps.Polyline({ map, path, strokeColor: step.mode === 'WALK' ? '#61776a' : transitColor(step), strokeOpacity: networkWalk?0:step.mode === 'WALK' ? .5 : .9, strokeWeight: step.mode === 'WALK' ? 4 : 6, ...(networkWalk?{icons:[{icon:{path:google.maps.SymbolPath?.CIRCLE??0,scale:5,fillColor:'#4285F4',fillOpacity:1,strokeColor:'#ffffff',strokeWeight:2,strokeOpacity:1},offset:'0',repeat:'16px'}]}:{}), clickable: false, zIndex: 1 }));
        }
        const points = (route?.steps || []).flatMap(step => validTransitPath(step.path));
        if (points.length) {
          routeView = {points:[...points,...validTransitPath([route.destinationPoint])],options:{top}};fitRoute();
          const destination = validTransitPath([route.destinationPoint])[0]||points.at(-1);
          routeMarkers.push(new AdvancedMarkerElement({ map, position: { lat: destination.latitude, lng: destination.longitude }, content: destinationElement(), title: 'Cel podróży', anchorLeft: '-50%', anchorTop: '-100%', zIndex: 300 }));
        }
        return routeLines.length > 0;
      },
      showVehicles(vehicles) {
        vehicleMarkers.forEach(marker => { marker.map = null; });vehicleMarkers = [];
        for (const vehicle of vehicles || []) {
          if (!validTransitPath([vehicle]).length || !freshVehicle(vehicle)) continue;
          vehicleMarkers.push(new AdvancedMarkerElement({ map, position:{lat:vehicle.latitude,lng:vehicle.longitude}, content:vehicleElement(vehicle), title:vehicleTitle(vehicle), zIndex:250 }));
        }
      },
      setView({ lat, lng }, zoom) { routeView = null; map.panTo({ lat, lng }); map.setZoom(zoom); },
      clearMarkers() { info.close(); activeBubble?.setAttribute('aria-expanded', 'false'); markers.forEach(m => { m.map = null; }); markers = []; },
      addMarker(place, { recommended = false, onOpen } = {}) {
        const bubble = resultBubble(place, recommended);
        const marker = new AdvancedMarkerElement({ map, position: { lat: place.lat, lng: place.lng }, title: place.name, content: bubble, gmpClickable: true, zIndex: recommended ? 200 : 100, collisionBehavior: optionalCollision });
        const open = () => {
          routeView = null;onOpen?.();
          activeBubble?.setAttribute('aria-expanded', 'false');
          if (activeMarker) activeMarker.collisionBehavior = optionalCollision;
          activeBubble = bubble;
          activeMarker = marker;
          marker.collisionBehavior = google.maps.CollisionBehavior?.REQUIRED_AND_HIDES_OPTIONAL;
          bubble.setAttribute('aria-expanded', 'true');
          const details = resultDetails(place, recommended);
          const close = document.createElement('button'); close.type = 'button'; close.className = 'result-detail__close'; close.setAttribute('aria-label', 'Zamknij');
          const closeIcon = document.createElement('span'); closeIcon.className = 'material-symbols-outlined'; closeIcon.setAttribute('aria-hidden', 'true'); closeIcon.textContent = 'close';
          close.append(closeIcon);
          close.addEventListener('click', () => { info.close(); google.maps.event.trigger(info, 'closeclick'); });
          details.prepend(close);
          info.setContent(details);
          info.open({ map, anchor: marker, shouldFocus: true });
        };
        bubble.addEventListener('click', event => { event.stopPropagation(); open(); });
        marker.addEventListener('gmp-click', open);
        markers.push(marker);
        return { open };
      },
      fitTo(points, padding) {
        routeView = null;if (!points.length) return;
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
    const transitLayer = L.layerGroup().addTo(map);
    const vehicleLayer = L.layerGroup().addTo(map);
    const results = [];
    let activeMarker;
    // Every result pin stays visible (no hiding of overlapping pins); only the zoom mode is synced.
    function arrangeBubbles() {
      element.classList?.toggle('markers-compact', Math.round(map.getZoom()) < DETAIL_ZOOM);
      for (const entry of results) { const icon = entry.marker.getElement(); if (icon) icon.style.visibility = ''; entry.bubble.tabIndex = 0; }
    }
    map.on('zoomend moveend resize', arrangeBubbles);
    let userDot, userAccuracy;
    let routeView;
    const fitRoute = () => {
      map.invalidateSize();
      if (!routeView) return;
      const padding = routePadding(element, routeView.options);
      if (canFitRoute(element, padding)) map.fitBounds(routeView.points,{paddingTopLeft:[padding.left,padding.top],paddingBottomRight:[padding.right,padding.bottom],animate:false});
    };
    observeRouteViewport(element, fitRoute);
    return {
      vendor: 'leaflet',
      ready,
      clearRoute() { routeView = null;transitLayer.clearLayers(); vehicleLayer.clearLayers(); },
      showRoute(route, { top = 65 } = {}) {
        routeView = null;map.closePopup?.();transitLayer.clearLayers();vehicleLayer.clearLayers();
        const points=(route?.steps || []).flatMap(step=>validTransitPath(step.path)).map(point=>[point.latitude,point.longitude]);
        let lineCount=0;
        for(const step of route?.steps || []){
          const path=transitContextPath(step).map(point=>[point.latitude,point.longitude]);
          if(path.length>1)L.polyline(path,{color:transitColor(step),weight:5,opacity:.2,interactive:false}).addTo(transitLayer);
        }
        for (const step of route?.steps || []) {
          const path=validTransitPath(step.path).map(point=>[point.latitude,point.longitude]);
          if(path.length<2)continue;lineCount++;
          if(step.mode==='WALK'&&step.geometry==='osm_pedestrian'){
            // Round zero-length SVG dashes form circles, with fixed pixel spacing at every zoom.
            for(const[color,weight]of [['#ffffff',12],['#4285F4',8]])L.polyline(path,{color,weight,opacity:1,lineCap:'round',dashArray:'0 16',dashOffset:'0',interactive:false}).addTo(transitLayer);
          }else L.polyline(path,{color:step.mode==='WALK'?'#61776a':transitColor(step),weight:step.mode==='WALK'?4:6,opacity:step.mode==='WALK'?.5:.9,dashArray:step.mode==='WALK'?'6 7':null,interactive:false}).addTo(transitLayer);
        }
        if(points.length){
          const icon=L.divIcon({className:'',html:destinationElement(),iconSize:[DESTINATION_PIN.width,DESTINATION_PIN.height],iconAnchor:[DESTINATION_PIN.width/2,DESTINATION_PIN.height]});
          const destination=validTransitPath([route.destinationPoint])[0];
          L.marker(destination?[destination.latitude,destination.longitude]:points.at(-1),{icon,title:'Cel podróży',keyboard:false,interactive:false,zIndexOffset:300}).addTo(transitLayer);
          routeView={points:destination?[...points,[destination.latitude,destination.longitude]]:points,options:{top}};fitRoute();
        }
        return lineCount>0;
      },
      showVehicles(vehicles) {
        vehicleLayer.clearLayers();
        for(const vehicle of vehicles||[]) {
          if(!validTransitPath([vehicle]).length||!freshVehicle(vehicle))continue;
          L.marker([vehicle.latitude,vehicle.longitude],{icon:L.divIcon({className:'',html:vehicleElement(vehicle),iconSize:[44,30],iconAnchor:[22,15]}),title:vehicleTitle(vehicle),zIndexOffset:250}).addTo(vehicleLayer);
        }
      },

      setView({ lat, lng }, zoom) { routeView = null;map.setView([lat, lng], zoom); },
      clearMarkers() { layer.clearLayers(); results.length = 0; activeMarker = undefined; },
      addMarker(place, { recommended = false, onOpen } = {}) {
        const bubble = resultBubble(place, recommended);
        const icon = L.divIcon({ className: 'result-marker', html: bubble, iconSize: [174, 76], iconAnchor: [87, 76], popupAnchor: [0, -70] });
        const marker = L.marker([place.lat, place.lng], { icon, keyboard: false, zIndexOffset: recommended ? 200 : 100 })
          .bindPopup(resultDetails(place, recommended), { className: 'result-info-popup', minWidth: 230, maxWidth: 290, autoPanPaddingTopLeft: [12, 70], autoPanPaddingBottomRight: [12, 150] })
          .on('popupopen', () => { routeView = null;activeMarker = marker; bubble.setAttribute('aria-expanded', 'true'); arrangeBubbles(); onOpen?.(); })
          .on('popupclose', () => { bubble.setAttribute('aria-expanded', 'false'); if (activeMarker === marker) activeMarker = undefined; arrangeBubbles(); })
          .addTo(layer);
        const open = () => { routeView = null;marker.openPopup(); };
        L.DomEvent.disableClickPropagation(bubble);
        bubble.addEventListener('click', event => { event.stopPropagation(); open(); });
        results.push({ marker, bubble, recommended });
        arrangeBubbles();
        return { open };
      },
      fitTo(points, padding) {
        routeView = null;if (!points.length) return;
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

  function validTransitPath(points) { return Array.isArray(points) ? points.filter(point=>Number.isFinite(point?.latitude)&&Math.abs(point.latitude)<=90&&Number.isFinite(point.longitude)&&Math.abs(point.longitude)<=180) : []; }
  function transitContextPath(step) { const path=validTransitPath(step.fullPath);return step.mode==='TRANSIT'&&step.geometry==='gtfs_shape'&&step.fullPathGeometry==='gtfs_shape'&&path.length===step.fullPath?.length?path:[]; }
  function destinationElement() {
    const pin=document.createElement('span');pin.className='transit-destination';pin.setAttribute('aria-hidden','true');
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 36 44');svg.setAttribute('width',DESTINATION_PIN.width);svg.setAttribute('height',DESTINATION_PIN.height);
    const drop=document.createElementNS('http://www.w3.org/2000/svg','path');
    drop.setAttribute('d','M18 43C14 37 3 29 3 18a15 15 0 0 1 30 0c0 11-11 19-15 25Z');drop.setAttribute('fill','currentColor');drop.setAttribute('stroke','#fff');drop.setAttribute('stroke-width','2');drop.setAttribute('stroke-linejoin','round');
    const flag=document.createElementNS('http://www.w3.org/2000/svg','path');
    flag.setAttribute('d','M13.5 26V11.5m0 1h10l-2.5 4 2.5 4h-10');flag.setAttribute('fill','none');flag.setAttribute('stroke','#fff');flag.setAttribute('stroke-width','2');flag.setAttribute('stroke-linecap','round');flag.setAttribute('stroke-linejoin','round');
    svg.append(drop,flag);pin.append(svg);return pin;
  }
  function transitColor(record) { return /^#[0-9a-f]{6}$/i.test(record.transportColor||'')?record.transportColor:'#65727f'; }
  function freshVehicle(vehicle) { const age=Date.now()-Date.parse(vehicle.observedAt);return vehicle.freshness==='recent'&&Number.isFinite(age)&&age>=-60000&&age<=90000; }
  function vehicleTitle(vehicle) { return (vehicle.transportLabel||(vehicle.type===2?'Tramwaj':'Autobus'))+' '+vehicle.line+' · '+(vehicle.freshness==='recent'?'świeży pomiar':'pomiar nieaktualny lub bez czasu')+' · '+(vehicle.sourceClock||'brak czasu')+' · pozycja nie jest ETA'; }
  function vehicleElement(vehicle) { const element=document.createElement('span');element.className='transit-vehicle';element.dataset.freshness=vehicle.freshness;element.style.backgroundColor=transitColor(vehicle);element.textContent=vehicle.line;element.title=vehicleTitle(vehicle);return element; }

  function userDotElement(vendor) {
    const wrap = document.createElement('div');
    wrap.className = `user-loc user-loc--${vendor}`;
    wrap.setAttribute('aria-hidden', 'true');
    const pulse = document.createElement('span'); pulse.className = 'user-loc__pulse';
    const dot = document.createElement('span'); dot.className = 'user-loc__dot';
    wrap.append(pulse, dot);
    return wrap;
  }

  const categoryLabels = { event: 'Wydarzenie', sports: 'Zajęcia sportowe', pitch: 'Boisko', route: 'Trasa', toilet: 'Toaleta', weather: 'Pogoda', air_quality: 'Jakość powietrza' };
  const themeIcons = { culture: 'palette', sport: 'directions_run', education: 'school', meeting: 'forum', family: 'family_restroom', seniors: 'elderly', outdoor: 'park' };
  // Sorts a result into one of the 7 pastel themes from its category and the words in its source data.
  // Theme order matters: the city's own event categories decide first, then the title, then the description.
  // Culture is checked before sport so "Kultura" events never get a sport pin from a stray word.
  const THEME_RULES = [
    ['family', /(^|[^a-ząćęłńóśźż])(dzieci|dziecko|dziecięc|rodzin|maluch|najmłodsz)/],
    ['seniors', /(^|[^a-ząćęłńóśźż])senior/],
    ['culture', /(^|[^a-ząćęłńóśźż])(kultur|koncert|spektakl|teatr|wystaw|muze|film|kino|festiwal|muzyk|sztuk|literat|taniec|tańc|opera|galeri|wernisaż|recital|jazz|kabaret)/],
    ['education', /(^|[^a-ząćęłńóśźż])(edukac|nauk|wykład|warsztat|szkoleni|kurs|lekcj|seminari)/],
    ['meeting', /(^|[^a-ząćęłńóśźż])(spotkani|debat|dyskusj|konferenc|panel|konsultac)/],
    ['sport', /(^|[^a-ząćęłńóśźż])(sport|biegi?($|[^a-ząćęłńóśźż])|bieg |maraton|joga|jogi|fitness|turniej|mecz|zawody|rowerow)/],
    ['outdoor', /(^|[^a-ząćęłńóśźż])(piknik|plener|festyn|spacer|ogród|park|czas woln|rekreac|wycieczk)/],
  ];
  function matchTheme(text) {
    if (!text) return null;
    const lower = text.toLowerCase();
    for (const [theme, pattern] of THEME_RULES) if (pattern.test(lower)) return theme;
    return null;
  }
  function themeFor(place) {
    if (place.category === 'sports' || place.category === 'pitch') return 'sport';
    if (['route', 'toilet', 'weather', 'air_quality'].includes(place.category)) return 'outdoor';
    return matchTheme([...(place.audience || []), ...(place.activities || [])].join(' · '))
      || matchTheme(place.name)
      || matchTheme(place.description)
      || 'culture';
  }

  const categoryIcons = { event: 'local_activity', sports: 'sports_soccer', pitch: 'sports_basketball', route: 'forest', toilet: 'wc', weather: 'partly_cloudy_day', air_quality: 'air' };
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
    copy.append(title, caption);
    // Pastel pin (Stitch "Zestaw Pastelowych Pinezek"): a dot when zoomed out, a pin when zoomed in.
    const theme = themeFor(place);
    button.dataset.theme = theme;
    const pin = document.createElement('span'); pin.className = 'result-pin'; pin.setAttribute('aria-hidden', 'true');
    const glyph = document.createElement('span'); glyph.className = 'material-symbols-outlined result-pin__icon'; glyph.textContent = place.category === 'toilet' ? 'wc' : themeIcons[theme];
    pin.append(glyph);
    // Recommended results show a white star on the small zoomed-out drop; zoomed in they look like every other pin.
    if (recommended) {
      const star = document.createElement('span'); star.className = 'material-symbols-outlined result-pin__star'; star.textContent = 'star';
      pin.append(star);
    }
    button.append(thumbnail(place), copy, pin);
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
  // Free / paid from the source data. The city calendar has no price field, so the text is checked;
  // when it says nothing the card tells the user to check with the organiser instead of guessing.
  function priceInfo(place) {
    if (!['event', 'sports'].includes(place.category)) return null;
    if (place.free === true) return { kind: 'free', label: 'Bezpłatne' };
    if (place.free === false) return { kind: 'paid', label: 'Płatne' };
    const words = [place.name, place.description, ...(place.activities || [])].filter(Boolean).join(' ').toLowerCase();
    if (/bezpłatn|wstęp wolny|wstęp darmowy|darmow|nieodpłatn/.test(words)) return { kind: 'free', label: 'Bezpłatne' };
    if (/odpłatn|płatn|bilet|\d+\s*zł/.test(words)) return { kind: 'paid', label: 'Płatne' };
    return { kind: 'unknown', label: 'Cena: sprawdź u organizatora' };
  }
  function resultDetails(place, recommended, full = false) {
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
    // Key facts at the top: price, time and place, each with an icon.
    const facts = document.createElement('div'); facts.className = 'result-detail__facts';
    const price = priceInfo(place);
    for (const [kind, icon, value] of [['price', price?.kind === 'free' ? 'money_off' : 'payments', price?.label], ['time', 'schedule', timing], ['place', 'location_on', location]]) {
      if (!value) continue;
      const row = document.createElement('p'); row.className = 'result-detail__fact'; row.dataset.kind = kind;
      if (kind === 'price') row.dataset.price = price.kind;
      const glyph = document.createElement('span'); glyph.className = 'material-symbols-outlined result-detail__fact-icon'; glyph.setAttribute('aria-hidden', 'true'); glyph.textContent = icon;
      const label = document.createElement('span'); label.className = 'result-detail__fact-text'; label.textContent = value;
      row.append(glyph, label); facts.append(row);
    }
    if (facts.children.length) body.append(facts);
    if (place.description) {
      const paragraph = document.createElement('p'); paragraph.className = 'result-detail__description'; paragraph.textContent = place.description; body.append(paragraph);
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
    if (Number.isFinite(place.lat) && Math.abs(place.lat) <= 90 && Number.isFinite(place.lng) && Math.abs(place.lng) <= 180) {
      const transit = document.createElement('button'); transit.type = 'button'; transit.className = 'result-detail__transit'; transit.textContent = 'Dojedź komunikacją →';
      transit.addEventListener('click', () => window.dispatchEvent(new CustomEvent('city:transit', { detail: { destination: { latitude: place.lat, longitude: place.lng, label: place.name } } })));
      body.append(transit);
    }
    card.append(body);
    if (!full) {
      // Expand button on the photo's top-left corner (the close button sits top-right).
      const expand = document.createElement('button'); expand.type = 'button'; expand.className = 'result-detail__expand';
      expand.setAttribute('aria-label', 'Pełny ekran'); expand.title = 'Pełny ekran';
      const expandIcon = document.createElement('span'); expandIcon.className = 'material-symbols-outlined'; expandIcon.setAttribute('aria-hidden', 'true'); expandIcon.textContent = 'open_in_full';
      expand.append(expandIcon);
      expand.addEventListener('click', event => { event.stopPropagation(); openFullDetails(place, recommended, card.getBoundingClientRect()); });
      card.append(expand); // absolutely positioned; kept last so the photo and body stay first
    }
    return card;
  }
  // Full-screen event view over the whole app; closes with the back button, Escape or a swipe down.
  function openFullDetails(place, recommended, fromRect) {
    // Preferred: open inside the conversation panel with an expand animation (app.js).
    if (window.openEventInConversation) {
      const details = resultDetails(place, recommended, true); details.classList.add('result-detail--full');
      window.openEventInConversation(details, { title: place.name, fromRect });
      return;
    }
    const shell = document.querySelector('.app-shell') || document.body;
    shell.querySelector('.event-full')?.remove();
    const overlay = document.createElement('div'); overlay.className = 'event-full';
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true'); overlay.setAttribute('aria-label', place.name);
    const back = document.createElement('button'); back.type = 'button'; back.className = 'event-full__back'; back.setAttribute('aria-label', 'Zamknij pełny opis');
    const backIcon = document.createElement('span'); backIcon.className = 'material-symbols-outlined'; backIcon.setAttribute('aria-hidden', 'true'); backIcon.textContent = 'close';
    back.append(backIcon);
    const details = resultDetails(place, recommended, true); details.classList.add('result-detail--full');
    overlay.append(back, details);
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = event => { if (event.key === 'Escape') close(); };
    back.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    let startY = null;
    overlay.addEventListener('pointerdown', event => { startY = overlay.scrollTop <= 0 ? event.clientY : null; });
    overlay.addEventListener('pointerup', event => { if (startY !== null && event.clientY - startY > 80) close(); startY = null; });
    shell.append(overlay);
    window.renderLocalIcons?.(overlay);
    back.focus();
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
          google.clearRoute();
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
