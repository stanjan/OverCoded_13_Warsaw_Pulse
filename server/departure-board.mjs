import {TransitError,departure,dateInWarsaw,transitAppearance} from '../transit-core.mjs';

const indexes=new WeakMap();
export function boardRequest(input,now=Date.now()){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new TransitError('INVALID_REQUEST','Wybierz przystanek wsiadania i cel etapu.');
 for(const key of ['fromStopId','toStopId'])if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>150||/[\u0000-\u001f]/.test(input[key]))throw new TransitError('INVALID_STOP','Nieprawidłowy identyfikator przystanku.');
 const start=Math.max(now,departure(input.departureTime,now).getTime());
 return{fromStopId:input.fromStopId,toStopId:input.toStopId,start,end:start+2*3600000,limit:24};
}
function graphIndex(graph){
 if(indexes.has(graph))return indexes.get(graph);
 const stops=new Map(graph.stops.map(stop=>[stop.id,stop])),departures=new Map();
 for(const trip of graph.trips)for(const [index,event]of trip.stopTimes.entries()){
  if(event.pickup!==0)continue;
  if(!departures.has(event.stopId))departures.set(event.stopId,[]);
  departures.get(event.stopId).push({trip,index,event});
 }
 const value={stops,departures};indexes.set(graph,value);return value;
}
// Exact platforms, dated trips and the downstream destination determine compatibility.
// This projection never changes the continuous fleet model or retains GPS history.
export function departureBoard(graphs,request,{now=Date.now(),deltas=new Map(),vehicles=[],signal}={}){
 const rows=[],seen=new Set(),byTrip=new Map();let from,to;
 for(const vehicle of vehicles){const age=now-Date.parse(vehicle.observedAt);if(typeof vehicle.id!=='string'||!vehicle.id||vehicle.directionSource!=='confirmed_gtfs_trip'||!vehicle.directionTripId||vehicle.freshness!=='recent'||!Number.isFinite(age)||age< -60000||age>90000||!Number.isFinite(vehicle.latitude)||Math.abs(vehicle.latitude)>90||!Number.isFinite(vehicle.longitude)||Math.abs(vehicle.longitude)>180)continue;const matches=byTrip.get(vehicle.directionTripId)||[];matches.push(vehicle);byTrip.set(vehicle.directionTripId,matches);}
 for(const graph of graphs){
  const index=graphIndex(graph);from||=index.stops.get(request.fromStopId);to||=index.stops.get(request.toStopId);
  for(const {trip,index:stopIndex,event}of index.departures.get(request.fromStopId)||[]){
   signal?.throwIfAborted();
   const destination=trip.stopTimes.find((item,i)=>i>stopIndex&&item.stopId===request.toStopId&&item.dropOff===0);
   if(!destination||!trip.serviceDate||!Number.isFinite(event.departure))continue;
   const key=trip.id+'|'+stopIndex;if(seen.has(key))continue;seen.add(key);
   const delta=deltas.get(trip.id),age=now-delta?.observedAt;
   const live=delta&&Number.isFinite(delta.deltaMs)&&Number.isFinite(age)&&age>=-60000&&age<=180000&&delta.confidence==='brigade_route_progress'&&Number.isInteger(delta.stopIndex)&&stopIndex>delta.stopIndex;
   const matches=byTrip.get(trip.id)||[],point=live&&matches.length===1&&matches[0].id===delta.vehicleId&&matches[0].line===trip.line?matches[0]:null;
   const vehicle=point?{id:point.id,line:point.line,latitude:point.latitude,longitude:point.longitude,observedAt:point.observedAt,freshness:'recent',directionSource:'confirmed_gtfs_trip',directionTripId:trip.id,...transitAppearance(trip)}:null;
   const correction=live?Math.max(0,delta.deltaMs):0,estimated=event.departure+correction;
   if(estimated<request.start||estimated>request.end)continue;
   rows.push({vehicle,tripId:trip.id,serviceDate:trip.serviceDate,line:trip.line,headsign:trip.headsign,...transitAppearance(trip),fromStopIndex:stopIndex,scheduledDeparture:event.departure,departure:estimated,timing:live?'live_model_estimate':'scheduled',deltaMs:live?delta.deltaMs:null,departureCorrectionMs:correction,observedAt:live?delta.observedAt:null,liveUntil:live?delta.observedAt+180000:null});
  }
 }
 if(!from||!to)throw new TransitError('STOP_NOT_FOUND','Nie znaleziono przystanku w datowanym rozkładzie ZTM.');
 rows.sort((a,b)=>a.departure-b.departure||a.line.localeCompare(b.line)||a.tripId.localeCompare(b.tripId)||a.fromStopIndex-b.fromStopIndex);
 return{stop:from,destination:to,departures:rows.slice(0,request.limit),total:rows.length,provided:Math.min(rows.length,request.limit),limited:rows.length>request.limit,windowStart:request.start,windowEnd:request.end,generatedAt:now,refreshSeconds:15,source:graphs[0].source,serviceDays:graphs.map(graph=>graph.serviceDay),timeZone:'Europe/Warsaw'};
}
