import test from 'node:test';
import assert from 'node:assert/strict';
import {createTransitService,TRANSIT_SOURCES} from '../server/transit.mjs';
import {nextAvailableTransit} from '../server/next-transit.mjs';
import {createWalkingVerification,planPedestrianGraph} from '../server/walking-router.mjs';
import {graphForDay,gtfsInstant} from '../server/transit-gtfs.mjs';
import {dateInWarsaw,serviceInstant,TransitError} from '../transit-core.mjs';
const stops=[{id:'a',name:'A',latitude:52.2,longitude:21},{id:'b',name:'B',latitude:52.23,longitude:21}];
const instant=(day,clock)=>gtfsInstant(day,clock);
function graph(day,trips=[],validTo='2026-10-25'){return{serviceDay:day,timeZone:'Europe/Warsaw',stops,trips,source:{url:'https://gtfs.ztm.waw.pl/last',validFrom:'2026-10-16',validTo,version:'test'}};}
function trip(day,start,end,id='trip'){return{id:id+'@'+day,line:'17',serviceDate:day,stopTimes:[{stopId:'a',arrival:instant(day,start),departure:instant(day,start),pickup:0,dropOff:0},{stopId:'b',arrival:instant(day,end),departure:instant(day,end),pickup:0,dropOff:0}]};}
function setup(day,clock='00:00:00',extra={}){const options={origin:{...stops[0],label:'Start'},destination:{...stops[1],label:'Cel'},departureTime:serviceInstant(day,clock),...extra},walking={verification:createWalkingVerification({signal:options.signal}),provider:{route:async(from,to)=>({geometry:'osm_pedestrian',durationMillis:180000,distanceMeters:200,path:[from,to]})}};return{options,walking};}

