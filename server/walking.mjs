import {TransitError,distanceMeters} from '../transit-core.mjs';
export const WALK_SOURCE={name:'OpenStreetMap · Valhalla',url:'https://www.openstreetmap.org/copyright',engine:'Valhalla',geometry:'osm_pedestrian'};
const DEMO='https://valhalla1.openstreetmap.de/route',MAX_BYTES=1048576;let demoNext=0,demoQueued=0;
const failure=(code,message)=>new TransitError(code,message);
const valid=p=>Number.isFinite(p?.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180;
export function walkingKey(from,to){return[from.latitude,from.longitude,to.latitude,to.longitude].map(n=>Number(n).toFixed(7)).join(',');}
export function decodePolyline6(encoded){
 if(typeof encoded!=='string'||encoded.length>300000)throw failure('WALK_SCHEMA','Nieprawidłowy przebieg pieszy.');
 const path=[];let i=0,lat=0,lon=0;
 function value(){let result=0,shift=0,byte;do{if(i>=encoded.length||shift>30)throw failure('WALK_SCHEMA','Uszkodzona geometria piesza.');byte=encoded.charCodeAt(i++)-63;if(byte<0||byte>63)throw failure('WALK_SCHEMA','Uszkodzona geometria piesza.');result+=(byte&31)*2**shift;shift+=5;}while(byte>=32);return result%2?-(result+1)/2:result/2;}
 while(i<encoded.length){lat+=value();lon+=value();const point={latitude:lat/1e6,longitude:lon/1e6};if(!valid(point)||path.length>=20000)throw failure('WALK_SCHEMA','Nieprawidłowa geometria piesza.');path.push(point);}return path;
}
const pause=(ms,signal)=>new Promise((resolve,reject)=>{signal?.throwIfAborted();const done=()=>{signal?.removeEventListener('abort',abort);resolve();},timer=setTimeout(done,ms),abort=()=>{clearTimeout(timer);reject(signal.reason);};signal?.addEventListener('abort',abort,{once:true});});
async function demoSlot(signal){if(demoQueued>=16)throw failure('WALK_BUSY','Usługa przejść pieszych jest zajęta.');demoQueued++;try{const start=Math.max(Date.now(),demoNext);demoNext=start+1000;await pause(Math.max(0,start-Date.now()),signal);}finally{demoQueued--;}}
async function readJson(response){
 let value;if(response.body?.getReader){const reader=response.body.getReader(),chunks=[];let bytes=0;try{for(;;){const item=await reader.read();if(item.done)break;bytes+=item.value.byteLength;if(bytes>MAX_BYTES)throw failure('WALK_SCHEMA','Zbyt duża odpowiedź przejść pieszych.');chunks.push(item.value);}}finally{await reader.cancel().catch(()=>{});}value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
 else value=await response.json();return value;
}
export function createWalkingProvider({fetchImpl=fetch,url=process.env.WALK_ROUTING_URL||DEMO,timeoutMs=8000}={}){
 const endpoint=new URL(url);if(endpoint.username||endpoint.password||endpoint.hash||endpoint.search||!((endpoint.protocol==='https:')||(endpoint.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))))throw failure('WALK_CONFIG','Adres Valhalla wymaga HTTPS albo lokalnego serwera.');
 const demo=endpoint.origin===new URL(DEMO).origin;
 return {source:WALK_SOURCE,async route(from,to,{signal}={}){
  if(!valid(from)||!valid(to)||distanceMeters(from,to)>6000)throw failure('WALK_INPUT','Nieprawidłowy zakres przejścia pieszego.');
  const requestSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);
  try{
   if(demo)await demoSlot(requestSignal);requestSignal.throwIfAborted();
   const response=await fetchImpl(endpoint.href,{method:'POST',redirect:'error',signal:requestSignal,headers:{Accept:'application/json','Content-Type':'application/json','X-Client-Id':'warsaw-ai-local-prototype','User-Agent':'warsaw-ai-local-prototype'},body:JSON.stringify({locations:[from,to].map(p=>({lat:p.latitude,lon:p.longitude,type:'break',radius:25,search_cutoff:25})),costing:'pedestrian',costing_options:{pedestrian:{walking_speed:4.32}},units:'kilometers',language:'pl-PL',directions_options:{units:'kilometers'}})});
   let data;try{data=await readJson(response);}catch(error){if(error instanceof TransitError)throw error;throw failure('WALK_SCHEMA','Nieprawidłowa odpowiedź Valhalla.');}
   if([170,171,442,443,444].includes(data?.error_code))throw failure('WALK_UNREACHABLE','Nie znaleziono połączenia dla pieszych.');
   if(!response.ok)throw failure('WALK_ROUTING_UNAVAILABLE','Usługa przejść pieszych jest niedostępna.');
   const trip=data?.trip,leg=trip?.legs?.[0],summary=trip?.summary;
   if(trip?.status!==0||!Array.isArray(trip.legs)||trip.legs.length!==1||!Number.isFinite(summary?.time)||summary.time<0||summary.time>18000||!Number.isFinite(summary?.length)||summary.length<0||summary.length>20)throw failure('WALK_SCHEMA','Nieprawidłowy czas lub długość przejścia.');
   const path=decodePolyline6(leg?.shape);if(path.length<2)throw failure('WALK_SCHEMA','Brak przebiegu przejścia.');
   const startGap=distanceMeters(from,path[0]),endGap=distanceMeters(to,path.at(-1));
   if(startGap>25||endGap>25)throw failure('WALK_UNREACHABLE','Punkt leży zbyt daleko od potwierdzonej ścieżki pieszej.');
   const connectorMeters=startGap+endGap,straight=distanceMeters(path[0],path.at(-1));
   if(summary.length*1000+30<straight||summary.time<straight/3)throw failure('WALK_SCHEMA','Niewiarygodny czas lub długość przejścia.');
   return {durationMillis:Math.ceil((summary.time+connectorMeters/1.2)*1000),distanceMeters:Math.round(summary.length*1000+connectorMeters),path,geometry:'osm_pedestrian',source:WALK_SOURCE,endpointGapsMeters:{start:Math.round(startGap),end:Math.round(endGap)},assumption:connectorMeters>2?'Trasa po ścieżkach OpenStreetMap; ostatnie metry do punktów (do 25 m) i ich czas są przybliżone.':'Trasa piesza po ścieżkach OpenStreetMap; czas jest szacunkiem Valhalla.'};
  }catch(error){signal?.throwIfAborted();if(error instanceof TransitError)throw error;throw failure('WALK_ROUTING_UNAVAILABLE','Nie udało się potwierdzić przejścia pieszego. Spróbuj odświeżyć trasę.');}
 }};
}
