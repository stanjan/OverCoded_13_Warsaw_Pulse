import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {runInNewContext} from 'node:vm';
const source=await readFile(new URL('../map.js',import.meta.url),'utf8');
function element(tag){return{tag,children:[],dataset:{},style:{},attributes:{},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},removeAttribute(){},setAttribute(key,value){this.attributes[key]=String(value);},addEventListener(){}};}
function setup(){const calls=[],markers=[],lines=[],groups=[],infos=[],observers=[],timers=new Map();let timerId=0;class Circle{constructor(options){Object.assign(this,options);}setCenter(value){this.center=value;}setRadius(value){this.radius=value;}}const nativeMap={panBy(x,y){calls.push(['pan',x,y]);},panTo(){},setZoom(){},fitBounds(bounds,padding){calls.push(['bounds',bounds,padding]);},getZoom:()=>12,addListener(){}};class Marker{constructor(options){Object.assign(this,options);markers.push(this);this.listeners={};}addEventListener(name,callback){this.listeners[name]=callback;}}class Polyline{constructor(options){Object.assign(this,options);lines.push(this);}setMap(value){this.map=value;}}
 const leafletMap={setView(){return this;},on(){return this;},invalidateSize(){},getZoom:()=>12,fitBounds(points,padding){calls.push(['leaflet-bounds',points,padding]);},closePopup(){calls.push(['close-popup']);}},L={map:()=>leafletMap,tileLayer:()=>({addTo(){}}),layerGroup:()=>{const group={items:[],addTo(){return this;},clearLayers(){this.cleared=true;this.items=[];}};groups.push(group);return group;},polyline:(path,options)=>({addTo(layer){layer.items.push({kind:'line',path,options});calls.push(['leaflet-line',path,options,layer]);}}),divIcon:options=>options,circle:()=>({addTo(){return this;},setLatLng(){return this;},setRadius(){return this;}}),marker:(position,options)=>({listeners:{},bindPopup(content,popupOptions){this.popup=content;this.popupOptions=popupOptions;return this;},on(name,callback){this.listeners[name]=callback;return this;},getPopup(){return{options:this.popupOptions,update(){calls.push(['update-popup']);}};},addTo(layer){Object.assign(this,{kind:'marker',position,options});layer.items?.push(this);calls.push(['leaflet-marker',position,options,layer]);return this;}})};
 const maps={Circle,Polyline,LatLngBounds:class{constructor(){this.points=[];}extend(point){this.points.push(point);}},importLibrary:async name=>name==='maps'?{Map:class{constructor(){return nativeMap;}},InfoWindow:class{constructor(options){this.options=options;this.listeners={};infos.push(this);}addListener(name,callback){this.listeners[name]=callback;}setContent(content){this.content=content;}open(options){calls.push(['open-info',this.content,options]);}close(){calls.push(['close-info']);}}}:{AdvancedMarkerElement:Marker},event:{addListenerOnce(_map,_name,callback){queueMicrotask(callback);}},CollisionBehavior:{}};const context={URL,URLSearchParams,console,L,google:{maps},window:{google:{maps},L},fetch:async()=>({ok:true,json:async()=>({googleMapsApiKey:'test-browser-key'})}),document:{createElement:element,createElementNS:(_ns,tag)=>element(tag)},setTimeout(callback){const id=++timerId;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id),ResizeObserver:class{constructor(callback){this.callback=callback;this.targets=[];observers.push(this);}observe(target){this.targets.push(target);}}};runInNewContext(source,context);return{context,calls,markers,lines,groups,infos,resize(target){observers.filter(observer=>observer.targets.includes(target)).forEach(observer=>observer.callback());},flushResize(){const pending=[...timers.values()];timers.clear();pending.forEach(callback=>callback());}};}
