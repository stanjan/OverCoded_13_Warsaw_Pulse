import test from 'node:test';
import assert from 'node:assert/strict';
import {createTransitService} from '../server/transit.mjs';
import {planGraph} from '../server/transit-router.mjs';
import {favoriteSnapshot,createFavoritesStore,FAVORITES_KEY} from '../favorites.mjs';
const initial=Date.parse('2026-10-18T08:00:30Z');
const reply=rows=>({ok:true,json:async()=>rows});
const points={origin:{latitude:52.2,longitude:21},destination:{latitude:52.201,longitude:21},mode:'transit'};
const row=(latitude=52.201,time='10:00:30',id='1')=>({Lat:latitude,Lon:21,Lines:'10',VehicleNumber:id,Brigade:'1',Time:'2026-10-18 '+time});
const stop={values:Object.entries({zespol:'1001',slupek:'01',nazwa_zespolu:'A',szer_geo:'52.2',dlug_geo:'21'}).map(([key,value])=>({key,value}))};
async function fleetRace(second,first){
 let firstResolve,calls=0;
 const service=createTransitService({now:()=>initial,key:()=> 'fixture',graphProvider:async()=>null,setTimeoutImpl:()=>0,clearTimeoutImpl(){},fetchImpl:async(url,options)=>{
  if(url.endsWith('get_ztm_przystanki_komunikacji_miejskiej'))return reply([stop]);
  if(url.endsWith('get_ztm_lokalizacja_pojazdow')){
   if(JSON.parse(options.body).type===2)return reply([]);
   if(++calls===1)return new Promise(resolve=>firstResolve=resolve);
   return reply(second);
  }
  return reply([]);
 }});
 const tracking=service.startTracking();
 while(!firstResolve)await new Promise(resolve=>setImmediate(resolve));
 await service.plan(points);
 const afterSecond=service.liveSnapshot(points);
 firstResolve(reply(first));await tracking;
 const afterFirst=service.liveSnapshot(points);
 await service.plan(points);
 const afterCache=service.liveSnapshot(points);
 service.stopTracking();return{afterSecond,afterFirst,afterCache,calls};
}
test('older fleet response cannot regress shared snapshot or poison the next cached read',async()=>{
 const result=await fleetRace([row()],[row(52.2,'10:00:00')]);
 for(const snapshot of [result.afterSecond,result.afterFirst,result.afterCache])assert.equal(snapshot.vehicles[0].latitude,52.201);
 assert.equal(result.calls,2,'third request uses the protected latest cache');
});
test('newer successful empty fleet removes vehicles and delayed response cannot resurrect them',async()=>{
 const result=await fleetRace([],[row()]);
 assert.equal(result.afterFirst.vehicles.length,0);assert.equal(result.afterCache.vehicles.length,0);
});
test('source time wins over request start order for vehicles still in current fleet',async()=>{
 const result=await fleetRace([row(52.2,'10:00:00')],[row()]);
 assert.equal(result.afterFirst.vehicles[0].latitude,52.201);
 assert.equal(result.afterCache.vehicles[0].latitude,52.201,'cached older source time cannot regress sample');
});
test('sequential source regression, partial type failure and expiry preserve honest fleet state',async()=>{
 let clock=initial,phase=0;
 const service=createTransitService({now:()=>clock,key:()=> 'fixture',graphProvider:async()=>null,fetchImpl:async(url,options)=>{
  if(url.endsWith('get_ztm_przystanki_komunikacji_miejskiej'))return reply([stop]);
  if(!url.endsWith('get_ztm_lokalizacja_pojazdow'))return reply([]);
  const type=JSON.parse(options.body).type;
  if(phase===1&&type===2)throw new Error('fixture failed tram source');
  if(phase===2)return reply([]);
  return reply([row(phase?52.2:52.201,phase?'10:00:00':'10:00:30')]);
 }});
 await service.plan(points);clock+=9000;phase=1;await service.plan(points);
 const snapshot=service.liveSnapshot(points);
 assert.deepEqual(snapshot.vehicles.map(vehicle=>vehicle.latitude),[52.201],'failed type is hidden while the successful type remains monotonic');
 assert.deepEqual(snapshot.errors,[{code:'SOURCE_UNAVAILABLE',part:'vehicles',type:2}]);
 clock+=100000;assert.equal(service.liveSnapshot(points).vehicles.length,0,'retained failed-source observation expires normally');
 assert.equal((await service.plan(points)).vehicles.length,0,'route plans also expire retained same-timestamp observations');
 phase=2;await service.plan(points);assert.equal(service.liveSnapshot(points).vehicles.length,0);
 service.stopTracking();
});
function loopGraph(withDistances=true){
 const p=(id,latitude,longitude)=>({id,name:id,latitude,longitude});
 const A=p('A',52.2,21),B=p('B',52.21,21),C=p('C',52.2,21.02);
 return{timeZone:'Europe/Warsaw',stops:[A,B,C],source:{url:'https://gtfs.ztm.waw.pl/gtfs.zip',validFrom:'2026-10-18',validTo:'2026-10-18'},trips:[{id:'loop',serviceDate:'2026-10-18',line:'L',headsign:'C',shape:[A,B,A,C].map((p,i)=>({...p,...(withDistances?{shapeDistance:i}: {})})),stopTimes:[['A',-600,0],['B',-300,1],['A',60,2],['C',300,3]].map(([stopId,seconds,shapeDistance])=>({stopId,arrival:initial+seconds*1000,departure:initial+seconds*1000,pickup:0,dropOff:0,shapeDistance}))}]};
}
for(const metadata of [true,false])test('second occurrence of a loop stop never draws the earlier loop (distances='+metadata+')',()=>{
 const graph=loopGraph(metadata),route=planGraph(graph,{origin:{...graph.stops[0],label:'A'},destination:{...graph.stops[2],label:'C'},departureTime:initial})[0];
 const ride=route.steps.find(step=>step.mode==='TRANSIT');
 assert.equal(ride.fromStopIndex,2);assert.equal(ride.toStopIndex,3);
 assert.deepEqual(ride.path,graph.stops.filter(stop=>stop.id!=='B').map(({latitude,longitude})=>({latitude,longitude})));
 assert.equal(ride.geometry,metadata?'gtfs_shape':'schematic');
 assert.equal(Boolean(ride.fullPath),metadata);
});
test('inconsistent source distances fall back rather than select a false loop occurrence',()=>{
 const graph=loopGraph();graph.trips[0].shape[2].shapeDistance=-1;
 const ride=planGraph(graph,{origin:{...graph.stops[0],label:'A'},destination:{...graph.stops[2],label:'C'},departureTime:initial})[0].steps.find(step=>step.mode==='TRANSIT');
 assert.equal(ride.geometry,'schematic');assert.equal(ride.path.length,2);
});
const tourist={id:'tourist',name:'Spacer',category:'route',lat:52.2,lng:21,lengthKm:3.59,geometryStatus:'published',traceSegments:[[[52.2,21],[52.21,21.01]],[[52.22,21.02],[52.23,21.03]]],touristPoints:[{name:'Rynek',lat:52.21,lng:21.01}]};
test('saved tourist route survives storage reload with separate trail gaps, details and defensive copies',()=>{
 const data={},storage={getItem:key=>data[key]||null,setItem:(key,value)=>data[key]=value};
 const first=createFavoritesStore({storage});const input=structuredClone(tourist);first.add(input);
 input.traceSegments[0][0][0]=0; // Input cannot mutate the saved snapshot.
 const second=createFavoritesStore({storage}),saved=second.list()[0];
 assert.equal(saved.lengthKm,3.59);assert.equal(saved.geometryStatus,'published');assert.equal(saved.traceVertexCount,4);
 assert.equal(saved.traceSegments[0][0][0],52.2);assert.equal(saved.traceSegments.length,2);assert.equal(saved.touristPoints[0].name,'Rynek');
 saved.traceSegments[0][0][0]=1;saved.touristPoints[0].name='Changed';
 assert.equal(second.list()[0].traceSegments[0][0][0],52.2);assert.equal(second.list()[0].touristPoints[0].name,'Rynek');
 assert.ok(data[FAVORITES_KEY]);
});
test('malformed, oversized and legacy saved tourist geometry remains bounded and explicitly local',()=>{
 const legacy=favoriteSnapshot({id:'old',name:'Old',category:'route',lat:52.2,lng:21});
 assert.equal(legacy.geometryStatus,'saved_unavailable');assert.equal(legacy.traceSegments,undefined);
 const supported=favoriteSnapshot({...tourist,traceSegments:[Array.from({length:3000},()=>[52.2,21])]});assert.equal(supported.traceVertexCount,3000);assert.equal(supported.geometryStatus,'published');
 const oversized=favoriteSnapshot({...tourist,traceSegments:[Array.from({length:10001},()=>[52.2,21])],touristPoints:Array.from({length:1000},()=>({name:'A',lat:52.2,lng:21}))});
 assert.equal(oversized.geometryStatus,'saved_unavailable');assert.equal(oversized.traceSegments,undefined);assert.equal(oversized.touristPoints.length,100);
 const malformed=favoriteSnapshot({...tourist,lengthKm:-1,traceSegments:[[[52.2,21],[91,21]],[[52.2,21],[52.3,21.1]]]});
 assert.equal(malformed.geometryStatus,'partial');assert.equal(malformed.traceSegments.length,1);assert.equal(malformed.lengthKm,undefined);
 const broken=createFavoritesStore({storage:{getItem:()=>JSON.stringify([{...tourist,traceSegments:[null,[null,null]]}])}});
 assert.equal(broken.list()[0].geometryStatus,'saved_unavailable');
});
