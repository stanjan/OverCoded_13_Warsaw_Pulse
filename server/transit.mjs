import {TransitError,waypoint,departure,dateInWarsaw,serviceSeconds,serviceInstant,distanceMeters,transitAppearance} from '../transit-core.mjs';
import {planGraph,validateGraph} from './transit-router.mjs';
import {getGtfsGraph} from './transit-gtfs.mjs';
import {createDelayModel} from './transit-live.mjs';
export const TRANSIT_SOURCES={
 stops:{action:'get_ztm_przystanki_komunikacji_miejskiej',id:'009fce84-0024-431a-aa5e-9515c539899e',ttl:21600000},
 lines:{action:'get_ztm_lista_linii_na_przystanku',id:'8eb065b6-f3a0-41d4-a842-732c6c1c3063',ttl:900000},
 departures:{action:'get_ztm_odjazdy_linii_z_przystanku',id:'dedad7b7-85f4-4be9-b73e-8395cefb434c',ttl:60000},
 vehicles:{action:'get_ztm_lokalizacja_pojazdow',id:'f319f602-7292-4e8c-b3d1-f5898aa9a638',ttl:8000},
};
const clean=value=>typeof value==='string'?value.trim().slice(0,300):'';
const fold=value=>clean(value).toLocaleLowerCase('pl').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replaceAll('ł','l');
const kv=row=>Object.fromEntries((Array.isArray(row)?row:row?.values||[]).filter(pair=>typeof pair?.key==='string').map(pair=>[pair.key,pair.value]));
const point=(lat,lng)=>{const latitude=Number(lat),longitude=Number(lng);return ['number','string'].includes(typeof lat)&&['number','string'].includes(typeof lng)&&String(lat).trim()!==''&&String(lng).trim()!==''&&Number.isFinite(latitude)&&Number.isFinite(longitude)&&Math.abs(latitude)<=90&&Math.abs(longitude)<=180?{latitude,longitude}:null;};
const sourceMeta=(key,fetchedAt)=>({name:'Warszawa / ZTM · '+key,url:'https://dane.um.warszawa.pl/pl/catalogue/'+TRANSIT_SOURCES[key].id,fetchedAt,serviceDate:null});
export function normalizeStops(rows) {return rows.map(row=>{const v=kv(row),p=point(v.szer_geo,v.dlug_geo);return p&&/^\d{4}$/.test(v.zespol)&&/^\d{2}$/.test(v.slupek)&&clean(v.nazwa_zespolu)?{id:v.zespol+'-'+v.slupek,group:v.zespol,platform:v.slupek,name:clean(v.nazwa_zespolu),...p}:null;}).filter(Boolean);}
export function normalizeDepartures(rows) {return rows.map(row=>{const v=kv(row);return serviceSeconds(v.czas)!==null?{clock:v.czas,brigade:clean(v.brygada),direction:clean(v.kierunek),variant:clean(v.trasa),serviceDate:null,tripId:null}:null;}).filter(Boolean);}
export function normalizeVehicles(rows,type,now=Date.now()) {return rows.map(row=>{
 const p=point(row.Lat,row.Lon),match=/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)$/.exec(row.Time||'');
 if(!p||!clean(row.Lines)||!clean(row.VehicleNumber))return null;
 const observed=match?serviceInstant(match[1],match[2]):null,age=observed===null?null:now-observed;
 return {id:type+':'+clean(row.VehicleNumber),type,line:clean(row.Lines),...transitAppearance({line:clean(row.Lines),type}),brigade:clean(row.Brigade),vehicle:clean(row.VehicleNumber),...p,observedAt:observed===null?null:new Date(observed).toISOString(),sourceClock:clean(row.Time),freshness:age===null?'unknown':age< -60000||age>90000?'stale':'recent',eta:null};
 }).filter(Boolean);}