const route={steps:[{mode:'WALK',path:[{latitude:52.2,longitude:21},{latitude:52.21,longitude:21}]},{mode:'TRANSIT',path:[{latitude:52.21,longitude:21},{latitude:52.25,longitude:21.02}]}]};
test('route framing waits for usable space, then fits above the sheet and below the weather bar on resize',async()=>{
 const{context,calls,resize,flushResize}=setup();let height=203,sheetTop=207,barBottom=118;
 const canvas={...element('div'),get clientHeight(){return height;},getBoundingClientRect:()=>({top:0,bottom:height})};
 const sheet={getBoundingClientRect:()=>({top:sheetTop})},bar={getBoundingClientRect:()=>({bottom:barBottom})};context.document.querySelector=selector=>selector==='#ai-sheet'?sheet:selector==='#environment-bar'?bar:null;
 let leaflet;const google=await context.window.createCityMap(canvas,{onReplace:adapter=>leaflet=adapter});google.showRoute(route,{top:120});assert.equal(calls.filter(call=>call[0]==='bounds').length,0,'do not fit into a seven-pixel slit before the panel collapses');
 height=500;sheetTop=504;resize(canvas);flushResize();let padding=calls.filter(call=>call[0]==='bounds').at(-1)[2];assert.equal(padding.top,170);assert.equal(padding.bottom,24,'Google canvas already ends above the sheet');assert.ok(height-padding.top-padding.bottom>=64);
 barBottom=100;resize(bar);flushResize();padding=calls.filter(call=>call[0]==='bounds').at(-1)[2];assert.equal(padding.top,152,'use the current bar geometry after its animation');
 const fitted=calls.filter(call=>call[0]==='bounds').length;height=150;resize(canvas);flushResize();assert.equal(calls.filter(call=>call[0]==='bounds').length,fitted,'a temporarily covered canvas does not receive an impossible fit');
 height=700;sheetTop=400;barBottom=118;context.window.gm_authFailure();await new Promise(resolve=>setImmediate(resolve));const holder=canvas.children.at(-1);Object.assign(holder,{clientHeight:700,getBoundingClientRect:()=>({top:0,bottom:700})});leaflet.showRoute(route,{top:120});padding=calls.filter(call=>call[0]==='leaflet-bounds').at(-1)[2];assert.equal(padding.paddingTopLeft[1],170);assert.equal(padding.paddingBottomRight[1],324);
 sheetTop=600;resize(sheet);flushResize();padding=calls.filter(call=>call[0]==='leaflet-bounds').at(-1)[2];assert.equal(padding.paddingBottomRight[1],124,'Leaflet refits when the overlaid panel shrinks');
});
test('route selection closes result details and reserves the expanded weather bar on both providers',async()=>{
 const{context,calls}=setup();let leaflet;const google=await context.window.createCityMap(element('div'),{onReplace:adapter=>leaflet=adapter});google.showRoute(route,{top:120});assert.ok(calls.some(call=>call[0]==='close-info'));assert.equal(calls.find(call=>call[0]==='bounds')[2].top,172);
 context.window.gm_authFailure();await new Promise(resolve=>setImmediate(resolve));leaflet.showRoute(route,{top:120});assert.ok(calls.some(call=>call[0]==='close-popup'));assert.equal(calls.find(call=>call[0]==='leaflet-bounds')[2].paddingTopLeft[1],172);
});
test('Google and Leaflet preserve transport colors and show only confirmed fresh vehicles',async()=>{
 const{context,lines,markers,calls}=setup();let leaflet;
 const google=await context.window.createCityMap(element('div'),{onReplace:adapter=>leaflet=adapter});
 const colors=['#880077','#000000','#8A0000','#008800'];
 const colored={steps:[route.steps[0],...colors.map(transportColor=>({...route.steps[1],transportColor}))]};
 google.showRoute(colored);assert.deepEqual(lines.map(line=>line.strokeColor),['#61776a',...colors]);
 const now=Date.now(),vehicles=colors.map((transportColor,index)=>({latitude:52.2,longitude:21,line:String(index),freshness:'recent',observedAt:new Date(now).toISOString(),transportColor}));
 const excluded=[{...vehicles[0],freshness:'stale'},{...vehicles[0],freshness:'unknown'},{...vehicles[0],observedAt:null},{...vehicles[0],observedAt:new Date(now-91000).toISOString()},{...vehicles[0],observedAt:new Date(now+61000).toISOString()}];
 google.showVehicles([...vehicles,...excluded]);
 const shown=markers.filter(marker=>marker.content.className==='transit-vehicle');assert.deepEqual(shown.map(marker=>marker.content.style.color),colors);
 google.showVehicles(excluded);assert.ok(shown.every(marker=>marker.map===null));assert.equal(markers.filter(marker=>marker.map&&marker.content.className==='transit-vehicle').length,0);
 context.window.gm_authFailure();await new Promise(resolve=>setImmediate(resolve));
 leaflet.showRoute(colored);assert.deepEqual(calls.filter(call=>call[0]==='leaflet-line').map(call=>call[2].color),['#61776a',...colors]);
 leaflet.showVehicles([...vehicles,...excluded]);
 assert.deepEqual(calls.filter(call=>call[0]==='leaflet-marker'&&call[2].icon.html.className==='transit-vehicle').map(call=>call[2].icon.html.style.color),colors);
 leaflet.showVehicles(excluded);assert.equal(calls.filter(call=>call[0]==='leaflet-marker'&&call[2].icon.html.className==='transit-vehicle').at(-1)[3].items.length,0);
});
test('Google shows only a destination pin, replaces it and preserves the GPS dot when clearing routes',async()=>{
 const{context,markers,lines}=setup(),adapter=await context.window.createCityMap(element('div'));
 adapter.showUser({lat:52.19,lng:20.99,accuracy:12});const gps=markers[0],gpsPosition=gps.position;
 const selected={steps:[...route.steps,{mode:'WALK',path:[route.steps.at(-1).path.at(-1),{latitude:52.251,longitude:21.021},{latitude:NaN,longitude:21.1},null]}]};
 assert.equal(adapter.showRoute(selected),true);assert.equal(lines.length,3);assert.equal(markers.length,2);
 const destination=markers[1];assert.equal(destination.title,'Cel podróży');assert.equal(destination.content.className,'transit-destination');
 assert.equal(destination.content.textContent,undefined);assert.equal(destination.content.children[0].tag,'svg');
 assert.equal(destination.position.lat,52.251);assert.equal(destination.position.lng,21.021);assert.equal(destination.anchorLeft,'-50%');assert.equal(destination.anchorTop,'-100%');
 adapter.showRoute(route);assert.equal(destination.map,null);assert.equal(lines[0].map,null);assert.equal(markers.filter(marker=>marker.map&&marker!==gps).length,1);
 assert.equal(gps.position,gpsPosition);assert.ok(gps.map);
 adapter.showVehicles([{latitude:52.2,longitude:21,type:2,line:'17',observedAt:new Date().toISOString(),freshness:'recent'}]);assert.equal(markers.at(-1).content.dataset.freshness,'recent');assert.match(markers.at(-1).title,/nie jest ETA/);
 adapter.clearRoute();assert.equal(markers.filter(marker=>marker.map&&marker!==gps).length,0);assert.ok(gps.map);assert.equal(gps.position,gpsPosition);
 adapter.showRoute({steps:[{path:[null,{latitude:91,longitude:21}]}]});assert.equal(markers.filter(marker=>marker.map&&marker!==gps).length,0);
});
test('fallback clears the Google destination and Leaflet recreates one correctly anchored pin without stale overlays',async()=>{
 const{context,calls,markers,groups}=setup();let replacement;
 const adapter=await context.window.createCityMap(element('div'),{onReplace:map=>replacement=map});adapter.showRoute(route);context.window.gm_authFailure();assert.equal(markers[0].map,null);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(replacement.vendor,'leaflet');replacement.showUser({lat:52.19,lng:20.99,accuracy:10});
 const gpsCall=calls.find(call=>call[0]==='leaflet-marker'&&call[2].title==='Twoja lokalizacja');
 const selected={steps:[...route.steps,{mode:'WALK',path:[{latitude:52.251,longitude:21.021},null,{latitude:52.2,longitude:181}]}]};
 assert.equal(replacement.showRoute(selected),true);assert.equal(calls.filter(c=>c[0]==='leaflet-line').length,2);
 const transit=groups[1],vehicles=groups[2],destination=transit.items.filter(item=>item.kind==='marker');assert.equal(destination.length,1);
 assert.equal(destination[0].position[0],52.251);assert.equal(destination[0].position[1],21.021);assert.equal(destination[0].options.title,'Cel podróży');
 assert.equal(destination[0].options.icon.iconSize.join(','),'36,44');assert.equal(destination[0].options.icon.iconAnchor.join(','),'18,44');assert.equal(destination[0].options.icon.html.className,'transit-destination');
 replacement.showVehicles([{latitude:52.2,longitude:21,type:1,line:'116',observedAt:new Date().toISOString(),freshness:'recent'}]);assert.equal(vehicles.items.length,1);
 replacement.showRoute(route);assert.equal(transit.items.filter(item=>item.kind==='marker').length,1);assert.equal(vehicles.items.length,0);
 replacement.clearRoute();assert.equal(transit.items.length,0);assert.equal(vehicles.items.length,0);assert.equal(gpsCall[1].join(','),'52.19,20.99');
 assert.equal(replacement.showRoute({steps:[{path:[null,{latitude:91,longitude:21}]}]}),false);assert.equal(transit.items.length,0);
});

