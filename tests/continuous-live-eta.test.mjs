import test from 'node:test';
import assert from 'node:assert/strict';
import {createTransitService,TRANSIT_SOURCES} from '../server/transit.mjs';
const base=Date.parse('2026-10-17T12:00:00Z');
const locations=['A','B','C','D'].map((name,index)=>({id:String(1000+index)+'-01',name,platform:'01',latitude:52.2+index*.01,longitude:21}));
const clock=seconds=>'14:'+String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');
const pairs=value=>({values:Object.entries(value).map(([key,value])=>({key,value}))});
const events=[60,180,360,540];
function fixture({lineCount=1,failFirst=false,staleCount=0,holdEvidence=false}={}){
 let time=base+80000,latitude=locations[0].latitude-.001,timer,active=0,maxActive=0,failures=0;
 let releaseEvidence;const gate=holdEvidence?new Promise(resolve=>{releaseEvidence=resolve;}):null;
 const calls=[],graph={serviceDay:'2026-10-17',timeZone:'Europe/Warsaw',source:{url:'https://gtfs.ztm.waw.pl/last',version:'fixture',validFrom:'2026-10-16',validTo:'2026-10-25'},stops:locations,trips:Array.from({length:lineCount},(_,index)=>({id:'trip-'+index,serviceDate:'2026-10-17',line:String(index+1),routeType:0,headsign:'D',stopTimes:locations.map((stop,i)=>({stopId:stop.id,arrival:base+events[i]*1000,departure:base+events[i]*1000,departureClock:clock(events[i]),pickup:0,dropOff:0}))}))};
 const service=createTransitService({now:()=>time,key:()=> 'fixture-token',graphProvider:async()=>graph,setTimeoutImpl:(callback,delay)=>{assert.ok(delay>=0&&delay<=15000);timer=callback;return{unref(){}};},clearTimeoutImpl:()=>{timer=null;},fetchImpl:async(url,options)=>{
  assert.equal(options.headers.Authorization,'fixture-token');const action=url.split('/').at(-1),args=options.body?JSON.parse(options.body):{};calls.push({action,args});
  if(action===TRANSIT_SOURCES.stops.action)return{ok:true,json:async()=>locations.map(stop=>pairs({zespol:stop.id.split('-')[0],slupek:'01',nazwa_zespolu:stop.name,szer_geo:String(stop.latitude),dlug_geo:'21'}))};
  if(action===TRANSIT_SOURCES.vehicles.action)return{ok:true,json:async()=>args.type===2?[...Array.from({length:staleCount},(_,index)=>({Lat:locations[0].latitude,Lon:21,Lines:'1',VehicleNumber:'stale-'+index,Brigade:'1',Time:'2025-01-01 14:00:00'})),...graph.trips.map((trip,index)=>({Lat:latitude,Lon:21,Lines:trip.line,VehicleNumber:String(index),Brigade:'01',Time:'2026-10-17 '+clock(Math.round((time-base)/1000))}))]:[]};
  assert.equal(action,TRANSIT_SOURCES.departures.action);active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setImmediate(resolve));if(gate)await gate;active--;
  if(failFirst&&failures++===0)throw new Error('temporary source failure');
  const stopIndex=locations.findIndex(stop=>stop.id.startsWith(args.busstopId+'-'));
  return{ok:true,json:async()=>[pairs({czas:clock(events[stopIndex]),brygada:'1',kierunek:'D',trasa:'fixture'})]};
 }});
 const status=()=>service.liveSnapshot({origin:locations[0],destination:locations[3]});
 const settled=async()=>{for(let index=0;index<100&&status().liveModel.evidenceInFlight;index++)await new Promise(resolve=>setImmediate(resolve));assert.equal(status().liveModel.evidenceInFlight,false);};
 return{service,calls,graph,status,settled,releaseEvidence:()=>releaseEvidence?.(),maxActive:()=>maxActive,async tick(seconds,point=latitude,waitEvidence=true){time=base+seconds*1000;latitude=point;assert.ok(timer);const callback=timer;timer=null;await callback();if(waitEvidence)await settled();},setTime:seconds=>{time=base+seconds*1000;}};
}
test('server-start learning confirms exact-trip deltas before any journey and reuses them immediately without query reset',async()=>{
 const f=fixture();try{await f.service.startTracking();await f.settled();assert.equal(f.status().liveModel.evidenceLines,1);assert.equal(f.status().liveModel.confirmedTrips,0);
  await f.tick(90,locations[0].latitude);await f.tick(105);await f.tick(195,locations[1].latitude-.001);await f.tick(210,locations[1].latitude);await f.tick(225);
  assert.equal(f.status().liveModel.confirmedTrips,1);assert.equal(f.status().liveModel.continuous,true);
  assert.equal(f.calls.filter(call=>call.action===TRANSIT_SOURCES.departures.action).length,1,'one positive exact-trip binding applies at subsequent stops');
  const request={origin:locations[2],destination:locations[3],departureTime:new Date(base+225000).toISOString()};
  const first=await f.service.plan(request),second=await f.service.plan(request);for(const result of [first,second]){assert.equal(result.liveModel.confirmedTrips,1);const ride=result.routes[0].steps.find(step=>step.mode==='TRANSIT');assert.equal(ride.delay.deltaMs,30000);assert.equal(ride.end,base+570000);}
  await f.service.plan({...request,departureTime:'2026-10-18T12:00:00.000Z'});assert.equal(f.status().liveModel.confirmedTrips,1,'future-date query must not replace current-day learning');
 }finally{f.service.stopTracking();}
});
test('all active lines eventually obtain evidence without the old 100-entry eviction and with four-request concurrency',async()=>{
 const f=fixture({lineCount:125});try{await f.service.startTracking();await f.settled();assert.equal(f.maxActive(),4);assert.equal(f.status().liveModel.evidenceLines,12);
  for(let index=1;index<=10;index++)await f.tick(80+index*15);
  assert.equal(f.status().liveModel.evidenceLines,125);assert.equal(f.status().liveModel.pendingEvidence,0);assert.equal(f.status().liveModel.evidenceDiagnostics.requests,125);assert.ok(f.maxActive()<=4);
 }finally{f.service.stopTracking();}
});
test('failed evidence retries fairly with timestamps; stale nearby positions cannot occupy the map delivery limit',async()=>{
 const f=fixture({failFirst:true,staleCount:60});try{await f.service.startTracking();await f.settled();let snapshot=f.status();assert.equal(snapshot.vehicles.length,1);assert.equal(snapshot.vehicles[0].vehicle,'0');assert.equal(snapshot.liveModel.evidenceDiagnostics.failures,1);assert.ok(snapshot.liveModel.evidenceDiagnostics.lastFailureAt);assert.equal(snapshot.liveModel.pendingEvidence,1);
  await f.tick(95);snapshot=f.status();assert.equal(snapshot.liveModel.evidenceLines,1);assert.ok(snapshot.liveModel.evidenceDiagnostics.lastSuccessAt);assert.equal(snapshot.liveModel.evidenceDiagnostics.requests,2);
  const result=await f.service.plan({origin:locations[0],destination:locations[3],departureTime:new Date(base+95000).toISOString()});assert.equal(result.vehicles.length,1);assert.equal(result.vehicles[0].freshness,'recent');
 }finally{f.service.stopTracking();}
});
test('stopTracking aborts in-flight work and discards current learning without scheduling another cycle',async()=>{
 const f=fixture();await f.service.startTracking();f.service.stopTracking();await f.settled();assert.equal(f.status().liveModel.continuous,false);assert.equal(f.status().liveModel.evidenceLines,0);assert.equal(f.status().liveModel.trackedVehicles,0);
});

test('blocked timetable evidence cannot hold back the next global fleet sample',async()=>{
 const f=fixture({holdEvidence:true});try{await f.service.startTracking();assert.equal(f.status().liveModel.evidenceInFlight,true);const initial=f.calls.filter(call=>call.action===TRANSIT_SOURCES.vehicles.action).length;
  await f.tick(95,locations[0].latitude,false);assert.equal(f.calls.filter(call=>call.action===TRANSIT_SOURCES.vehicles.action).length,initial+2);assert.equal(f.status().liveModel.evidenceInFlight,true);assert.equal(f.status().liveModel.trackingDiagnostics.lastPollCompletedAt,new Date(base+95000).toISOString());
 }finally{f.service.stopTracking();f.releaseEvidence();await f.settled();}
});
