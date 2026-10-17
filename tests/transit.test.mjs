import test from 'node:test';import assert from 'node:assert/strict';
import {waypoint,gpsOrigin,departure,warsawDeparture,serviceSeconds,serviceInstant,createPlanner,computeMunicipal,TransitError,transitAppearance} from '../transit-core.mjs';
import {runTool} from '../mcp/tools.mjs';import {normalizeStops,normalizeDepartures,normalizeVehicles,withVehicleDirections,createTransitService,TRANSIT_SOURCES} from '../server/transit.mjs';import {gtfsInstant,activeServices,csvRow} from '../server/transit-gtfs.mjs';import {planGraph} from '../server/transit-router.mjs';
const now=Date.parse('2026-10-17T12:00:00Z');
const stop=(id,name,latitude,longitude)=>({values:Object.entries({zespol:id.split('-')[0],slupek:id.split('-')[1],nazwa_zespolu:name,szer_geo:String(latitude),dlug_geo:String(longitude)}).map(([key,value])=>({key,value}))});
const rows=[stop('1000-01','Start',52.2,21),stop('2000-01','Cel',52.23,21.02)];
const dep=Object.entries({czas:'25:10:00',brygada:'9',kierunek:'Żerań',trasa:'TP-FSO'}).map(([key,value])=>({key,value}));