test('both maps draw all dim full-trip contexts below active legs, fit only the journey and clear every overlay',async()=>{
 const{context,calls,lines}=setup();let leaflet;const google=await context.window.createCityMap(element('div'),{onReplace:adapter=>leaflet=adapter});
 const first={...route.steps[1],mode:'TRANSIT',geometry:'gtfs_shape',transportColor:'#8A0000',fullPathGeometry:'gtfs_shape',fullPath:[{latitude:52,longitude:20},...route.steps[1].path,{latitude:52.4,longitude:21.2}]};
 const second={...first,transportColor:'#880077',path:[{latitude:52.25,longitude:21.02},{latitude:52.26,longitude:21.03}],fullPath:[{latitude:52.24,longitude:21.01},{latitude:52.25,longitude:21.02},{latitude:52.26,longitude:21.03},{latitude:52.6,longitude:21.4}]};
 const selected={steps:[route.steps[0],first,second]};
 google.showRoute(selected);assert.equal(lines.length,5);assert.deepEqual(lines.map(line=>line.strokeOpacity),[.2,.2,.5,.9,.9]);assert.deepEqual(lines.slice(0,2).map(line=>line.strokeColor),['#8A0000','#880077']);
 assert.equal(lines[0].path[0].lat,52);assert.equal(lines[4].path.at(-1).lat,52.26);
 const fitted=calls.find(call=>call[0]==='bounds')[1].points;assert.ok(fitted.every(point=>point.lat>=52.2&&point.lat<=52.26));
 context.window.gm_authFailure();assert.ok(lines.every(line=>line.map===null));await new Promise(resolve=>setImmediate(resolve));
 leaflet.showRoute(selected);const drawn=calls.filter(call=>call[0]==='leaflet-line');assert.equal(drawn.length,5);assert.deepEqual(drawn.map(call=>call[2].opacity),[.2,.2,.5,.9,.9]);
 assert.ok(calls.find(call=>call[0]==='leaflet-bounds')[1].every(point=>point[0]>=52.2&&point[0]<=52.26));
 const layer=drawn[0][3];leaflet.clearRoute();assert.equal(layer.items.length,0);
 // A schematic or malformed context must never be presented as a whole line.
 for(const leg of [{...first,geometry:'schematic'},{...first,fullPathGeometry:undefined},{...first,fullPath:[...first.fullPath,null]}]){
  leaflet.showRoute({steps:[leg]});assert.equal(layer.items.filter(item=>item.kind==='line').length,1);
 }
 google.showRoute(route);assert.ok(lines.slice(0,5).every(line=>line.map===null));google.clearRoute();assert.ok(lines.every(line=>line.map===null));
});

test('verified walking paths use blue circles with white outlines on both maps, preserve destination coordinates and clear overlays',async()=>{
 const{context,calls,lines,markers,groups}=setup();let leaflet;const google=await context.window.createCityMap(element('div'),{onReplace:adapter=>leaflet=adapter});
 const selected={destinationPoint:{latitude:52.2101,longitude:21.0001},steps:[{mode:'WALK',geometry:'osm_pedestrian',path:[{latitude:52.2,longitude:21},{latitude:52.205,longitude:21.001},{latitude:52.21,longitude:21}]}]};
 google.showRoute(selected);const line=lines[0];assert.equal(line.strokeOpacity,0);assert.equal(line.icons.length,1);assert.equal(line.icons[0].repeat,'16px');assert.equal(line.icons[0].icon.scale,5);assert.equal(line.icons[0].icon.fillColor,'#4285F4');assert.equal(line.icons[0].icon.strokeColor,'#ffffff');assert.equal(line.icons[0].icon.strokeWeight,2);assert.equal(markers[0].position.lat,52.2101);assert.equal(markers[0].position.lng,21.0001);
 context.window.gm_authFailure();await new Promise(resolve=>setImmediate(resolve));assert.equal(line.map,null);leaflet.showRoute(selected);const drawn=calls.filter(c=>c[0]==='leaflet-line');assert.equal(drawn.length,2);assert.deepEqual(drawn.map(c=>c[2].color),['#ffffff','#4285F4']);assert.deepEqual(drawn.map(c=>c[2].weight),[12,8]);assert.ok(drawn.every(c=>c[2].dashArray==='0 16'&&c[2].lineCap==='round'&&c[2].opacity===1));const dest=calls.filter(c=>c[0]==='leaflet-marker').at(-1);assert.equal(dest[1][0],52.2101);leaflet.clearRoute();assert.equal(groups[1].items.length,0);
 // A schematic fallback must not inherit the verified path's blue dots.
 leaflet.showRoute(route);assert.equal(calls.filter(c=>c[0]==='leaflet-line').at(-2)[2].color,'#61776a');
});


