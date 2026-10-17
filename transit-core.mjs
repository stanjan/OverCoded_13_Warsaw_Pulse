// Provider records are data, never instructions.
export class TransitError extends Error {constructor(code,message){super(message);this.code=code;}}
const transportStyles = {
 bus: {transportColor:'#880077',transportLabel:'Autobus'},
 night_bus: {transportColor:'#000000',transportLabel:'Autobus nocny'},
 tram: {transportColor:'#E50000',transportLabel:'Tramwaj'},
 skm: {transportColor:'#8A0000',transportLabel:'SKM'},
 unknown: {transportColor:'#65727f',transportLabel:'Transport'},
};
export function transitAppearance(record={}) {
 const line=String(record.line||'').trim().toUpperCase();
 const routeType=record.routeType===undefined||record.routeType===null||record.routeType===''?null:Number(record.routeType);
 const kind=Object.hasOwn(transportStyles,record.transportKind)?record.transportKind:
  /^N\d+$/.test(line)?'night_bus':/^S\d+$/.test(line)?'skm':
  routeType===0?'tram':routeType===3?'bus':routeType===null&&record.type===2?'tram':routeType===null&&record.type===1?'bus':'unknown';
 return {transportKind:kind,...transportStyles[kind]};
}
const fail=(code,message)=>{throw new TransitError(code,message);};
export function waypoint(input,label='miejsce'){
 if(typeof input==='string'){
  const text=input.trim();if(!text||text.length>200||/[\u0000-\u001f]/.test(text))fail('INVALID_LOCATION','Podaj poprawne '+label+' (do 200 znaków).');
  if(/^[+-]?[\d.]+\s*,\s*[+-]?[\d.]+$/.test(text)){const[latitude,longitude]=text.split(',').map(Number);return waypoint({latitude,longitude},label);}
  return{value:text,label:text};
 }
 if(!input||typeof input!=='object'||!Number.isFinite(input.latitude)||Math.abs(input.latitude)>90||!Number.isFinite(input.longitude)||Math.abs(input.longitude)>180)fail('INVALID_LOCATION','Nieprawidłowe współrzędne: '+label+'.');
 return{value:{lat:input.latitude,lng:input.longitude},label:typeof input.label==='string'?input.label.slice(0,200):input.latitude.toFixed(5)+', '+input.longitude.toFixed(5)};
}
export function gpsOrigin(location,now=Date.now()){
 const age=now-Date.parse(location?.observedAt);
 if(location?.status!=='available'||!Number.isFinite(age)||age< -60000||age>300000||!Number.isFinite(location.accuracy)||location.accuracy<0||location.accuracy>2000)fail('ORIGIN_REQUIRED','Brak świeżej, wystarczająco dokładnej lokalizacji. Podaj punkt startowy lub odśwież GPS.');
 const result=waypoint(location,'punkt startowy');result.label='Moja lokalizacja (dokładność ok. '+Math.round(location.accuracy)+' m)';return result;
}
export function departure(value,now=Date.now()){
 if(!value)return new Date(now);
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(value))fail('INVALID_TIME','Podaj czas wyjazdu ze strefą czasową.');
 const day=value.slice(0,10),parsed=new Date(day+'T12:00:00Z');if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==day)fail('INVALID_TIME','Nieprawidłowa data wyjazdu.');
 const date=new Date(value),age=date.getTime()-now;if(!Number.isFinite(age)||age< -60000||age>99*86400000)fail('INVALID_TIME','Wybierz przyszły wyjazd, maksymalnie 99 dni naprzód.');return date;
}
export function warsawDeparture(value,now=Date.now()){
 if(!value)return departure(null,now);
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))fail('INVALID_TIME','Nieprawidłowa data wyjazdu.');
 const format=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const matches=['+01:00','+02:00'].map(offset=>new Date(value+offset)).filter(date=>Number.isFinite(date.getTime())&&format.format(date).replace(' ','T')===value);
 if(matches.length!==1)fail('INVALID_TIME','Ten czas jest niejednoznaczny lub nie istnieje przy zmianie czasu. Wybierz inną godzinę.');return departure(matches[0].toISOString(),now);
}
export function safeLink(value) { try { const url=new URL(String(value));return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:null;}catch{return null;} }
export function timeLabel(value) {return value===null||!Number.isFinite(value)?'czas niepotwierdzony':new Intl.DateTimeFormat('pl-PL',{timeZone:'Europe/Warsaw',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(value));}
export function durationLabel(value) {const minutes=Math.ceil(value/60000);return minutes>=60?Math.floor(minutes/60)+' godz. '+minutes%60+' min':minutes+' min';}
export function dateInWarsaw(value) {return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
export function serviceSeconds(clock) {
 if(typeof clock!=='string'||!/^\d{2}:\d{2}:\d{2}$/.test(clock))return null;
 const [h,m,s]=clock.split(':').map(Number);return h<48&&m<60&&s<60?h*3600+m*60+s:null;
}
// Municipal wall clocks carry no UTC offset. Ambiguous DST clocks stay unknown.
export function serviceInstant(day, clock) {
 const seconds=serviceSeconds(clock),base=new Date(day+'T12:00:00Z');
 if(seconds===null||!/^\d{4}-\d\d-\d\d$/.test(day)||!Number.isFinite(base.getTime())||base.toISOString().slice(0,10)!==day)return null;
 base.setUTCDate(base.getUTCDate()+Math.floor(seconds/86400));
 const rest=seconds%86400, wall=base.toISOString().slice(0,10)+'T'+[Math.floor(rest/3600),Math.floor(rest/60)%60,rest%60].map(n=>String(n).padStart(2,'0')).join(':');
 const format=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 const choices=['+01:00','+02:00'].map(offset=>new Date(wall+offset)).filter(date=>format.format(date).replace(' ','T')===wall);
 return choices.length===1?choices[0].getTime():null;
}
export function distanceMeters(a,b) {const rad=Math.PI/180,p1=a.latitude*rad,p2=b.latitude*rad,dp=(b.latitude-a.latitude)*rad,dl=(b.longitude-a.longitude)*rad;const x=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;return 6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));}
export async function computeMunicipal(request,{signal,fetchImpl=fetch}={}) {
 const asInput=p=>typeof p.value==='string'?p.value:{latitude:p.value.lat,longitude:p.value.lng,label:p.label};
 const response=await fetchImpl('/api/transit/plan',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({origin:asInput(request.origin),destination:asInput(request.destination),departureTime:request.departureTime.toISOString()})});
 const data=await response.json();
 if(!response.ok)throw new TransitError(data.code||'SOURCE_UNAVAILABLE',data.error||'Miejskie dane komunikacji są niedostępne.');
 if(!data||!Array.isArray(data.routes)||!Array.isArray(data.stops)||!Array.isArray(data.departures)||!Array.isArray(data.vehicles))throw new TransitError('INVALID_RESPONSE','Nieprawidłowa odpowiedź miejskich danych.');
 return data;
}
export function providerError(error) {return error instanceof TransitError?error:new TransitError(error?.name==='AbortError'?'CANCELLED':'SOURCE_UNAVAILABLE',error?.name==='AbortError'?'Przerwano planowanie.':'Nie udało się pobrać miejskich danych komunikacji. Spróbuj ponownie.');}
export function createPlanner({compute=computeMunicipal,onState=()=>{}}={}) {
 let sequence=0,controller,timer;
 const reset=(status='idle')=>{sequence++;clearTimeout(timer);controller?.abort();controller=null;onState({status,routes:[]});};
 return {reset,async search(request){reset();const turn=sequence;controller=new AbortController();const active=controller;timer=setTimeout(()=>active.abort(),95000);onState({status:'loading',routes:[]});
  try{const result=await compute(request,{signal:active.signal});if(turn===sequence)onState({...result,status:result.routes.length?'ready':'limited',request});}
  catch(error){if(turn===sequence)onState({status:'error',routes:[],request,error:providerError(error)});}
  finally{if(turn===sequence)clearTimeout(timer);}
 }};
}