test('transport colors distinguish city fleet types from GTFS route_type and keep unknown service neutral',()=>{
 const cases=[
  [{line:'175',type:1},'bus','#880077'],
  [{line:'N31',type:1},'night_bus','#000000'],
  [{line:'17',type:2},'tram','#8A0000'],
  [{line:'S2',routeType:2},'skm','#008800'],
  [{line:'17',routeType:0},'tram','#8A0000'],
  [{line:'175',routeType:3},'bus','#880077'],
  [{line:'R1',routeType:2},'unknown','#65727f'],
  [{line:'17'},'unknown','#65727f'],
 ];
 for(const[record,kind,color]of cases){const appearance=transitAppearance(record);assert.equal(appearance.transportKind,kind);assert.equal(appearance.transportColor,color);}
 const bus=normalizeVehicles([{Lat:52.2,Lon:21,Lines:'175',VehicleNumber:'1',Time:'2026-10-17 14:00:00'}],1,now)[0];
 assert.equal(bus.transportKind,'bus');assert.equal(bus.transportColor,'#880077');
});
test('named/coordinate waypoint and last known GPS never substitute city centre',()=>{
 assert.deepEqual(waypoint('52.2,21').value,{lat:52.2,lng:21});for(const value of ['',{latitude:91,longitude:21},'a'.repeat(201)])assert.throws(()=>waypoint(value));
 const location={status:'available',latitude:52.2,longitude:21,accuracy:20,observedAt:new Date(now).toISOString()};assert.deepEqual(gpsOrigin(location,now).value,{lat:52.2,lng:21});for(const value of [{...location,observedAt:new Date(now-86400000).toISOString(),accuracy:10000},{...location,observedAt:null,accuracy:undefined}])assert.deepEqual(gpsOrigin(value,now).value,{lat:52.2,lng:21});for(const value of [null,{...location,status:'unavailable'},{...location,latitude:91},{...location,longitude:'21'}])assert.throws(()=>gpsOrigin(value,now),{code:'ORIGIN_REQUIRED'});
});
test('Warsaw clock, extended service times, midnight and GTFS DST use distinct documented time semantics',()=>{
 assert.equal(warsawDeparture('2026-10-17T15:00',now).toISOString(),'2026-10-17T13:00:00.000Z');assert.throws(()=>departure('2026-02-30T12:00:00Z',Date.parse('2026-02-01')));assert.throws(()=>warsawDeparture('2026-10-25T02:30',now));
 assert.equal(serviceSeconds('25:10:00'),90600);assert.equal(serviceSeconds('25:61:00'),null);assert.equal(serviceInstant('2026-10-25','02:30:00'),null);
 assert.equal(new Date(serviceInstant('2026-10-17','25:10:00')).toISOString(),'2026-10-17T23:10:00.000Z');
 assert.equal(new Date(gtfsInstant('2026-10-25','02:30:00')).toISOString(),'2026-10-25T01:30:00.000Z');
 assert.equal(new Date(gtfsInstant('2026-03-29','03:00:00')).toISOString(),'2026-03-29T01:00:00.000Z');
});
test('municipal schema keeps unknown service dates/trip identities and stale vehicle observations explicit',()=>{
 assert.equal(normalizeStops(rows).length,2);assert.equal(normalizeStops([{values:[]}]).length,0);assert.equal(normalizeDepartures([dep])[0].serviceDate,null);assert.equal(normalizeDepartures([dep])[0].tripId,null);
 const vehicles=normalizeVehicles([{Lat:52.2,Lon:21,Lines:'17',Brigade:'1',VehicleNumber:'1000',Time:'2026-10-17 14:00:00'},{Lat:52.2,Lon:21,Lines:'17',VehicleNumber:'1001',Time:'2024-03-21 13:47:11'},{Lat:52.2,Lon:21,Lines:'17',VehicleNumber:'1002',Time:'invalid'}],2,now);
 assert.deepEqual(vehicles.map(v=>v.freshness),['recent','stale','unknown']);assert.ok(vehicles.every(v=>v.eta===null));
});
test('municipal API posts raw authorization and bounds/caches fan-out without fabricating a journey',async()=>{
 const calls=[];const service=createTransitService({key:()=> 'test-only-token',now:()=>now,graphProvider:async()=>null,fetchImpl:async(url,init)=>{
 calls.push({url,init});assert.equal(init.method,'POST');assert.equal(init.headers.Authorization,'test-only-token');assert.equal(init.headers.Authorization.startsWith('Bearer '),false);
 const action=url.split('/').at(-1);return{ok:true,json:async()=>action===TRANSIT_SOURCES.stops.action?rows:action===TRANSIT_SOURCES.lines.action?[{values:[{key:'linia',value:'17'}]}]:action===TRANSIT_SOURCES.departures.action?[dep]:[{Lat:52.2,Lon:21,Lines:'17',VehicleNumber:'1000',Time:'2026-10-17 14:00:00'}]};}});
 assert.equal((await service.searchStops('sta')).results[0].id,'1000-01');const result=await service.plan({origin:'Start',destination:'Cel',departureTime:new Date(now).toISOString()});assert.equal(result.routes.length,0);assert.equal(result.reason,'GRAPH_UNAVAILABLE');assert.equal(result.complete,false);assert.equal(result.departures[0].records[0].tripId,null);assert.ok(calls.length<=23);const before=calls.length;await service.plan({origin:'Start',destination:'Cel',departureTime:new Date(now).toISOString()});assert.equal(calls.length,before);
 await assert.rejects(()=>service.plan({origin:'Unknown street address',destination:'Cel'}),{code:'LOCATION_REQUIRED'});
});
test('source failures and caller cancellation cannot become a successful empty catalogue',async()=>{
 await assert.rejects(()=>createTransitService({key:()=>null}).searchStops('ab'),{code:'SOURCE_NOT_CONFIGURED'});
 await assert.rejects(()=>createTransitService({key:()=> 'test',fetchImpl:async()=>({ok:true,json:async()=>({result:[]})})}).searchStops('ab'),{code:'SOURCE_SCHEMA'});
 const controller=new AbortController();controller.abort();await assert.rejects(()=>createTransitService().plan({origin:'A',destination:'B'},{signal:controller.signal}),{name:'AbortError'});
});
const instant=clock=>gtfsInstant('2026-10-17',clock);
const event=(stopId,arrival,departure=arrival,pickup=0,dropOff=0)=>({stopId,arrival:instant(arrival),departure:instant(departure),pickup,dropOff});
function graph(){return{timeZone:'Europe/Warsaw',source:{url:'https://gtfs.ztm.waw.pl/last',validFrom:'2026-10-16',validTo:'2026-10-25'},stops:[{id:'a',name:'A',latitude:52.2,longitude:21},{id:'b',name:'B',latitude:52.22,longitude:21},{id:'c',name:'C',latitude:52.22,longitude:21.002},{id:'d',name:'D',latitude:52.24,longitude:21}],trips:[{id:'first@2026-10-17',serviceDate:'2026-10-17',line:'17',routeType:0,headsign:'B',stopTimes:[event('a','14:00:00'),event('b','14:10:00')]},{id:'missed@2026-10-17',serviceDate:'2026-10-17',line:'17',headsign:'D',stopTimes:[event('b','14:11:00'),event('d','14:20:00')]},{id:'transfer@2026-10-17',serviceDate:'2026-10-17',line:'22',headsign:'D',stopTimes:[event('c','14:16:00'),event('d','14:25:00')]}]};}
test('router verifies same-trip continuation and walk/transfer feasibility; equal lines never imply same trip',()=>{
 const data=graph(),routes=planGraph(data,{origin:{...data.stops[0],label:'A'},destination:{...data.stops[3],label:'D'},departureTime:instant('13:59:00')});assert.ok(routes.length);const ride=routes[0].steps.filter(step=>step.mode==='TRANSIT');assert.deepEqual(ride.map(step=>step.line),['17','22']);assert.deepEqual(ride.map(step=>step.tripId),['first@2026-10-17','transfer@2026-10-17']);assert.equal(ride[0].transportColor,'#8A0000');assert.equal(ride[0].routeType,0);assert.equal(routes[0].transfers,1);assert.equal(routes[0].arrival,instant('14:25:00'));assert.equal(routes[0].realtimeConfirmed,false);assert.equal(ride[0].geometry,'schematic');
 const noPickup=graph();noPickup.trips[0].stopTimes[0].pickup=1;assert.equal(planGraph(noPickup,{origin:{...data.stops[0],label:'A'},destination:{...data.stops[3],label:'D'},departureTime:instant('13:59:00')}).length,0);
 assert.throws(()=>planGraph(data,{origin:data.stops[0],destination:data.stops[3],departureTime:Date.parse('2026-11-01')}),{code:'DATE_OUTSIDE_FEED'});
});