test('vehicle refreshes do not refit a selected route and cleared or externally focused routes stay cleared on resize',async()=>{
 const{context,calls,resize,flushResize}=setup(),canvas=element('div');let leaflet;
 const google=await context.window.createCityMap(canvas,{onReplace:adapter=>leaflet=adapter});google.showRoute(route);
 let count=calls.filter(call=>call[0]==='bounds').length;google.showVehicles([{latitude:52.2,longitude:21,line:'17',freshness:'recent',observedAt:new Date().toISOString()}]);assert.equal(calls.filter(call=>call[0]==='bounds').length,count);
 google.clearRoute();resize(canvas);flushResize();assert.equal(calls.filter(call=>call[0]==='bounds').length,count);
 google.showRoute(route);google.setView({lat:52.3,lng:21.1},16);count=calls.filter(call=>call[0]==='bounds').length;resize(canvas);flushResize();assert.equal(calls.filter(call=>call[0]==='bounds').length,count,'event or GPS focus owns the view after setView');
 google.showRoute(route);google.fitTo([[52.3,21.1]],{top:24,bottom:24,left:24,right:24});count=calls.filter(call=>call[0]==='bounds').length;resize(canvas);flushResize();assert.equal(calls.filter(call=>call[0]==='bounds').length,count);
 context.window.gm_authFailure();await new Promise(resolve=>setImmediate(resolve));const holder=canvas.children.at(-1);leaflet.showRoute(route);count=calls.filter(call=>call[0]==='leaflet-bounds').length;
 leaflet.showVehicles([]);assert.equal(calls.filter(call=>call[0]==='leaflet-bounds').length,count);
 leaflet.clearRoute();resize(holder);flushResize();assert.equal(calls.filter(call=>call[0]==='leaflet-bounds').length,count);
 leaflet.showRoute(route);leaflet.setView({lat:52.3,lng:21.1},16);count=calls.filter(call=>call[0]==='leaflet-bounds').length;resize(holder);flushResize();assert.equal(calls.filter(call=>call[0]==='leaflet-bounds').length,count);
 leaflet.showRoute(route);leaflet.fitTo([[52.3,21.1]],{top:24,bottom:24,left:24,right:24});count=calls.filter(call=>call[0]==='leaflet-bounds').length;resize(holder);flushResize();assert.equal(calls.filter(call=>call[0]==='leaflet-bounds').length,count);
});


test('white stop dots use only official active-leg stop positions and clear on selection, fallback and reset',async()=>{
 const{context,markers,groups,calls}=setup();let leaflet;const google=await context.window.createCityMap(element('div'),{onReplace:adapter=>leaflet=adapter});
 const stop=(id,latitude)=>({id,name:'Stop '+id,latitude,longitude:21});
 const selected={steps:[{...route.steps[1],stopPositionSource:'gtfs_stop_sequence',stopPositions:[stop('a',52.21),stop('b',52.26),stop('c',52.25),stop('b',52.26),null,stop('bad',91)],fullPath:[stop('outside',52.8)]},{...route.steps[0],stopPositionSource:'gtfs_stop_sequence',stopPositions:[stop('walk',52.2)]},{...route.steps[1],stopPositions:[stop('unverified',52.24)]}]};
 google.showRoute(selected);let dots=markers.filter(marker=>marker.content.className==='transit-stop');assert.equal(dots.length,3);assert.deepEqual(dots.map(dot=>dot.position.lat),[52.21,52.26,52.25]);assert.ok(calls.find(call=>call[0]==='bounds')[1].points.some(point=>point.lat===52.26),'include source stop coordinates beyond the shape in active framing');assert.ok(dots.every(dot=>dot.zIndex===150&&dot.anchorTop==='-50%'));google.showRoute(route);assert.ok(dots.every(dot=>dot.map===null));
 google.showRoute(selected);dots=markers.filter(marker=>marker.content.className==='transit-stop');context.window.gm_authFailure();await new Promise(resolve=>setImmediate(resolve));assert.ok(dots.every(dot=>dot.map===null));leaflet.showRoute(selected);
 const layer=groups[1],leafDots=layer.items.filter(item=>item.options?.icon?.html?.className==='transit-stop');assert.equal(leafDots.length,3);assert.ok(calls.filter(call=>call[0]==='leaflet-bounds').at(-1)[1].some(point=>point[0]===52.26));assert.ok(leafDots.every(dot=>dot.options.interactive===true&&dot.options.keyboard===true&&dot.options.icon.iconSize.join(',')==='6,6'));leaflet.showRoute(route);assert.equal(layer.items.filter(item=>item.options?.icon?.html?.className==='transit-stop').length,0);leaflet.showRoute(selected);leaflet.clearRoute();assert.equal(layer.items.length,0);
});

