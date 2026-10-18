import {distanceMeters} from '../transit-core.mjs';

export const LIVE_PROGRESS_CONFIDENCE='brigade_route_progress';
const MAX_OFFSET=900000,MAX_SHAPE_ERROR=120;
const AMBIGUOUS_PROGRESS=Symbol('ambiguous_route_projection');
const validPoint=p=>Number.isFinite(p?.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p?.longitude)&&Math.abs(p.longitude)<=180;
// Projection is onto the official directed shape, never a circle around a stop.
function projections(shape,point){
 const result=[],cos=Math.cos(point.latitude*Math.PI/180),scale=111195;
 for(let i=1;i<shape.points.length;i++){
  const a=shape.points[i-1],b=shape.points[i],x=(b.longitude-a.longitude)*cos*scale,y=(b.latitude-a.latitude)*scale;
  const px=(point.longitude-a.longitude)*cos*scale,py=(point.latitude-a.latitude)*scale,length=x*x+y*y;
  if(!length)continue;const fraction=Math.max(0,Math.min(1,(px*x+py*y)/length));
  result.push({progress:shape.meters[i-1]+fraction*(shape.meters[i]-shape.meters[i-1]),distance:Math.hypot(px-fraction*x,py-fraction*y)});
 }
 return result;
}
function distinctProjections(items,tolerance=25){
 const groups=[];for(const item of items.sort((a,b)=>a.progress-b.progress)){const prior=groups.at(-1);if(prior&&item.progress-prior.progress<=tolerance){if(item.distance<prior.distance)groups[groups.length-1]=item;}else groups.push(item);}return groups;
}
function atSourceDistance(shape,value){
 if(!Number.isFinite(value)||!shape.sourceDistances)return null;
 const distances=shape.sourceDistances;if(value<distances[0]||value>distances.at(-1))return null;
 for(let i=1;i<distances.length;i++)if(distances[i]>=value&&distances[i]>distances[i-1])return shape.meters[i-1]+(value-distances[i-1])/(distances[i]-distances[i-1])*(shape.meters[i]-shape.meters[i-1]);
 return null;
}
function prepareShape(points){
 if(!Array.isArray(points)||points.length<2||!points.every(validPoint))return null;
 const meters=[0];for(let i=1;i<points.length;i++)meters.push(meters.at(-1)+distanceMeters(points[i-1],points[i]));
 if(meters.at(-1)<=1)return null;
 const distances=points.map(p=>p.shapeDistance),sourceDistances=distances.every((d,i)=>Number.isFinite(d)&&(!i||d>=distances[i-1]))&&distances.at(-1)>distances[0]?distances:null;
 return{points,meters,sourceDistances};
}
function prepareTrip(trip,shape,stops){
 if(!shape||trip.stopTimes.length<2)return null;const positions=[];
 for(let i=0;i<trip.stopTimes.length;i++){
  const event=trip.stopTimes[i],stop=stops.get(event.stopId);if(!stop)return null;
  let progress=atSourceDistance(shape,event.shapeDistance);
  if(progress===null){
   const items=projections(shape,stop).filter(p=>p.distance<=150&&(!i||p.progress>positions[i-1]+1));if(!items.length)return null;
   const best=Math.min(...items.map(p=>p.distance)),matches=distinctProjections(items.filter(p=>p.distance<=best+5));
   // The first stop may anchor the beginning of a closed shape. Other repeated
   // geometry needs GTFS distances; choosing an arbitrary loop invents progress.
   if(i===0&&matches[0]?.progress<=25)progress=matches[0].progress;
   else if(matches.length===1)progress=matches[0].progress;else return null;
  }
  if(i&&progress<=positions[i-1]+1)return null;positions.push(progress);
 }
 return{trip,shape,positions};
}
function projectVehicle(prepared,vehicle,prior){
 let items=projections(prepared.shape,vehicle).filter(p=>p.distance<=MAX_SHAPE_ERROR);
 if(!items.length)return null;const best=Math.min(...items.map(p=>p.distance));items=items.filter(p=>p.distance<=best+8);

 const matches=distinctProjections(items,30);if(matches.length>1)return AMBIGUOUS_PROGRESS;if(!matches.length)return null;
 const progress=matches[0].progress;if(prior&&progress<prior.progressMeters-25)return null;if(progress<prepared.positions[0]-25||progress>prepared.positions.at(-1)+25)return null;
 return Math.max(prepared.positions[0],Math.min(prepared.positions.at(-1),progress));
}
function scheduledAt(prepared,progress){
 const{positions,trip}=prepared;for(let i=0;i<positions.length-1;i++)if(progress<positions[i+1]){
  const from=trip.stopTimes[i],to=trip.stopTimes[i+1],fraction=(progress-positions[i])/(positions[i+1]-positions[i]);
  return from.departure+fraction*(to.arrival-from.departure);
 }
 return trip.stopTimes.at(-1).arrival;
}

