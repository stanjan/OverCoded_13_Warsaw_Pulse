import {walkingKey} from './walking.mjs';
import {TransitError,distanceMeters,dateInWarsaw,transitAppearance} from '../transit-core.mjs';
const WALK_SPEED=1.2,WALK_FACTOR=1.3,TRANSFER_BUFFER=120000;
const walkMs=distance=>Math.ceil(distance*WALK_FACTOR/WALK_SPEED)*1000;
const coordinate=point=>({latitude:point.latitude,longitude:point.longitude});
const validShape=shape=>Array.isArray(shape)&&shape.length>1&&shape.every(point=>Number.isFinite(point?.latitude)&&Math.abs(point.latitude)<=90&&Number.isFinite(point?.longitude)&&Math.abs(point.longitude)<=180);
export function validateGraph(graph) {
 if(!graph||!Array.isArray(graph.stops)||!Array.isArray(graph.trips)||!graph.source||graph.timeZone!=='Europe/Warsaw')throw new TransitError('GRAPH_INVALID','Nieprawidłowy graf rozkładu ZTM.');
 let url;try{url=new URL(graph.source.url);}catch{throw new TransitError('GRAPH_INVALID','Brak źródła grafu.');}
 if(url.protocol!=='https:'||!['gtfs.ztm.waw.pl','dane.um.warszawa.pl','www.ztm.waw.pl','ztm.waw.pl'].includes(url.hostname))throw new TransitError('GRAPH_INVALID','Graf musi pochodzić z oficjalnego źródła Warszawy/ZTM.');
 if(!graph.stops.length||!graph.trips.length||!graph.source.validFrom||!graph.source.validTo)throw new TransitError('GRAPH_INVALID','Brak kalendarza lub kursów w rozkładzie.');
 return graph;
}
export function planGraph(graph,{origin,destination,departureTime,signal,maxBoardings=3,horizonMs=4*3600000,deltas=new Map(),now=Date.now(),walkingEdges=new Map()}={}) {
 validateGraph(graph);const day=dateInWarsaw(departureTime);
 if(day<graph.source.validFrom||day>graph.source.validTo)throw new TransitError('DATE_OUTSIDE_FEED','Rozkład ZTM nie obejmuje wybranego dnia.');
 const byId=new Map(graph.stops.map(stop=>[stop.id,stop]));
 const nearby=point=>graph.stops.map(stop=>({stop,distance:distanceMeters(point,stop)})).filter(item=>item.distance<=900).sort((a,b)=>a.distance-b.distance).slice(0,8);
 const starts=nearby(origin),ends=nearby(destination);if(!starts.length||!ends.length)return[];
 function walk(from,to,distance,start,fromName,toName){
  const key=walkingKey(from,to),known=walkingEdges.has(key),edge=walkingEdges.get(key);if(known&&!edge)return null;
  const duration=known?edge.durationMillis:walkMs(distance);
  return {mode:'WALK',from:fromName,to:toName,start,end:start+duration,distanceMeters:known?edge.distanceMeters:Math.round(distance*WALK_FACTOR),path:known?edge.path:[coordinate(from),coordinate(to)],geometry:known?edge.geometry:'schematic',walkingKey:key,...(known?{walkingSource:edge.source,endpointGapsMeters:edge.endpointGapsMeters}:{}),assumption:known?edge.assumption:'Odległość w linii prostej × 1,3; prędkość 1,2 m/s. Brak weryfikacji przejścia dla pieszych.'};
 }
 let previous=new Map();for(const{stop,distance}of starts){const step=walk(origin,stop,distance,departureTime,origin.label,stop.name);if(step)previous.set(stop.id,{time:step.end,path:distance>0?[step]:[]});}
 const candidates=[];
 const grid=new Map();for(const stop of graph.stops){const key=Math.floor(stop.latitude*100)+':'+Math.floor(stop.longitude*100);if(!grid.has(key))grid.set(key,[]);grid.get(key).push(stop);}
 const transfers=new Map();function neighbours(id){if(transfers.has(id))return transfers.get(id);const from=byId.get(id),items=[];for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)for(const to of grid.get((Math.floor(from.latitude*100)+y)+':'+(Math.floor(from.longitude*100)+x))||[]){const distance=distanceMeters(from,to);if(to.id!==id&&distance<=250)items.push({to,distance});}transfers.set(id,items);return items;}
 for(let round=1;round<=maxBoardings;round++){
  signal?.throwIfAborted();const next=new Map(previous);let checked=0;
  for(const trip of graph.trips){
   if(++checked%500===0)signal?.throwIfAborted();let boarding=null;
   for(let index=0;index<trip.stopTimes.length;index++){
    const scheduled=trip.stopTimes[index],delta=deltas.get(trip.id),usable=delta&&Number.isFinite(delta.deltaMs)&&now-delta.observedAt<=180000&&now-delta.observedAt>=-60000&&delta.confidence==='brigade_two_stop_dwell'&&index>delta.stopIndex;
    const event={...scheduled,arrival:scheduled.arrival+(usable?delta.deltaMs:0),departure:scheduled.departure+(usable?Math.max(0,delta.deltaMs):0),live:usable?delta:null},stop=byId.get(event.stopId);if(!stop)continue;
    if(boarding&&event.dropOff===0&&event.arrival>=boarding.event.departure&&event.arrival<=departureTime+horizonMs){
     const existing=next.get(stop.id);if(!existing||event.arrival<existing.time){
      const from=byId.get(boarding.event.stopId),sequence=trip.stopTimes.slice(boarding.index,index+1).map(item=>byId.get(item.stopId)).filter(Boolean);
      const shapePath=validShape(trip.shape)?shapeSlice(trip.shape,boarding.event,event,byId):[];
      next.set(stop.id,{time:event.arrival,path:[...boarding.label.path,{mode:'TRANSIT',line:trip.line,...transitAppearance(trip),routeType:trip.routeType,headsign:trip.headsign,tripId:trip.id,serviceDate:trip.serviceDate,from:from.name,to:stop.name,fromStopId:from.id,toStopId:stop.id,start:boarding.event.departure,end:event.arrival,scheduledStart:trip.stopTimes[boarding.index].departure,scheduledEnd:scheduled.arrival,delay:event.live?{...event.live}:null,stops:index-boarding.index,path:shapePath.length>1?shapePath:sequence.map(coordinate),geometry:shapePath.length>1?'gtfs_shape':'schematic'}]});
     }
    }
    const label=previous.get(stop.id),buffer=round>1&&label?.path.some(segment=>segment.mode==='TRANSIT')?TRANSFER_BUFFER:0;
    if(event.pickup===0&&label&&label.time+buffer<=event.departure&&event.departure>=departureTime&&event.departure<=departureTime+horizonMs){
     if(!boarding||label.time<boarding.label.time)boarding={event,index,label};
    }
   }
  }
  const rides=[...next];for(const [id,label]of rides){if(!label.path.some(segment=>segment.mode==='TRANSIT'))continue;for(const{to,distance}of neighbours(id)){const from=byId.get(id),step=walk(from,to,distance,label.time,from.name,to.name);if(!step)continue;const time=step.end,existing=next.get(to.id);if(!existing||time<existing.time)next.set(to.id,{time,path:[...label.path,step]});}}
  for(const{stop,distance}of ends){const label=next.get(stop.id);if(!label?.path.some(segment=>segment.mode==='TRANSIT'))continue;const step=walk(stop,destination,distance,label.time,stop.name,destination.label);if(!step)continue;const arrival=step.end;if(arrival>departureTime+horizonMs)continue;const path=[...label.path,...(distance>0?[step]:[])];candidates.push({origin:origin.label,destination:destination.label,departure:departureTime,arrival,durationMillis:arrival-departureTime,transfers:Math.max(0,path.filter(segment=>segment.mode==='TRANSIT').length-1),steps:path,provider:'Warszawa / ZTM GTFS',timing:path.some(segment=>segment.delay)?'live_model_estimate':'scheduled_estimate',realtimeConfirmed:false,modelAdjusted:path.some(segment=>segment.delay),source:graph.source,warnings:['Najlepsze spośród sprawdzonych połączeń: do 8 najbliższych przystanków w promieniu 900 m, maks. 2 przesiadki, horyzont 4 h.','Odcinki piesze są szacunkowe. Korekta opóźnienia dotyczy tylko wskazanych kursów z dopasowanym świeżym modelem; pozostałe czasy są rozkładowe.']});}
  previous=next;
 }
 const distinct=new Map();for(const route of candidates.sort((a,b)=>a.arrival-b.arrival||a.transfers-b.transfers)){const key=route.steps.filter(step=>step.mode==='TRANSIT').map(step=>step.tripId+'@'+step.fromStopId+'>'+step.toStopId).join('|');if(!distinct.has(key))distinct.set(key,route);}
 // Attach the exact trip's full geometry only after routing: intermediate labels
 // must not repeatedly copy whole lines while searching every stop/round.
 const tripsById=new Map(graph.trips.map(trip=>[trip.id,trip]));
 return [...distinct.values()].slice(0,3).map(route=>({...route,steps:route.steps.map(step=>{
  const trip=tripsById.get(step.tripId);
  return step.mode==='TRANSIT'&&step.geometry==='gtfs_shape'&&validShape(trip?.shape)?{...step,fullPath:trip.shape.map(coordinate),fullPathGeometry:'gtfs_shape'}:step;
 })}));
}
function shapeSlice(shape,from,to,byId){
 const a=byId.get(from.stopId),b=byId.get(to.stopId);if(!a||!b)return[];
 let start=-1,end=-1,d1=Infinity,d2=Infinity;
 for(let i=0;i<shape.length;i++){const distance=distanceMeters(shape[i],a);if(distance<d1){d1=distance;start=i;}}
 for(let i=start;i<shape.length;i++){const distance=distanceMeters(shape[i],b);if(distance<d2){d2=distance;end=i;}}
 if(start<0||end<=start||d1>150||d2>150)return[];
 return shape.slice(start,end+1).map(coordinate);
}