test('round vehicle glyphs open safe line/direction popups, reject stale markers, and refresh removes popups',async()=>{
 const{context,markers,calls,groups}=setup();let leaflet;const google=await context.window.createCityMap(element('div'),{onReplace:adapter=>leaflet=adapter});
 const vehicle={latitude:52.2,longitude:21,type:2,line:'17',transportKind:'tram',transportColor:'#8A0000',transportLabel:'Tramwaj',freshness:'recent',observedAt:new Date().toISOString(),direction:'Żerań <img>',directionSource:'confirmed_gtfs_trip'};
 google.showVehicles([vehicle,{...vehicle,freshness:'stale'},{...vehicle,observedAt:new Date(Date.now()-100000).toISOString()}]);assert.equal(markers.length,1);const marker=markers[0];assert.equal(marker.gmpClickable,true);assert.equal(marker.content.textContent,undefined);assert.equal(marker.content.children[0].tag,'svg');assert.equal(marker.content.style.color,'#8A0000');marker.listeners['gmp-click']();let popup=calls.find(call=>call[0]==='open-info');assert.equal(popup[1].children[0].textContent,'Tramwaj 17');assert.equal(popup[1].children[1].textContent,'Żerań <img>');assert.equal(popup[2].anchor,marker);let closes=calls.filter(call=>call[0]==='close-info').length;google.showVehicles([]);assert.equal(marker.map,null);assert.ok(calls.filter(call=>call[0]==='close-info').length>closes);
 context.window.gm_authFailure();await new Promise(resolve=>setImmediate(resolve));leaflet.showVehicles([vehicle,{...vehicle,line:'S2',type:1,transportKind:'skm',transportColor:'#008800',directionSource:null}]);const live=groups[2].items;assert.equal(live.length,2);assert.equal(live[0].options.keyboard,true);assert.equal(live[0].options.icon.iconSize.join(','),'36,36');assert.equal(live[0].popup.children[1].textContent,'Żerań <img>');assert.equal(live[1].popup.children[1].textContent,'Kierunek niepotwierdzony');assert.equal(live[1].options.icon.html.style.color,'#008800');assert.equal(live[0].options.icon.html.children[0].children[0].attributes.d,live[1].options.icon.html.children[0].children[0].attributes.d);leaflet.showVehicles([]);assert.equal(groups[2].items.length,0);leaflet.showVehicles([vehicle]);leaflet.clearRoute();assert.equal(groups[2].items.length,0);
});


test('vehicle popup panning respects weather, sheet and canvas edges, with dynamic Leaflet padding',async()=>{
 const{context,markers,calls,groups,infos}=setup();let leaflet,barBottom=118,sheetTop=500;
 const canvas={...element('div'),getBoundingClientRect:()=>({top:20,bottom:700,left:0,right:800})};
 context.document.querySelector=selector=>selector==='#environment-bar'?{getBoundingClientRect:()=>({bottom:barBottom})}:selector==='#ai-sheet'?{getBoundingClientRect:()=>({top:sheetTop})}:null;
 const google=await context.window.createCityMap(canvas,{onReplace:adapter=>leaflet=adapter}),vehicle={latitude:52.2,longitude:21,line:'26',freshness:'recent',observedAt:new Date().toISOString()};google.showVehicles([vehicle]);markers[0].listeners['gmp-click']();const popup=infos[1];assert.equal(popup.options.disableAutoPan,true);
 let rect={top:48,bottom:143,left:502,right:670};popup.content.closest=selector=>{assert.equal(selector,'[role="dialog"]');return{getBoundingClientRect:()=>rect};};popup.listeners.domready();assert.deepEqual(calls.filter(call=>call[0]==='pan').at(-1),['pan',0,-78]);
 rect={top:420,bottom:520,left:760,right:900};popup.listeners.domready();assert.deepEqual(calls.filter(call=>call[0]==='pan').at(-1),['pan',112,32]);
 rect={top:180,bottom:280,left:100,right:220};const count=calls.filter(call=>call[0]==='pan').length;popup.listeners.domready();assert.equal(calls.filter(call=>call[0]==='pan').length,count,'already visible popup stays put');google.showVehicles([]);popup.listeners.domready();assert.equal(calls.filter(call=>call[0]==='pan').length,count,'late domready cannot pan after refresh');
 context.window.gm_authFailure();await new Promise(resolve=>setImmediate(resolve));const holder=canvas.children.at(-1);holder.getBoundingClientRect=canvas.getBoundingClientRect;leaflet.showVehicles([vehicle]);const marker=groups[2].items[0];assert.equal(marker.popupOptions.autoPanPaddingTopLeft.join(','),'12,106');assert.equal(marker.popupOptions.autoPanPaddingBottomRight.join(','),'12,212');barBottom=170;sheetTop=450;marker.listeners.popupopen();assert.equal(marker.popupOptions.autoPanPaddingTopLeft.join(','),'12,158');assert.equal(marker.popupOptions.autoPanPaddingBottomRight.join(','),'12,262');assert.ok(calls.some(call=>call[0]==='update-popup'));
});