test('empty four-hour window extends to the first later same-day departure and separates waiting from journey',async()=>{
 const day='2026-10-18',g=graph(day,[trip(day,'09:00:00','09:30:00')]),{options,walking}=setup(day,'00:00:00');assert.deepEqual(await planPedestrianGraph(g,options,walking),[]);
 const result=await nextAvailableTransit(g,options,{graphProvider:async()=>assert.fail('same-day route should finish'),walking});const route=result.routes[0];assert.equal(route.firstBoarding,instant(day,'09:00:00'));assert.equal(route.departure,route.firstBoarding);assert.equal(route.waitingMillis,9*3600000);assert.equal(route.durationMillis,30*60000);assert.equal(route.nextAvailable,true);assert.equal(result.search.daysChecked,1);
});
test('fallback chooses the first feasible departure, even when a later express arrives sooner',async()=>{
 const day='2026-10-18',g=graph(day,[trip(day,'10:00:00','10:10:00','express'),trip(day,'09:00:00','11:00:00','first')]),{options,walking}=setup(day);const result=await nextAvailableTransit(g,options,{walking});assert.equal(result.routes[0].steps.find(step=>step.mode==='TRANSIT').tripId,'first@'+day);assert.equal(result.routes[0].firstBoarding,instant(day,'09:00:00'));
});
test('actual verified access time can miss the earliest departure and is shifted just before the next one',async()=>{
 const day='2026-10-18',g=graph(day,[trip(day,'00:01:00','00:30:00','missed'),trip(day,'09:00:00','09:30:00','later')]),{options,walking}=setup(day,'00:00:00',{origin:{latitude:52.1998,longitude:21,label:'GPS'}});let calls=0;const provider=walking.provider;walking.provider={route:async(...args)=>{calls++;return provider.route(...args);}};
 assert.deepEqual(await planPedestrianGraph(g,options,walking),[]);const result=await nextAvailableTransit(g,options,{walking});const route=result.routes[0];assert.equal(route.firstBoarding,instant(day,'09:00:00'));assert.equal(route.departure,instant(day,'08:57:00'));assert.equal(route.steps[0].start,route.departure);assert.equal(route.steps[0].end,route.firstBoarding);assert.equal(route.durationMillis,33*60000);assert.equal(calls,1,'verification is shared across initial, extended and binary searches');
});
test('calendar gaps and exceptions are searched through the actual feed end without replacing the current live graph',async()=>{
 const day='2026-10-18',end='2026-10-22',templates={source:graph(day,[],end).source,stops,calendar:[{service_id:'s',monday:'1',tuesday:'0',wednesday:'0',thursday:'0',friday:'0',saturday:'0',sunday:'0',start_date:'20261016',end_date:'20261025'}],exceptions:[{service_id:'s',date:'20261019',exception_type:'2'},{service_id:'s',date:'20261022',exception_type:'1'}],trips:[{id:'t',serviceId:'s',line:'17',shape:[],stopTimes:[{stopId:'a',arrivalClock:'09:00:00',departureClock:'09:00:00',pickup:0,dropOff:0},{stopId:'b',arrivalClock:'09:30:00',departureClock:'09:30:00',pickup:0,dropOff:0}]}]},initial=graphForDay(templates,day),seen=[],{options,walking}=setup(day);
 const result=await nextAvailableTransit(initial,options,{walking,graphProvider:async (value,opts)=>{const date=dateInWarsaw(value);seen.push(date);return graphForDay(templates,date,opts);}});assert.equal(result.routes[0].steps.find(step=>step.mode==='TRANSIT').serviceDate,end);assert.deepEqual(seen,['2026-10-18','2026-10-19','2026-10-20','2026-10-21','2026-10-22']);assert.equal(initial.serviceDay,day);assert.equal(initial.trips.length,0);assert.equal(result.search.daysChecked,5);
});
test('overnight previous-day trips and the DST service-day origin keep exact dated instants',async()=>{
 const day='2026-10-25',g=graph(day,[trip('2026-10-24','25:40:00','26:00:00','overnight'),trip(day,'06:00:00','06:30:00','morning')]),{options,walking}=setup(day);const result=await nextAvailableTransit(g,options,{walking});assert.equal(result.routes[0].firstBoarding,instant('2026-10-24','25:40:00'));assert.equal(result.routes[0].steps.find(step=>step.mode==='TRANSIT').serviceDate,'2026-10-24');assert.equal(result.routes[0].durationMillis,20*60000);
});
test('the first late-night departure keeps a next-day transfer after 04:00 instead of skipping to a later direct service',async()=>{
 const day='2026-10-18',tomorrow='2026-10-19',middle={id:'c',name:'C',latitude:52.215,longitude:21},g=graph(day,[{...trip(day,'23:50:00','24:10:00','night'),stopTimes:trip(day,'23:50:00','24:10:00').stopTimes.map((event,i)=>i?{...event,stopId:'c'}:event)},{id:'transfer@'+tomorrow,line:'103',serviceDate:tomorrow,stopTimes:[{stopId:'c',arrival:instant(tomorrow,'05:10:00'),departure:instant(tomorrow,'05:10:00'),pickup:0,dropOff:0},{stopId:'b',arrival:instant(tomorrow,'05:30:00'),departure:instant(tomorrow,'05:30:00'),pickup:0,dropOff:0}]},trip(tomorrow,'06:00:00','06:20:00','direct')]);g.stops=[...stops,middle];g.nextDayHours=4;const {options,walking}=setup(day),calls=[];
 const result=await nextAvailableTransit(g,options,{walking,graphProvider:async(_time,opts)=>{calls.push(opts.nextDayHours);return{...g,nextDayHours:24};}});assert.deepEqual(calls,[24]);assert.deepEqual(result.routes[0].steps.filter(step=>step.mode==='TRANSIT').map(step=>step.tripId),['night@'+day,'transfer@'+tomorrow]);assert.equal(result.routes[0].firstBoarding,instant(day,'23:50:00'));assert.equal(result.routes[0].arrival,instant(tomorrow,'05:30:00'));
});
test('feed exhaustion, unavailable future graphs, caller abort and request deadline never invent a route',async()=>{
 const day='2026-10-18',g=graph(day,[],day),{options,walking}=setup(day);const result=await nextAvailableTransit(g,options,{walking});assert.deepEqual(result.routes,[]);assert.equal(result.search.exhausted,true);assert.equal(result.search.feedValidTo,day);
 await assert.rejects(()=>nextAvailableTransit(graph(day),options,{walking,graphProvider:async()=>{throw new TransitError('GTFS_UNAVAILABLE','offline');}}),{code:'GTFS_UNAVAILABLE'});
 const controller=new AbortController();controller.abort();await assert.rejects(()=>nextAvailableTransit(g,{...options,signal:controller.signal},{walking}),{name:'AbortError'});
 walking.verification.deadlineAt=0;await assert.rejects(()=>nextAvailableTransit(g,options,{walking}),{code:'LOOKAHEAD_LIMIT'});walking.verification.signal=AbortSignal.abort(new DOMException('deadline','TimeoutError'));await assert.rejects(()=>nextAvailableTransit(g,options,{walking}),{name:'TimeoutError'});
});
test('transit service keeps successful ordinary routes and only asks later dates after an empty range',async()=>{
 const day='2026-10-18',now=instant(day,'00:00:00'),rawStops=stops.map((stop,index)=>({values:Object.entries({zespol:String(1000+index),slupek:'01',nazwa_zespolu:stop.name,szer_geo:String(stop.latitude),dlug_geo:String(stop.longitude)}).map(([key,value])=>({key,value}))}));
 const calls=[],make=initial=>createTransitService({now:()=>now,key:()=> 'fixture-only',graphProvider:async value=>{calls.push(dateInWarsaw(value));return dateInWarsaw(value)===day?initial:graph(dateInWarsaw(value),[trip(dateInWarsaw(value),'06:00:00','06:30:00')]);},fetchImpl:async url=>({ok:true,json:async()=>url.endsWith(TRANSIT_SOURCES.stops.action)?rawStops:[]})});
 const input={origin:stops[0],destination:stops[1],departureTime:new Date(now).toISOString()},ordinary=await make(graph(day,[trip(day,'00:10:00','00:30:00')])).plan(input);assert.equal(ordinary.status,'ready');assert.equal(ordinary.nextSearch,null);assert.equal(ordinary.routes[0].nextAvailable,undefined);assert.deepEqual(calls,[day]);calls.length=0;
 const future=await make(graph(day)).plan(input);assert.equal(future.status,'ready');assert.equal(future.routes[0].firstBoarding,instant('2026-10-19','06:00:00'));assert.equal(future.routes[0].durationMillis,30*60000);assert.deepEqual(calls,[day,'2026-10-19']);assert.equal(future.liveModel.continuous,false);
 const exhausted=await make(graph(day,[],day)).plan(input);assert.equal(exhausted.status,'limited');assert.equal(exhausted.reason,'FEED_EXHAUSTED');assert.equal(exhausted.nextSearch.feedValidTo,day);assert.equal(exhausted.nextSearch.exhausted,true);
});
