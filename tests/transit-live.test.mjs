import test from 'node:test';import assert from 'node:assert/strict';
import {createDelayModel} from '../server/transit-live.mjs';import {planGraph} from '../server/transit-router.mjs';import {gtfsInstant} from '../server/transit-gtfs.mjs';
const base=Date.parse('2026-10-17T12:00Z'),at=(minutes,seconds=0)=>base+minutes*60000+seconds*1000;
const stops=[{id:'a',name:'A',latitude:52.2,longitude:21},{id:'b',name:'B',latitude:52.21,longitude:21},{id:'c',name:'C',latitude:52.22,longitude:21}];
const event=(stopId,minute)=>({stopId,arrival:at(minute),departure:at(minute),pickup:0,dropOff:0});
const trip={id:'trip@2026-10-17',serviceDate:'2026-10-17',line:'17',headsign:'C',stopTimes:[event('a',1),event('b',5),event('c',9)]};
const graph={timeZone:'Europe/Warsaw',source:{url:'https://gtfs.ztm.waw.pl/last',validFrom:'2026-10-16',validTo:'2026-10-25'},stops,trips:[trip]};
function fixture(extra=[]){let time=base;const model=createDelayModel({now:()=>time,tripEvidence:()=>new Set([trip.id,...extra.map(item=>item.id)])});model.attachGraph({...graph,trips:[trip,...extra]});const sample=(latitude,t,id='2:1000',line='17')=>{time=t;model.ingest([{id,line,latitude,longitude:21,observedAt:new Date(t).toISOString(),freshness:'recent'}]);};return{model,sample,setTime:t=>time=t};}
function dwell(f,index,delta=30000){const stop=stops[index],scheduled=trip.stopTimes[index].arrival,entry=scheduled+delta;if(index>0)f.sample(stop.latitude-.003,entry-90000);f.sample(stop.latitude-.001,entry-10000);f.sample(stop.latitude,entry);f.sample(stop.latitude,entry+10000);}
test('two entered, stationary, sequential stops identify a specific trip and update a signed current delta',()=>{const f=fixture();dwell(f,0);assert.equal(f.model.getDeltas().size,0);dwell(f,1);const delay=f.model.getDeltas().get(trip.id);assert.equal(delay.deltaMs,30000);assert.equal(delay.stopIndex,1);assert.equal(delay.confidence,'brigade_two_stop_dwell');assert.equal(delay.ageSeconds,10);assert.equal(f.model.summary().persistentGpsHistory,false);});
test('initial snapshot already inside a stop, repeated timestamps and same-line ambiguity do not claim observed arrival',()=>{const f=fixture();f.sample(stops[0].latitude,at(1,30));f.sample(stops[0].latitude,at(1,40));dwell(f,1);assert.equal(f.model.getDeltas().size,0);
 const second={...trip,id:'another-trip',stopTimes:trip.stopTimes.map(e=>({...e,arrival:e.arrival+60000,departure:e.departure+60000}))},ambiguous=fixture([second]);dwell(ambiguous,0);dwell(ambiguous,1);assert.equal(ambiguous.model.getDeltas().size,0);
 const repeated=fixture();repeated.sample(stops[0].latitude-.001,at(1,20));repeated.sample(stops[0].latitude,at(1,30));repeated.sample(stops[0].latitude,at(1,30));assert.equal(repeated.model.getDeltas().size,0);
});
test('negative deltas remain signed; changed line, stale state and TTL expire exact-trip estimates',()=>{const f=fixture();dwell(f,0,-30000);dwell(f,1,-30000);assert.equal(f.model.getDeltas().get(trip.id).deltaMs,-30000);f.sample(stops[1].latitude,at(5),'2:1000','22');assert.equal(f.model.getDeltas().size,0);
 const stale=fixture();dwell(stale,0);dwell(stale,1);stale.setTime(at(9));assert.equal(stale.model.getDeltas().size,0);assert.equal(stale.model.summary().trackedVehicles,0);
});
test('matched delay adjusts downstream ETA before transfer checks and stale/uncertain deltas fall back',()=>{
 const clock=value=>gtfsInstant('2026-10-17',value),data={timeZone:'Europe/Warsaw',source:graph.source,stops:[{id:'z',name:'Z',latitude:52.19,longitude:21},{id:'a',name:'A',latitude:52.2,longitude:21},{id:'b',name:'B',latitude:52.22,longitude:21},{id:'d',name:'D',latitude:52.24,longitude:21}],trips:[{id:'one',serviceDate:'2026-10-17',line:'17',headsign:'B',stopTimes:[{stopId:'z',arrival:clock('13:57:00'),departure:clock('13:57:00'),pickup:0,dropOff:0},{stopId:'a',arrival:clock('14:00:00'),departure:clock('14:00:00'),pickup:0,dropOff:0},{stopId:'b',arrival:clock('14:10:00'),departure:clock('14:10:00'),pickup:0,dropOff:0}]},{id:'two',serviceDate:'2026-10-17',line:'22',headsign:'D',stopTimes:[{stopId:'b',arrival:clock('14:13:00'),departure:clock('14:13:00'),pickup:0,dropOff:0},{stopId:'d',arrival:clock('14:25:00'),departure:clock('14:25:00'),pickup:0,dropOff:0}]}]};
 const request={origin:{...data.stops[1],label:'A'},destination:{...data.stops[3],label:'D'},departureTime:clock('14:00:00'),now:clock('14:00:00')};assert.ok(planGraph(data,request).length);
 const delta={tripId:'one',deltaMs:180000,stopIndex:0,observedAt:request.now,ageSeconds:0,confidence:'brigade_two_stop_dwell'};assert.equal(planGraph(data,{...request,deltas:new Map([['one',delta]])}).length,0);
 assert.ok(planGraph(data,{...request,deltas:new Map([['one',{...delta,observedAt:request.now-180001}]])}).length);
 assert.ok(planGraph(data,{...request,deltas:new Map([['one',{...delta,confidence:'unconfirmed'}]])}).length);
 const early=planGraph(data,{...request,departureTime:clock('13:59:00'),deltas:new Map([['one',{...delta,deltaMs:-30000}]])})[0];assert.equal(early.steps.find(s=>s.mode==='TRANSIT').start,clock('14:00:00'));assert.equal(early.steps.find(s=>s.mode==='TRANSIT').end,clock('14:09:30'));
});

test('a seven-minute-late vehicle never aliases to the next ten-minute-headway trip without unique brigade evidence',()=>{
 const second={...trip,id:'next-trip',stopTimes:trip.stopTimes.map(e=>({...e,arrival:e.arrival+600000,departure:e.departure+600000}))};const f=fixture([second]);dwell(f,0,420000);dwell(f,1,420000);assert.equal(f.model.getDeltas().size,0);
 const unverified=createDelayModel({now:()=>at(20)});unverified.attachGraph(graph);unverified.ingest([{id:'2:1',line:'17',brigade:'1',latitude:52.2,longitude:21,observedAt:new Date(at(20)).toISOString(),freshness:'recent'}]);assert.equal(unverified.getDeltas().size,0);
});
