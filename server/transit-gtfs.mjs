// First-party ZTM GTFS. Stream the large stop_times table, retain dated services only.
import {open,stat,mkdir,rename,unlink} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {createInflateRaw} from 'node:zlib';
import {createInterface} from 'node:readline';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {resolve} from 'node:path';
import {TransitError,serviceSeconds,serviceInstant,dateInWarsaw,distanceMeters} from '../transit-core.mjs';
export const GTFS_URL='https://gtfs.ztm.waw.pl/last';
const invalid=message=>{throw new TransitError('GTFS_INVALID',message);};
export function csvRow(line){const values=[];let value='',quoted=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){values.push(value);value='';}else value+=c;}if(quoted)invalid('Niedomknięte pole CSV w GTFS.');values.push(value);return values;}
export async function openGtfs(path){
 const file=await open(path),size=(await file.stat()).size;
 try{
  if(size<22||size>100000000)invalid('Nieprawidłowa wielkość archiwum GTFS.');
  const tail=Buffer.alloc(Math.min(size,65557));await file.read(tail,0,tail.length,size-tail.length);
  const end=tail.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));if(end<0)invalid('Brak katalogu ZIP.');
  const length=tail.readUInt32LE(end+12),offset=tail.readUInt32LE(end+16);if(length>1000000||offset+length>size)invalid('Nieprawidłowy katalog ZIP.');
  const directory=Buffer.alloc(length);await file.read(directory,0,length,offset);const entries=new Map();
  for(let pos=0;pos<length;){if(directory.readUInt32LE(pos)!==0x02014b50)invalid('Nieprawidłowy wpis ZIP.');const nameLength=directory.readUInt16LE(pos+28),extra=directory.readUInt16LE(pos+30),comment=directory.readUInt16LE(pos+32),name=directory.toString('utf8',pos+46,pos+46+nameLength);
   entries.set(name,{name,method:directory.readUInt16LE(pos+10),compressed:directory.readUInt32LE(pos+20),bytes:directory.readUInt32LE(pos+24),offset:directory.readUInt32LE(pos+42)});pos+=46+nameLength+extra+comment;
  }
  return {async each(name,callback,{signal,optional=false}={}){
   const entry=entries.get(name);if(!entry){if(optional)return;invalid('Brak '+name+' w GTFS.');}
   if(![0,8].includes(entry.method)||entry.bytes>800000000)invalid('Nieobsługiwany wpis GTFS.');
   const header=Buffer.alloc(30);await file.read(header,0,30,entry.offset);const start=entry.offset+30+header.readUInt16LE(26)+header.readUInt16LE(28);
   if(start+entry.compressed>size)invalid('Niepełne archiwum GTFS.');
   const raw=createReadStream(path,{start,end:start+entry.compressed-1,signal}),inflated=entry.method===8?raw.pipe(createInflateRaw()):raw,lines=createInterface({input:inflated,crlfDelay:Infinity});
   let headers,count=0,bytes=0;
   try{for await(const line of lines){signal?.throwIfAborted();bytes+=Buffer.byteLength(line)+1;if(bytes>entry.bytes+1000||line.length>1000000||++count>10000000)invalid('Przekroczono rozmiar tabeli GTFS.');if(!headers){headers=csvRow(line.replace(/^\uFEFF/,''));continue;}if(!line)continue;const values=csvRow(line);if(values.length!==headers.length)invalid('Nieprawidłowe kolumny GTFS.');callback(Object.fromEntries(headers.map((key,index)=>[key,values[index]])));}}
   finally{lines.close();raw.destroy();if(inflated!==raw)inflated.destroy();}
  },close:()=>file.close()};
 }catch(error){await file.close();throw error;}
}
const isoDate=value=>/^\d{8}$/.test(value||'')?value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6):null;
export function activeServices(calendar,exceptions,day){
 const compact=day.replaceAll('-',''),weekday=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date(day+'T12:00Z').getUTCDay()];
 const active=new Set(calendar.filter(row=>row.start_date<=compact&&row.end_date>=compact&&row[weekday]==='1').map(row=>row.service_id));
 for(const row of exceptions)if(row.date===compact){if(row.exception_type==='1')active.add(row.service_id);if(row.exception_type==='2')active.delete(row.service_id);}
 return active;
}
// GTFS Time is elapsed from local noon minus 12h, including DST days.
const serviceBases=new Map();
export function gtfsInstant(day,clock){const seconds=serviceSeconds(clock);if(!serviceBases.has(day)){serviceBases.set(day,serviceInstant(day,'12:00:00'));while(serviceBases.size>100)serviceBases.delete(serviceBases.keys().next().value);}const noon=serviceBases.get(day);return seconds===null||noon===null?null:noon-43200000+seconds*1000;}
export async function loadGtfs(path,day,{signal,fetchedAt}={}){
 const archive=await openGtfs(path),calendar=[],exceptions=[],agencies=[],feed=[],stops=[],routes=new Map(),trips=new Map(),shapes=new Map();
 try{
  await archive.each('feed_info.txt',row=>feed.push(row),{signal});await archive.each('agency.txt',row=>agencies.push(row),{signal});
  const info=feed[0],validFrom=isoDate(info?.feed_start_date),validTo=isoDate(info?.feed_end_date);
  if(!validFrom||!validTo||day<validFrom||day>validTo)throw new TransitError('DATE_OUTSIDE_FEED','Oficjalny rozkład ZTM obejmuje '+(validFrom||'?')+' – '+(validTo||'?')+'.');
  if(agencies.some(row=>row.agency_timezone!=='Europe/Warsaw'))invalid('Nieobsługiwana strefa rozkładu.');
  await archive.each('calendar.txt',row=>calendar.push(row),{signal,optional:true});await archive.each('calendar_dates.txt',row=>exceptions.push(row),{signal,optional:true});
  const dates=[-1,0,1].map(offset=>{const date=new Date(day+'T12:00Z');date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);});
  const serviceDates=new Map();for(const date of dates)for(const id of activeServices(calendar,exceptions,date)){if(!serviceDates.has(id))serviceDates.set(id,[]);serviceDates.get(id).push(date);}
  await archive.each('stops.txt',row=>{const latitude=Number(row.stop_lat),longitude=Number(row.stop_lon);if(row.stop_id&&row.stop_name&&Number.isFinite(latitude)&&Math.abs(latitude)<=90&&Number.isFinite(longitude)&&Math.abs(longitude)<=180)stops.push({id:row.stop_id,name:row.stop_name,platform:row.stop_code,latitude,longitude});},{signal});
  await archive.each('routes.txt',row=>routes.set(row.route_id,{line:row.route_short_name,type:row.route_type}),{signal});
  await archive.each('trips.txt',row=>{if(serviceDates.has(row.service_id)&&routes.has(row.route_id))trips.set(row.trip_id,{id:row.trip_id,serviceId:row.service_id,line:routes.get(row.route_id).line,routeType:/^\d+$/.test(routes.get(row.route_id).type||'')?Number(routes.get(row.route_id).type):null,headsign:row.trip_headsign,shapeId:row.shape_id,stopTimes:[]});},{signal});
  await archive.each('stop_times.txt',row=>{const trip=trips.get(row.trip_id);if(!trip)return;const arrival=serviceSeconds(row.arrival_time),departure=serviceSeconds(row.departure_time);if(arrival===null||departure===null){trip.invalid=true;return;}trip.stopTimes.push({stopId:row.stop_id,arrivalClock:row.arrival_time,departureClock:row.departure_time,sequence:Number(row.stop_sequence),pickup:Number(row.pickup_type||0),dropOff:Number(row.drop_off_type||0),shapeDistance:row.shape_dist_traveled?Number(row.shape_dist_traveled):null});},{signal});
  const shapeIds=new Set([...trips.values()].map(trip=>trip.shapeId));await archive.each('shapes.txt',row=>{if(!shapeIds.has(row.shape_id))return;const point={latitude:Number(row.shape_pt_lat),longitude:Number(row.shape_pt_lon),sequence:Number(row.shape_pt_sequence)};if(!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude)||Math.abs(point.latitude)>90||Math.abs(point.longitude)>180)return;if(!shapes.has(row.shape_id))shapes.set(row.shape_id,[]);shapes.get(row.shape_id).push(point);},{signal,optional:true});
  for(const shape of shapes.values())shape.sort((a,b)=>a.sequence-b.sequence);
  const graphTrips=[];let excluded=0;
  for(const trip of trips.values()){
   trip.stopTimes.sort((a,b)=>a.sequence-b.sequence);if(trip.invalid||trip.stopTimes.length<2){excluded++;continue;}
   for(const serviceDate of serviceDates.get(trip.serviceId)){
    if(serviceDate<day&&serviceSeconds(trip.stopTimes.at(-1).departureClock)<86400)continue;
    if(serviceDate>day&&serviceSeconds(trip.stopTimes[0].arrivalClock)>4*3600)continue;
    const stopTimes=trip.stopTimes.map(event=>({...event,arrival:gtfsInstant(serviceDate,event.arrivalClock),departure:gtfsInstant(serviceDate,event.departureClock)}));
    if(stopTimes.some((event,index)=>event.arrival===null||event.departure===null||event.arrival>event.departure||index>0&&event.arrival<stopTimes[index-1].departure)){excluded++;continue;}
    graphTrips.push({...trip,id:trip.id+'@'+serviceDate,serviceDate,stopTimes,shape:shapes.get(trip.shapeId)||[]});
   }
  }
  return {serviceDay:day,timeZone:'Europe/Warsaw',stops,trips:graphTrips,source:{name:'Zarząd Transportu Miejskiego w Warszawie · GTFS',url:GTFS_URL,documentationUrl:'https://www.ztm.waw.pl/pliki-do-pobrania/dane-rozkladowe/',fetchedAt:fetchedAt||new Date((await stat(path)).mtimeMs).toISOString(),validFrom,validTo,version:info.feed_version,processed:true,excludedTrips:excluded}};
 }finally{await archive.close();}
}
export function createGtfsProvider({cacheDir=resolve(import.meta.dirname,'../.local/transit'),fetchImpl=fetch,now=()=>Date.now()}={}){
 let loaded,queue=Promise.resolve();
 return async function getGraph(requested,{signal}={}){
  const day=dateInWarsaw(requested),path=resolve(cacheDir,'gtfs.zip');
  if(loaded?.day===day&&now()-loaded.at<21600000)return loaded.graph;
  const pending=queue.then(async()=>{
   if(loaded?.day===day&&now()-loaded.at<21600000)return loaded.graph;
   await mkdir(cacheDir,{recursive:true});const existing=await stat(path).catch(()=>null);
   if(!existing||now()-existing.mtimeMs>21600000){const response=await fetchImpl(GTFS_URL,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw new TransitError('GTFS_UNAVAILABLE','Oficjalny plik rozkładu ZTM jest niedostępny.');const length=Number(response.headers.get('content-length'));if(length>100000000)invalid('Plik GTFS jest zbyt duży.');let bytes=0;const temp=path+'.download';try{await pipeline(Readable.fromWeb(response.body),async function*(chunks){for await(const chunk of chunks){bytes+=chunk.length;if(bytes>100000000)invalid('Plik GTFS jest zbyt duży.');yield chunk;}},createWriteStream(temp));await rename(temp,path);}catch(error){await unlink(temp).catch(()=>{});throw error;}}
   const graph=await loadGtfs(path,day);
   // Keep only the current day graph for continuous prediction. Future queries are ephemeral.
   if(day===dateInWarsaw(now())||!loaded)loaded={day,at:now(),graph};
   return graph;
  });queue=pending.then(()=>{},()=>{});
  const graph=await pending;signal?.throwIfAborted();return graph;
 };
}
export const getGtfsGraph=createGtfsProvider();
