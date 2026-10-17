import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createEnvironmentService,CENTRAL_WARSAW} from '../server/environment.mjs';
const NOW = new Date('2026-10-17T16:00:00Z');
const seconds = text => Date.parse(text)/1000;
const weatherFixture = () => ({latitude:52.23,longitude:21.01,current_units:{temperature_2m:'°C'},current:{time:seconds('2026-10-17T16:00:00Z'),temperature_2m:11.4,weather_code:2,is_day:0},daily:{time:[seconds('2026-10-16T22:00:00Z')],sunrise:[seconds('2026-10-17T05:00:00Z')],sunset:[seconds('2026-10-17T15:40:00Z')]}});
const airFixture = () => ({latitude:52.25,longitude:21.05,current_units:{pm2_5:'μg/m³'},current:{time:seconds('2026-10-17T16:00:00Z'),european_aqi:43.5,pm2_5:18.4}});
function fixtureFetch(calls=[],transform=x=>x) { return async url=> {calls.push(new URL(url));return {ok:true,json:async()=>transform(url.hostname.startsWith('air-quality')?airFixture():weatherFixture(),url)};}; }
test('environment service requests current models and daily sun with source time, units and grid provenance',async()=>{
 const calls=[], service=createEnvironmentService({fetchImpl:fixtureFetch(calls),now:()=>NOW});
 const data=await service();
 assert.equal(calls.length,2);assert.deepEqual(data.location,{...CENTRAL_WARSAW,basis:'central_warsaw'});
 assert.equal(calls[0].searchParams.get('timeformat'),'unixtime');assert.equal(calls[0].searchParams.get('timezone'),'Europe/Warsaw');
 assert.equal(calls[1].searchParams.get('domains'),'cams_europe');
 assert.equal(data.weather.temperatureC,11.4);assert.equal(data.weather.isDay,false);assert.equal(data.weather.source.kind,'weather_model');
 assert.equal(data.weather.validAt,NOW.toISOString());assert.notDeepEqual(data.weather.grid,data.location);
 assert.equal(data.air.europeanAqi,43.5);assert.equal(data.air.pm25,18.4);assert.equal(data.air.source.kind,'air_quality_model');
 assert.equal(data.sun.date,'2026-10-17');assert.equal(data.sun.sunrise,'2026-10-17T05:00:00.000Z');assert.equal(data.complete,true);
});
test('location validation, last known basis and cache retain the requested location without mutating cached source data',async()=>{
 const calls=[],service=createEnvironmentService({fetchImpl:fixtureFetch(calls),now:()=>NOW});
 for(const input of [{latitude:NaN,longitude:21},{latitude:91,longitude:21},{latitude:52,longitude:'21'}]) await assert.rejects(service(input),/współrzędne/);
 assert.equal(calls.length,0);
 const first=await service({latitude:52.23001,longitude:21.01001});first.weather.temperatureC=100;
 const second=await service({latitude:52.23002,longitude:21.01002});
 assert.equal(calls.length,2);assert.equal(second.cached,true);assert.equal(second.location.latitude,52.23002);assert.equal(second.location.basis,'gps');assert.equal(second.weather.temperatureC,11.4);
 const fallback=await service({status:'available',freshness:'stale',latitude:52.3,longitude:21.2});assert.equal(fallback.location.basis,'gps');assert.equal(fallback.location.latitude,52.3);assert.equal(fallback.location.freshness,'stale');
});
test('independent provider failure and nulls never become fabricated current zero measurements',async()=>{
 let count=0;
 const service=createEnvironmentService({now:()=>NOW,fetchImpl:async url=>{
  count++; if(url.hostname.startsWith('air-quality'))throw new Error('internal URL/credential must not escape');
  const data=weatherFixture();data.current.temperature_2m=null;data.current.time=null;data.daily.sunset=[null];return {ok:true,json:async()=>data};
 }});
 const result=await service();assert.equal(result.weather.temperatureC,null);assert.equal(result.weather.status,'partial');assert.equal(result.weather.freshness,'unknown');
 assert.equal(result.air.status,'unavailable');assert.equal(result.air.europeanAqi,undefined);assert.equal(result.sun.sunset,null);assert.equal(result.sun.status,'partial');assert.equal(result.complete,false);
 assert.doesNotMatch(JSON.stringify(result),/credential/);await service();assert.equal(count,4,'partial errors are retried, not cached');
});
test('stale source time remains stale regardless of a fresh download; wrong units are not relabelled',async()=>{
 const service=createEnvironmentService({now:()=>NOW,fetchImpl:fixtureFetch([],data=>{data.current.time=seconds('2026-10-17T10:00:00Z');if(data.current_units.temperature_2m)data.current_units.temperature_2m='°F';else data.current_units.pm2_5='mg/m³';return data;})});
 const result=await service();assert.equal(result.weather.temperatureC,null);assert.equal(result.weather.freshness,'stale');assert.equal(result.air.freshness,'stale');assert.equal(result.air.pm25,null);assert.equal(result.fetchedAt,NOW.toISOString());assert.equal(result.complete,false);
});
test('cache expires, stays bounded, and does not reuse yesterday solar times across Warsaw midnight',async()=>{
 let clock=NOW;const calls=[],service=createEnvironmentService({fetchImpl:fixtureFetch(calls),now:()=>clock,cacheLimit:1});
 await service({latitude:52,longitude:21});await service({latitude:53,longitude:21});await service({latitude:52,longitude:21});assert.equal(calls.length,6);
 clock=new Date(NOW.getTime()+301000);await service({latitude:52,longitude:21});assert.equal(calls.length,8);
 clock=new Date('2026-10-17T21:59:00Z');const midnightCalls=[];
 // Use the fixture's current valid time so the response is cacheable just before midnight.
 const before=createEnvironmentService({fetchImpl:fixtureFetch(midnightCalls,data=>{data.current.time=clock.getTime()/1000;return data;}),now:()=>clock});
 await before();clock=new Date('2026-10-17T22:01:00Z');const next=await before();assert.equal(midnightCalls.length,4);assert.equal(next.sun.date,'2026-10-18');assert.equal(next.sun.status,'unavailable');
});
test('request timeout yields unavailable components and caller cancellation is propagated',async()=>{
 const service=createEnvironmentService({timeoutMs:10,fetchImpl:async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})),now:()=>NOW});
 const keepAlive=setTimeout(()=>{},100);try {const result=await service();assert.equal(result.weather.status,'unavailable');assert.equal(result.air.status,'unavailable');}finally{clearTimeout(keepAlive);}
 const controller=new AbortController();controller.abort();await assert.rejects(service(undefined,{signal:controller.signal}),{name:'AbortError'});
});
const browserSource=await readFile(new URL('../environment.js',import.meta.url),'utf8');
function browser(fetchImpl=()=>{throw new Error('Unexpected fetch');}){const context={window:{},document:{querySelector:()=>null},fetch:fetchImpl,AbortController,Date,Intl,URL,encodeURIComponent,setInterval,clearInterval};runInNewContext(browserSource,context);return context.window.CityEnvironment;}

