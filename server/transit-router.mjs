import {TransitError,distanceMeters,dateInWarsaw,transitAppearance} from '../transit-core.mjs';
const WALK_SPEED=1.2,WALK_FACTOR=1.3,TRANSFER_BUFFER=120000;
const walkMs=distance=>Math.ceil(distance*WALK_FACTOR/WALK_SPEED)*1000;
const coordinate=point=>({latitude:point.latitude,longitude:point.longitude});
export function validateGraph(graph) {
 if(!graph||!Array.isArray(graph.stops)||!Array.isArray(graph.trips)||!graph.source||graph.timeZone!=='Europe/Warsaw')throw new TransitError('GRAPH_INVALID','Nieprawidłowy graf rozkładu ZTM.');
 let url;try{url=new URL(graph.source.url);}catch{throw new TransitError('GRAPH_INVALID','Brak źródła grafu.');}
 if(url.protocol!=='https:'||!['gtfs.ztm.waw.pl','dane.um.warszawa.pl','www.ztm.waw.pl','ztm.waw.pl'].includes(url.hostname))throw new TransitError('GRAPH_INVALID','Graf musi pochodzić z oficjalnego źródła Warszawy/ZTM.');
 if(!graph.stops.length||!graph.trips.length||!graph.source.validFrom||!graph.source.validTo)throw new TransitError('GRAPH_INVALID','Brak kalendarza lub kursów w rozkładzie.');
 return graph;
}
export function planGraph(graph,{origin,destination,departureTime,signal,maxBoardings=3,horizonMs=4*3600000,deltas=new Map(),now=Date.now()}={}) {
 validateGraph(graph);const day=dateInWarsaw(departureTime);
 if(day<graph.source.validFrom||day>graph.source.validTo)throw new TransitError('DATE_OUTSIDE_FEED','Rozkład ZTM nie obejmuje wybranego dnia.');
 const byId=new Map(graph.stops.map(stop=>[stop.id,stop]));
 const nearby=point=>graph.stops.map(stop=>({stop,distance:distanceMeters(point,stop)})).filter(item=>item.distance<=900).sort((a,b)=>a.distance-b.distance).slice(0,8);
 const starts=nearby(origin),ends=nearby(destination);if(!starts.length||!ends.length)return[];
 let previous=new Map(starts.map(({stop,distance})=>[stop.id,{time:departureTime+walkMs(distance),path:distance>0?[{mode:'WALK',from:origin.label,to:stop.name,start:departureTime,end:departureTime+walkMs(distance),distanceMeters:Math.round(distance*WALK_FACTOR),path:[coordinate(origin),coordinate(stop)],geometry:'schematic',assumption:'Odległość w linii prostej × 1,3; prędkość 1,2 m/s. Brak weryfikacji przejścia dla pieszych.'}]:[]}]));
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
      const path=trip.shape&&trip.shape.length?shapeSlice(trip.shape,boarding.event,event,byId):sequence.map(coordinate);
      next.set(stop.id,{time:event.arrival,path:[...boarding.label.path,{mode:'TRANSIT',line:trip.line,...transitAppearance(trip),routeType:trip.routeType,headsign:trip.headsign,tripId:trip.id,serviceDate:trip.serviceDate,from:from.name,to:stop.name,fromStopId:from.id,toStopId:stop.id,start:boarding.event.departure,end:event.arrival,scheduledStart:trip.stopTimes[boarding.index].departure,scheduledEnd:scheduled.arrival,delay:event.live?{...event.live}:null,stops:index-boarding.index,path:path.length>1?path:sequence.map(coordinate),geometry:trip.shape&&path.length>1?'gtfs_shape':'schematic'}]});
     }
    }
    const label=previous.get(stop.id),buffer=round>1&&label?.path.some(segment=>segment.mode==='TRANSIT')?TRANSFER_BUFFER:0;
    if(event.pickup===0&&label&&label.time+buffer<=event.departure&&event.departure>=departureTime&&event.departure<=departureTime+horizonMs){
     if(!boarding||label.time<boarding.label.time)boarding={event,index,label};
    }
   }
  }
  const rides=[...next];for(const [id,label]of rides){if(!label.path.some(segment=>segment.mode==='TRANSIT'))continue;for(const{to,distance}of neighbours(id)){const time=label.time+walkMs(distance),existing=next.get(to.id);if(!existing||time<existing.time){const from=byId.get(id);next.set(to.id,{time,path:[...label.path,{mode:'WALK',from:from.name,to:to.name,start:label.time,end:time,distanceMeters:Math.round(distance*WALK_FACTOR),path:[coordinate(from),coordinate(to)],geometry:'schematic',assumption:'Przesiadka piesza: odległość × 1,3; 1,2 m/s; dodatkowo 2 min buforu przed kolejnym pojazdem.'}]});}}}
  for(const{stop,distance}of ends){const label=next.get(stop.id);if(!label?.path.some(segment=>segment.mode==='TRANSIT'))continue;const arrival=label.time+walkMs(distance);if(arrival>departureTime+horizonMs)continue;const path=[...label.path,...(distance>0?[{mode:'WALK',from:stop.name,to:destination.label,start:label.time,end:arrival,distanceMeters:Math.round(distance*WALK_FACTOR),path:[coordinate(stop),coordinate(destination)],geometry:'schematic',assumption:'Dojście w przybliżeniu; nie jest nawigacją pieszą.'}]:[])];candidates.push({origin:origin.label,destination:destination.label,departure:departureTime,arrival,durationMillis:arrival-departureTime,transfers:Math.max(0,path.filter(segment=>segment.mode==='TRANSIT').length-1),steps:path,provider:'Warszawa / ZTM GTFS',timing:path.some(segment=>segment.delay)?'live_model_estimate':'scheduled_estimate',realtimeConfirmed:false,modelAdjusted:path.some(segment=>segment.delay),source:graph.source,warnings:['Najlepsze spośród sprawdzonych połączeń: do 8 najbliższych przystanków w promieniu 900 m, maks. 2 przesiadki, horyzont 4 h.','Odcinki piesze są szacunkowe. Korekta opóźnienia dotyczy tylko wskazanych kursów z dopasowanym świeżym modelem; pozostałe czasy są rozkładowe.']});}
  previous=next;
 }
 const distinct=new Map();for(const route of candidates.sort((a,b)=>a.arrival-b.arrival||a.transfers-b.transfers)){const key=route.steps.filter(step=>step.mode==='TRANSIT').map(step=>step.tripId+'@'+step.fromStopId+'>'+step.toStopId).join('|');if(!distinct.has(key))distinct.set(key,route);}
 return [...distinct.values()].slice(0,3);
}
function shapeSlice(shape,from,to,byId){
 const a=byId.get(from.stopId),b=byId.get(to.stopId);if(!a||!b)return[];
 let start=-1,end=-1,d1=Infinity,d2=Infinity;
 for(let i=0;i<shape.length;i++){const distance=distanceMeters(shape[i],a);if(distance<d1){d1=distance;start=i;}}
 for(let i=start;i<shape.length;i++){const distance=distanceMeters(shape[i],b);if(distance<d2){d2=distance;end=i;}}
 if(start<0||end<=start||d1>150||d2>150)return[];
 return shape.slice(start,end+1).map(coordinate);
}
