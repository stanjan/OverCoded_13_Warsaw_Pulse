import {TransitError,distanceMeters} from '../transit-core.mjs';
import {planGraph} from './transit-router.mjs';
import {createWalkingProvider,walkingKey,WALK_SOURCE} from './walking.mjs';
// Request-local edges only: coordinates, paths and failures never go to disk.
export function createWalkingVerification({signal,maxCalls=24,deadlineMs=25000}={}){return{edges:new Map(),calls:0,maxCalls,deadlineAt:Date.now()+deadlineMs,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(deadlineMs)]):AbortSignal.timeout(deadlineMs)};}
export async function planPedestrianGraph(graph,options,{provider=createWalkingProvider(),maxCalls=12,deadlineMs=25000,maxRounds=16,verification=createWalkingVerification({signal:options.signal,maxCalls,deadlineMs})}={}){
 const {edges,signal}=verification;let limited=false;
 for(let round=0;round<maxRounds;round++){
  options.signal?.throwIfAborted();
  const candidates=planGraph(graph,{...options,walkingEdges:edges});
  const unknown=candidates.flatMap(route=>route.steps.filter(step=>step.mode==='WALK'&&!edges.has(step.walkingKey)));
  const next=unknown[0];
  if(!next||verification.calls>=verification.maxCalls||signal.aborted||Date.now()>=verification.deadlineAt){limited=!!next;return finish(candidates,limited);}
  verification.calls++;
  try{const result=await provider.route(next.path[0],next.path.at(-1),{signal});if(result?.geometry!=='osm_pedestrian'||!Number.isFinite(result.durationMillis)||result.durationMillis<0||result.durationMillis>18000000||!Number.isFinite(result.distanceMeters)||result.distanceMeters<0||!Array.isArray(result.path)||result.path.length<2||result.path.length>20000||!result.path.every(point=>Number.isFinite(point?.latitude)&&Math.abs(point.latitude)<=90&&Number.isFinite(point.longitude)&&Math.abs(point.longitude)<=180))throw new TransitError('WALK_SCHEMA','Nieprawidłowy wynik przejścia.');edges.set(next.walkingKey,result);}
  catch(error){options.signal?.throwIfAborted();if(error?.code==='WALK_UNREACHABLE')edges.set(next.walkingKey,null);else {const verified=finish(planGraph(graph,{...options,walkingEdges:edges}),true,false);if(verified.length)return verified;throw error;}}
 }
 return finish(planGraph(graph,{...options,walkingEdges:edges}),true);
 function finish(candidates,bounded,throwIfEmpty=true){const verified=candidates.filter(route=>route.steps.every(step=>step.mode!=='WALK'||edges.get(step.walkingKey)?.geometry==='osm_pedestrian')).map(route=>({...route,destinationPoint:{latitude:options.destination.latitude,longitude:options.destination.longitude},...(route.steps.some(step=>step.mode==='WALK')?{walkingSource:WALK_SOURCE}:{}),walkingVerified:true,walkingCoverage:{calls:verification.calls,maxCalls:verification.maxCalls,bounded},warnings:route.warnings.filter(warning=>!warning.startsWith('Odcinki piesze są szacunkowe.')).concat('Dojścia i przesiadki uwzględniają czasy ścieżek pieszych OpenStreetMap / Valhalla. Czasy przejazdów pozostają rozkładowe, z dostępną korektą modelu GPS.',bounded?'Sprawdzono ograniczoną liczbę przejść pieszych; dostępne opcje nie muszą obejmować wszystkich możliwych połączeń.':[])}));if(!verified.length&&bounded&&throwIfEmpty)throw new TransitError('WALK_VERIFICATION_LIMIT','Nie potwierdzono przejść pieszych w limicie czasu. Spróbuj odświeżyć trasę.');return verified;}
}

// Direct walks are independent of ZTM timetables and vehicle observations.
export async function planDirectWalk(options,{provider=createWalkingProvider()}={}) {
 const {origin,destination,departureTime,signal}=options;
 signal?.throwIfAborted();
 if(distanceMeters(origin,destination)>6000)throw new TransitError('WALK_RANGE','Trasy piesze obsługujemy do 6 km w linii prostej. Wybierz bliższy cel lub komunikację.');
 const edge=await provider.route(origin,destination,{signal});signal?.throwIfAborted();
 if(edge?.geometry!=='osm_pedestrian'||!Number.isFinite(edge.durationMillis)||edge.durationMillis<0||edge.durationMillis>18000000||!Number.isFinite(edge.distanceMeters)||edge.distanceMeters<0||!Array.isArray(edge.path)||edge.path.length<2||edge.path.length>20000||!edge.path.every(point=>Number.isFinite(point?.latitude)&&Math.abs(point.latitude)<=90&&Number.isFinite(point.longitude)&&Math.abs(point.longitude)<=180))throw new TransitError('WALK_SCHEMA','Nieprawidłowy wynik przejścia.');
 const arrival=departureTime+edge.durationMillis;
 return {mode:'walk',origin:origin.label,destination:destination.label,departure:departureTime,arrival,durationMillis:edge.durationMillis,distanceMeters:edge.distanceMeters,transfers:0,steps:[{mode:'WALK',from:origin.label,to:destination.label,start:departureTime,end:arrival,...edge}],provider:'OpenStreetMap · Valhalla',timing:'walking_estimate',realtimeConfirmed:false,modelAdjusted:false,walkingVerified:true,walkingSource:WALK_SOURCE,source:WALK_SOURCE,destinationPoint:{latitude:destination.latitude,longitude:destination.longitude},warnings:[edge.assumption||'Trasa piesza po ścieżkach OpenStreetMap; czas jest szacunkiem Valhalla.']};
}
export function mergeRouteOptions(transitRoutes,walkingRoute) {
 const routes=[...transitRoutes,...(walkingRoute?[walkingRoute]:[])].sort((a,b)=>a.arrival-b.arrival||Number(b.mode==='walk')-Number(a.mode==='walk')).slice(0,3);
 return routes.map((route,index)=>({...route,recommended:index===0,...(index===0&&route.mode==='walk'?{recommendationReason:transitRoutes.length?'Pieszo dotrzesz wcześniej niż sprawdzoną komunikacją.':'Potwierdzona trasa piesza do celu.'}:{})}));
}
