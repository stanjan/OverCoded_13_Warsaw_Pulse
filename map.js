// City map adapter: Google Maps when configured, Leaflet/OpenStreetMap otherwise.
// Both expose the same small API so app.js does not depend on a map vendor.
(() => {
  const WARSAW = { lat: 52.2318, lng: 21.006 };
  const START_ZOOM = 12;
  // Below this zoom results are small icons; zooming in turns them into bubbles with photo and name.
  const DETAIL_ZOOM = 16;
  const DESTINATION_PIN = { width: 36, height: 44 };
  const STOP_DOT_SIZE = 6;

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

  // Popups must fit the visible map, including overlays unknown to either map SDK.
  function popupViewport(element) {
    const rect=element.getBoundingClientRect?.();if(!rect)return null;
    const bar=document.querySelector?.('#environment-bar')?.getBoundingClientRect?.(),sheet=document.querySelector?.('#ai-sheet')?.getBoundingClientRect?.();
    return {left:rect.left+12,right:rect.right-12,top:Math.max(rect.top,bar?.bottom??rect.top)+8,bottom:Math.min(rect.bottom,sheet?.top??rect.bottom)-12};
  }
  function vehiclePopupPadding(element) {
    const rect=element.getBoundingClientRect?.(),view=popupViewport(element);
    return view?{autoPanPaddingTopLeft:[12,view.top-rect.top],autoPanPaddingBottomRight:[12,rect.bottom-view.bottom]}:{autoPanPaddingTopLeft:[12,12],autoPanPaddingBottomRight:[12,12]};
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
  function touristCloudPadding(element, padding, details) {
    if (!details) return padding;
    const view=popupViewport(element),canvas=element.getBoundingClientRect?.();
    if(!view||!canvas)return padding;
    // Leave room for the complete route below the result cloud and its marker.
    const height=Math.min(200,Math.max(80,view.bottom-view.top-220));
    details.style.setProperty?.('--tourist-popup-height',height+'px');
    const cloud=details.closest?.('[role="dialog"], .leaflet-popup')?.getBoundingClientRect?.()||details.getBoundingClientRect?.();
    return {...padding,top:Math.max(padding.top,view.top-canvas.top+(cloud?.height||height)+100)};
  }

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
    const vehicleInfo = new InfoWindow({ maxWidth: 230, disableAutoPan: true });
    let vehiclePopupContent;
    vehicleInfo.addListener('closeclick',()=>{vehiclePopupContent=null;});
    vehicleInfo.addListener('domready',()=>{
      const rect=(vehiclePopupContent?.closest?.('[role="dialog"]')||vehiclePopupContent)?.getBoundingClientRect?.(),view=popupViewport(element);
      if(!rect||!view)return;
      const x=rect.left<view.left?rect.left-view.left:rect.right>view.right?rect.right-view.right:0;
      const y=rect.top<view.top?rect.top-view.top:rect.bottom>view.bottom?rect.bottom-view.bottom:0;
      if(x||y)map.panBy(x,y);
    });
    const stopInfo = new InfoWindow({ maxWidth: 230, disableAutoPan: true });
    let stopPopupContent;
    const closeStopPopup = () => { stopInfo.close?.();stopPopupContent=null; };
    stopInfo.addListener('closeclick',()=>{stopPopupContent=null;});
    stopInfo.addListener('domready',()=>{
      const rect=(stopPopupContent?.closest?.('[role="dialog"]')||stopPopupContent)?.getBoundingClientRect?.(),view=popupViewport(element);
      if(!rect||!view)return;
      const x=rect.left<view.left?rect.left-view.left:rect.right>view.right?rect.right-view.right:0;
      const y=rect.top<view.top?rect.top-view.top:rect.bottom>view.bottom?rect.bottom-view.bottom:0;
      if(x||y)map.panBy(x,y);
    });
    let activeBubble, activeMarker, touristResultDetails;
    // Every result pin stays visible, even when pins overlap.
    const optionalCollision = google.maps.CollisionBehavior?.REQUIRED;
    info.addListener('closeclick', () => { touristResultDetails=null;activeBubble?.setAttribute('aria-expanded', 'false'); if (activeMarker) activeMarker.collisionBehavior = optionalCollision; if(routeView?.tourism)fitRoute(); });
    info.addListener('domready',()=>{if(touristResultDetails&&routeView?.tourism)fitRoute();});
    let markers = [];
    let routeLines = [], routeMarkers = [], vehicleMarkers = [], routeView;
    let touristPlaces = [], touristLines = [], touristMarkers = [], touristRecommendedId;
    const touristInfo = new InfoWindow({ maxWidth: 230, disableAutoPan: true });
    let touristPopupContent;
    touristInfo.addListener('closeclick',()=>{touristPopupContent=null;});
    touristInfo.addListener('domready',()=>{
      const rect=(touristPopupContent?.closest?.('[role="dialog"]')||touristPopupContent)?.getBoundingClientRect?.(),view=popupViewport(element);
      if(!rect||!view)return;
      const x=rect.left<view.left?rect.left-view.left:rect.right>view.right?rect.right-view.right:0;
      const y=rect.top<view.top?rect.top-view.top:rect.bottom>view.bottom?rect.bottom-view.bottom:0;
      if(x||y)map.panBy(x,y);
    });
    const clearTourism = () => {
      touristInfo.close?.(); touristPopupContent=null; touristLines.forEach(line => line.setMap(null)); touristMarkers.forEach(marker => { marker.map = null; });
      touristLines = []; touristMarkers = []; if (routeView?.tourism) routeView = null;
    };
    const showTouristRoutes = (places, { selectedId, recommendedId = touristRecommendedId } = {}) => {
      clearTourism(); touristPlaces = places.filter(place => place.category === 'route');
      touristRecommendedId=recommendedId;
      const selected = touristPlaces.find(place => place.id === (selectedId||recommendedId));
      for (const place of touristPlaces) for (const segment of touristSegments(place)) {
        const opacity=place===selected?1:.25;
        touristLines.push(new google.maps.Polyline({ map, path: segment.map(([lat,lng]) => ({lat,lng})), strokeColor: '#8a6537', strokeWeight: 4, strokeOpacity: 0, icons:['#fff8e8','#8a6537'].map((color,index)=>({icon:{path:'M 0,-3 0,3',scale:1,strokeColor:color,strokeWeight:index?3:7,strokeOpacity:opacity},offset:'0',repeat:'14px'})), clickable: false, zIndex: place === selected ? 5 : 0 }));
      }
      for (const [index, point] of touristPoints(selected).entries()) {
        const marker = new AdvancedMarkerElement({map,position:{lat:point.lat,lng:point.lng},content:touristPointElement(index),title:point.name,gmpClickable:true,anchorLeft:'-50%',anchorTop:'-50%',zIndex:210});
        marker.addEventListener('gmp-click', () => { touristPopupContent=touristPointDetails(point);touristInfo.setContent(touristPopupContent); touristInfo.open({map,anchor:marker,shouldFocus:true}); }); touristMarkers.push(marker);
      }
      const points = touristMapPoints(selected ? [selected] : touristPlaces);
      if (points.length) { routeView = {tourism:true,points:points.map(([latitude,longitude])=>({latitude,longitude})),options:{}}; fitRoute(); }
      return points.length > 0;
    };
    const fitRoute = () => {
      if (!routeView) return;
      const padding = touristCloudPadding(element,routePadding(element, routeView.options),routeView.tourism?touristResultDetails:null);
      if (!canFitRoute(element, padding)) return;
      const bounds = new google.maps.LatLngBounds();routeView.points.forEach(point => bounds.extend({lat:point.latitude,lng:point.longitude}));
      map.fitBounds(bounds, padding);
    };
    observeRouteViewport(element, fitRoute);
    const clearRoute = () => { closeStopPopup();vehicleInfo.close?.();vehiclePopupContent=null;routeView = null; routeLines.forEach(line => line.setMap(null)); [...routeMarkers,...vehicleMarkers].forEach(marker => { marker.map = null; }); routeLines = []; routeMarkers = []; vehicleMarkers = []; };
    let userDot, userAccuracy;
    const syncDetail = () => element.classList?.toggle('markers-compact', Math.round(map.getZoom()) < DETAIL_ZOOM);
    map.addListener('zoom_changed', syncDetail);
    syncDetail();

    return {
      vendor: 'google',
      ready,
      clearRoute,
      showTouristRoutes,
      showRoute(route, { top = 65 } = {}) {
        touristResultDetails=null;
        clearTourism();
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
        for(const stop of activeRouteStops(route, true)){
          const marker=new AdvancedMarkerElement({map,position:{lat:stop.latitude,lng:stop.longitude},content:stopElement(),title:stopTitle(stop),gmpClickable:true,anchorLeft:'-50%',anchorTop:'-50%',zIndex:150});
          marker.addEventListener('gmp-click',()=>{vehicleInfo.close?.();vehiclePopupContent=null;stopPopupContent=stopDetails(stop);stopInfo.setContent(stopPopupContent);stopInfo.open({map,anchor:marker,shouldFocus:true});});routeMarkers.push(marker);
        }
        const points = (route?.steps || []).flatMap(step => validTransitPath(step.path));
        if (points.length) {
          routeView = {points:[...points,...activeRouteStops(route),...validTransitPath([route.destinationPoint])],options:{top}};fitRoute();
          const destination = validTransitPath([route.destinationPoint])[0]||points.at(-1);
          routeMarkers.push(new AdvancedMarkerElement({ map, position: { lat: destination.latitude, lng: destination.longitude }, content: destinationElement(), title: 'Cel podróży', anchorLeft: '-50%', anchorTop: '-100%', zIndex: 300 }));
        }
        return routeLines.length > 0;
      },
      showVehicles(vehicles) {
        vehicleInfo.close?.();vehiclePopupContent=null;vehicleMarkers.forEach(marker => { marker.map = null; });vehicleMarkers = [];
        for (const vehicle of vehicles || []) {
          if (!validTransitPath([vehicle]).length || !freshVehicle(vehicle)) continue;
          const marker=new AdvancedMarkerElement({ map, position:{lat:vehicle.latitude,lng:vehicle.longitude}, content:vehicleElement(vehicle), title:vehicleTitle(vehicle), gmpClickable:true, zIndex:250 });
          marker.addEventListener('gmp-click',()=>{closeStopPopup();vehiclePopupContent=vehicleDetails(vehicle);vehicleInfo.setContent(vehiclePopupContent);vehicleInfo.open({map,anchor:marker,shouldFocus:true});});vehicleMarkers.push(marker);
        }
      },
      setView({ lat, lng }, zoom) { routeView = null; map.panTo({ lat, lng }); map.setZoom(zoom); },
      clearMarkers() { touristResultDetails=null;clearTourism(); touristPlaces = []; touristRecommendedId=undefined;info.close?.(); activeBubble?.setAttribute('aria-expanded', 'false'); markers.forEach(m => { m.map = null; }); markers = []; },
      addMarker(place, { recommended = false, onOpen } = {}) {
        const bubble = resultBubble(place, recommended);
        const marker = new AdvancedMarkerElement({ map, position: { lat: place.lat, lng: place.lng }, title: place.name, content: bubble, gmpClickable: true, zIndex: recommended ? 200 : 100, collisionBehavior: optionalCollision });
        const open = () => {
          touristResultDetails=null;
          routeView = null;onOpen?.();
          if (place.category === 'route') showTouristRoutes(touristPlaces, {selectedId:place.id});
          else clearTourism();
          activeBubble?.setAttribute('aria-expanded', 'false');
          if (activeMarker) activeMarker.collisionBehavior = optionalCollision;
          activeBubble = bubble;
          activeMarker = marker;
          marker.collisionBehavior = google.maps.CollisionBehavior?.REQUIRED_AND_HIDES_OPTIONAL;
          bubble.setAttribute('aria-expanded', 'true');
          const details = resultDetails(place, recommended);
          if(place.category==='route')touristResultDetails=details;
          info.setOptions?.({disableAutoPan:place.category==='route'});
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
    const touristLayer = L.layerGroup().addTo(map);
    let touristPlaces = [], touristRecommendedId;
    const results = [];
    let activeMarker, touristResultDetails;
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
      const padding = touristCloudPadding(element,routePadding(element, routeView.options),routeView.tourism?touristResultDetails:null);
      if (canFitRoute(element, padding)) map.fitBounds(routeView.points,{paddingTopLeft:[padding.left,padding.top],paddingBottomRight:[padding.right,padding.bottom],animate:false});
    };
    observeRouteViewport(element, fitRoute);
    const clearTourism = () => { touristLayer.clearLayers(); if (routeView?.tourism) routeView = null; };
    const showTouristRoutes = (places, { selectedId, recommendedId = touristRecommendedId } = {}) => {
      clearTourism(); touristPlaces = places.filter(place => place.category === 'route');
      touristRecommendedId=recommendedId;
      const selected = touristPlaces.find(place => place.id === (selectedId||recommendedId));
      for (const place of touristPlaces) for (const segment of touristSegments(place)) for(const [color,weight] of [['#fff8e8',8],['#8a6537',3]])L.polyline(segment,{color,weight,opacity:place === selected ? 1 : .25,dashArray:'7 7',lineCap:'round',interactive:false}).addTo(touristLayer);
      for (const [index, point] of touristPoints(selected).entries()) {
        const marker=L.marker([point.lat,point.lng],{icon:L.divIcon({className:'',html:touristPointElement(index),iconSize:[22,22],iconAnchor:[11,11]}),title:point.name,keyboard:true,zIndexOffset:210}).bindPopup(touristPointDetails(point),{className:'tourist-point-popup',maxWidth:230,...vehiclePopupPadding(element)});
        marker.on('popupopen',()=>{const popup=marker.getPopup();Object.assign(popup.options,vehiclePopupPadding(element));popup.update();});marker.addTo(touristLayer);
      }
      const points=touristMapPoints(selected?[selected]:touristPlaces);
      if(points.length){routeView={tourism:true,points,options:{}};fitRoute();}return points.length>0;
    };
    return {
      vendor: 'leaflet',
      ready,
      showTouristRoutes,
      clearRoute() { map.closePopup?.();routeView = null;transitLayer.clearLayers(); vehicleLayer.clearLayers(); },
      showRoute(route, { top = 65 } = {}) {
        touristResultDetails=null;
        clearTourism();
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
        for(const stop of activeRouteStops(route, true)){
          const marker=L.marker([stop.latitude,stop.longitude],{icon:L.divIcon({className:'',html:stopElement(),iconSize:[STOP_DOT_SIZE,STOP_DOT_SIZE],iconAnchor:[STOP_DOT_SIZE/2,STOP_DOT_SIZE/2],popupAnchor:[0,-STOP_DOT_SIZE/2]}),title:stopTitle(stop),keyboard:true,interactive:true,zIndexOffset:150}).bindPopup(stopDetails(stop),{className:'transit-stop-popup',maxWidth:230,...vehiclePopupPadding(element)});
          marker.on('popupopen',()=>{const popup=marker.getPopup();Object.assign(popup.options,vehiclePopupPadding(element));popup.update();});marker.addTo(transitLayer);
        }
        if(points.length){
          const icon=L.divIcon({className:'',html:destinationElement(),iconSize:[DESTINATION_PIN.width,DESTINATION_PIN.height],iconAnchor:[DESTINATION_PIN.width/2,DESTINATION_PIN.height]});
          const destination=validTransitPath([route.destinationPoint])[0];
          L.marker(destination?[destination.latitude,destination.longitude]:points.at(-1),{icon,title:'Cel podróży',keyboard:false,interactive:false,zIndexOffset:300}).addTo(transitLayer);
          routeView={points:[...points,...activeRouteStops(route).map(stop=>[stop.latitude,stop.longitude]),...(destination?[[destination.latitude,destination.longitude]]:[])],options:{top}};fitRoute();
        }
        return lineCount>0;
      },
      showVehicles(vehicles) {
        vehicleLayer.clearLayers();
        for(const vehicle of vehicles||[]) {
          if(!validTransitPath([vehicle]).length||!freshVehicle(vehicle))continue;
          const marker=L.marker([vehicle.latitude,vehicle.longitude],{icon:L.divIcon({className:'',html:vehicleElement(vehicle),iconSize:[36,36],iconAnchor:[18,18],popupAnchor:[0,-18]}),title:vehicleTitle(vehicle),keyboard:true,zIndexOffset:250}).bindPopup(vehicleDetails(vehicle),{className:'transit-vehicle-popup',maxWidth:230,...vehiclePopupPadding(element)});
          marker.on('popupopen',()=>{const popup=marker.getPopup();Object.assign(popup.options,vehiclePopupPadding(element));popup.update();});marker.addTo(vehicleLayer);
        }
      },

      setView({ lat, lng }, zoom) { routeView = null;map.setView([lat, lng], zoom); },
      clearMarkers() { touristResultDetails=null;clearTourism(); touristPlaces = []; touristRecommendedId=undefined;map.closePopup?.(); layer.clearLayers(); results.length = 0; activeMarker = undefined; },
      addMarker(place, { recommended = false, onOpen } = {}) {
        const bubble = resultBubble(place, recommended);
        const details=resultDetails(place,recommended);
        const icon = L.divIcon({ className: 'result-marker', html: bubble, iconSize: [174, 76], iconAnchor: [87, 76], popupAnchor: [0, -70] });
        const marker = L.marker([place.lat, place.lng], { icon, keyboard: false, zIndexOffset: recommended ? 200 : 100 })
          .bindPopup(details, { className: 'result-info-popup', minWidth: 230, maxWidth: 290, ...(place.category==='route'?{autoPan:false}:{}), autoPanPaddingTopLeft: [12, 70], autoPanPaddingBottomRight: [12, 150] })
          .on('popupopen', () => { touristResultDetails=place.category==='route'?details:null;routeView = null;activeMarker = marker; bubble.setAttribute('aria-expanded', 'true'); arrangeBubbles(); onOpen?.(); if(place.category==='route')showTouristRoutes(touristPlaces,{selectedId:place.id}); else clearTourism(); })
          .on('popupclose', () => { touristResultDetails=null;bubble.setAttribute('aria-expanded', 'false'); if (activeMarker === marker) activeMarker = undefined; arrangeBubbles();if(routeView?.tourism)fitRoute(); })
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

  function touristSegments(place) {
    return place?.category === 'route' && Array.isArray(place.traceSegments) ? place.traceSegments.filter(segment => Array.isArray(segment) && segment.length > 1 && segment.every(point => Array.isArray(point) && point.length === 2 && Number.isFinite(point[0]) && Math.abs(point[0]) <= 90 && Number.isFinite(point[1]) && Math.abs(point[1]) <= 180)) : [];
  }
  function touristPoints(place) { return Array.isArray(place?.touristPoints) ? place.touristPoints.filter(point => typeof point?.name === 'string' && Number.isFinite(point.lat) && Math.abs(point.lat) <= 90 && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180) : []; }
  function touristMapPoints(places) { return places.flatMap(place => [...touristSegments(place).flat(), ...touristPoints(place).map(point => [point.lat,point.lng]), ...(Number.isFinite(place.lat)&&Number.isFinite(place.lng)?[[place.lat,place.lng]]:[])]); }
  function touristPointElement(index) { const dot=document.createElement('span');dot.className='tourist-point';dot.textContent=String(index+1);return dot; }
  function touristPointDetails(point) { const details=document.createElement('strong');details.className='tourist-point-detail';details.textContent=point.name;return details; }
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
  // Display-only alignment: platforms can sit beside a GTFS shape. Match their
  // ordered sequence to this active leg, never to the dimmed whole-trip path.
  function alignedStopPositions(stops, points) {
    const path=validTransitPath(points);
    if(path.length<2||path.length!==points?.length)return stops;
    const radius=6378137,limit=85.05112878;
    const project=point=>({x:radius*point.longitude*Math.PI/180,y:radius*Math.log(Math.tan(Math.PI/4+Math.max(-limit,Math.min(limit,point.latitude))*Math.PI/360))});
    const xy=path.map(project),scale=Math.cos((path[0].latitude+path.at(-1).latitude)*Math.PI/360);
    const candidates=stops.map(stop=>{
      const p=project(stop),result=[];
      for(let index=0;index<xy.length-1;index++){
        const a=xy[index],b=xy[index+1],dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
        if(!length)continue;
        const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/length)),x=a.x+t*dx,y=a.y+t*dy;
        const distance=Math.hypot(p.x-x,p.y-y)*scale;
        if(distance<=150)result.push({progress:index+t,distance,x,y});
      }
      // Allow platform offsets, but do not force a stop onto a distant loop arm
      // just to make the sequence fit. Inconsistent geometry stays unchanged.
      const nearest=Math.min(...result.map(candidate=>candidate.distance));
      return result.filter(candidate=>candidate.distance<=nearest+20);
    });
    if(candidates.some(row=>!row.length))return stops;
    // Dynamic ordered matching considers following stops too: a nearest-only
    // match can prematurely jump to a later branch where a line doubles back.
    let previous=[];
    for(let row=0;row<candidates.length;row++){
      const current=candidates[row];let cursor=0,best;
      for(const candidate of current){
        if(!row){candidate.cost=candidate.distance**2;continue;}
        while(cursor<previous.length&&previous[cursor].progress<=candidate.progress+1e-9){
          const option=previous[cursor++];if(!best||option.cost<best.cost)best=option;
        }
        candidate.cost=best?best.cost+candidate.distance**2:Infinity;candidate.previous=best;
      }
      previous=current;
    }
    let chosen=previous.reduce((best,candidate)=>!best||candidate.cost<best.cost?candidate:best,null);
    if(!Number.isFinite(chosen?.cost))return stops;
    const aligned=[];
    for(let index=stops.length-1;index>=0;index--){
      aligned[index]={...stops[index],longitude:chosen.x/radius*180/Math.PI,latitude:(2*Math.atan(Math.exp(chosen.y/radius))-Math.PI/2)*180/Math.PI};chosen=chosen.previous;
    }
    return aligned;
  }
  function activeRouteStops(route, align=false) {
    const seen=new Set(),stops=[];
    for(const step of route?.steps||[]){
      if(step.mode!=='TRANSIT'||step.stopPositionSource!=='gtfs_stop_sequence')continue;
      const source=validTransitPath(step.stopPositions),positions=align?alignedStopPositions(source,step.path):source;
      for(let index=0;index<source.length;index++){
        const stop=source[index],key=stop.id+'|'+stop.latitude+'|'+stop.longitude;
        if(seen.has(key))continue;seen.add(key);stops.push(positions[index]);
      }
    }return stops;
  }
  function stopElement(){const dot=document.createElement('span');dot.className='transit-stop';dot.style.width=dot.style.height=STOP_DOT_SIZE+'px';dot.setAttribute('aria-hidden','true');return dot;}
  function stopPlatform(stop){return typeof stop.platform==='string'?stop.platform.trim():'';}
  function stopTitle(stop){return 'Przystanek '+(stop.name||'bez nazwy')+(stopPlatform(stop)?' · stanowisko '+stopPlatform(stop):'');}
  function stopDetails(stop){
    const box=document.createElement('div');box.className='transit-stop-detail';
    const name=document.createElement('strong');name.textContent=stop.name||'Przystanek';box.append(name);
    const platform=stopPlatform(stop);if(platform){const label=document.createElement('p');label.textContent='Stanowisko '+platform;box.append(label);}
    return box;
  }
  function vehicleDirection(vehicle){return vehicle.directionSource==='confirmed_gtfs_trip'&&typeof vehicle.direction==='string'&&vehicle.direction.trim()?vehicle.direction:'Kierunek niepotwierdzony';}
  function vehicleTitle(vehicle) { return (vehicle.transportLabel||(vehicle.type===2?'Tramwaj':'Autobus'))+' '+vehicle.line+' · '+vehicleDirection(vehicle)+' · '+(vehicle.sourceClock||'brak czasu')+' · pozycja nie jest ETA'; }
  function vehicleDetails(vehicle){
    const box=document.createElement('div');box.className='transit-vehicle-detail';
    const line=document.createElement('strong');line.textContent=(vehicle.transportLabel||(vehicle.type===2?'Tramwaj':'Autobus'))+' '+vehicle.line;
    const direction=document.createElement('p');direction.textContent=vehicleDirection(vehicle);box.append(line,direction);return box;
  }
  function vehicleElement(vehicle) {
    const element=document.createElement('span');element.className='transit-vehicle';element.dataset.freshness=vehicle.freshness;element.style.color=transitColor(vehicle);element.title=vehicleTitle(vehicle);
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
    const rail=vehicle.transportKind==='tram'||vehicle.transportKind==='skm'||vehicle.type===2;
    const paths=rail?['M7 4h10a2 2 0 0 1 2 2v11H5V6a2 2 0 0 1 2-2Z','M5 12h14M9 4l1-3h4l1 3M8 20l-2 2m10-2 2 2M8 15h.01M16 15h.01']:['M6 3h12a2 2 0 0 1 2 2v13H4V5a2 2 0 0 1 2-2Z','M4 12h16M7 18v3m10-3v3M7 15h.01M17 15h.01M8 6h8'];
    for(const d of paths){const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);svg.append(path);}element.append(svg);return element;
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

  const categoryLabels = { event: 'Wydarzenie', sports: 'Zajęcia sportowe', pitch: 'Boisko', route: 'Trasa', toilet: 'Toaleta', aed: 'Defibrylator AED', weather: 'Pogoda', air_quality: 'Jakość powietrza' };
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

  const categoryIcons = { event: 'local_activity', sports: 'sports_soccer', pitch: 'sports_basketball', route: 'explore', toilet: 'wc', weather: 'partly_cloudy_day', air_quality: 'air' };
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
    if(place.category==='route')button.dataset.tourism='true';
    const pin = document.createElement('span'); pin.className = 'result-pin'; pin.setAttribute('aria-hidden', 'true');
    const glyph = document.createElement('span'); glyph.className = 'material-symbols-outlined result-pin__icon'; glyph.textContent = place.category === 'toilet' ? 'wc' : place.category==='route'?'explore':themeIcons[theme];
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
    const card = document.createElement('article'); card.className = 'result-detail'+(place.category==='route'&&!full?' tourist-result-detail':'');
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
    if (place.category === 'route') {
      const note=document.createElement('p');note.className='result-detail__meta';
      note.textContent=[Number.isFinite(place.lengthKm) ? place.lengthKm+' km' : '', place.geometryStatus === 'partial' ? 'Ślad źródłowy ma przerwy.' : place.geometryStatus !== 'published' ? 'Brak pełnego śladu trasy na mapie.' : 'Przebieg trasy według danych miejskich.'].filter(Boolean).join(' · ');body.append(note);
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
          google.clearMarkers();
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
  // Short facts for the recommended cards in the conversation (theme, when, price, photo).
  const themeLabels = { culture: 'Kultura', sport: 'Sport', education: 'Edukacja', meeting: 'Spotkanie', family: 'Rodzina', seniors: 'Seniorzy', outdoor: 'Plener' };
  function cardWhen(place) {
    const first = (place.dates || [])[0];
    if (!first) return place.time || '';
    const zone = { timeZone: 'Europe/Warsaw' };
    const today = new Intl.DateTimeFormat('en-CA', zone).format(new Date());
    const tomorrow = new Intl.DateTimeFormat('en-CA', zone).format(new Date(Date.now() + 864e5));
    const dayLabel = first.from <= today && first.to >= today ? 'Dziś' : first.from === tomorrow ? 'Jutro'
      : new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', ...zone }).format(new Date(first.from + 'T12:00:00Z'));
    let time = '';
    if (typeof first.sourceFrom === 'string' && first.sourceFrom.includes('T')) {
      const parsed = new Date(first.sourceFrom.replace(/([+-]\d{2})$/, '$1:00'));
      if (Number.isFinite(parsed.getTime())) time = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', ...zone }).format(parsed);
      if (time === '00:00') time = '';
    }
    return [dayLabel, time || place.time].filter(Boolean).join(' ');
  }
  window.cityCardInfo = place => {
    const theme = themeFor(place);
    const price = priceInfo(place);
    return { theme, themeLabel: place.category==='aed'?'AED':themeLabels[theme], icon: place.category==='route'?'explore':themeIcons[theme], when: cardWhen(place), price: price && price.kind !== 'unknown' ? price.label : '', imageUrl: safeUrl(place.imageUrl, true) };
  };
  window.CITY_CENTER = { ...WARSAW, zoom: START_ZOOM };
})();
