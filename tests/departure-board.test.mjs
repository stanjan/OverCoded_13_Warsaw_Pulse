import test from 'node:test';
import assert from 'node:assert/strict';
import {boardRequest,departureBoard} from '../server/departure-board.mjs';
import {createTransitService} from '../server/transit.mjs';
import {boardingStages,nearestBoarding,boardTiming,departureDirection,boardVehicle,mountDepartureBoard} from '../departure-board.mjs';

const now=Date.parse('2026-10-18T12:00:00Z');
const stops=[{id:'A',name:'Start',platform:'01',latitude:52.2,longitude:21},{id:'A2',name:'Start',platform:'02',latitude:52.2001,longitude:21},{id:'B',name:'Przesiadka',platform:'03',latitude:52.21,longitude:21},{id:'C',name:'Cel',latitude:52.22,longitude:21}];
const event=(stopId,minutes,extra={})=>({stopId,arrival:now+minutes*60000,departure:now+minutes*60000,pickup:0,dropOff:0,...extra});
const trip=(id,line,events,extra={})=>({id:id+'@2026-10-18',line,headsign:'Centrum',routeType:3,serviceDate:'2026-10-18',stopTimes:events,...extra});
const graph=trips=>({timeZone:'Europe/Warsaw',serviceDay:'2026-10-18',stops,trips,source:{url:'https://gtfs.ztm.waw.pl/gtfs.zip',version:'1',validFrom:'2026-10-01',validTo:'2026-10-31'}});
const request=()=>boardRequest({fromStopId:'A',toStopId:'C'},now);
test('board includes all compatible lines and dated occurrences, excludes wrong platform, direction, branches and pickup/dropoff restrictions',()=>{
 const g=graph([trip('one','17',[event('A',1),event('C',4)]),trip('two','33',[event('A',2),event('B',3),event('C',7)]),trip('reverse','17',[event('C',1),event('A',4)]),trip('platform','17',[event('A2',2),event('C',5)]),trip('branch','17',[event('A',2),event('B',5)]),trip('nopick','4',[event('A',2,{pickup:1}),event('C',5)]),trip('nodrop','4',[event('A',2),event('C',5,{dropOff:1})]),trip('undated','4',[event('A',2),event('C',5)],{serviceDate:null})]);
 const result=departureBoard([g],request(),{now});assert.deepEqual(result.departures.map(row=>row.line),['17','33']);assert.equal(result.stop.platform,'01');assert.equal(result.departures[0].tripId,'one@2026-10-18');assert.equal(result.departures[0].timing,'scheduled');
 assert.throws(()=>departureBoard([g],{...request(),fromStopId:'missing'},{now}),{code:'STOP_NOT_FOUND'});
});
test('live estimates require exact fresh downstream confidence, clamp early departures and reorder after correction',()=>{
 const trips=['delayed','earlier','negative','expired','upstream','wrong'].map((id,i)=>trip(id,String(i),[event('B',-2),event('A',i+1),event('C',12)]));
 const base={deltaMs:6*60000,observedAt:now,confidence:'brigade_route_progress',stopIndex:0};
 const deltas=new Map(trips.map(t=>[t.id,{...base}]));deltas.get(trips[1].id).deltaMs=0;deltas.get(trips[2].id).deltaMs=-60000;deltas.get(trips[3].id).observedAt=now-180001;deltas.get(trips[4].id).stopIndex=1;deltas.get(trips[5].id).confidence='candidate';
 const result=departureBoard([graph(trips)],request(),{now,deltas});assert.deepEqual(result.departures.map(row=>row.line),['1','2','3','4','5','0']);
 const negative=result.departures.find(row=>row.line==='2');assert.equal(negative.departure,negative.scheduledDeparture);assert.equal(negative.deltaMs,-60000);
 assert.ok(result.departures.filter(row=>['3','4','5'].includes(row.line)).every(row=>row.timing==='scheduled'&&row.deltaMs===null));
 assert.equal(result.departures.at(-1).liveUntil,now+180000);
});
test('loop visits are separate boarding opportunities with downstream dropoff and board bounds are explicit',()=>{
 const g=graph([trip('loop','1',[event('A',1),event('C',2),event('A',3),event('C',4)]),...Array.from({length:30},(_,i)=>trip('extra'+i,'2',[event('A',5+i),event('C',50+i)])),trip('late','1',[event('A',121),event('C',125)])]);
 const result=departureBoard([g,g],request(),{now});assert.equal(result.total,32);assert.equal(result.provided,24);assert.equal(result.limited,true);assert.deepEqual(result.departures.slice(0,2).map(row=>row.fromStopIndex),[0,2]);assert.equal(result.windowEnd-now,7200000);
});
test('board retains GTFS service dates across midnight and uses only the chosen future date',async()=>{
 const midnight=Date.parse('2026-10-18T21:59:00Z'),g=graph([trip('overnight','N1',[{...event('A',1),departure:midnight+120000},{...event('C',5),arrival:midnight+500000}])]);
 const result=departureBoard([g],boardRequest({fromStopId:'A',toStopId:'C'},midnight),{now:midnight});assert.equal(result.departures[0].serviceDate,'2026-10-18');
 let calls=0,attached=0;const model={getDeltas:()=>new Map(),attachGraph(){attached++;}},future=now+86400000;
 const service=createTransitService({now:()=>now,delayModel:model,graphProvider:async date=>{calls++;assert.equal(date,future);return graph([trip('future','1',[event('A',1441),event('C',1445)],{serviceDate:'2026-10-19'})]);}});
 const input={fromStopId:'A',toStopId:'C',departureTime:new Date(future).toISOString()};assert.equal((await service.board(input)).departures.length,1);await service.board(input);assert.equal(calls,1);assert.equal(attached,0);
 const controller=new AbortController();controller.abort();await assert.rejects(()=>service.board(input,{signal:controller.signal}),{name:'AbortError'});
 await assert.rejects(()=>createTransitService({now:()=>now,graphProvider:async()=>null}).board({fromStopId:'A',toStopId:'C'}),{code:'GTFS_UNAVAILABLE'});
 for(const input of [null,[],{}, {fromStopId:'A',toStopId:'C',departureTime:'bad'},{fromStopId:'a'.repeat(151),toStopId:'C'}])assert.throws(()=>boardRequest(input,now));
});