test('small stop dots follow the active curved path on both maps without changing official stop positions or framing',async()=>{
 const{context,markers,calls,groups}=setup();let leaflet;const google=await context.window.createCityMap(element('div'),{onReplace:adapter=>leaflet=adapter});
 const point=(latitude,longitude)=>({latitude,longitude});
 const path=[point(52,21),point(52.001,21),point(52.001,21.002)];
 const source=[{id:'a',name:'A',...point(52.0005,21.00008)},{id:'b',name:'B',...point(52.00106,21.001)}];
 const selected={steps:[{mode:'TRANSIT',path,geometry:'gtfs_shape',fullPathGeometry:'gtfs_shape',fullPath:[point(51.99,21.00008),...path,point(52.02,21.001)],stopPositionSource:'gtfs_stop_sequence',stopPositions:source}]};
 const before=JSON.stringify(selected);google.showRoute(selected);
 const dots=markers.filter(marker=>marker.content.className==='transit-stop');assert.equal(dots.length,2);
 assert.ok(Math.abs(dots[0].position.lng-21)<1e-10);assert.ok(Math.abs(dots[0].position.lat-52.0005)<1e-10);
 assert.ok(Math.abs(dots[1].position.lat-52.001)<1e-10);assert.ok(Math.abs(dots[1].position.lng-21.001)<1e-10);
 assert.ok(dots.every(dot=>dot.anchorLeft==='-50%'&&dot.anchorTop==='-50%'&&dot.content.style.width==='6px'&&dot.content.style.height==='6px'));
 assert.equal(JSON.stringify(selected),before,'display projection must not mutate GTFS coordinates, walking endpoints or ETA data');
 const fitted=calls.find(call=>call[0]==='bounds')[1].points;assert.ok(fitted.some(p=>p.lat===source[1].latitude&&p.lng===source[1].longitude),'framing retains the true stop location');
 context.window.gm_authFailure();await new Promise(resolve=>setImmediate(resolve));assert.ok(dots.every(dot=>dot.map===null));leaflet.showRoute(selected);
 const leafDots=groups[1].items.filter(item=>item.options?.icon?.html?.className==='transit-stop');
 assert.equal(leafDots.length,2);for(let i=0;i<2;i++){assert.equal(leafDots[i].position[0],dots[i].position.lat);assert.equal(leafDots[i].position[1],dots[i].position.lng);assert.equal(leafDots[i].options.icon.iconSize.join(','),'6,6');assert.equal(leafDots[i].options.icon.iconAnchor.join(','),'3,3');}
 leaflet.clearRoute();assert.equal(groups[1].items.length,0);assert.equal(JSON.stringify(selected),before);
});

test('ordered stop matching does not jump to the nearer returning loop arm or another active leg',async()=>{
 const{context,markers}=setup(),google=await context.window.createCityMap(element('div'));
 const point=(latitude,longitude)=>({latitude,longitude});
 const path=[point(52,21),point(52.004,21),point(52.004,21.0002),point(52,21.0002)];
 const stops=[{id:'a',...point(52.001,21.00018)},{id:'b',...point(52.003,21.00002)},{id:'c',...point(52.002,21.00018)}];
 const selected={steps:[{mode:'TRANSIT',path,stopPositionSource:'gtfs_stop_sequence',stopPositions:stops},{mode:'TRANSIT',path:[point(52,21.00018),point(52.004,21.00018)]}]};
 google.showRoute(selected);const dots=markers.filter(marker=>marker.content.className==='transit-stop');assert.equal(dots.length,3);
 assert.ok(Math.abs(dots[0].position.lng-21)<1e-10,'following stops disambiguate the first stop onto the outbound arm');
 assert.ok(Math.abs(dots[1].position.lng-21)<1e-10);assert.ok(Math.abs(dots[2].position.lng-21.0002)<1e-10);
 google.clearRoute();assert.ok(dots.every(dot=>dot.map===null));
});

test('unusable or distant active geometry retains source stop positions instead of inventing a match',async()=>{
 const{context,markers}=setup(),google=await context.window.createCityMap(element('div'));
 const stop={id:'a',latitude:52.1,longitude:21.1};
 for(const path of [[],[null,{latitude:52.1,longitude:21.1}],[{latitude:52.1,longitude:21.1},{latitude:52.1,longitude:21.1}],[{latitude:52,longitude:21},{latitude:52.001,longitude:21}]]){
  google.showRoute({steps:[{mode:'TRANSIT',path,stopPositionSource:'gtfs_stop_sequence',stopPositions:[stop]}]});
  const dot=markers.filter(marker=>marker.map&&marker.content.className==='transit-stop').at(-1);assert.equal(dot.position.lat,stop.latitude);assert.equal(dot.position.lng,stop.longitude);
 }
});