test('capsule presents clear air status and concise details without presenting stale data as good',async()=>{
 const nodes=new Map();
 const doc={querySelector:id=>{if(!nodes.has(id))nodes.set(id,{dataset:{},textContent:'',title:''});return nodes.get(id);},addEventListener(){}};
 let data={location:{basis:'gps'},weather:{status:'ok',temperatureC:11,weatherCode:0,isDay:false,validAt:NOW.toISOString(),freshness:'current'},air:{status:'ok',europeanAqi:55,validAt:NOW.toISOString(),freshness:'current'},sun:{status:'ok',sunrise:'2026-10-17T05:04:00Z',sunset:'2026-10-17T15:37:00Z'}};
 let fail=false;
 const ui=browser(async()=>({ok:!fail,json:async()=>data}));
 const controller=ui.mountEnvironment(doc,{addEventListener(){}});
 try{
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(nodes.get('#environment-air-label').textContent,'Umiarkowana');
  assert.equal(nodes.get('#environment-air-value').textContent,'AQI EU 55');
  assert.equal(nodes.get('#environment-icon').dataset.tone,'night');
  assert.equal(nodes.get('#environment-sunrise').textContent,'07:04');
  assert.equal(nodes.get('#environment-sunset').textContent,'17:37');
  assert.ok(nodes.get('#environment-info').textContent.length<200);
  data={...data,air:{...data.air,europeanAqi:10,freshness:'stale'}};
  await controller.update();
  assert.equal(nodes.get('#environment-air-label').textContent,'Nieaktualne');
  assert.equal(nodes.get('#environment-air').dataset.level,'unknown');
  fail=true;await controller.update();
  assert.equal(nodes.get('#environment-air-label').textContent,'Brak danych');
  assert.equal(nodes.get('#environment-air-value').textContent,'AQI —');
  assert.equal(nodes.get('#environment-sunrise').textContent,'—');
 }finally{controller.stop();}
});
test('every documented WMO condition has a Polish label and icon, with day/night and unknown fallback',()=>{
 const ui=browser();for(const code of [0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,97,99]){assert.notEqual(ui.weatherCondition(code,true).icon,'help');assert.ok(ui.weatherCondition(code,false).label);}
 assert.notEqual(ui.weatherCondition(0,true).icon,ui.weatherCondition(0,false).icon);assert.equal(ui.weatherCondition(999,true).icon,'help');assert.equal(ui.weatherCondition('__proto__',true).icon,'help');assert.equal(ui.weatherCondition(0,null).icon,'cloud');
 assert.equal(ui.aqiCategory(0).level,'good');assert.equal(ui.aqiCategory(20).level,'good');assert.equal(ui.aqiCategory(20.1).level,'fair');assert.equal(ui.aqiCategory(101).level,'extreme');assert.equal(ui.aqiCategory(null).level,'unknown');
});
test('browser starts on Warsaw, follows location events, discards older requests and clears old measurements on failure',async()=>{
 const ui=browser(),requests=[],renders=[];let timer,cleared=false;
 const controller=ui.createEnvironmentController({render:state=>renders.push(state),now:()=>NOW.getTime(),fetchImpl:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve})),setTimer:callback=>{timer=callback;return 1;},clearTimer:()=>{cleared=true;}});
 const first=controller.update();assert.equal(requests[0].url,'/api/environment');
 const second=controller.update({status:'available',latitude:52.3,longitude:21.1,observedAt:NOW.toISOString()});assert.ok(requests[1].url.includes('latitude=52.3'));assert.equal(requests[0].options.signal.aborted,true);
 requests[1].resolve({ok:true,json:async()=>({location:{basis:'gps'}})});await second;
 requests[0].resolve({ok:true,json:async()=>({location:{basis:'central_warsaw'}})});await first;
 assert.equal(renders.filter(x=>x.status==='ready').length,1);assert.equal(renders.at(-1).data.location.basis,'gps');
 const fail=controller.update({status:'unavailable',reason:'denied'});assert.equal(renders.at(-1).status,'loading');assert.equal(requests[2].url,'/api/environment');requests[2].resolve({ok:false});await fail;assert.equal(renders.at(-1).status,'error');assert.equal(renders.at(-1).basis,'central_warsaw');
 timer();assert.equal(requests[3].url,'/api/environment');controller.stop();requests[3].resolve({ok:true,json:async()=>({})});await new Promise(resolve=>setImmediate(resolve));assert.equal(cleared,true);assert.equal(renders.at(-1).status,'loading');
});

test('browser keeps old or undated GPS as the last known weather area',async()=>{
 const ui=browser(),urls=[];const controller=ui.createEnvironmentController({now:()=>NOW.getTime(),render:()=>{},setTimer:()=>0,clearTimer:()=>{},fetchImpl:async url=>{urls.push(url);return {ok:true,json:async()=>({})};}});
 await controller.update({status:'available',latitude:52.3,longitude:21.1,observedAt:'2026-10-17T15:54:00Z'});
 await controller.update({status:'available',latitude:52.3,longitude:21.1});assert.deepEqual(urls,['/api/environment?latitude=52.3&longitude=21.1','/api/environment?latitude=52.3&longitude=21.1']);controller.stop();
});