test('router returns full geometry only for the selected official trip while retaining the boarded segment and schedule',()=>{
 const data=graph(),request={origin:{...data.stops[0],label:'A'},destination:{...data.stops[3],label:'D'},departureTime:instant('13:59:00')};
 const baseline=planGraph(data,request)[0];
 const firstShape=[{latitude:52.19,longitude:21},data.stops[0],{latitude:52.21,longitude:21},data.stops[1],{latitude:52.23,longitude:21}];
 const secondShape=[{latitude:52.21,longitude:21.002},data.stops[2],{latitude:52.23,longitude:21.001},data.stops[3],{latitude:52.25,longitude:21}];
 data.trips[0].shape=firstShape;data.trips[2].shape=secondShape;
 // Another direction of the same numbered line must not leak into the context.
 data.trips.push({...data.trips[0],id:'opposite@2026-10-17',shape:[{latitude:52.4,longitude:21.2},{latitude:52.5,longitude:21.3}],stopTimes:[event('b','14:00:00'),event('a','14:10:00')]});
 const selected=planGraph(data,request)[0],rides=selected.steps.filter(step=>step.mode==='TRANSIT');
 assert.equal(selected.arrival,baseline.arrival);assert.equal(selected.durationMillis,baseline.durationMillis);assert.equal(selected.transfers,baseline.transfers);
 const coords=points=>points.map(({latitude,longitude})=>({latitude,longitude}));
 assert.deepEqual(rides.map(step=>step.tripId),['first@2026-10-17','transfer@2026-10-17']);
 assert.deepEqual(rides[0].path,coords(firstShape.slice(1,-1)));assert.deepEqual(rides[0].fullPath,coords(firstShape));
 assert.deepEqual(rides[1].path,coords(secondShape.slice(1,-1)));assert.deepEqual(rides[1].fullPath,coords(secondShape));
 assert.ok(rides.every(step=>step.geometry==='gtfs_shape'&&step.fullPathGeometry==='gtfs_shape'));
 assert.ok(selected.steps.filter(step=>step.mode==='WALK').every(step=>!Object.hasOwn(step,'fullPath')));
 for(const shape of [[],[{latitude:52.2,longitude:21}],firstShape.map((point,index)=>index===1?{latitude:NaN,longitude:21}:point),[{latitude:52.4,longitude:21},{latitude:52.5,longitude:21}]]){
  data.trips[0].shape=shape;const ride=planGraph(data,request)[0].steps.find(step=>step.tripId==='first@2026-10-17');
  assert.equal(ride.geometry,'schematic');assert.equal(Object.hasOwn(ride,'fullPath'),false);
 }
});
test('calendar exceptions and escaped CSV are interpreted without inventing service',()=>{
 assert.deepEqual(csvRow('a,"b,c","x""y"'),['a','b,c','x"y']);const calendar=[{service_id:'weekday',saturday:'1',start_date:'20261016',end_date:'20261025'}];const exceptions=[{service_id:'weekday',date:'20261017',exception_type:'2'},{service_id:'special',date:'20261017',exception_type:'1'}];assert.deepEqual([...activeServices(calendar,exceptions,'2026-10-17')],['special']);
});
test('request races/cancellation and municipal HTTP seam never reuse a stale route',async()=>{
 const jobs=[],states=[],planner=createPlanner({compute:()=>new Promise(resolve=>jobs.push(resolve)),onState:s=>states.push(s)});const first=planner.search({id:1}),second=planner.search({id:2});jobs[1]({routes:['second']});await second;jobs[0]({routes:['first']});await first;assert.deepEqual(states.at(-1).routes,['second']);const third=planner.search({});planner.reset('cancelled');jobs[2]({routes:['third']});await third;assert.equal(states.at(-1).status,'cancelled');
 const request={origin:waypoint({latitude:52.2,longitude:21}),destination:waypoint('Cel'),departureTime:new Date(now)};let body;await computeMunicipal(request,{fetchImpl:async(url,init)=>{assert.equal(url,'/api/transit/plan');body=JSON.parse(init.body);return{ok:true,json:async()=>({routes:[],stops:[],departures:[],vehicles:[]})};}});assert.deepEqual(body.origin,{latitude:52.2,longitude:21,label:'52.20000, 21.00000'});
});
test('MCP action resolves verified destination coordinates and reports request acceptance without route/ETA',async()=>{
 const state={results:[{id:'event-1',name:'Koncert',lat:52.2,lng:21}],actions:[]};const result=await runTool('plan_transit',{destinationId:'event-1'},state);assert.equal(result.status,'planning_requested');assert.equal(result.durationMillis,undefined);assert.deepEqual(state.actions[0].destination,{latitude:52.2,longitude:21,label:'Koncert'});for(const args of [{destinationId:'unknown'},{destinationId:'event-1',destinationQuery:'A'},{}])await assert.rejects(()=>runTool('plan_transit',args,state));
});