function element(tag='div'){
 return{tag,children:[],style:{setProperty(){}},dataset:{},hidden:false,listeners:{},attributes:{},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=[...children];},setAttribute(key,value){this.attributes[key]=value;},addEventListener(type,fn){this.listeners[type]=fn;},getBoundingClientRect:()=>({top:0,bottom:800}),click(){this.listeners.click?.();}};
}
const stage=(from,to,lat,start=now)=>({mode:'TRANSIT',fromStopId:from,toStopId:to,from:'Przystanek '+from,to:'Przystanek '+to,scheduledStart:start,stopPositions:[{id:from,latitude:lat,longitude:21,platform:'01'}]});
const journey={departure:now,steps:[{mode:'WALK'},stage('A','B',52.2),{mode:'WALK'},stage('B','C',52.21,now+600000)]};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function ui(fetchImpl,extraHost={}){
 const container=element(),timers=new Map();let serial=0,clock=now;
 const doc={getElementById:id=>id==='map-canvas-container'?container:null,createElement:element};
 const board=mountDepartureBoard({doc,host:{getCityLocation:()=>({status:'available',latitude:52.21,longitude:21,observedAt:null,accuracy:10000}),...extraHost},fetchImpl,now:()=>clock,setIntervalImpl:(fn,delay)=>{timers.set(++serial,{fn,delay});return serial;},clearIntervalImpl:id=>timers.delete(id)});
 return{board,doc,panel:container.children[0],timers,advance(value){clock+=value;},body:()=>container.children[0].children[2].children[0].children[1]};
}
const response=(from='B',rows=[])=>({ok:true,json:async()=>({stop:{id:from,name:'Przystanek '+from,platform:'01'},departures:rows,windowEnd:now+7200000})});
test('nearest boarding uses known coordinates regardless of location age, and skips walking/intermediate stops',()=>{
 const stages=boardingStages(journey);assert.equal(stages.length,2);assert.equal(nearestBoarding(stages,{status:'available',latitude:52.21,longitude:21,observedAt:'2000-01-01',accuracy:99999}),1);assert.equal(nearestBoarding(stages,{status:'unavailable'}),0);
});
test('panel follows nearest boarding until manual navigation and refreshes only that stage',async()=>{
 const requests=[];const f=ui(async(_url,options)=>{const input=JSON.parse(options.body);requests.push(input);return response(input.fromStopId);});f.board.show(journey);await tick();assert.equal(f.board.getState().selected,1);assert.equal(requests[0].fromStopId,'B');assert.equal(requests[0].departureTime,undefined,'a nearby transfer board shows upcoming services now, not only after the original selected vehicle');
 f.panel.children[0].children[1].children[0].click();await tick();assert.equal(f.board.getState().selected,0);assert.equal(f.board.getState().manual,true);f.board.location({status:'available',latitude:52.21,longitude:21});await f.board.refresh();assert.equal(requests.at(-1).fromStopId,'A');assert.equal(requests.at(-1).departureTime,undefined);
 f.board.show(journey);assert.equal(f.board.getState().selected,0);f.board.hide();assert.equal(f.timers.size,0);assert.equal(f.panel.hidden,true);
 f.board.show({steps:[{mode:'WALK'}]});assert.equal(f.panel.hidden,true);
 f.board.show({...journey,departure:now+86400000,steps:[stage('A','B',52.2,now+86400000)]});await tick();assert.equal(requests.at(-1).departureTime,new Date(now+86400000).toISOString());f.board.hide();
});
test('old responses and errors cannot restore hidden or newer boards; failures/expiry remove GPS estimates',async()=>{
 const pending=[];const f=ui((_url,options)=>new Promise((resolve,reject)=>pending.push({resolve,reject,signal:options.signal})));f.board.show(journey);f.panel.children[0].children[1].children[0].click();assert.equal(pending[0].signal.aborted,true);
 pending[1].resolve(response('A',[{line:'17',headsign:'Cel',scheduledDeparture:now+600000,departure:now+660000,timing:'live_model_estimate',deltaMs:60000,observedAt:now,liveUntil:now+180000}]));await tick();assert.equal(f.body().children[0].children[2].children[0].dataset.tone,'on-time');
 pending[0].reject(new Error('old'));await tick();assert.equal(f.body().children[0].children[2].children[0].dataset.tone,'on-time');
 assert.equal(f.body().children[0].children[2].children[0].textContent,'11 min');assert.equal(f.body().children[0].children[2].children[0].children.length,1);
 const refresh=f.board.refresh();pending[2].reject(new Error('offline'));await refresh;assert.equal(f.body().children[0].children[2].children[0].dataset.tone,'scheduled');assert.equal(f.body().children[0].children[2].children[0].textContent,'10 min');assert.equal(f.body().children[0].children[2].children[0].children.length,0);
 assert.equal(boardTiming({timing:'live_model_estimate',liveUntil:now+180000,observedAt:now,departure:now+660000,scheduledDeparture:now+600000},now+180001).live,false);
 const late=f.board.refresh();f.board.hide();pending[3].resolve(response('A'));await late;assert.equal(f.panel.hidden,true);
});
test('compact board uses relative times below thirty minutes, clock thereafter and inclusive two-minute live tolerance',async()=>{
 const base={line:'116',headsign:'116 -> Wilanów',timing:'live_model_estimate',observedAt:now,liveUntil:now+180000};
 for(const [deltaMs,tone]of [[-120001,'early'],[-120000,'on-time'],[120000,'on-time'],[120001,'late']])assert.equal(boardTiming({...base,deltaMs},now).tone,tone);
 const rows=[{...base,deltaMs:-120001,departure:now+29*60000,scheduledDeparture:now+31*60000},{...base,deltaMs:120001,departure:now+30*60000,scheduledDeparture:now+28*60000},{line:'503',headsign:'503 → Natolin Płn.',timing:'scheduled',scheduledDeparture:now+31*60000}];
 const f=ui(async()=>response('B',rows));f.board.show(journey);await tick();
 assert.deepEqual(f.body().children.map(row=>row.children[2].children[0].textContent),['29 min','14:30','14:31']);
 assert.deepEqual(f.body().children.map(row=>row.children[2].children[0].dataset.tone),['early','late','scheduled']);
 assert.equal(f.body().children[0].children[1].children[0].textContent,'Wilanów');assert.equal(departureDirection(rows[2]),'Natolin Płn.');assert.equal(departureDirection({line:'116',headsign:'Os. Kabaty'}),'Os. Kabaty');
 assert.equal(f.panel.children[0].children[0].children[1].textContent,'01');assert.equal(f.panel.children[1].hidden,true);f.board.hide();
});
test('board hides rather than covering weather or attribution when a small viewport has no map space',()=>{
 const container=element();container.getBoundingClientRect=()=>({top:0,bottom:360});
 const weather=element();weather.getBoundingClientRect=()=>({top:10,bottom:180});
 const sheet=element();sheet.getBoundingClientRect=()=>({top:260,bottom:360});
 const doc={createElement:element,getElementById:id=>({'map-canvas-container':container,'environment-bar':weather,'ai-sheet':sheet}[id])};
 const board=mountDepartureBoard({doc,host:{},now:()=>now,fetchImpl:async()=>response('A'),setIntervalImpl:()=>1,clearIntervalImpl(){}});board.show(journey);assert.equal(container.children[0].dataset.noRoom,'true');board.hide();
});

