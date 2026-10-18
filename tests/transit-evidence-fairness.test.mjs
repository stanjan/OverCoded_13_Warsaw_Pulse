import test from 'node:test';
import assert from 'node:assert/strict';
import {createTransitService,TRANSIT_SOURCES} from '../server/transit.mjs';
const base=Date.parse('2026-10-17T12:00:00Z');
const pairs=value=>({values:Object.entries(value).map(([key,value])=>({key,value}))});

test('one busy line cannot fill the bounded evidence queue before another active line receives bootstrap evidence',async()=>{
 const firstStops=Array.from({length:600},(_,index)=>({id:String(1000+index)+'-01',name:'Variant '+index,platform:'01',latitude:52.2,longitude:21}));
 const last={id:'9999-01',name:'Terminal',platform:'01',latitude:52.21,longitude:21},other={id:'2000-01',name:'Other line',platform:'01',latitude:52.2,longitude:21};
 const stops=[...firstStops,other,last],trip=(start,line,index)=>({id:'trip-'+line+'-'+index,line,headsign:'Terminal',shape:[start,last],stopTimes:[{stopId:start.id,arrival:base+60000,departure:base+60000,departureClock:'14:01:00'},{stopId:last.id,arrival:base+180000,departure:base+180000,departureClock:'14:03:00'}]});
 const graph={serviceDay:'2026-10-17',timeZone:'Europe/Warsaw',source:{url:'https://gtfs.ztm.waw.pl/last',version:'fixture',validFrom:'2026-10-16',validTo:'2026-10-25'},stops,trips:[...firstStops.map((stop,index)=>trip(stop,'1',index)),trip(other,'2',0)]};
 const requests=[];const service=createTransitService({now:()=>base+80000,key:()=> 'fixture-token',graphProvider:async()=>graph,setTimeoutImpl:()=>({unref(){}}),clearTimeoutImpl:()=>{},fetchImpl:async(url,init)=>{
  const action=url.split('/').at(-1),args=init.body?JSON.parse(init.body):{};
  if(action===TRANSIT_SOURCES.stops.action)return{ok:true,json:async()=>stops.map(stop=>pairs({zespol:stop.id.split('-')[0],slupek:'01',nazwa_zespolu:stop.name,szer_geo:String(stop.latitude),dlug_geo:String(stop.longitude)}))};
  if(action===TRANSIT_SOURCES.vehicles.action)return{ok:true,json:async()=>args.type===2?['1','2'].map(line=>({Lat:52.205,Lon:21,Lines:line,VehicleNumber:line,Brigade:'1',Time:'2026-10-17 14:01:20'})):[]};
  assert.equal(action,TRANSIT_SOURCES.departures.action);requests.push(args);return{ok:true,json:async()=>[pairs({czas:args.busstopId==='9999'?'14:03:00':'14:01:00',brygada:'1',kierunek:'Terminal',trasa:'fixture'})]};
 }});
 const snapshot=()=>service.liveSnapshot({origin:firstStops[0],destination:last});
 try{
  await service.startTracking();for(let index=0;index<100&&snapshot().liveModel.evidenceInFlight;index++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(snapshot().liveModel.evidenceInFlight,false);assert.ok(requests.length<=12);assert.ok(snapshot().liveModel.pendingEvidence<=512);
  assert.ok(requests.some(request=>request.line==='2'),"bootstrap evidence for the second active line must not be starved by the first line's platform variants");
 }finally{service.stopTracking();}
});