// RAM stores one current progress/next-stop state per vehicle and current trip
// deltas. Source timestamps are retained; normalization is a schedule estimate.
export function createDelayModel({now=()=>Date.now(),maxVehicles=5000,stateTtlMs=180000,deltaTtlMs=180000,tripEvidence=()=>null}={}){
 const emptyDiagnostics=()=>({scope:'latest_vehicle_sample',sampledAt:null,received:0,eligible:0,missingBrigade:0,staleOrInvalid:0,duplicateObservations:0,uniquelyMatched:0,awaitingEvidence:0,ambiguousTrips:0,noPlausibleTrip:0,noUsableGeometry:0,noUsableProjection:0,noMatchingBrigadeTrip:0,conflictingVehicles:0});
 let matchingDiagnostics=emptyDiagnostics();
 const states=new Map(),deltas=new Map();let graph,byLine=new Map(),stops=new Map(),prepared=new WeakMap(),shapes=new WeakMap();
 function invalidate(state){if(state?.tripId&&deltas.get(state.tripId)?.vehicleId===state.vehicleId)deltas.delete(state.tripId);}
 function expire(){const time=now();for(const[id,state]of states)if(time-state.observedAt>stateTtlMs){invalidate(state);states.delete(id);}for(const[id,delta]of deltas)if(time-delta.observedAt>deltaTtlMs||time-delta.observedAt< -60000)deltas.delete(id);}
 function attachGraph(value,{preserveState=false}={}){
  if(graph===value)return;graph=value;byLine=new Map();stops=new Map(graph.stops.map(stop=>[stop.id,stop]));prepared=new WeakMap();shapes=new WeakMap();
  if(!preserveState){states.clear();deltas.clear();}for(const trip of graph.trips){if(!byLine.has(trip.line))byLine.set(trip.line,[]);byLine.get(trip.line).push(trip);}
 }
 function geometry(trip){if(prepared.has(trip))return prepared.get(trip);let shape=null;if(Array.isArray(trip.shape)){if(!shapes.has(trip.shape))shapes.set(trip.shape,prepareShape(trip.shape));shape=shapes.get(trip.shape);}const value=prepareTrip(trip,shape,stops);prepared.set(trip,value);return value;}
 function ingest(vehicles){expire();matchingDiagnostics=emptyDiagnostics();matchingDiagnostics.sampledAt=new Date(now()).toISOString();matchingDiagnostics.received=vehicles.length;for(const vehicle of vehicles){
  const observedAt=Date.parse(vehicle.observedAt),age=now()-observedAt,prior=states.get(vehicle.id);
  if(vehicle.freshness!=='recent'||!String(vehicle.brigade??'').trim()||!validPoint(vehicle)||!Number.isFinite(age)||age>90000||age< -60000){matchingDiagnostics[!String(vehicle.brigade??'').trim()?'missingBrigade':'staleOrInvalid']++;invalidate(prior);states.delete(vehicle.id);continue;}
  matchingDiagnostics.eligible++;
  if(prior&&observedAt<=prior.observedAt){matchingDiagnostics.duplicateObservations++;continue;}
  const sameIdentity=prior?.line===vehicle.line&&prior?.brigade===vehicle.brigade;if(!sameIdentity)invalidate(prior);
  const matches=[];let unresolved=false,plausible=false,usableGeometry=false,usableProjection=false;
  for(const trip of byLine.get(vehicle.line)||[]){
   if(trip.stopTimes[0].departure>observedAt+MAX_OFFSET||trip.stopTimes.at(-1).arrival<observedAt-MAX_OFFSET)continue;
   plausible=true;const path=geometry(trip);if(!path)continue;usableGeometry=true;const previous=sameIdentity&&prior.tripId===trip.id?prior:null,progress=projectVehicle(path,vehicle,previous);if(typeof progress!=='number')continue;
   const scheduledPassageAt=scheduledAt(path,progress);if(Math.abs(observedAt-scheduledPassageAt)>MAX_OFFSET)continue;usableProjection=true;
   const nextIndex=path.positions.findIndex(p=>p>progress+0.01),evidenceIndex=nextIndex<0?trip.stopTimes.length-1:Math.max(0,nextIndex-1);
   // Warm the registered next platform ahead of crossing, while current-leg
   // evidence determines identity now. A future branch must not erase a valid
   // current delta before the vehicle reaches that branch.
   if(previous?.nextStopIndex>=0&&progress<path.positions[previous.nextStopIndex])tripEvidence(vehicle,trip.stopTimes[previous.nextStopIndex].stopId);
   const evidenceStopId=trip.stopTimes[evidenceIndex].stopId,evidence=tripEvidence(vehicle,evidenceStopId);if(evidence===null){unresolved=true;continue;}if(!evidence.has(trip.id))continue;
   // Missing geometry or an ambiguous projection cannot eliminate another
   // positively brigade-bound, plausible trip sharing this platform. Off-shape
   // competitors can still be excluded, unlike overlapping loop occurrences.
   if((byLine.get(vehicle.line)||[]).some(other=>other.id!==trip.id&&evidence.has(other.id)&&other.stopTimes[0].departure<=observedAt+MAX_OFFSET&&other.stopTimes.at(-1).arrival>=observedAt-MAX_OFFSET&&other.stopTimes.some(event=>event.stopId===evidenceStopId)&&(!geometry(other)||projectVehicle(geometry(other),vehicle,sameIdentity&&prior.tripId===other.id?prior:null)===AMBIGUOUS_PROGRESS)))unresolved=true;
   matches.push({path,trip,progress,scheduledPassageAt,nextIndex});
  }
  if(unresolved||matches.length!==1){
   matchingDiagnostics[unresolved?'awaitingEvidence':matches.length>1?'ambiguousTrips':!plausible?'noPlausibleTrip':!usableGeometry?'noUsableGeometry':!usableProjection?'noUsableProjection':'noMatchingBrigadeTrip']++;
   invalidate(prior);let waiting=null;
   if(unresolved&&matches.length<=1&&sameIdentity&&prior.tripId){
    const trip=(byLine.get(vehicle.line)||[]).find(t=>t.id===prior.tripId),path=trip&&geometry(trip),progress=path&&projectVehicle(path,vehicle,prior);
    if(typeof progress==='number'){
     let pending=prior.pending;
     if(prior.nextStopIndex>=0&&progress+0.01>=path.positions[prior.nextStopIndex]){
      let crossed=prior.nextStopIndex;while(crossed+1<path.positions.length&&path.positions[crossed+1]<=progress+0.01)crossed++;
      if(!pending||crossed>pending.stopIndex)pending={progress,observedAt,stopIndex:crossed,scheduledPassageAt:scheduledAt(path,progress)};
     }
     waiting={...prior,observedAt,pending};
    }
   }
   states.delete(vehicle.id);states.set(vehicle.id,waiting||{vehicleId:vehicle.id,line:vehicle.line,brigade:vehicle.brigade,observedAt});continue;
  }
  const match=matches[0],previous=sameIdentity&&prior.tripId===match.trip.id?prior:null;
  if(prior?.tripId&&!previous)invalidate(prior);
  const peer=[...states.values()].find(state=>state.vehicleId!==vehicle.id&&state.tripId===match.trip.id);
  if(peer){matchingDiagnostics.conflictingVehicles++;invalidate(peer);invalidate(prior);states.delete(vehicle.id);states.set(vehicle.id,{vehicleId:vehicle.id,line:vehicle.line,brigade:vehicle.brigade,observedAt,tripId:match.trip.id,progressMeters:match.progress,nextStopIndex:match.nextIndex});continue;}
  matchingDiagnostics.uniquelyMatched++;
  // A first point establishes the NEXT stop. It cannot claim an earlier passage.
  const progress=Math.max(previous?.progressMeters??-Infinity,match.progress),nextStopIndex=match.path.positions.findIndex(p=>p>progress+0.01);
  if(previous?.nextStopIndex>=0&&match.progress+0.01>=match.path.positions[previous.nextStopIndex]){
   let crossed=previous.nextStopIndex;while(crossed+1<match.path.positions.length&&match.path.positions[crossed+1]<=match.progress+0.01)crossed++;
   const observation=previous.pending?.stopIndex===crossed?previous.pending:{progress:match.progress,observedAt,scheduledPassageAt:match.scheduledPassageAt};
   const event=match.trip.stopTimes[crossed],normalizationMs=observation.scheduledPassageAt-event.arrival;
   deltas.set(match.trip.id,{tripId:match.trip.id,vehicleId:vehicle.id,deltaMs:observation.observedAt-observation.scheduledPassageAt,stopIndex:crossed,stopId:event.stopId,observedAt:observation.observedAt,updatedAt:now(),estimatedArrivalAtStop:observation.observedAt-normalizationMs,normalizationMs,distancePastStopMeters:Math.max(0,observation.progress-match.path.positions[crossed]),progressMeters:observation.progress,scheduledPassageAt:observation.scheduledPassageAt,confidence:LIVE_PROGRESS_CONFIDENCE,method:'scheduled_route_progress'});
  }
  states.delete(vehicle.id);states.set(vehicle.id,{vehicleId:vehicle.id,line:vehicle.line,brigade:vehicle.brigade,observedAt,tripId:match.trip.id,progressMeters:progress,nextStopIndex});
  while(states.size>maxVehicles){const id=states.keys().next().value;invalidate(states.get(id));states.delete(id);}
 }while(states.size>maxVehicles){const id=states.keys().next().value;invalidate(states.get(id));states.delete(id);}expire();}
 return{attachGraph,ingest,getDeltas(){expire();return new Map([...deltas].map(([id,delta])=>[id,{...delta,ageSeconds:Math.max(0,Math.floor((now()-delta.observedAt)/1000))}]));},summary(){expire();return{status:graph?'observing':'warming',trackedVehicles:states.size,tentativeTrips:[...states.values()].filter(s=>s.tripId).length,vehiclesAwaitingNextStop:[...states.values()].filter(s=>s.nextStopIndex>=0).length,confirmedTrips:deltas.size,maxVehicles,stateTtlMs,deltaTtlMs,method:'scheduled_route_progress',normalization:'scheduled_departure_to_next_arrival',persistentGpsHistory:false,matchingDiagnostics:{...matchingDiagnostics}};},clear(){states.clear();deltas.clear();matchingDiagnostics=emptyDiagnostics();}};
}
