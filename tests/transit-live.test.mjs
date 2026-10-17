import test from 'node:test';import assert from 'node:assert/strict';
import {createDelayModel} from '../server/transit-live.mjs';import {planGraph} from '../server/transit-router.mjs';import {gtfsInstant} from '../server/transit-gtfs.mjs';
const base=Date.parse('2026-10-17T12:00Z'),at=(minutes,seconds=0)=>base+minutes*60000+seconds*1000;
const stops=['a','b','c','d','e'].map((id,index)=>({id,name:id.toUpperCase(),latitude:52.2+index*.001,longitude:21}));
const trip={id:'trip@2026-10-17',serviceDate:'2026-10-17',line:'17',headsign:'E',shape:stops,stopTimes:stops.map((stop,index)=>({stopId:stop.id,arrival:at(index),departure:at(index),pickup:0,dropOff:0}))};
const graph={timeZone:'Europe/Warsaw',source:{url:'https://gtfs.ztm.waw.pl/last',validFrom:'2026-10-16',validTo:'2026-10-25'},stops,trips:[trip]};
function fixture({trips=[trip],evidence=()=>new Set(trips.map(t=>t.id)),maxVehicles=5000,catalog=stops}={}){let time=base;const model=createDelayModel({now:()=>time,tripEvidence:evidence,maxVehicles});model.attachGraph({...graph,trips,stops:catalog});const sample=(progress,t,extra={})=>{time=t;model.ingest([{id:'2:1000',line:'17',brigade:'1',latitude:52.2+progress*.001,longitude:21,observedAt:new Date(t).toISOString(),freshness:'recent',...extra}]);};return{model,sample,setTime:t=>time=t};}
function close(actual,expected){assert.ok(Math.abs(actual-expected)<2,actual+' ≠ '+expected);}
test('one first record past the next stop publishes a signed distance-normalized delta without a dwell or speed gate',()=>{
 const f=fixture();f.sample(.2,at(.7));assert.equal(f.model.getDeltas().size,0);f.sample(1.5,at(2));const delta=f.model.getDeltas().get(trip.id);close(delta.deltaMs,30000);assert.equal(delta.stopIndex,1);close(delta.normalizationMs,30000);close(delta.estimatedArrivalAtStop,at(1.5));assert.equal(delta.observedAt,at(2));assert.ok(delta.distancePastStopMeters>50);assert.equal(delta.confidence,'brigade_route_progress');assert.equal(delta.ageSeconds,0);assert.equal(f.model.summary().persistentGpsHistory,false);
});
test('irregular polling can cross multiple stops and stores only the latest crossed stop',()=>{
 const f=fixture();f.sample(.2,at(.7));f.sample(2.6,at(3.1));const delta=f.model.getDeltas().get(trip.id);close(delta.deltaMs,30000);assert.equal(delta.stopIndex,2);assert.equal(f.model.getDeltas().size,1);f.sample(3.1,at(3.6));assert.equal(f.model.getDeltas().get(trip.id).stopIndex,3);
});
test('normalization uses scheduled departure to next arrival and explicitly includes the crossed-stop dwell',()=>{
 const data={...trip,stopTimes:trip.stopTimes.map((event,index)=>({...event,departure:event.departure+(index===1?20000:0)}))},f=fixture({trips:[data]});f.sample(.2,at(.7));f.sample(1.5,at(2,10));const delta=f.model.getDeltas().get(trip.id);close(delta.deltaMs,30000);close(delta.normalizationMs,40000);close(delta.estimatedArrivalAtStop,at(1.5));
});
test('initial record already beyond a stop only establishes a baseline; timestamps, backwards jitter and return do not invent a crossing',()=>{
 const f=fixture();f.sample(1.5,at(2));f.sample(1.5,at(2));f.sample(1.4,at(2.1));f.sample(1.6,at(2.2));assert.equal(f.model.getDeltas().size,0);f.sample(2.1,at(2.6));assert.equal(f.model.getDeltas().get(trip.id).stopIndex,2);const time=f.model.getDeltas().get(trip.id).observedAt;f.sample(1.98,at(2.7));f.sample(2.1,at(2.8));assert.equal(f.model.getDeltas().get(trip.id).observedAt,time);
});
test('negative deltas, missing/ambiguous evidence, delayed headways and exact dated identity stay separate',()=>{
 const early=fixture();early.sample(.2,at(.1));early.sample(1.5,at(1));close(early.model.getDeltas().get(trip.id).deltaMs,-30000);
 const next={...trip,id:'next@2026-10-17',stopTimes:trip.stopTimes.map(event=>({...event,arrival:event.arrival+600000,departure:event.departure+600000}))};const f=fixture({trips:[trip,next]});f.sample(.2,at(7.2));f.sample(1.5,at(8.5));assert.equal(f.model.getDeltas().size,0);
 const unique=fixture({trips:[trip,next],evidence:()=>new Set([trip.id])});unique.sample(.2,at(7.2));unique.sample(1.5,at(8.5));close(unique.model.getDeltas().get(trip.id).deltaMs,420000);
 const unknown=fixture({evidence:()=>null});unknown.sample(.2,at(.7));unknown.sample(1.5,at(2));assert.equal(unknown.model.getDeltas().size,0);
});
test('line/brigade changes, stale/out-of-order points and bounded RAM expiry invalidate only current estimates',()=>{
 for(const change of [{line:'22'},{brigade:'2'},{freshness:'stale'}]){const f=fixture();f.sample(.2,at(.7));f.sample(1.5,at(2));assert.equal(f.model.getDeltas().size,1);f.sample(1.6,at(2.1),change);assert.equal(f.model.getDeltas().size,0);}
 const f=fixture();f.sample(.2,at(.7));f.sample(1.5,at(2));f.sample(2.5,at(1.9));assert.equal(f.model.getDeltas().get(trip.id).stopIndex,1);f.setTime(at(6));assert.equal(f.model.getDeltas().size,0);assert.equal(f.model.summary().trackedVehicles,0);
 const bounded=fixture({maxVehicles:2,evidence:()=>null});for(let i=0;i<4;i++)bounded.sample(.2,at(.7),{id:'2:'+i});assert.equal(bounded.model.summary().trackedVehicles,2);
});
test('missing shapes do not fabricate distance; terminal crossing uses zero normalization without extrapolating',()=>{
 const noShape=fixture({trips:[{...trip,shape:[]}]});noShape.sample(.2,at(.7));noShape.sample(1.5,at(2));assert.equal(noShape.model.getDeltas().size,0);
 const f=fixture();f.sample(3.5,at(4));f.sample(4.2,at(4.7));const delta=f.model.getDeltas().get(trip.id);assert.equal(delta.stopIndex,4);assert.equal(delta.normalizationMs,0);close(delta.deltaMs,42000);
});
test('repeated stop IDs use GTFS shape distances; an ambiguous loop location cannot invent a lap crossing',()=>{
 const shape=[stops[0],stops[1],{...stops[1],longitude:21.002},{...stops[0],longitude:21.002},stops[0],stops[1]].map((p,i)=>({...p,shapeDistance:i*100}));
 const data={...trip,shape,stopTimes:[{...trip.stopTimes[0],shapeDistance:0},{...trip.stopTimes[1],shapeDistance:100},{...trip.stopTimes[2],stopId:'a',shapeDistance:400},{...trip.stopTimes[3],stopId:'b',shapeDistance:500}]},f=fixture({trips:[data]});f.sample(.5,at(1));f.sample(.8,at(1.2));assert.equal(f.model.getDeltas().size,0,'overlapping first/final legs have no unique route progress');
});
test('matched delay adjusts downstream ETA before transfer checks and stale/uncertain deltas fall back',()=>{
 const clock=value=>gtfsInstant('2026-10-17',value),data={timeZone:'Europe/Warsaw',source:graph.source,stops:[{id:'z',name:'Z',latitude:52.19,longitude:21},{id:'a',name:'A',latitude:52.2,longitude:21},{id:'b',name:'B',latitude:52.22,longitude:21},{id:'d',name:'D',latitude:52.24,longitude:21}],trips:[{id:'one',serviceDate:'2026-10-17',line:'17',headsign:'B',stopTimes:[{stopId:'z',arrival:clock('13:57:00'),departure:clock('13:57:00'),pickup:0,dropOff:0},{stopId:'a',arrival:clock('14:00:00'),departure:clock('14:00:00'),pickup:0,dropOff:0},{stopId:'b',arrival:clock('14:10:00'),departure:clock('14:10:00'),pickup:0,dropOff:0}]},{id:'two',serviceDate:'2026-10-17',line:'22',headsign:'D',stopTimes:[{stopId:'b',arrival:clock('14:13:00'),departure:clock('14:13:00'),pickup:0,dropOff:0},{stopId:'d',arrival:clock('14:25:00'),departure:clock('14:25:00'),pickup:0,dropOff:0}]}]};
 const request={origin:{...data.stops[1],label:'A'},destination:{...data.stops[3],label:'D'},departureTime:clock('14:00:00'),now:clock('14:00:00')};assert.ok(planGraph(data,request).length);
 const delta={tripId:'one',deltaMs:180000,stopIndex:0,observedAt:request.now,ageSeconds:0,confidence:'brigade_route_progress'};assert.equal(planGraph(data,{...request,deltas:new Map([['one',delta]])}).length,0);
 assert.ok(planGraph(data,{...request,deltas:new Map([['one',{...delta,observedAt:request.now-180001}]])}).length);
 assert.ok(planGraph(data,{...request,deltas:new Map([['one',{...delta,confidence:'unconfirmed'}]])}).length);
 const early=planGraph(data,{...request,departureTime:clock('13:59:00'),deltas:new Map([['one',{...delta,deltaMs:-30000}]])})[0];assert.equal(early.steps.find(s=>s.mode==='TRANSIT').start,clock('14:00:00'));assert.equal(early.steps.find(s=>s.mode==='TRANSIT').end,clock('14:09:30'));
});


