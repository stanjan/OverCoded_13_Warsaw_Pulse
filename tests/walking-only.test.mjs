import test from 'node:test';import assert from 'node:assert/strict';
import {planDirectWalk,mergeRouteOptions} from '../server/walking-router.mjs';
import {computeMunicipal,waypoint,routeMode} from '../transit-core.mjs';
import {runTool,mcpTools} from '../mcp/tools.mjs';
const origin={latitude:52.2,longitude:21,label:'Start'},destination={latitude:52.212,longitude:21.003,label:'Cel'},departureTime=Date.parse('2026-10-18T10:00:00Z');
const edge={geometry:'osm_pedestrian',durationMillis:1200000,distanceMeters:1500,path:[origin,{latitude:52.201,longitude:21.003},destination]};
const options={origin,destination,departureTime};
const provider={route:async()=>edge};
test('direct walk constructs one genuine pedestrian leg without any transit identifiers or live claims',async()=>{
 const route=await planDirectWalk(options,{provider});assert.equal(route.mode,'walk');assert.equal(route.timing,'walking_estimate');assert.equal(route.arrival,departureTime+1200000);assert.deepEqual(route.steps[0].path,edge.path);assert.equal(route.steps[0].tripId,undefined);assert.equal(route.steps[0].line,undefined);assert.equal(route.modelAdjusted,false);assert.deepEqual(route.destinationPoint,{latitude:destination.latitude,longitude:destination.longitude});
});
test('direct walk keeps bounded range and never fabricates paths on failure or cancellation',async()=>{
 await assert.rejects(planDirectWalk({...options,destination:{latitude:53,longitude:21}},{provider:{route:()=>assert.fail('range must be checked before provider')}}),{code:'WALK_RANGE'});
 await assert.rejects(planDirectWalk(options,{provider:{route:async()=>({...edge,geometry:'schematic'})}}),{code:'WALK_SCHEMA'});
 await assert.rejects(planDirectWalk(options,{provider:{route:async()=>{throw Object.assign(new Error('unreachable'),{code:'WALK_UNREACHABLE'});}}}),{code:'WALK_UNREACHABLE'});
 const controller=new AbortController();controller.abort();await assert.rejects(planDirectWalk({...options,signal:controller.signal},{provider}),{name:'AbortError'});
});
test('automatic comparison retains a faster walk among three cards and counts future transit waiting by arrival',async()=>{
 const walking=await planDirectWalk(options,{provider});const rides=[30,32,35].map(minutes=>({arrival:departureTime+minutes*60000,steps:[{mode:'TRANSIT'}]}));
 const routes=mergeRouteOptions(rides,walking);assert.equal(routes.length,3);assert.equal(routes[0].mode,'walk');assert.ok(routes[0].recommended);assert.equal(routes.filter(route=>route.recommended).length,1);assert.match(routes[0].recommendationReason,/wcześniej/);
 const future={departure:departureTime+86400000,arrival:departureTime+87000000,durationMillis:600000,nextAvailable:true,steps:[{mode:'TRANSIT'}]};assert.equal(mergeRouteOptions([future],walking)[0].mode,'walk');
 const faster={arrival:departureTime+120000,steps:[{mode:'TRANSIT'}]};assert.equal(mergeRouteOptions([faster],walking)[0].steps[0].mode,'TRANSIT');assert.equal(mergeRouteOptions([faster],walking)[1].mode,'walk');
});
test('walking mode survives client HTTP serialization and MCP action while invalid modes are rejected',async()=>{
 let body;await computeMunicipal({origin:waypoint(origin),destination:waypoint(destination),departureTime:new Date(departureTime),mode:'walk'},{fetchImpl:async(_url,init)=>{body=JSON.parse(init.body);return{ok:true,json:async()=>({routes:[],stops:[],departures:[],vehicles:[]})};}});assert.equal(body.mode,'walk');assert.equal(routeMode(), 'auto');assert.throws(()=>routeMode('drive'),{code:'INVALID_MODE'});
 const state={results:[],actions:[]};const planned=await runTool('plan_transit',{destinationCoordinates:destination,originCoordinates:origin,mode:'walk'},state);assert.equal(planned.action.mode,'walk');assert.equal(state.actions[0].mode,'walk');assert.deepEqual(mcpTools.find(tool=>tool.name==='plan_transit').inputSchema.properties.mode.enum,['auto','walk','transit']);await assert.rejects(runTool('plan_transit',{destinationCoordinates:destination,mode:'drive'},state),/Nieprawidłowy tekst/);
});