test('active stops preserve exact boarded sequence including loops without leaking earlier/later trip stops',()=>{
 const data=graph();const middle={id:'m',name:'Middle',latitude:52.21,longitude:21},before={id:'before',name:'Before',latitude:52.18,longitude:21},after={id:'after',name:'After',latitude:52.26,longitude:21};data.stops.push(middle,before,after);data.trips=[{...data.trips[0],stopTimes:[event('before','13:50:00'),event('a','14:00:00'),event('m','14:03:00'),event('a','14:06:00','14:06:00',1),event('d','14:20:00'),event('after','14:30:00')]}];
 const ride=planGraph(data,{origin:{...data.stops[0],label:'A'},destination:{...data.stops[3],label:'D'},departureTime:instant('13:59:00')})[0].steps.find(step=>step.mode==='TRANSIT');
 assert.equal(ride.fromStopIndex,1);assert.equal(ride.toStopIndex,4);assert.equal(ride.stopPositionSource,'gtfs_stop_sequence');assert.deepEqual(ride.stopPositions.map(stop=>stop.id),['a','m','a','d']);assert.deepEqual(ride.stopPositions.map(stop=>stop.sequenceIndex),[1,2,3,4]);assert.equal(ride.stopPositions[1].latitude,middle.latitude);assert.equal(ride.stopPositions[1].name,'Middle');
});

test('vehicle directions require fresh unambiguous confirmed same-vehicle and same-line trip binding',()=>{
 const data=graph(),vehicle={id:'2:1',line:'17',freshness:'recent',observedAt:new Date(now).toISOString()},delta={vehicleId:'2:1',tripId:data.trips[0].id,observedAt:now,confidence:'brigade_two_stop_dwell'},decorate=(vehicles,deltas)=>withVehicleDirections(vehicles,data,new Map(deltas.map((delta,index)=>[index,delta])),now);
 assert.equal(decorate([vehicle],[delta])[0].direction,'B');assert.equal(decorate([vehicle],[delta])[0].directionTripId,data.trips[0].id);
 for(const value of [{...delta,observedAt:now-180001},{...delta,observedAt:now+60001},{...delta,confidence:'unconfirmed'},{...delta,vehicleId:'2:other'},{...delta,tripId:'missing'},{...delta,tripId:data.trips[2].id}])assert.equal(decorate([vehicle],[value])[0].direction,null);
 assert.equal(decorate([vehicle],[delta,{...delta,tripId:data.trips[1].id}])[0].direction,null);assert.equal(decorate([{...vehicle,freshness:'stale'}],[delta])[0].direction,null);assert.equal(decorate([{...vehicle,observedAt:new Date(now-90001).toISOString()}],[delta])[0].direction,null);assert.equal(decorate([{...vehicle,line:'22'}],[delta])[0].direction,null);
});
