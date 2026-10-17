import test from 'node:test';import assert from 'node:assert/strict';
import {createWalkingProvider,decodePolyline6,walkingKey} from '../server/walking.mjs';
import {planPedestrianGraph} from '../server/walking-router.mjs';
import {planGraph} from '../server/transit-router.mjs';
const a={latitude:52.2,longitude:21},b={latitude:52.2002,longitude:21.0002};
function encode(points){let latitude=0,longitude=0,result='';function integer(value){let num=value<0?-value*2-1:value*2;while(num>=32){result+=String.fromCharCode((num%32)+95);num=Math.floor(num/32);}result+=String.fromCharCode(num+63);}for(const point of points){const lat=Math.round(point.latitude*1e6),lon=Math.round(point.longitude*1e6);integer(lat-latitude);integer(lon-longitude);latitude=lat;longitude=lon;}return result;}
const reply=(path=[a,b],overrides={})=>({trip:{status:0,summary:{time:30,length:.04},legs:[{shape:encode(path)}],...overrides}});
const provider=(data=reply(),fetchImpl)=>createWalkingProvider({url:'https://walking.example/route',fetchImpl:fetchImpl||(async()=>new Response(JSON.stringify(data)))});
test('Valhalla pedestrian request is fixed, authenticated city data is never forwarded and native polyline6 is decoded',async()=>{
 let request;const walking=provider(reply(),async(url,init)=>{request={url,...init};return new Response(JSON.stringify(reply()));});const result=await walking.route(a,b);
 assert.equal(request.url,'https://walking.example/route');assert.equal(request.method,'POST');assert.equal(request.redirect,'error');assert.equal(request.headers.Authorization,undefined);assert.equal(request.headers['X-Client-Id'],'warsaw-ai-local-prototype');
 const body=JSON.parse(request.body);assert.equal(body.costing,'pedestrian');assert.equal(body.costing_options.pedestrian.walking_speed,4.32);assert.deepEqual(body.locations.map(p=>[p.lat,p.lon]),[[52.2,21],[52.2002,21.0002]]);assert.ok(body.locations.every(p=>p.search_cutoff===25));assert.deepEqual(result.path,[a,b]);assert.equal(result.geometry,'osm_pedestrian');assert.equal(result.durationMillis,30000);assert.equal(result.distanceMeters,40);
 assert.deepEqual(decodePolyline6(encode([a,b,a])),[a,b,a]);for(const bad of ['?','~','x'.repeat(300001)])assert.throws(()=>decodePolyline6(bad),{code:'WALK_SCHEMA'});
});
test('walking rejects malformed replies, far snaps, unreachable endpoints, redirects and timeouts explicitly',async()=>{
 for(const data of [reply([a,b],{summary:{time:NaN,length:.1}}),reply([a,b],{summary:{time:10,length:-1}}),reply([a,b],{legs:[]}),reply([a]),reply([{latitude:91,longitude:21},b])])await assert.rejects(()=>provider(data).route(a,b),{code:'WALK_SCHEMA'});
 await assert.rejects(()=>provider(reply([{latitude:52.21,longitude:21},b])).route(a,b),{code:'WALK_UNREACHABLE'});
 await assert.rejects(()=>provider({error_code:442}).route(a,b),{code:'WALK_UNREACHABLE'});
 await assert.rejects(()=>provider(null,async()=>new Response('{}',{status:503})).route(a,b),{code:'WALK_ROUTING_UNAVAILABLE'});
 await assert.rejects(()=>provider(null,async()=>{throw new TypeError('redirect disallowed');}).route(a,b),{code:'WALK_ROUTING_UNAVAILABLE'});
 const slow=createWalkingProvider({url:'https://walking.example/route',timeoutMs:5,fetchImpl:async(_url,{signal})=>new Promise((_resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('test delay')),100);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});})});await assert.rejects(()=>slow.route(a,b),{code:'WALK_ROUTING_UNAVAILABLE'});
 const controller=new AbortController();controller.abort();await assert.rejects(()=>provider().route(a,b,{signal:controller.signal}),{name:'AbortError'});
 for(const url of ['http://remote.example/route','https://user:password@walking.example/route','https://walking.example/route?url=anything'])assert.throws(()=>createWalkingProvider({url}),{code:'WALK_CONFIG'});
 assert.doesNotThrow(()=>createWalkingProvider({url:'http://127.0.0.1:8002/route'}));
});
const instant=clock=>Date.parse('2026-10-17T'+clock+'+02:00');
const event=(stopId,clock)=>({stopId,arrival:instant(clock),departure:instant(clock),pickup:0,dropOff:0});
function graph(){const stops=[{...a,id:'a',name:'A'},{latitude:52.22,longitude:21,id:'b',name:'B'},{latitude:52.22,longitude:21.002,id:'c',name:'C'},{latitude:52.24,longitude:21,id:'d',name:'D'}];return{timeZone:'Europe/Warsaw',source:{url:'https://gtfs.ztm.waw.pl/last',validFrom:'2026-10-17',validTo:'2026-10-17'},stops,trips:[{id:'first',line:'17',routeType:0,stopTimes:[event('a','14:00:00'),event('b','14:10:00')]},{id:'early',line:'22',routeType:0,stopTimes:[event('c','14:16:00'),event('d','14:25:00')]},{id:'later',line:'22',routeType:0,stopTimes:[event('c','14:25:00'),event('d','14:35:00')]}]};}
const options=g=>({origin:{...g.stops[0],label:'Start'},destination:{...g.stops[3],label:'Cel'},departureTime:instant('13:59:00')});
const routed=(from,to,durationMillis=500000)=>({geometry:'osm_pedestrian',durationMillis,distanceMeters:500,path:[from,{latitude:from.latitude,longitude:to.longitude},to],source:{name:'OpenStreetMap',url:'https://www.openstreetmap.org/copyright'}});
test('actual pedestrian duration is used before transfer feasibility and selects the later exact trip',async()=>{
 const g=graph(),request=options(g);assert.deepEqual(planGraph(g,request)[0].steps.filter(s=>s.mode==='TRANSIT').map(s=>s.tripId),['first','early']);let calls=0;
 const routes=await planPedestrianGraph(g,request,{provider:{route:async(from,to)=>{calls++;return routed(from,to);}}});
 assert.ok(routes.length);assert.deepEqual(routes[0].steps.filter(s=>s.mode==='TRANSIT').map(s=>s.tripId),['first','later']);assert.equal(routes[0].arrival,instant('14:35:00'));assert.equal(routes[0].steps.find(s=>s.mode==='WALK').end,instant('14:18:20'));assert.ok(routes[0].walkingVerified);assert.ok(calls<=12);assert.deepEqual(routes[0].destinationPoint,{latitude:52.24,longitude:21});
});
test('unreachable directed walks are excluded, while alternative pickup stops and later vehicles remain available',async()=>{
 const g=graph();g.trips.push({id:'direct-after-transfer-failure',line:'103',routeType:3,stopTimes:[event('b','14:20:00'),event('d','14:40:00')]});let failed=0;
 const routes=await planPedestrianGraph(g,options(g),{provider:{route:async()=>{failed++;throw Object.assign(new Error('No pedestrian route'),{code:'WALK_UNREACHABLE'});}}});assert.ok(failed);assert.deepEqual(routes[0].steps.filter(s=>s.mode==='TRANSIT').map(s=>s.tripId),['first','direct-after-transfer-failure']);assert.equal(routes[0].arrival,instant('14:40:00'));
});
test('actual origin walk can miss a pickup and replan instead of shifting geometry after ETA computation',async()=>{
 const g=graph();g.trips=[{id:'missed',line:'17',stopTimes:[event('a','14:00:00'),event('d','14:20:00')]},{id:'later-origin',line:'17',stopTimes:[event('a','14:05:00'),event('d','14:30:00')]}];const request={...options(g),origin:{latitude:52.1998,longitude:21,label:'GPS'}};
 assert.equal(planGraph(g,request)[0].steps.find(s=>s.mode==='TRANSIT').tripId,'missed');const routes=await planPedestrianGraph(g,request,{provider:{route:async(from,to)=>routed(from,to,180000)}});assert.equal(routes[0].steps.find(s=>s.mode==='TRANSIT').tripId,'later-origin');assert.equal(routes[0].steps[0].end,instant('14:02:00'));
});
test('verification is request-local and bounded; failures and cancellation never return heuristic paths as verified',async()=>{
 const g=graph(),request=options(g);await assert.rejects(()=>planPedestrianGraph(g,request,{maxCalls:0,provider:{route:async()=>assert.fail()}}),{code:'WALK_VERIFICATION_LIMIT'});
 await assert.rejects(()=>planPedestrianGraph(g,request,{provider:{route:async()=>{throw Object.assign(new Error('offline'),{code:'WALK_ROUTING_UNAVAILABLE'});}}}),{code:'WALK_ROUTING_UNAVAILABLE'});
 const controller=new AbortController();controller.abort();await assert.rejects(()=>planPedestrianGraph(g,{...request,signal:controller.signal}),{name:'AbortError'});
 let calls=0;const p={route:async(from,to)=>{calls++;return routed(from,to,100000);}};await planPedestrianGraph(g,request,{provider:p});const first=calls;await planPedestrianGraph(g,request,{provider:p});assert.equal(calls,first*2);assert.equal(walkingKey(a,b),walkingKey({...a},b));
});