test('backwards GPS jitter cannot turn an overlapping later lap into unique forward progress',()=>{
 const e={...stops[4],latitude:52.2005},shape=[stops[0],stops[1],{...stops[1],longitude:21.002},{...stops[0],longitude:21.002},stops[0],e].map((p,i)=>({...p,shapeDistance:[0,100,200,300,400,450][i]}));
 const data={...trip,shape,stopTimes:[{...trip.stopTimes[0],shapeDistance:0},{...trip.stopTimes[1],shapeDistance:100},{...trip.stopTimes[2],stopId:'a',shapeDistance:400},{...trip.stopTimes[3],stopId:'e',shapeDistance:450}]},f=fixture({trips:[data],catalog:[...stops.slice(0,4),e]});
 f.sample(.9,at(.9));assert.equal(f.model.summary().tentativeTrips,1);f.sample(.4,at(1.15));assert.equal(f.model.getDeltas().size,0);assert.equal(f.model.summary().tentativeTrips,0);
});
test('delayed platform evidence retains the first crossing timestamp rather than using the later poll as arrival',()=>{
 let ready=true;const f=fixture({evidence:()=>ready?new Set([trip.id]):null});f.sample(.2,at(.7));ready=false;f.sample(1.5,at(2));f.sample(1.6,at(2.1));assert.equal(f.model.getDeltas().size,0);ready=true;f.sample(1.7,at(2.2));const delta=f.model.getDeltas().get(trip.id);assert.equal(delta.observedAt,at(2));close(delta.deltaMs,30000);
});

test('missing brigades and two simultaneous vehicles claiming the same trip cannot provide a live correction',()=>{
 const missing=fixture();missing.sample(.2,at(.7),{brigade:''});missing.sample(1.5,at(2),{brigade:''});assert.equal(missing.model.getDeltas().size,0);
 const f=fixture();f.sample(.2,at(.7));f.sample(.3,at(.8),{id:'2:other'});f.sample(1.5,at(2));f.sample(1.6,at(2.1),{id:'2:other'});assert.equal(f.model.getDeltas().size,0);
});

test('a positively brigade-bound competing trip cannot be dismissed just because its shape is unavailable',()=>{
 const other={...trip,id:'unresolved-shape',shape:[]},f=fixture({trips:[trip,other]});f.sample(.2,at(.7));f.sample(1.5,at(2));assert.equal(f.model.getDeltas().size,0);
});