test('stop bubbles show safe official names and platform codes, remain through live refresh and clear with the route',async()=>{
 const{context,markers,infos,calls,groups}=setup();let leaflet,barBottom=120,sheetTop=500;
 const canvas={...element('div'),getBoundingClientRect:()=>({top:0,bottom:700,left:0,right:800})};
 context.document.querySelector=selector=>selector==='#environment-bar'?{getBoundingClientRect:()=>({bottom:barBottom})}:selector==='#ai-sheet'?{getBoundingClientRect:()=>({top:sheetTop})}:null;
 const google=await context.window.createCityMap(canvas,{onReplace:adapter=>leaflet=adapter});
 const stops=[{id:'not-a-platform-1234',name:'Okopowa <img>',platform:'02',latitude:52.21,longitude:21},{id:'invent-no-99',name:'Bez numeru',latitude:52.25,longitude:21.02}];
 const selected={steps:[{...route.steps[1],stopPositionSource:'gtfs_stop_sequence',stopPositions:stops}]};google.showRoute(selected);
 const dots=markers.filter(marker=>marker.content.className==='transit-stop');assert.ok(dots.every(dot=>dot.gmpClickable));assert.equal(dots[0].title,'Przystanek Okopowa <img> · stanowisko 02');
 dots[0].listeners['gmp-click']();const popup=infos[2];assert.equal(popup.options.disableAutoPan,true);assert.equal(popup.content.className,'transit-stop-detail');assert.equal(popup.content.children[0].textContent,'Okopowa <img>');assert.equal(popup.content.children[0].children.length,0,'name cannot create HTML');assert.equal(popup.content.children[1].textContent,'Stanowisko 02');assert.equal(calls.filter(call=>call[0]==='open-info').at(-1)[2].shouldFocus,true);
 popup.content.closest=()=>({getBoundingClientRect:()=>({top:60,bottom:150,left:100,right:220})});popup.listeners.domready();assert.deepEqual(calls.filter(call=>call[0]==='pan').at(-1),['pan',0,-68]);
 google.showVehicles([]);const pans=calls.filter(call=>call[0]==='pan').length;popup.listeners.domready();assert.equal(calls.filter(call=>call[0]==='pan').length,pans+1,'live vehicle refresh preserves the stop popup');
 dots[1].listeners['gmp-click']();assert.equal(popup.content.children.length,1,'missing platform must not be guessed from stop ID');assert.equal(popup.content.children[0].textContent,'Bez numeru');
 popup.content.closest=()=>({getBoundingClientRect:()=>({top:60,bottom:150,left:100,right:220})});google.clearRoute();const cleared=calls.filter(call=>call[0]==='pan').length;popup.listeners.domready();assert.equal(calls.filter(call=>call[0]==='pan').length,cleared,'late popup callbacks cannot pan after route clear');assert.ok(dots.every(dot=>dot.map===null));
 google.showRoute(selected);context.window.gm_authFailure();await new Promise(resolve=>setImmediate(resolve));const holder=canvas.children.at(-1);holder.getBoundingClientRect=canvas.getBoundingClientRect;leaflet.showRoute(selected);
 const leafDots=groups[1].items.filter(item=>item.options?.icon?.html?.className==='transit-stop');assert.equal(leafDots.length,2);assert.ok(leafDots.every(dot=>dot.options.keyboard&&dot.options.interactive));assert.equal(leafDots[0].popup.children[0].textContent,'Okopowa <img>');assert.equal(leafDots[0].popup.children[1].textContent,'Stanowisko 02');assert.equal(leafDots[1].popup.children.length,1);assert.equal(leafDots[0].popupOptions.autoPanPaddingTopLeft.join(','),'12,128');
 barBottom=160;sheetTop=450;leafDots[0].listeners.popupopen();assert.equal(leafDots[0].popupOptions.autoPanPaddingTopLeft.join(','),'12,168');assert.equal(leafDots[0].popupOptions.autoPanPaddingBottomRight.join(','),'12,262');leaflet.clearRoute();assert.equal(groups[1].items.length,0);
});

test('tourist overlays preserve the whole published trace and selected named points on Google and Leaflet, and clear independently of GPS',async()=>{
 const{context,markers,lines,groups,infos,calls,resize,flushResize}=setup();let leaflet;
 const canvas=element('div');const google=await context.window.createCityMap(canvas,{onReplace:adapter=>leaflet=adapter});
 const first={id:'first',category:'route',name:'Spacer',lat:52.2,lng:21,traceSegments:[[[52.2,21],[52.3,21.1],[52.25,21.2]]],touristPoints:[{name:'Pomnik <img>',lat:52.28,lng:21.15}]};
 const second={id:'second',category:'route',traceSegments:[[[52.21,21.01],[52.24,21.03]]],touristPoints:[]};
 google.showUser({lat:52.22,lng:21.01,accuracy:20});const gps=markers[0];google.showTouristRoutes([first,second]);assert.equal(lines.length,2);assert.ok(lines.every(line=>line.icons[1].icon.strokeOpacity===.25));assert.equal(calls.filter(call=>call[0]==='bounds').at(-1)[1].points.some(point=>point.lat===52.3&&point.lng===21.1),true);
 google.showTouristRoutes([first,second],{selectedId:'first'});assert.ok(lines.slice(0,2).every(line=>line.map===null));const active=lines.slice(-2);assert.equal(active[0].icons[1].icon.strokeOpacity,1);assert.equal(active[1].icons[1].icon.strokeOpacity,.25);assert.equal(active[0].icons[0].icon.strokeColor,'#fff8e8');assert.equal(active[0].icons[1].icon.strokeColor,'#3a2a22');assert.equal(active[0].icons[1].repeat,'14px');assert.equal(JSON.stringify(active[0].path),JSON.stringify(first.traceSegments[0].map(([lat,lng])=>({lat,lng}))));
 const point=markers.find(marker=>marker.content.className==='tourist-point');assert.equal(point.title,'Pomnik <img>');assert.equal(point.gmpClickable,true);point.listeners['gmp-click']();assert.equal(infos[3].content.textContent,'Pomnik <img>');assert.equal(infos[3].content.children.length,0);
 const fit=calls.filter(call=>call[0]==='bounds').at(-1)[1].points;assert.ok(fit.some(point=>point.lat===52.3&&point.lng===21.1));assert.ok(fit.every(point=>!(point.lat===52.24&&point.lng===21.03)),'selected framing excludes other traces');
 const before=calls.filter(call=>call[0]==='bounds').length;google.showVehicles([]);assert.equal(calls.filter(call=>call[0]==='bounds').length,before);resize(canvas);flushResize();assert.equal(calls.filter(call=>call[0]==='bounds').length,before+1);
 google.clearMarkers();assert.ok(lines.every(line=>line.map===null));assert.equal(point.map,null);assert.ok(gps.map,'tourism clearing retains GPS');
 google.showTouristRoutes([first],{selectedId:'first'});context.window.gm_authFailure();await new Promise(resolve=>setImmediate(resolve));assert.ok(lines.every(line=>line.map===null),'provider replacement detaches all Google tourism lines');
 leaflet.showTouristRoutes([first,second],{selectedId:'first'});const tourism=groups[3];assert.equal(tourism.items.filter(item=>item.kind==='line').length,4);assert.equal(JSON.stringify(tourism.items[0].path),JSON.stringify(first.traceSegments[0]));assert.equal(tourism.items[0].options.color,'#fff8e8');assert.equal(tourism.items[1].options.color,'#3a2a22');assert.equal(tourism.items[1].options.dashArray,'7 7');assert.equal(tourism.items[1].options.opacity,1);assert.equal(tourism.items[3].options.opacity,.25);const named=tourism.items.find(item=>item.kind==='marker');assert.equal(named.popup.textContent,'Pomnik <img>');assert.equal(named.options.keyboard,true);assert.equal(named.options.title,'Pomnik <img>');assert.ok(calls.filter(call=>call[0]==='leaflet-bounds').at(-1)[1].some(point=>point[0]===52.3&&point[1]===21.1));
 leaflet.showTouristRoutes([second],{selectedId:'second'});assert.equal(tourism.items.length,2);leaflet.clearMarkers();assert.equal(tourism.items.length,0);
});