export const normalizeBrigade=value=>/^\d+$/.test(String(value||''))?String(Number(value)):fold(value);
const tripDirection=value=>fold(value).replace(/^.*?->\s*/,'');
export function buildBrigadeEvidence(records,line,stopId,graph,day){
 const bindings=new Map();for(const trip of graph?.trips||[]){if(trip.line!==line)continue;for(const event of trip.stopTimes){if(event.stopId!==stopId||dateInWarsaw(event.departure)!==day)continue;
  for(const row of records){if(!row.direction||row.clock!==event.departureClock||tripDirection(row.direction)!==tripDirection(trip.headsign))continue;const id=normalizeBrigade(row.brigade);if(!id)continue;if(!bindings.has(id))bindings.set(id,new Set());bindings.get(id).add(trip.id);}
 }}return bindings;
}
export function createTransitService({fetchImpl=fetch,key=()=>process.env.DATA_API_KEY,now=()=>Date.now(),graphProvider=getGtfsGraph,timeoutMs=8000,cacheLimit=300}={}) {
 const cache=new Map(),bindingCache=new Map(),bindingQueue=new Map(),delayModel=createDelayModel({now,tripEvidence});
 let municipalStops=[],stopBridge=new Map();
 let modelGraph,pollTimer,pollPromise,tracking=false,latestSnapshot={vehicles:[],sources:[],errors:[]};
 async function vehicleSnapshot(signal){const vehicles=[],sources=[],errors=[];for(const type of [1,2])try{const data=await api('vehicles',{type},signal);sources.push(data.source);vehicles.push(...normalizeVehicles(data.rows,type,now()));}catch(error){signal?.throwIfAborted();errors.push({code:error.code||'SOURCE_UNAVAILABLE',part:'vehicles',type});}delayModel.ingest(vehicles);latestSnapshot={vehicles,sources,errors};return latestSnapshot;}
 function attach(graph){if(modelGraph===graph)return;const same=Boolean(modelGraph&&modelGraph.serviceDay===graph.serviceDay&&modelGraph.source.version===graph.source.version);modelGraph=graph;delayModel.attachGraph(graph,{preserveState:same});if(same)return;bindingCache.clear();bindingQueue.clear();stopBridge.clear();const byName=new Map();for(const stop of municipalStops){const name=fold(stop.name);if(!byName.has(name))byName.set(name,[]);byName.get(name).push(stop);}for(const stop of graph.stops){const matches=(byName.get(fold(stop.name))||[]).filter(item=>!stop.platform||item.platform===stop.platform).map(item=>({stop:item,distance:distanceMeters(stop,item)})).filter(item=>item.distance<=60).sort((a,b)=>a.distance-b.distance);if(matches[0]&&(!matches[1]||matches[1].distance-matches[0].distance>=5))stopBridge.set(stop.id,matches[0].stop);}}

 function tripEvidence(vehicle,stopId){
  const stop=stopBridge.get(stopId);if(!stop||!normalizeBrigade(vehicle.brigade))return null;const key=dateInWarsaw(now())+'|'+stop.id+'|'+vehicle.line+'|'+stopId,cached=bindingCache.get(key);
  if(cached&&cached.until>now())return cached.bindings.get(normalizeBrigade(vehicle.brigade))||new Set();
  if(!bindingQueue.has(key)){bindingQueue.set(key,{key,stop,line:vehicle.line,stopId,queuedAt:now()});while(bindingQueue.size>100)bindingQueue.delete(bindingQueue.keys().next().value);}return null;
 }
 async function flushBindings(){
  let count=0;for(const[key,item]of bindingQueue){bindingQueue.delete(key);if(now()-item.queuedAt>120000)continue;if(count++>=4){bindingQueue.set(key,item);break;}
   try{const data=await api('departures',{busstopId:item.stop.group,busstopNr:item.stop.platform,line:item.line});const rows=normalizeDepartures(data.rows),bindings=buildBrigadeEvidence(rows,item.line,item.stopId,modelGraph,dateInWarsaw(now()));
    bindingCache.set(key,{until:now()+600000,bindings});while(bindingCache.size>100)bindingCache.delete(bindingCache.keys().next().value);
   }catch{}
  }
 }
 async function startTracking(){
  if(tracking)return;tracking=true;
  const tick=async()=>{
   pollTimer=null;if(!tracking)return;
   pollPromise=(async()=>{try{if(!municipalStops.length)municipalStops=(await stops()).stops;const graph=await graphProvider(now());if(graph)attach(validateGraph(graph));await vehicleSnapshot();await flushBindings();}catch{delayModel.ingest([]);}})();
   try{await pollPromise;}finally{pollPromise=null;if(tracking){pollTimer=setTimeout(tick,15000);pollTimer.unref?.();}}
  };
  await tick();
 }
 function liveSnapshot(input){
  const start=waypoint(input?.origin,'punkt startowy'),end=waypoint(input?.destination,'cel');if(typeof start.value==='string'||typeof end.value==='string')throw new TransitError('INVALID_LOCATION','Do aktualizacji mapy wymagane są współrzędne.');
  const origin={latitude:start.value.lat,longitude:start.value.lng},destination={latitude:end.value.lat,longitude:end.value.lng};
  const nearby=latestSnapshot.vehicles.map(vehicle=>{const age=now()-Date.parse(vehicle.observedAt);return{...vehicle,freshness:!Number.isFinite(age)?'unknown':age< -60000||age>90000?'stale':'recent',distanceMeters:Math.round(Math.min(distanceMeters(vehicle,origin),distanceMeters(vehicle,destination)))};}).filter(vehicle=>vehicle.distanceMeters<=2000).sort((a,b)=>a.distanceMeters-b.distanceMeters);
  return{vehicles:nearby.slice(0,40),vehicleCount:nearby.length,vehicleProvided:Math.min(40,nearby.length),liveModel:{...delayModel.summary(),pollSeconds:15,continuous:tracking,pendingEvidence:bindingQueue.size,evidenceCached:bindingCache.size,matchedStopPlatforms:stopBridge.size},errors:latestSnapshot.errors};
 }

 async function api(name,args,signal) {
  signal?.throwIfAborted();const spec=TRANSIT_SOURCES[name],cacheKey=name+JSON.stringify(args||{}),cached=cache.get(cacheKey);
  if(cached&&cached.until>now())return structuredClone(cached.result);
  if(!key())throw new TransitError('SOURCE_NOT_CONFIGURED','Brak połączenia z miejskim API komunikacji.');
  let response;
  try{response=await fetchImpl('https://dane.um.warszawa.pl/api/action/'+spec.action,{method:'POST',headers:{Authorization:key(),'Content-Type':'application/json',Accept:'application/json'},...(args?{body:JSON.stringify(args)}:{}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs)});}
  catch(error){signal?.throwIfAborted();throw new TransitError('SOURCE_UNAVAILABLE','Miejskie API komunikacji nie odpowiedziało na czas.');}
  if(!response.ok)throw new TransitError('SOURCE_UNAVAILABLE','Miejskie API komunikacji jest chwilowo niedostępne.');
  const raw=await response.json();if(!Array.isArray(raw))throw new TransitError('SOURCE_SCHEMA','Miejskie API zwróciło nieznany format danych.');
  const result={rows:raw,source:sourceMeta(name,new Date(now()).toISOString())};
  cache.set(cacheKey,{until:now()+spec.ttl,result});while(cache.size>cacheLimit)cache.delete(cache.keys().next().value);
  return structuredClone(result);
 }
 async function stops(signal){const result=await api('stops',null,signal),normalized=normalizeStops(result.rows);if(!normalized.length)throw new TransitError('SOURCE_SCHEMA','Brak poprawnych współrzędnych przystanków.');return{stops:normalized,source:result.source,invalidRecords:result.rows.length-normalized.length};}
 function resolve(input,all,label){
  const parsed=waypoint(input,label);if(typeof parsed.value!=='string')return{latitude:parsed.value.lat,longitude:parsed.value.lng,label:parsed.label};
  const id=/\b(\d{4}-\d{2})$/.exec(parsed.value)?.[1];
  const matches=all.filter(stop=>id?stop.id===id:fold(stop.name)===fold(parsed.value));
  if(matches.length!==1)throw new TransitError('LOCATION_REQUIRED','Wybierz konkretny przystanek z podpowiedzi lub podaj współrzędne dla: '+label+'.');
  return{latitude:matches[0].latitude,longitude:matches[0].longitude,label:matches[0].name+' · '+matches[0].id,stopId:matches[0].id};
 }
 async function searchStops(query,{signal}={}){if(typeof query!=='string'||query.length>200||query.trim().length<2)throw new TransitError('INVALID_QUERY','Wpisz co najmniej dwa znaki nazwy przystanku.');const result=await stops(signal);const matches=result.stops.filter(stop=>fold(stop.name+' '+stop.id).includes(fold(query)));return{results:matches.slice(0,12),total:matches.length,provided:Math.min(matches.length,12),source:result.source};}
 async function plan(input,{signal}={}){
  signal?.throwIfAborted();if(!input||typeof input!=='object')throw new TransitError('INVALID_REQUEST','Podaj punkt startowy i cel.');
  waypoint(input.origin,'punkt startowy');waypoint(input.destination,'cel');const requested=departure(input.departureTime,now());
  const catalog=await stops(signal);municipalStops=catalog.stops;const origin=resolve(input.origin,catalog.stops,'start'),destination=resolve(input.destination,catalog.stops,'cel');
  const nearby=p=>catalog.stops.map(stop=>({...stop,distanceMeters:Math.round(distanceMeters(p,stop))})).filter(stop=>stop.distanceMeters<=900).sort((a,b)=>a.distanceMeters-b.distanceMeters).slice(0,2);
  const starts=nearby(origin),ends=nearby(destination),selected=[...new Map([...starts,...ends].map(stop=>[stop.id,stop])).values()];
  const errors=[],sources=[catalog.source],departures=[];let requests=1,graph=null,graphSource=null,routes=[],reason='GRAPH_UNAVAILABLE';
  try{const raw=await graphProvider(requested.getTime(),{signal});if(raw){graph=validateGraph(raw);graphSource=graph.source;if(dateInWarsaw(requested)===dateInWarsaw(now()))attach(graph);}}
  catch(error){signal?.throwIfAborted();reason=error instanceof TransitError?error.code:'GRAPH_INVALID';errors.push({code:reason,part:'routing'});}
  const snapshot=await vehicleSnapshot(signal);requests+=2;sources.push(...snapshot.sources);errors.push(...snapshot.errors);
  // Per-stop undated APIs are fallback observations only. A valid GTFS avoids fan-out.
  if(!graph)for(const stop of [starts[0],ends[0]].filter(Boolean)){
   try{requests++;const lines=await api('lines',{busstopId:stop.group,busstopNr:stop.platform},signal);sources.push(lines.source);const names=[...new Set(lines.rows.map(row=>clean(kv(row).linia)).filter(Boolean))];
    for(const line of names.slice(0,1)){try{requests++;const data=await api('departures',{busstopId:stop.group,busstopNr:stop.platform,line},signal);sources.push(data.source);departures.push({stopId:stop.id,stopName:stop.name,line,records:normalizeDepartures(data.rows),source:data.source,linesChecked:1,linesTotal:names.length});}catch(error){signal?.throwIfAborted();errors.push({code:error.code||'SOURCE_UNAVAILABLE',part:'departures',stopId:stop.id,line});}}
   }catch(error){signal?.throwIfAborted();errors.push({code:error.code||'SOURCE_UNAVAILABLE',part:'lines',stopId:stop.id});}
  }
  const deltas=delayModel.getDeltas();
  if(graph)try{routes=planGraph(graph,{origin,destination,departureTime:requested.getTime(),signal,deltas,now:now()});reason=routes.length?null:'NO_VERIFIED_ROUTE';}catch(error){signal?.throwIfAborted();reason=error instanceof TransitError?error.code:'GRAPH_INVALID';errors.push({code:reason,part:'routing'});}
  const relevant=snapshot.vehicles.map(vehicle=>({...vehicle,distanceMeters:Math.round(Math.min(distanceMeters(vehicle,origin),distanceMeters(vehicle,destination)))})).filter(vehicle=>vehicle.distanceMeters<=2000).sort((a,b)=>a.distanceMeters-b.distanceMeters);
  return{status:routes.length?'ready':'limited',routes,reason,origin,destination,requestedDeparture:requested.toISOString(),timeZone:'Europe/Warsaw',stops:selected,originStopIds:starts.map(stop=>stop.id),destinationStopIds:ends.map(stop=>stop.id),departures,vehicles:relevant.slice(0,40),vehicleCount:relevant.length,vehicleProvided:Math.min(40,relevant.length),complete:false,errors,sources:[...new Map(sources.map(source=>[source.url,source])).values()],graphSource,liveModel:{...delayModel.summary(),pollSeconds:15,continuous:tracking,pendingEvidence:bindingQueue.size,evidenceCached:bindingCache.size,matchedStopPlatforms:stopBridge.size,vehicleSnapshotCount:snapshot.vehicles.length},coverage:{stopRadiusMeters:900,stopsPerEnd:8,linesPerStop:graph?0:1,maxSourceRequests:graph?3:7,sourceCalls:requests,vehicleRadiusMeters:2000},limitations:['Odjazdy z API bez daty i trip_id nie są łączone w przejazd.','Pozycja pojazdu to obserwacja; korekta ETA wymaga potwierdzonego modelu tego samego kursu.','Przejścia piesze są szacowane, a wyszukiwanie ogranicza zakres przystanków i przesiadek.']};
 }

 return{searchStops,plan,startTracking,liveSnapshot,stopTracking(){tracking=false;clearTimeout(pollTimer);pollTimer=null;delayModel.clear();bindingCache.clear();bindingQueue.clear();latestSnapshot={vehicles:[],sources:[],errors:[]};}};
}
export const transitService=createTransitService();
