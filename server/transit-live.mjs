import {distanceMeters} from '../transit-core.mjs';
// This is a conservative sampled-stop model, not a certified arrival prediction.
// RAM contains only current deltas and one preceding point/dwell per vehicle.
export function createDelayModel({now=()=>Date.now(),maxVehicles=5000,stateTtlMs=180000,deltaTtlMs=180000,stopRadiusMeters=40,dwellMs=8000,tripEvidence=()=>null}={}) {
 const states=new Map(),deltas=new Map();let graph,byLine=new Map(),lineStops=new Map();
 function expire(){const time=now();for(const[id,state]of states)if(time-state.observedAt>stateTtlMs)states.delete(id);for(const[id,delta]of deltas)if(time-delta.observedAt>deltaTtlMs||time-delta.observedAt< -60000)deltas.delete(id);}
 function attachGraph(value,{preserveState=false}={}){if(graph===value)return;graph=value;byLine=new Map();lineStops=new Map();if(!preserveState){states.clear();deltas.clear();}const stops=new Map(graph.stops.map(stop=>[stop.id,stop]));for(const trip of graph.trips){if(!byLine.has(trip.line))byLine.set(trip.line,[]);byLine.get(trip.line).push(trip);if(!lineStops.has(trip.line))lineStops.set(trip.line,new Map());for(const event of trip.stopTimes)if(stops.has(event.stopId))lineStops.get(trip.line).set(event.stopId,stops.get(event.stopId));}}
 function ingest(vehicles){expire();for(const vehicle of vehicles){
  const observedAt=Date.parse(vehicle.observedAt),age=now()-observedAt;
  if(vehicle.freshness!=='recent'||!Number.isFinite(age)||age>90000||age< -60000){const stale=states.get(vehicle.id);if(stale?.tripId)deltas.delete(stale.tripId);states.delete(vehicle.id);continue;}
  const prior=states.get(vehicle.id);if(prior&&observedAt<=prior.observedAt)continue;
  const state={latitude:vehicle.latitude,longitude:vehicle.longitude,observedAt,line:vehicle.line,brigade:vehicle.brigade,tripId:prior?.line===vehicle.line&&prior?.brigade===vehicle.brigade?prior.tripId:null,stopIndex:prior?.line===vehicle.line?prior.stopIndex:null,deltaMs:prior?.line===vehicle.line?prior.deltaMs:null,confirmations:prior?.line===vehicle.line?prior.confirmations:0,dwell:null};
  if((prior?.line!==vehicle.line||prior?.brigade!==vehicle.brigade)&&prior?.tripId)deltas.delete(prior.tripId);
  const candidates=[...(lineStops.get(vehicle.line)?.values()||[])].map(stop=>({stop,distance:distanceMeters(vehicle,stop)})).filter(item=>item.distance<=stopRadiusMeters).sort((a,b)=>a.distance-b.distance);
  const stop=candidates[0]?.stop;
  if(stop){const previousDwell=prior?.line===vehicle.line&&prior.dwell?.stopId===stop.id?prior.dwell:null;state.dwell=previousDwell?{...previousDwell}:{stopId:stop.id,since:observedAt,handled:false,entryKnown:Boolean(prior&&prior.line===vehicle.line&&observedAt-prior.observedAt<=30000&&distanceMeters(prior,stop)>stopRadiusMeters)};
   const seconds=prior?(observedAt-prior.observedAt)/1000:0,speed=prior&&seconds>0?distanceMeters(prior,vehicle)/seconds:Infinity;
   if(!state.dwell.handled&&state.dwell.entryKnown&&observedAt-state.dwell.since>=dwellMs&&speed<=.8){
    const evidence=tripEvidence(vehicle,stop.id);
    if(!evidence){if(state.tripId)deltas.delete(state.tripId);states.delete(vehicle.id);states.set(vehicle.id,state);continue;}
    state.dwell.handled=true;const matches=[];
    for(const trip of byLine.get(vehicle.line)||[]){
     if(!evidence.has(trip.id))continue;
     if(trip.stopTimes[0].departure>observedAt+900000||trip.stopTimes.at(-1).arrival<observedAt-900000)continue;
     for(let index=0;index<trip.stopTimes.length;index++){const event=trip.stopTimes[index];if(event.stopId!==stop.id)continue;const delta=state.dwell.since-event.arrival;
      if(state.tripId===trip.id&&index>state.stopIndex&&Math.abs(delta-state.deltaMs)<=180000)matches.push({trip,index,delta,score:Math.abs(delta-state.deltaMs)});
      else if(Math.abs(delta)<=900000)matches.push({trip,index,delta,score:Math.abs(delta)});
     }
    }
    matches.sort((a,b)=>a.score-b.score);const best=matches[0],unique=best&&matches.length===1;
    if(unique){const same=state.tripId===best.trip.id&&best.index>state.stopIndex;if(state.tripId&&!same)deltas.delete(state.tripId);state.confirmations=same?(state.confirmations||0)+1:1;state.tripId=best.trip.id;state.stopIndex=best.index;state.deltaMs=best.delta;
     if(state.confirmations>=2)deltas.set(best.trip.id,{tripId:best.trip.id,vehicleId:vehicle.id,deltaMs:best.delta,stopIndex:best.index,stopId:stop.id,observedAt:state.dwell.since,updatedAt:now(),confidence:'brigade_two_stop_dwell',method:'sampled_stop_dwell'});
    }else{if(state.tripId)deltas.delete(state.tripId);state.tripId=null;state.stopIndex=null;state.deltaMs=null;state.confirmations=0;}
   }
  }
  states.delete(vehicle.id);states.set(vehicle.id,state);while(states.size>maxVehicles){const oldest=states.keys().next().value,removed=states.get(oldest);if(removed?.tripId)deltas.delete(removed.tripId);states.delete(oldest);}
 }while(states.size>maxVehicles){const oldest=states.keys().next().value,removed=states.get(oldest);if(removed?.tripId)deltas.delete(removed.tripId);states.delete(oldest);}expire();}
 return{attachGraph,ingest,getDeltas(){expire();return new Map([...deltas].map(([id,delta])=>[id,{...delta,ageSeconds:Math.max(0,Math.floor((now()-delta.observedAt)/1000))}]));},summary(){expire();return{status:graph?'observing':'warming',trackedVehicles:states.size,vehiclesAtStops:[...states.values()].filter(state=>state.dwell).length,observedStopEntries:[...states.values()].filter(state=>state.dwell?.entryKnown).length,tentativeTrips:[...states.values()].filter(state=>state.tripId).length,confirmedTrips:deltas.size,maxVehicles,stateTtlMs,deltaTtlMs,dwellMs,stopRadiusMeters,method:'brigade_two_stop_dwell',persistentGpsHistory:false};},clear(){states.clear();deltas.clear();}};
}