const {createTransitService,TRANSIT_SOURCES}=await import('../server/transit.mjs');
const serviceOptions={origin,destination,departureTime:new Date(departureTime).toISOString()};
const stopRecord=(point,index)=>({values:Object.entries({zespol:String(1000+index),slupek:'01',nazwa_zespolu:point.label,szer_geo:String(point.latitude),dlug_geo:String(point.longitude)}).map(([key,value])=>({key,value}))});
const graph=(rideMinutes=30,day='2026-10-18')=>({timeZone:'Europe/Warsaw',serviceDay:day,source:{url:'https://gtfs.ztm.waw.pl/last',validFrom:'2026-10-18',validTo:'2026-10-19'},stops:[{...origin,id:'a',name:'Start'},{...destination,id:'b',name:'Cel'}],trips:[{id:'t',line:'17',headsign:'Cel',stopTimes:[{stopId:'a',arrival:departureTime+60000,departure:departureTime+60000,pickup:0,dropOff:0},{stopId:'b',arrival:departureTime+rideMinutes*60000,departure:departureTime+rideMinutes*60000,pickup:0,dropOff:0}]}]});
const cityFetch=async url=>({ok:true,json:async()=>url.endsWith(TRANSIT_SOURCES.stops.action)?[stopRecord(origin,0),stopRecord(destination,1)]:[]});
test('walking-only service works without credentials, GTFS, municipal stops or vehicles and rejects unsupported modes',async()=>{
 const service=createTransitService({key:()=>'',now:()=>departureTime,walkingProvider:provider,fetchImpl:()=>assert.fail('walk must not fetch municipal data'),graphProvider:()=>assert.fail('walk must not require GTFS')});const result=await service.plan({...serviceOptions,mode:'walk'});assert.equal(result.mode,'walk');assert.equal(result.status,'ready');assert.equal(result.routes.length,1);assert.equal(result.routes[0].timing,'walking_estimate');assert.deepEqual(result.vehicles,[]);assert.deepEqual(result.stops,[]);assert.equal(result.graphSource,null);assert.equal(result.liveModel,undefined);await assert.rejects(service.plan({...serviceOptions,mode:'drive'}),{code:'INVALID_MODE'});
});
test('automatic service compares true arrivals and retains a walk through transit source outages',async()=>{
 const make=(minutes,walking=provider)=>createTransitService({key:()=> 'fixture',now:()=>departureTime,fetchImpl:cityFetch,graphProvider:async()=>graph(minutes),walkingProvider:walking});
 const automatic=await make(30).plan(serviceOptions);assert.equal(automatic.mode,'auto');assert.equal(automatic.routes[0].mode,'walk');assert.equal(automatic.routes[1].steps[0].mode,'TRANSIT');assert.equal(automatic.routes[0].departure,automatic.routes[1].departure);
 const fasterRide=await make(2).plan(serviceOptions);assert.equal(fasterRide.routes[0].steps[0].mode,'TRANSIT');assert.equal(fasterRide.routes[1].mode,'walk');
 const unavailable=createTransitService({key:()=>'',now:()=>departureTime,graphProvider:async()=>null,walkingProvider:provider});const fallback=await unavailable.plan(serviceOptions);assert.equal(fallback.status,'ready');assert.equal(fallback.routes[0].mode,'walk');assert.ok(fallback.errors.some(error=>error.part==='stops'));assert.equal(fallback.routes[0].recommendationReason,'Potwierdzona trasa piesza do celu.');
 const failedWalk=await make(30,{route:async()=>{throw Object.assign(new Error('offline'),{code:'WALK_ROUTING_UNAVAILABLE'});}}).plan(serviceOptions);assert.equal(failedWalk.status,'ready');assert.equal(failedWalk.routes.length,1);assert.equal(failedWalk.routes[0].steps[0].mode,'TRANSIT');assert.ok(failedWalk.errors.some(error=>error.part==='walking'));
});
test('auto compares a walk with a next-day transit fallback from the original departure; transit mode omits direct walks',async()=>{
 let dayCalls=0;const initial={...graph(),trips:[]},future=graph(24*60+10,'2026-10-19');future.trips[0].stopTimes[0].arrival+=86400000;future.trips[0].stopTimes[0].departure+=86400000;
 const service=createTransitService({key:()=> 'fixture',now:()=>departureTime,fetchImpl:cityFetch,walkingProvider:provider,graphProvider:async()=>++dayCalls===1?initial:future});const result=await service.plan(serviceOptions);assert.equal(result.routes[0].mode,'walk');assert.equal(result.routes[1].nextAvailable,true);assert.ok(result.routes[1].arrival>result.routes[0].arrival);assert.equal(result.routes[0].departure,departureTime);
 const transit=createTransitService({key:()=> 'fixture',now:()=>departureTime,fetchImpl:cityFetch,graphProvider:async()=>graph(),walkingProvider:{route:()=>assert.fail('no direct walk in transit mode')}});const only=await transit.plan({...serviceOptions,mode:'transit'});assert.equal(only.routes.length,1);assert.equal(only.routes[0].steps[0].mode,'TRANSIT');
});

test('walking to named stop platforms needs only the catalogue and preserves the selected exact platform',async()=>{
 let requests=0;const service=createTransitService({key:()=> 'fixture',now:()=>departureTime,walkingProvider:provider,graphProvider:()=>assert.fail('named walking route must not load GTFS'),fetchImpl:async url=>{requests++;assert.ok(url.endsWith(TRANSIT_SOURCES.stops.action));return cityFetch(url);}});const result=await service.plan({...serviceOptions,mode:'walk',origin:'Start · 1000-01',destination:'Cel · 1001-01'});assert.equal(result.status,'ready');assert.equal(result.destination.stopId,'1001-01');assert.equal(requests,1);
});
