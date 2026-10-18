import {TransitError,waypoint,departure,dateInWarsaw,serviceSeconds,serviceInstant,distanceMeters,transitAppearance,routeMode} from '../transit-core.mjs';
import {validateGraph} from './transit-router.mjs';
import {planPedestrianGraph,createWalkingVerification,planDirectWalk,mergeRouteOptions} from './walking-router.mjs';
import {nextAvailableTransit} from './next-transit.mjs';
import {getGtfsGraph} from './transit-gtfs.mjs';
import {createDelayModel} from './transit-live.mjs';
import {boardRequest,departureBoard} from './departure-board.mjs';
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
 const indexed=new Map();for(const row of records){if(!row.direction||!normalizeBrigade(row.brigade))continue;const key=row.clock+'|'+tripDirection(row.direction);if(!indexed.has(key))indexed.set(key,[]);indexed.get(key).push(row);}
 const bindings=new Map();for(const trip of graph?.trips||[]){if(trip.line!==line)continue;for(const event of trip.stopTimes){if(event.stopId!==stopId||dateInWarsaw(event.departure)!==day)continue;
  for(const row of indexed.get(event.departureClock+'|'+tripDirection(trip.headsign))||[]){const id=normalizeBrigade(row.brigade);if(!id)continue;if(!bindings.has(id))bindings.set(id,new Set());bindings.get(id).add(trip.id);}
 }}return bindings;
}
// Directions belong to a confirmed vehicle/trip binding, never merely a line number.
export function withVehicleDirections(vehicles,graph,deltas,now=Date.now()) {
 const trips=new Map((graph?.trips||[]).map(trip=>[trip.id,trip])),byVehicle=new Map();
 for(const delta of deltas.values()){
  const age=now-delta.observedAt,trip=trips.get(delta.tripId);
  if(delta.confidence!=='brigade_route_progress'||!Number.isFinite(age)||age< -60000||age>180000||!trip?.headsign)continue;
  if(!byVehicle.has(delta.vehicleId))byVehicle.set(delta.vehicleId,[]);byVehicle.get(delta.vehicleId).push(trip);
 }
 return vehicles.map(vehicle=>{
  const matches=(byVehicle.get(vehicle.id)||[]).filter(trip=>trip.line===vehicle.line),age=now-Date.parse(vehicle.observedAt),confirmed=vehicle.freshness==='recent'&&Number.isFinite(age)&&age>=-60000&&age<=90000&&matches.length===1;
  return {...vehicle,direction:confirmed?matches[0].headsign:null,directionSource:confirmed?'confirmed_gtfs_trip':null,directionTripId:confirmed?matches[0].id:null};
 });
}
export function createTransitService({fetchImpl=fetch,key=()=>process.env.DATA_API_KEY,now=()=>Date.now(),graphProvider=getGtfsGraph,timeoutMs=8000,cacheLimit=300,setTimeoutImpl=setTimeout,clearTimeoutImpl=clearTimeout,walkingProvider,delayModel:injectedDelayModel}={}) {
 const cache=new Map(),bindingCache=new Map(),bindingQueue=new Map(),activeBindings=new Set(),lineBindings=new Map(),delayModel=injectedDelayModel||createDelayModel({now,tripEvidence});
 const boardGraphs=new Map();
 let municipalStops=[],stopBridge=new Map();
 let modelGraph,pollTimer,pollPromise,bindingPromise,trackingController,graphGeneration=0,tracking=false;
 const evidenceStats={requests:0,failures:0,lastSuccessAt:null,lastFailureAt:null,lastFailureCode:null};
 let latestSnapshot={vehicles:[],sources:[],errors:[]};
 const trackingStats={lastPollStartedAt:null,lastPollCompletedAt:null,lastPollError:null};
 async function vehicleSnapshot(signal){
  const results=await Promise.all([1,2].map(async type=>{try{const data=await api('vehicles',{type},signal);return{vehicles:normalizeVehicles(data.rows,type,now()),source:data.source};}catch(error){signal?.throwIfAborted();return{error:{code:error.code||'SOURCE_UNAVAILABLE',part:'vehicles',type}};}}));
  signal?.throwIfAborted();const vehicles=results.flatMap(result=>result.vehicles||[]),sources=results.flatMap(result=>result.source?[result.source]:[]),errors=results.flatMap(result=>result.error?[result.error]:[]);
  // Reserve every active line's bootstrap before per-vehicle platform misses
  // can fill the bounded queue in source-record order.
  prewarmEvidence(vehicles);delayModel.ingest(vehicles);latestSnapshot={vehicles,sources,errors};return latestSnapshot;
 }
 function attach(graph){if(modelGraph===graph)return;const same=Boolean(modelGraph&&modelGraph.serviceDay===graph.serviceDay&&modelGraph.source.version===graph.source.version);modelGraph=graph;delayModel.attachGraph(graph,{preserveState:same});if(same)return;graphGeneration++;bindingCache.clear();bindingQueue.clear();activeBindings.clear();lineBindings.clear();stopBridge.clear();const byName=new Map();for(const stop of municipalStops){const name=fold(stop.name);if(!byName.has(name))byName.set(name,[]);byName.get(name).push(stop);}for(const stop of graph.stops){const matches=(byName.get(fold(stop.name))||[]).filter(item=>!stop.platform||item.platform===stop.platform).map(item=>({stop:item,distance:distanceMeters(stop,item)})).filter(item=>item.distance<=60).sort((a,b)=>a.distance-b.distance);if(matches[0]&&(!matches[1]||matches[1].distance-matches[0].distance>=5))stopBridge.set(stop.id,matches[0].stop);}}

 const EVIDENCE_TTL=600000,QUEUE_LIMIT=512,CACHE_LIMIT=512,SHARED_BINDING_LIMIT=32768;
 function evidenceKey(stop,line,stopId){return dateInWarsaw(now())+'|'+stop.id+'|'+line+'|'+stopId;}
 function queueEvidence(stop,line,stopId){
  const key=evidenceKey(stop,line,stopId),cached=bindingCache.get(key);
  if(cached?.until>now()||bindingQueue.has(key)||activeBindings.has(key)||bindingQueue.size>=QUEUE_LIMIT)return;
  bindingQueue.set(key,{key,stop,line,stopId,queuedAt:now(),attempts:0,retryAt:0});
 }
 function sharedBindingCount(){let count=0;for(const item of lineBindings.values())for(const ids of item.bindings.values())count+=ids.size;return count;}
 function sharedEvidence(line){const item=lineBindings.get(line);if(item?.until>now())return item.bindings;lineBindings.delete(line);return null;}
 function tripEvidence(vehicle,stopId){
  const stop=stopBridge.get(stopId),brigade=normalizeBrigade(vehicle.brigade);if(!stop||!brigade)return null;
  const shared=sharedEvidence(vehicle.line),known=shared?.get(brigade),cached=bindingCache.get(evidenceKey(stop,vehicle.line,stopId));
  // A complete current-platform response takes precedence. Shared positive
  // bindings are not an exhaustive list: another branch may use this platform.
  if(cached?.until>now())return cached.bindings.get(brigade)||new Set();
  const observedAt=Date.parse(vehicle.observedAt);
  const plausible=modelGraph.trips.filter(trip=>trip.line===vehicle.line&&trip.stopTimes.some(event=>event.stopId===stopId)&&trip.stopTimes[0].departure<=observedAt+900000&&trip.stopTimes.at(-1).arrival>=observedAt-900000);
  // Reuse is safe only if it cannot hide a competing spatial/temporal trip.
  // Otherwise obtain this platform's complete brigade evidence before matching.
  // Complete platform responses also positively identify other brigades' trips.
  // Those known competitors do not require re-fetching every later platform;
  // an unbound branch still does, and own-brigade ambiguity remains in known.
  if(known&&plausible.length&&plausible.every(trip=>known.has(trip.id)||[...shared.values()].some(ids=>ids.has(trip.id))))return known;
  queueEvidence(stop,vehicle.line,stopId);return null;
 }
 function prewarmEvidence(vehicles){
  const lines=new Set(vehicles.filter(vehicle=>vehicle.freshness==='recent'&&normalizeBrigade(vehicle.brigade)).map(vehicle=>vehicle.line));
  for(const line of lines){
   if(sharedEvidence(line)||[...bindingQueue.values()].some(item=>item.line===line))continue;
   // One representative platform per active line starts learning before a stop
   // arrival or route request. Later branch-specific misses queue independently.
   const counts=new Map();for(const trip of modelGraph?.trips||[]){if(trip.line!==line||trip.stopTimes[0].departure>now()+900000||trip.stopTimes.at(-1).arrival<now()-900000)continue;for(const event of trip.stopTimes)if(stopBridge.has(event.stopId))counts.set(event.stopId,(counts.get(event.stopId)||0)+1);}
   const stopId=[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0];if(stopId)queueEvidence(stopBridge.get(stopId),line,stopId);
  }
 }
 async function flushBindings(signal){
  if(bindingPromise)return bindingPromise;const generation=graphGeneration,graph=modelGraph;
  const jobs=[];for(const[key,item]of bindingQueue){if(now()-item.queuedAt>EVIDENCE_TTL){bindingQueue.delete(key);continue;}if(item.retryAt>now())continue;bindingQueue.delete(key);activeBindings.add(key);jobs.push(item);if(jobs.length>=12)break;}
  bindingPromise=(async()=>{let next=0;await Promise.all(Array.from({length:Math.min(4,jobs.length)},async()=>{while(next<jobs.length){const item=jobs[next++];if(signal?.aborted||generation!==graphGeneration)return;evidenceStats.requests++;
   try{const data=await api('departures',{busstopId:item.stop.group,busstopNr:item.stop.platform,line:item.line},signal);if(signal?.aborted||generation!==graphGeneration)return;
    const bindings=buildBrigadeEvidence(normalizeDepartures(data.rows),item.line,item.stopId,graph,dateInWarsaw(now()));
    bindingCache.set(item.key,{until:now()+EVIDENCE_TTL,bindings});while(bindingCache.size>CACHE_LIMIT)bindingCache.delete(bindingCache.keys().next().value);
    if(bindings.size){let shared=sharedEvidence(item.line);if(!shared)shared=new Map();let bindingCount=sharedBindingCount();for(const[brigade,ids]of bindings){if(!shared.has(brigade)&&bindingCount<SHARED_BINDING_LIMIT)shared.set(brigade,new Set());const target=shared.get(brigade);if(!target)continue;for(const id of ids)if(!target.has(id)&&bindingCount<SHARED_BINDING_LIMIT){target.add(id);bindingCount++;}}lineBindings.set(item.line,{until:now()+EVIDENCE_TTL,bindings:shared});while(lineBindings.size>256)lineBindings.delete(lineBindings.keys().next().value);}
    evidenceStats.lastSuccessAt=new Date(now()).toISOString();
   }catch(error){if(signal?.aborted||generation!==graphGeneration)return;evidenceStats.failures++;evidenceStats.lastFailureAt=new Date(now()).toISOString();evidenceStats.lastFailureCode=error.code||'SOURCE_UNAVAILABLE';item.attempts++;item.retryAt=now()+Math.min(120000,15000*2**Math.min(item.attempts-1,3));if(bindingQueue.size<QUEUE_LIMIT)bindingQueue.set(item.key,item);}finally{activeBindings.delete(item.key);}
  }}));})().finally(()=>{bindingPromise=null;});return bindingPromise;
 }
 async function startTracking(){
  if(tracking)return;tracking=true;trackingController=new AbortController();const signal=trackingController.signal;
  const tick=async()=>{
   pollTimer=null;if(!tracking||signal.aborted)return;const startedAt=now();trackingStats.lastPollStartedAt=new Date(startedAt).toISOString();
   pollPromise=(async()=>{try{if(!municipalStops.length)municipalStops=(await stops(signal)).stops;const graph=await graphProvider(now(),{signal});if(signal.aborted)return;if(graph)attach(validateGraph(graph));await vehicleSnapshot(signal);void flushBindings(signal);trackingStats.lastPollCompletedAt=new Date(now()).toISOString();trackingStats.lastPollError=null;}catch(error){if(!signal.aborted){delayModel.ingest([]);trackingStats.lastPollError=error.code||'SOURCE_UNAVAILABLE';}}})();
   try{await pollPromise;}finally{pollPromise=null;if(tracking&&!signal.aborted){pollTimer=setTimeoutImpl(tick,Math.max(0,15000-(now()-startedAt)));pollTimer.unref?.();}}
  };
  await tick();
 }
 function liveSummary(){return{...delayModel.summary(),pollSeconds:15,continuous:tracking,pendingEvidence:bindingQueue.size,evidenceCached:bindingCache.size,evidenceLines:lineBindings.size,sharedTripBindings:sharedBindingCount(),sharedTripBindingLimit:SHARED_BINDING_LIMIT,evidenceInFlight:Boolean(bindingPromise),evidenceQueueLimit:QUEUE_LIMIT,oldestQueuedEvidenceAgeSeconds:bindingQueue.size?Math.max(...[...bindingQueue.values()].map(item=>Math.max(0,Math.floor((now()-item.queuedAt)/1000)))):0,evidenceConcurrency:4,evidenceRequestsPerCycle:12,evidenceDiagnostics:{...evidenceStats},trackingDiagnostics:{...trackingStats,pollAgeSeconds:trackingStats.lastPollCompletedAt?Math.max(0,Math.floor((now()-Date.parse(trackingStats.lastPollCompletedAt))/1000)):null,vehicleSnapshotCount:latestSnapshot.vehicles.length,recentVehicleCount:latestSnapshot.vehicles.filter(vehicle=>vehicle.freshness==='recent'&&now()-Date.parse(vehicle.observedAt)<=90000).length},matchedStopPlatforms:stopBridge.size};}
 function liveSnapshot(input){
  const start=waypoint(input?.origin,'punkt startowy'),end=waypoint(input?.destination,'cel');if(typeof start.value==='string'||typeof end.value==='string')throw new TransitError('INVALID_LOCATION','Do aktualizacji mapy wymagane są współrzędne.');
  const origin={latitude:start.value.lat,longitude:start.value.lng},destination={latitude:end.value.lat,longitude:end.value.lng};
  const nearby=withVehicleDirections(latestSnapshot.vehicles,modelGraph,delayModel.getDeltas(),now()).map(vehicle=>{const age=now()-Date.parse(vehicle.observedAt);return{...vehicle,freshness:!Number.isFinite(age)?'unknown':age< -60000||age>90000?'stale':'recent',distanceMeters:Math.round(Math.min(distanceMeters(vehicle,origin),distanceMeters(vehicle,destination)))};}).filter(vehicle=>vehicle.distanceMeters<=2000&&vehicle.freshness==='recent').sort((a,b)=>a.distanceMeters-b.distanceMeters);
  return{vehicles:nearby.slice(0,40),vehicleCount:nearby.length,vehicleProvided:Math.min(40,nearby.length),liveModel:liveSummary(),errors:latestSnapshot.errors};
 }
 async function board(input,{signal}={}){
  // A dated GTFS graph already includes yesterday's overnight service and the
  // next day's first four hours, covering this two-hour board across midnight.
  signal?.throwIfAborted();const instant=now(),request=boardRequest(input,instant),days=[request.start];
  const graphs=[];
  for(const time of days){
   const day=dateInWarsaw(time);let graph=modelGraph?.serviceDay===day?modelGraph:null;
   const cached=boardGraphs.get(day);if(!graph&&cached?.until>instant)graph=cached.graph;
   if(!graph){graph=await graphProvider(time,{signal});signal?.throwIfAborted();if(!graph)throw new TransitError('GTFS_UNAVAILABLE','Datowany rozkład ZTM jest chwilowo niedostępny.');validateGraph(graph);boardGraphs.set(day,{graph,until:instant+300000});while(boardGraphs.size>2)boardGraphs.delete(boardGraphs.keys().next().value);}
   graphs.push(graph);
  }
  signal?.throwIfAborted();return departureBoard(graphs,request,{now:instant,deltas:delayModel.getDeltas(),vehicles:withVehicleDirections(latestSnapshot.vehicles,modelGraph,delayModel.getDeltas(),instant),signal});
 }

 async function api(name,args,signal) {
  signal?.throwIfAborted();const spec=TRANSIT_SOURCES[name],cacheKey=name+JSON.stringify(args||{}),cached=cache.get(cacheKey);
  if(cached&&cached.until>now())return structuredClone(cached.result);
  if(!key())throw new TransitError('SOURCE_NOT_CONFIGURED','Brak połączenia z miejskim API komunikacji.');
  let response;
  try{response=await fetchImpl('https://dane.um.warszawa.pl/api/action/'+spec.action,{method:'POST',headers:{Authorization:key(),'Content-Type':'application/json',Accept:'application/json'},...(args?{body:JSON.stringify(args)}:{}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs)});}
  catch(error){signal?.throwIfAborted();throw new TransitError('SOURCE_UNAVAILABLE','Miejskie API komunikacji nie odpowiedziało na czas.');}
  if(!response.ok)throw new TransitError('SOURCE_UNAVAILABLE','Miejskie API komunikacji jest chwilowo niedostępne.');
  const raw=await response.json();signal?.throwIfAborted();if(!Array.isArray(raw))throw new TransitError('SOURCE_SCHEMA','Miejskie API zwróciło nieznany format danych.');
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
  const start=waypoint(input.origin,'punkt startowy'),end=waypoint(input.destination,'cel'),mode=routeMode(input.mode),requested=departure(input.departureTime,now()),errors=[];
  let catalog={stops:[],source:null},walkingRoute=null;
  // Coordinates and exact address results need no city catalogue for a walk.
  if(mode!=='walk'||typeof start.value==='string'||typeof end.value==='string')try{catalog=await stops(signal);municipalStops=catalog.stops;}catch(error){signal?.throwIfAborted();if(mode!=='auto'||typeof start.value==='string'||typeof end.value==='string')throw error;errors.push({code:error.code||'SOURCE_UNAVAILABLE',part:'stops'});}
  const origin=resolve(input.origin,catalog.stops,'start'),destination=resolve(input.destination,catalog.stops,'cel');
  if(mode==='walk'||mode==='auto'&&distanceMeters(origin,destination)<=6000)try{walkingRoute=await planDirectWalk({origin,destination,departureTime:requested.getTime(),signal},walkingProvider?{provider:walkingProvider}:{});}catch(error){signal?.throwIfAborted();if(mode==='walk')throw error;errors.push({code:error.code||'WALK_ROUTING_UNAVAILABLE',part:'walking'});}
  if(mode==='walk')return{status:'ready',mode,routes:mergeRouteOptions([],walkingRoute),reason:null,nextSearch:null,origin,destination,requestedDeparture:requested.toISOString(),timeZone:'Europe/Warsaw',stops:[],originStopIds:[],destinationStopIds:[],departures:[],vehicles:[],vehicleCount:0,vehicleProvided:0,complete:false,errors:[],sources:[walkingRoute.walkingSource],graphSource:null,coverage:{directWalkingMaxMeters:6000},limitations:walkingRoute.warnings};
  const nearby=p=>catalog.stops.map(stop=>({...stop,distanceMeters:Math.round(distanceMeters(p,stop))})).filter(stop=>stop.distanceMeters<=900).sort((a,b)=>a.distanceMeters-b.distanceMeters).slice(0,2);
  const starts=nearby(origin),ends=nearby(destination),selected=[...new Map([...starts,...ends].map(stop=>[stop.id,stop])).values()];
  const sources=catalog.source?[catalog.source]:[],departures=[];let requests=catalog.source?1:0,graph=null,graphSource=null,routes=[],reason='GRAPH_UNAVAILABLE';
  try{const raw=await graphProvider(requested.getTime(),{signal});if(raw){graph=validateGraph(raw);graphSource=graph.source;if(dateInWarsaw(requested)===dateInWarsaw(now()))attach(graph);}}
  catch(error){signal?.throwIfAborted();reason=error instanceof TransitError?error.code:'GRAPH_INVALID';errors.push({code:reason,part:'routing'});}
  const snapshot=await vehicleSnapshot(signal);requests+=2;sources.push(...snapshot.sources);errors.push(...snapshot.errors);
  // Per-stop undated APIs are fallback observations only. A valid GTFS avoids fan-out.
  if(!graph)for(const stop of [starts[0],ends[0]].filter(Boolean)){
   try{requests++;const lines=await api('lines',{busstopId:stop.group,busstopNr:stop.platform},signal);sources.push(lines.source);const names=[...new Set(lines.rows.map(row=>clean(kv(row).linia)).filter(Boolean))];
    for(const line of names.slice(0,1)){try{requests++;const data=await api('departures',{busstopId:stop.group,busstopNr:stop.platform,line},signal);sources.push(data.source);departures.push({stopId:stop.id,stopName:stop.name,line,records:normalizeDepartures(data.rows),source:data.source,linesChecked:1,linesTotal:names.length});}catch(error){signal?.throwIfAborted();errors.push({code:error.code||'SOURCE_UNAVAILABLE',part:'departures',stopId:stop.id,line});}}
   }catch(error){signal?.throwIfAborted();errors.push({code:error.code||'SOURCE_UNAVAILABLE',part:'lines',stopId:stop.id});}
  }
  const deltas=delayModel.getDeltas();let nextSearch=null;
  if(graph)try{
   const options={origin,destination,departureTime:requested.getTime(),signal,deltas,now:now()},walking={...(walkingProvider?{provider:walkingProvider}:{}),verification:createWalkingVerification({signal})};
   routes=await planPedestrianGraph(graph,options,walking);
   if(!routes.length){const fallback=await nextAvailableTransit(graph,options,{graphProvider,walking});routes=fallback.routes;nextSearch=fallback.search;}
   for(const route of routes)if(route.walkingSource)sources.push(route.walkingSource);reason=routes.length?null:nextSearch?.exhausted?'FEED_EXHAUSTED':'NO_VERIFIED_ROUTE';
  }catch(error){signal?.throwIfAborted();reason=error instanceof TransitError?error.code:error?.name==='TimeoutError'?'LOOKAHEAD_LIMIT':'GRAPH_INVALID';errors.push({code:reason,part:'routing'});}
  routes=mergeRouteOptions(routes,walkingRoute);if(walkingRoute)sources.push(walkingRoute.walkingSource);if(routes.length)reason=null;
  const relevant=withVehicleDirections(snapshot.vehicles,modelGraph,delayModel.getDeltas(),now()).map(vehicle=>({...vehicle,distanceMeters:Math.round(Math.min(distanceMeters(vehicle,origin),distanceMeters(vehicle,destination)))})).filter(vehicle=>vehicle.distanceMeters<=2000&&vehicle.freshness==='recent').sort((a,b)=>a.distanceMeters-b.distanceMeters);
  return{status:routes.length?'ready':'limited',mode,routes,reason,nextSearch,origin,destination,requestedDeparture:requested.toISOString(),timeZone:'Europe/Warsaw',stops:selected,originStopIds:starts.map(stop=>stop.id),destinationStopIds:ends.map(stop=>stop.id),departures,vehicles:relevant.slice(0,40),vehicleCount:relevant.length,vehicleProvided:Math.min(40,relevant.length),complete:false,errors,sources:[...new Map(sources.map(source=>[source.url,source])).values()],graphSource,liveModel:{...liveSummary(),vehicleSnapshotCount:snapshot.vehicles.length},coverage:{stopRadiusMeters:900,stopsPerEnd:8,linesPerStop:graph?0:1,maxSourceRequests:graph?3:7,sourceCalls:requests,vehicleRadiusMeters:2000},limitations:['Odjazdy z API bez daty i trip_id nie są łączone w przejazd.','Pozycja pojazdu to obserwacja; korekta ETA wymaga potwierdzonego modelu tego samego kursu.',routes.length?'Czasy dojść uwzględniają ścieżki OpenStreetMap / Valhalla; ostatnie metry do punktów i tempo marszu pozostają szacunkowe. Wyszukiwanie ma ograniczony zakres przystanków, przesiadek i sprawdzanych przejść.':'Przejścia piesze nie zostały potwierdzone w żadnej zwróconej trasie; wyszukiwanie ogranicza zakres przystanków, przesiadek i sprawdzanych przejść.']};
 }

 return{searchStops,plan,startTracking,liveSnapshot,board,stopTracking(){tracking=false;trackingController?.abort();clearTimeoutImpl(pollTimer);pollTimer=null;graphGeneration++;delayModel.clear();bindingCache.clear();bindingQueue.clear();activeBindings.clear();lineBindings.clear();boardGraphs.clear();latestSnapshot={vehicles:[],sources:[],errors:[]};}};
}
export const transitService=createTransitService();
