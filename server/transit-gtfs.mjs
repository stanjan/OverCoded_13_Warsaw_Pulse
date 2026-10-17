// First-party ZTM GTFS. Stream the large stop_times table, retain dated services only.
import {open,stat,mkdir,rename,unlink} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {createInflateRaw} from 'node:zlib';
import {StringDecoder} from 'node:string_decoder';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {resolve} from 'node:path';
import {TransitError,serviceSeconds,serviceInstant,dateInWarsaw,distanceMeters} from '../transit-core.mjs';
export const GTFS_URL='https://gtfs.ztm.waw.pl/last';
const invalid=message=>{throw new TransitError('GTFS_INVALID',message);};
export function csvRow(line){if(!line.includes('"'))return line.split(',');const values=[];let value='',quoted=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){values.push(value);value='';}else value+=c;}if(quoted)invalid('Niedomknięte pole CSV w GTFS.');values.push(value);return values;}
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
  return {async each(name,callback,{signal,optional=false,valuesOnly=false,onHeaders}={}){
   const entry=entries.get(name);if(!entry){if(optional)return;invalid('Brak '+name+' w GTFS.');}
   if(![0,8].includes(entry.method)||entry.bytes>800000000)invalid('Nieobsługiwany wpis GTFS.');
   const header=Buffer.alloc(30);await file.read(header,0,30,entry.offset);const start=entry.offset+30+header.readUInt16LE(26)+header.readUInt16LE(28);
   if(start+entry.compressed>size)invalid('Niepełne archiwum GTFS.');
   const raw=createReadStream(path,{start,end:start+entry.compressed-1,signal}),inflated=entry.method===8?raw.pipe(createInflateRaw()):raw,decoder=new StringDecoder('utf8');
   if(inflated!==raw)raw.on('error',error=>inflated.destroy(error));
   let headers,count=0,bytes=0,pending='';
   function consume(text){const line=text.endsWith('\r')?text.slice(0,-1):text;signal?.throwIfAborted();bytes+=Buffer.byteLength(text)+1;if(bytes>entry.bytes+1000||line.length>1000000||++count>10000000)invalid('Przekroczono rozmiar tabeli GTFS.');if(!headers){headers=csvRow(line.replace(/^\uFEFF/,''));onHeaders?.(Object.fromEntries(headers.map((key,index)=>[key,index])));return;}if(!line)return;const values=csvRow(line);if(values.length!==headers.length)invalid('Nieprawidłowe kolumny GTFS.');callback(valuesOnly?values:Object.fromEntries(headers.map((key,index)=>[key,values[index]])));}
   // Batch lines per decoded chunk. An async iterator per 8M individual lines
   // turns a single cold import into minutes of microtask/GC overhead.
   try{for await(const chunk of inflated){pending+=decoder.write(chunk);const lines=pending.split('\n');pending=lines.pop();for(const line of lines)consume(line);if(pending.length>1000000)invalid('Przekroczono rozmiar wiersza GTFS.');}pending+=decoder.end();if(pending)consume(pending);}
   finally{raw.destroy();if(inflated!==raw)inflated.destroy();}
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
export async function loadGtfsTemplates(path,{signal,fetchedAt}={}){
 const archive=await openGtfs(path),calendar=[],exceptions=[],agencies=[],feed=[],stops=[],routes=new Map(),trips=new Map(),shapes=new Map();
 try{
  await archive.each('feed_info.txt',row=>feed.push(row),{signal});await archive.each('agency.txt',row=>agencies.push(row),{signal});
  const info=feed[0],validFrom=isoDate(info?.feed_start_date),validTo=isoDate(info?.feed_end_date);
  if(!validFrom||!validTo||validTo<validFrom||Date.parse(validTo)-Date.parse(validFrom)>100*86400000)invalid('Nieprawidłowy zakres dat oficjalnego rozkładu ZTM.');
  if(agencies.some(row=>row.agency_timezone!=='Europe/Warsaw'))invalid('Nieobsługiwana strefa rozkładu.');
  await archive.each('calendar.txt',row=>calendar.push(row),{signal,optional:true});await archive.each('calendar_dates.txt',row=>exceptions.push(row),{signal,optional:true});
  // One compact, undated copy per trip, shared by every requested service day.
  const services=new Set();for(let date=validFrom;date<=validTo;date=nextDay(date))for(const id of activeServices(calendar,exceptions,date))services.add(id);
  await archive.each('stops.txt',row=>{const latitude=Number(row.stop_lat),longitude=Number(row.stop_lon);if(row.stop_id&&row.stop_name&&Number.isFinite(latitude)&&Math.abs(latitude)<=90&&Number.isFinite(longitude)&&Math.abs(longitude)<=180)stops.push({id:row.stop_id,name:row.stop_name,platform:row.stop_code,latitude,longitude});},{signal});
  const stopIndexes=new Map(stops.map((stop,index)=>[stop.id,index]));
  await archive.each('routes.txt',row=>routes.set(row.route_id,{line:row.route_short_name,type:row.route_type}),{signal});
  await archive.each('trips.txt',row=>{if(services.has(row.service_id)&&routes.has(row.route_id))trips.set(row.trip_id,{id:row.trip_id,serviceId:row.service_id,line:routes.get(row.route_id).line,routeType:/^\d+$/.test(routes.get(row.route_id).type||'')?Number(routes.get(row.route_id).type):null,headsign:row.trip_headsign,shapeId:row.shape_id,stopTimes:[]});},{signal});
  let columns;await archive.each('stop_times.txt',row=>{const trip=trips.get(row[columns.trip_id]);if(!trip)return;const arrival=serviceSeconds(row[columns.arrival_time]),departure=serviceSeconds(row[columns.departure_time]),stopIndex=stopIndexes.get(row[columns.stop_id]);if(arrival===null||departure===null||stopIndex===undefined){trip.invalid=true;return;}trip.stopTimes.push(stopIndex,arrival,departure,Number(row[columns.stop_sequence]),Number(row[columns.pickup_type]||0),Number(row[columns.drop_off_type]||0),row[columns.shape_dist_traveled]?Number(row[columns.shape_dist_traveled]):NaN);},{signal,valuesOnly:true,onHeaders:value=>{columns=value;}});
  const shapeIds=new Set([...trips.values()].map(trip=>trip.shapeId));await archive.each('shapes.txt',row=>{const id=row[columns.shape_id];if(!shapeIds.has(id))return;const point={latitude:Number(row[columns.shape_pt_lat]),longitude:Number(row[columns.shape_pt_lon]),sequence:Number(row[columns.shape_pt_sequence]),shapeDistance:row[columns.shape_dist_traveled]?Number(row[columns.shape_dist_traveled]):null};if(!Number.isFinite(point.latitude)||!Number.isFinite(point.longitude)||Math.abs(point.latitude)>90||Math.abs(point.longitude)>180)return;if(!shapes.has(id))shapes.set(id,[]);shapes.get(id).push(point);},{signal,optional:true,valuesOnly:true,onHeaders:value=>{columns=value;}});
  for(const shape of shapes.values())shape.sort((a,b)=>a.sequence-b.sequence);
  let excluded=0;
  for(const trip of trips.values()){
   const ordered=[];for(let i=0;i<trip.stopTimes.length;i+=7)ordered.push(trip.stopTimes.slice(i,i+7));ordered.sort((a,b)=>a[3]-b[3]);if(trip.invalid||ordered.length<2||ordered.some((event,index)=>event[1]>event[2]||index>0&&event[1]<ordered[index-1][2])){excluded++;trips.delete(trip.id);continue;}
   trip.events=Float64Array.from(ordered.flat());delete trip.stopTimes;
   trip.shape=shapes.get(trip.shapeId)||[];
  }
  return {calendar,exceptions,stops,trips:[...trips.values()],source:{name:'Zarząd Transportu Miejskiego w Warszawie · GTFS',url:GTFS_URL,documentationUrl:'https://www.ztm.waw.pl/pliki-do-pobrania/dane-rozkladowe/',fetchedAt:fetchedAt||new Date((await stat(path)).mtimeMs).toISOString(),validFrom,validTo,version:info.feed_version,processed:true,excludedTrips:excluded}};
 }finally{await archive.close();}
}
export function nextDay(day,offset=1){const date=new Date(day+'T12:00Z');date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);}
export function graphForDay(templates,day,{signal,nextDayHours=4}={}){
 const {validFrom,validTo}=templates.source;if(day<validFrom||day>validTo)throw new TransitError('DATE_OUTSIDE_FEED','Oficjalny rozkład ZTM obejmuje '+validFrom+' – '+validTo+'.');
 const dates=[nextDay(day,-1),day,nextDay(day)].filter(date=>date>=validFrom&&date<=validTo),active=new Map(dates.map(date=>[date,activeServices(templates.calendar,templates.exceptions,date)])),trips=[];
 let index=0;for(const trip of templates.trips){if(++index%500===0)signal?.throwIfAborted();for(const serviceDate of dates){
  if(!active.get(serviceDate).has(trip.serviceId)||serviceDate<day&&(trip.events?trip.events.at(-5):serviceSeconds(trip.stopTimes.at(-1).departureClock))<86400||serviceDate>day&&(trip.events?trip.events[1]:serviceSeconds(trip.stopTimes[0].arrivalClock))>nextDayHours*3600)continue;
  // Derive elapsed times once per dated trip, rather than formatting every stop.
  const base=gtfsInstant(serviceDate,'00:00:00'),stopTimes=[];
  if(trip.events)for(let i=0;i<trip.events.length;i+=7){const e=trip.events;stopTimes.push({stopId:templates.stops[e[i]].id,arrivalClock:serviceClock(e[i+1]),departureClock:serviceClock(e[i+2]),sequence:e[i+3],pickup:e[i+4],dropOff:e[i+5],shapeDistance:Number.isNaN(e[i+6])?null:e[i+6],arrival:base+e[i+1]*1000,departure:base+e[i+2]*1000});}
  else for(const event of trip.stopTimes)stopTimes.push({...event,arrival:base+serviceSeconds(event.arrivalClock)*1000,departure:base+serviceSeconds(event.departureClock)*1000});
  const {events,...record}=trip;trips.push({...record,id:trip.id+'@'+serviceDate,serviceDate,stopTimes});
 }}
 signal?.throwIfAborted();return{serviceDay:day,nextDayHours,timeZone:'Europe/Warsaw',stops:templates.stops,trips,source:templates.source};
}
const clocks=new Map();function serviceClock(seconds){if(!clocks.has(seconds))clocks.set(seconds,[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(number=>String(number).padStart(2,'0')).join(':'));return clocks.get(seconds);}
export async function loadGtfs(path,day,options={}){return graphForDay(await loadGtfsTemplates(path,options),day,options);}
export function createGtfsProvider({cacheDir=resolve(import.meta.dirname,'../.local/transit'),fetchImpl=fetch,now=()=>Date.now()}={}){
 let loaded,templates,templateStamp,queue=Promise.resolve();
 return async function getGraph(requested,{signal,nextDayHours=4}={}){
  signal?.throwIfAborted();
  const day=dateInWarsaw(requested),path=resolve(cacheDir,'gtfs.zip');
  if(nextDayHours===4&&loaded?.day===day&&now()-loaded.at<21600000)return loaded.graph;
  const pending=queue.then(async()=>{
   signal?.throwIfAborted();if(nextDayHours===4&&loaded?.day===day&&now()-loaded.at<21600000)return loaded.graph;
   await mkdir(cacheDir,{recursive:true});const existing=await stat(path).catch(()=>null);
   if(!existing||now()-existing.mtimeMs>21600000){const response=await fetchImpl(GTFS_URL,{signal:AbortSignal.timeout(120000)});if(!response.ok)throw new TransitError('GTFS_UNAVAILABLE','Oficjalny plik rozkładu ZTM jest niedostępny.');const length=Number(response.headers.get('content-length'));if(length>100000000)invalid('Plik GTFS jest zbyt duży.');let bytes=0;const temp=path+'.download';try{await pipeline(Readable.fromWeb(response.body),async function*(chunks){for await(const chunk of chunks){bytes+=chunk.length;if(bytes>100000000)invalid('Plik GTFS jest zbyt duży.');yield chunk;}},createWriteStream(temp));await rename(temp,path);}catch(error){await unlink(temp).catch(()=>{});throw error;}}
   const stamp=(await stat(path)).mtimeMs;if(!templates||templateStamp!==stamp){templates=await loadGtfsTemplates(path);templateStamp=stamp;loaded=null;}
   const graph=graphForDay(templates,day,{signal,nextDayHours});
   // Keep only the current day graph for continuous prediction. Future queries are ephemeral.
   if(nextDayHours===4&&(day===dateInWarsaw(now())||!loaded))loaded={day,at:now(),graph};
   return graph;
  });queue=pending.then(()=>{},()=>{});
  const graph=await pending;signal?.throwIfAborted();return graph;
 };
}
export const getGtfsGraph=createGtfsProvider();
