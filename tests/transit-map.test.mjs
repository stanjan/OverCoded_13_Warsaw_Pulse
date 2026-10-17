import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {runInNewContext} from 'node:vm';
const source=await readFile(new URL('../map.js',import.meta.url),'utf8');
function element(tag){return{tag,children:[],dataset:{},style:{},attributes:{},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},removeAttribute(){},setAttribute(key,value){this.attributes[key]=String(value);},addEventListener(){}};}
function setup(){const calls=[],markers=[],lines=[],groups=[];class Circle{constructor(options){Object.assign(this,options);}setCenter(value){this.center=value;}setRadius(value){this.radius=value;}}const nativeMap={panTo(){},setZoom(){},fitBounds(bounds,padding){calls.push(['bounds',bounds,padding]);},getZoom:()=>12,addListener(){}};class Marker{constructor(options){Object.assign(this,options);markers.push(this);}}class Polyline{constructor(options){Object.assign(this,options);lines.push(this);}setMap(value){this.map=value;}}
 const leafletMap={setView(){return this;},on(){return this;},invalidateSize(){},getZoom:()=>12,fitBounds(points,padding){calls.push(['leaflet-bounds',points,padding]);},closePopup(){calls.push(['close-popup']);}},L={map:()=>leafletMap,tileLayer:()=>({addTo(){}}),layerGroup:()=>{const group={items:[],addTo(){return this;},clearLayers(){this.cleared=true;this.items=[];}};groups.push(group);return group;},polyline:(path,options)=>({addTo(layer){layer.items.push({kind:'line',path,options});calls.push(['leaflet-line',path,options,layer]);}}),divIcon:options=>options,circle:()=>({addTo(){return this;},setLatLng(){return this;},setRadius(){return this;}}),marker:(position,options)=>({addTo(layer){const marker={kind:'marker',position,options};layer.items?.push(marker);calls.push(['leaflet-marker',position,options,layer]);return marker;}})};
 const maps={Circle,Polyline,LatLngBounds:class{constructor(){this.points=[];}extend(point){this.points.push(point);}},importLibrary:async name=>name==='maps'?{Map:class{constructor(){return nativeMap;}},InfoWindow:class{addListener(){}close(){calls.push(['close-info']);}}}:{AdvancedMarkerElement:Marker},event:{addListenerOnce(_map,_name,callback){queueMicrotask(callback);}},CollisionBehavior:{}};const context={URL,URLSearchParams,console,L,google:{maps},window:{google:{maps},L},fetch:async()=>({ok:true,json:async()=>({googleMapsApiKey:'test-browser-key'})}),document:{createElement:element,createElementNS:(_ns,tag)=>element(tag)},ResizeObserver:class{observe(){}}};runInNewContext(source,context);return{context,calls,markers,lines,groups};}
const route={steps:[{mode:'WALK',path:[{latitude:52.2,longitude:21},{latitude:52.21,longitude:21}]},{mode:'TRANSIT',path:[{latitude:52.21,longitude:21},{latitude:52.25,longitude:21.02}]}]};
test('endpoint markers clear the route bar in a constrained map and Leaflet excludes the overlaid sheet',async()=>{
 const{context,calls}=setup(),canvas={...element('div'),clientHeight:203,getBoundingClientRect:()=>({top:0,bottom:203})};
 context.document.querySelector=()=>({getBoundingClientRect:()=>({top:207})});let leaflet;const google=await context.window.createCityMap(canvas,{onReplace:adapter=>leaflet=adapter});google.showRoute(route,{top:120});let padding=calls.filter(call=>call[0]==='bounds').at(-1)[2];assert.ok(padding.top-44>118,'the whole endpoint must clear the 118px route bar');assert.ok(padding.top+padding.bottom<203);
 canvas.clientHeight=150;google.showRoute(route,{top:120});padding=calls.filter(call=>call[0]==='bounds').at(-1)[2];assert.equal(padding.bottom,0);assert.ok(padding.top+padding.bottom<150,'short maps must not receive impossible padding');
 canvas.clientHeight=700;canvas.getBoundingClientRect=()=>({top:0,bottom:700});context.document.querySelector=()=>({getBoundingClientRect:()=>({top:400})});context.window.gm_authFailure();await new Promise(resolve=>setImmediate(resolve));Object.assign(canvas.children.at(-1),{clientHeight:700,getBoundingClientRect:()=>({top:0,bottom:700})});leaflet.showRoute(route,{top:120});padding=calls.filter(call=>call[0]==='leaflet-bounds').at(-1)[2];assert.equal(padding.paddingTopLeft[1],172);assert.equal(padding.paddingBottomRight[1],324);
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
 const shown=markers.filter(marker=>marker.content.className==='transit-vehicle');assert.deepEqual(shown.map(marker=>marker.content.style.backgroundColor),colors);
 google.showVehicles(excluded);assert.ok(shown.every(marker=>marker.map===null));assert.equal(markers.filter(marker=>marker.map&&marker.content.className==='transit-vehicle').length,0);
 context.window.gm_authFailure();await new Promise(resolve=>setImmediate(resolve));
 leaflet.showRoute(colored);assert.deepEqual(calls.filter(call=>call[0]==='leaflet-line').map(call=>call[2].color),['#61776a',...colors]);
 leaflet.showVehicles([...vehicles,...excluded]);
 assert.deepEqual(calls.filter(call=>call[0]==='leaflet-marker'&&call[2].icon.html.className==='transit-vehicle').map(call=>call[2].icon.html.style.backgroundColor),colors);
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
 google.showRoute(selected);const line=lines[0];assert.equal(line.strokeOpacity,0);assert.equal(line.icons.length,1);assert.equal(line.icons[0].repeat,'12px');assert.equal(line.icons[0].icon.fillColor,'#4285F4');assert.equal(line.icons[0].icon.strokeColor,'#ffffff');assert.equal(line.icons[0].icon.strokeWeight,2);assert.equal(markers[0].position.lat,52.2101);assert.equal(markers[0].position.lng,21.0001);
 context.window.gm_authFailure();await new Promise(resolve=>setImmediate(resolve));assert.equal(line.map,null);leaflet.showRoute(selected);const drawn=calls.filter(c=>c[0]==='leaflet-line');assert.equal(drawn.length,2);assert.deepEqual(drawn.map(c=>c[2].color),['#ffffff','#4285F4']);assert.deepEqual(drawn.map(c=>c[2].weight),[8,4]);assert.ok(drawn.every(c=>c[2].dashArray==='0 12'&&c[2].lineCap==='round'&&c[2].opacity===1));const dest=calls.filter(c=>c[0]==='leaflet-marker').at(-1);assert.equal(dest[1][0],52.2101);leaflet.clearRoute();assert.equal(groups[1].items.length,0);
 // A schematic fallback must not inherit the verified path's blue dots.
 leaflet.showRoute(route);assert.equal(calls.filter(c=>c[0]==='leaflet-line').at(-2)[2].color,'#61776a');
});