test('tourist map adapters never bridge malformed segments and transit selection removes tourism overlays',async()=>{
 const{context,lines,groups}=setup();let leaflet;const google=await context.window.createCityMap(element('div'),{onReplace:adapter=>leaflet=adapter});
 const place={category:'route',traceSegments:[[[52.2,21],null,[52.3,21.1]],[[52.4,21],[52.41,21.1]]],touristPoints:[]};google.showTouristRoutes([place]);assert.equal(lines.length,1);assert.equal(lines[0].path.length,2);assert.equal(lines[0].path[0].lat,52.4);google.showRoute(route);assert.equal(lines[0].map,null);
 context.window.gm_authFailure();await new Promise(resolve=>setImmediate(resolve));leaflet.showTouristRoutes([place]);assert.equal(groups[3].items.length,2);leaflet.showRoute(route);assert.equal(groups[3].items.length,0);
});

test('tourist result clouds reserve measured space above the whole route on both maps and resize without native auto-pan',async()=>{
 const{context,calls,infos,groups,resize,flushResize,lines}=setup();let leaflet,sheetTop=580;
 const articles=[];context.document.createElement=tag=>{
  const node=element(tag);node.style.setProperty=(name,value)=>{node.style[name]=value;};node.prepend=(...children)=>{node.children.unshift(...children);};
  if(tag==='article'){articles.push(node);node.closest=()=>({getBoundingClientRect:()=>({height:Number.parseFloat(node.style['--tourist-popup-height']||'400')+24})});}
  return node;
 };
 context.document.querySelector=selector=>selector==='#environment-bar'?{getBoundingClientRect:()=>({bottom:90})}:selector==='#ai-sheet'?{getBoundingClientRect:()=>({top:sheetTop})}:null;
 const canvas={...element('div'),clientHeight:700,getBoundingClientRect:()=>({top:0,bottom:700,left:0,right:800})};const google=await context.window.createCityMap(canvas,{onReplace:adapter=>leaflet=adapter});infos[0].setOptions=options=>{Object.assign(infos[0].options,options);};
 const place={id:'route',name:'Trakt Królewski',category:'route',lat:52.3,lng:21.1,geometryStatus:'published',description:'Long source description '.repeat(1000),traceSegments:[[[52.3,21.1],[52.2,21.05]]],touristPoints:[]};
 google.showTouristRoutes([place],{recommendedId:place.id});assert.equal(lines.at(-1).icons[1].icon.strokeOpacity,1,'recommendation is emphasized before a manual click');google.addMarker(place).open();infos[0].listeners.domready();
 const details=articles.at(-1);assert.equal(details.className,'result-detail tourist-result-detail');assert.equal(details.style['--tourist-popup-height'],'200px');assert.equal(infos[0].options.disableAutoPan,true);assert.equal(details.children[0].className,'result-detail__close');
 let bounds=calls.filter(call=>call[0]==='bounds').at(-1);assert.ok(bounds[2].top>=422,'cloud height plus marker anchor fits above the complete trace');assert.ok(bounds[2].top+bounds[2].bottom+64<=700);assert.equal(bounds[1].points.length,3,'both path endpoints and result anchor retained');assert.equal(calls.some(call=>call[0]==='pan'),false);
 sheetTop=470;resize(canvas);flushResize();bounds=calls.filter(call=>call[0]==='bounds').at(-1);assert.ok(Number.parseFloat(details.style['--tourist-popup-height'])<200,'short viewport reduces the scrollable cloud before fitting');assert.ok(bounds[2].top+bounds[2].bottom+64<=700);
 context.window.gm_authFailure();await new Promise(resolve=>setImmediate(resolve));context.L.DomEvent={disableClickPropagation(){}};const nativeMarker=context.L.marker;context.L.marker=(...args)=>{const marker=nativeMarker(...args);marker.getElement=()=>null;marker.openPopup=()=>{marker.listeners.popupopen?.();return marker;};return marker;};
 const holder=canvas.children.at(-1);Object.assign(holder,{clientHeight:700,getBoundingClientRect:canvas.getBoundingClientRect});leaflet.showTouristRoutes([place],{recommendedId:place.id});const marker=leaflet.addMarker(place);marker.open();
 const result=groups[0].items.at(-1);assert.equal(result.popupOptions.autoPan,false);assert.match(result.popup.className,/tourist-result-detail/);const leafBounds=calls.filter(call=>call[0]==='leaflet-bounds').at(-1);assert.ok(leafBounds[2].paddingTopLeft[1]>250);assert.ok(leafBounds[2].paddingTopLeft[1]+leafBounds[2].paddingBottomRight[1]+64<=700);assert.ok(leafBounds[1].some(point=>point[0]===52.3));assert.ok(leafBounds[1].some(point=>point[0]===52.2));
});
