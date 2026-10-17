import {TransitError} from '../transit-core.mjs';
import {planGraph} from './transit-router.mjs';
import {createWalkingProvider,walkingKey,WALK_SOURCE} from './walking.mjs';
// Request-local edges only: coordinates, paths and failures never go to disk.
export async function planPedestrianGraph(graph,options,{provider=createWalkingProvider(),maxCalls=12,deadlineMs=25000,maxRounds=16}={}){
 const edges=new Map(),signal=options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(deadlineMs)]):AbortSignal.timeout(deadlineMs);let calls=0,limited=false;
 for(let round=0;round<maxRounds;round++){
  options.signal?.throwIfAborted();
  const candidates=planGraph(graph,{...options,walkingEdges:edges});
  const unknown=candidates.flatMap(route=>route.steps.filter(step=>step.mode==='WALK'&&!edges.has(step.walkingKey)));
  const next=unknown[0];
  if(!next||calls>=maxCalls||signal.aborted){limited=!!next;return finish(candidates,limited);}
  calls++;
  try{const result=await provider.route(next.path[0],next.path.at(-1),{signal});if(result?.geometry!=='osm_pedestrian'||!Number.isFinite(result.durationMillis)||result.durationMillis<0||!Array.isArray(result.path)||result.path.length<2)throw new TransitError('WALK_SCHEMA','Nieprawidłowy wynik przejścia.');edges.set(next.walkingKey,result);}
  catch(error){options.signal?.throwIfAborted();if(error?.code==='WALK_UNREACHABLE')edges.set(next.walkingKey,null);else {const verified=finish(planGraph(graph,{...options,walkingEdges:edges}),true,false);if(verified.length)return verified;throw error;}}
 }
 return finish(planGraph(graph,{...options,walkingEdges:edges}),true);
 function finish(candidates,bounded,throwIfEmpty=true){const verified=candidates.filter(route=>route.steps.every(step=>step.mode!=='WALK'||edges.get(step.walkingKey)?.geometry==='osm_pedestrian')).map(route=>({...route,destinationPoint:{latitude:options.destination.latitude,longitude:options.destination.longitude},walkingSource:WALK_SOURCE,walkingVerified:true,walkingCoverage:{calls,maxCalls,bounded},warnings:route.warnings.filter(warning=>!warning.startsWith('Odcinki piesze są szacunkowe.')).concat('Dojścia i przesiadki uwzględniają czasy ścieżek pieszych OpenStreetMap / Valhalla. Czasy przejazdów pozostają rozkładowe, z dostępną korektą modelu GPS.',bounded?'Sprawdzono ograniczoną liczbę przejść pieszych; dostępne opcje nie muszą obejmować wszystkich możliwych połączeń.':[])}));if(!verified.length&&bounded&&throwIfEmpty)throw new TransitError('WALK_VERIFICATION_LIMIT','Nie potwierdzono przejść pieszych w limicie czasu. Spróbuj odświeżyć trasę.');return verified;}
}