const liveBoardRow=()=>({tripId:'exact@2026-10-18',fromStopIndex:1,line:'17',headsign:'17 -> Cel',scheduledDeparture:now+600000,departure:now+660000,timing:'live_model_estimate',deltaMs:60000,observedAt:now,liveUntil:now+180000,vehicle:{id:'2:123',line:'17',latitude:52.205,longitude:21,observedAt:new Date(now).toISOString(),freshness:'recent',directionSource:'confirmed_gtfs_trip',directionTripId:'exact@2026-10-18'}});
test('board returns only a unique fresh vehicle bound to the exact live trip and model vehicle ID',()=>{
 const t=trip('exact','17',[event('B',-3),event('A',10),event('C',15)]),g=graph([t]),row=liveBoardRow(),vehicle=row.vehicle;
 const delta={tripId:t.id,vehicleId:vehicle.id,confidence:'brigade_route_progress',deltaMs:60000,observedAt:now,stopIndex:0};
 const get=(vehicles,change={})=>departureBoard([g],request(),{now,vehicles,deltas:new Map([[t.id,{...delta,...change}]])}).departures[0];
 assert.equal(get([vehicle]).vehicle.id,vehicle.id);
 for(const vehicles of [[{...vehicle,id:'wrong'}],[{...vehicle,line:'22'}],[{...vehicle,directionTripId:'other'}],[{...vehicle,directionSource:null}],[{...vehicle,observedAt:new Date(now-90001).toISOString()}],[{...vehicle,observedAt:new Date(now+60001).toISOString()}],[{...vehicle,latitude:91}],[vehicle,{...vehicle,id:'2:999'}]])assert.equal(get(vehicles).vehicle,null);
 assert.equal(get([vehicle],{observedAt:now-180001}).vehicle,null);assert.equal(get([vehicle],{stopIndex:1}).vehicle,null);
});
test('board selection highlights the initial stop without focus, arrow focuses next stop, and rows stay stable on countdowns',async()=>{
 const calls=[],map={setBoardStop:(...args)=>calls.push(['stop',...args]),setBoardVehicle:(...args)=>calls.push(['vehicle',...args])},row=liveBoardRow();
 const f=ui(async(_url,options)=>response(JSON.parse(options.body).fromStopId,[row]),{getCityMap:()=>map});f.board.show(journey);await tick();
 const first=calls.filter(call=>call[0]==='stop'&&call[1]).at(-1);assert.equal(first[1].id,'B');assert.equal(first[2].focus,false);
 const tr=f.body().children[0],button=tr.children[1].children[0];assert.equal(button.disabled,false);button.click();assert.equal(calls.filter(call=>call[0]==='vehicle'&&call[2]?.focus).length,1);assert.equal(tr.dataset.selected,'true');
 [...f.timers.values()].find(item=>item.delay===1000).fn();assert.equal(f.body().children[0],tr);assert.equal(f.body().children[0].children[1].children[0],button);assert.equal(calls.filter(call=>call[0]==='vehicle'&&call[2]?.focus).length,1,'countdowns never steal camera focus');
 await f.board.refresh();assert.equal(f.body().children[0],tr);assert.equal(calls.filter(call=>call[0]==='vehicle'&&call[2]?.focus).length,1,'polls do not focus again');
 f.panel.children[0].children[1].children[0].click();await tick();const last=calls.filter(call=>call[0]==='stop'&&call[1]).at(-1);assert.equal(last[1].id,'A');assert.equal(last[2].focus,true);assert.equal(calls.filter(call=>call[0]==='vehicle').at(-1)[1],null);f.board.hide();assert.equal(calls.filter(call=>call[0]==='stop').at(-1)[1],null);
});
test('selected vehicles expire and cannot be clicked again; provider replay restores valid selection without moving camera',async()=>{
 const calls=[],host={setBoardStop:(...args)=>calls.push(['stop',...args]),setBoardVehicle:(...args)=>calls.push(['vehicle',...args])};let active=host,offline=false;
 const row=liveBoardRow(),f=ui(async()=>{if(offline)throw Error('offline');return response('B',[row]);},{getCityMap:()=>active});f.board.show(journey);await tick();let tr=f.body().children[0];tr.click();
 const replaced=[];active={setBoardStop:(...args)=>replaced.push(['stop',...args]),setBoardVehicle:(...args)=>replaced.push(['vehicle',...args])};f.board.show(journey);assert.equal(replaced.find(call=>call[0]==='vehicle')[2].focus,false);assert.equal(replaced.find(call=>call[0]==='stop')[2].focus,false);
 f.advance(90001);[...f.timers.values()].find(item=>item.delay===1000).fn();assert.equal(tr.children[1].children[0].disabled,true);assert.equal(replaced.filter(call=>call[0]==='vehicle').at(-1)[1],null);const count=replaced.length;tr.click();assert.equal(replaced.length,count);
 assert.equal(boardVehicle({...row,vehicle:{...row.vehicle,directionTripId:'other'}},now),null);
 f.board.hide();f.board.show(journey);await tick();f.advance(-90001);await f.board.refresh();f.body().children[0].click();offline=true;await f.board.refresh();assert.equal(replaced.filter(call=>call[0]==='vehicle').at(-1)[1],null);assert.equal(f.body().children[0].children[1].children[0].disabled,true);f.board.hide();
});

test('a polling reorder preserves the active row control and scrolled board position',async()=>{
 const a=liveBoardRow(),b={...liveBoardRow(),tripId:'second',scheduledDeparture:now+900000,departure:now+960000,vehicle:{...liveBoardRow().vehicle,id:'2:999',directionTripId:'second'}};let rows=[a,b];
 const f=ui(async()=>response('B',rows));f.board.show(journey);await tick();const control=f.body().children[1].children[1].children[0],scroll=f.panel.children[2];let focus;
 control.focus=options=>focus=options;f.doc.activeElement=control;scroll.scrollTop=40;rows=[{...a,departure:now+1200000},b];await f.board.refresh();assert.equal(f.body().children[0].children[1].children[0],control);assert.deepEqual(focus,{preventScroll:true});assert.equal(scroll.scrollTop,40);f.board.hide();
});
