import test from 'node:test';
import assert from 'node:assert/strict';
import {mountTransit,routeChain,timingLabel,compactTime,departureLabel} from '../transit-ui.mjs';
import {TransitError} from '../transit-core.mjs';
function element(tag='div') {
 const node={tag,children:[],listeners:{},attributes:{},dataset:{},style:{},hidden:false,value:'',textContent:'',
 append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},
 setAttribute(k,v){this.attributes[k]=v;},getAttribute(k){return this.attributes[k]||null;},cloneNode(){const copy=element(this.tag);copy.id=this.id;copy.attributes={...this.attributes};copy.dataset={...this.dataset};copy.hidden=this.hidden;copy.children=this.children.map(child=>child.cloneNode(true));return copy;},removeAttribute(k){delete this.attributes[k];},addEventListener(k,v){this.listeners[k]=v;},focus(){this.focused=true;},click(){return this.listeners.click?.({});},
 querySelectorAll(selector){return this.children.flatMap(child=>[...((selector==='*'||selector===child.tag||(selector==='[id]'&&child.id))?[child]:[]),...child.querySelectorAll(selector)]);}};
 Object.defineProperty(node,'innerHTML',{set(){throw new Error('Untrusted route data must be text nodes');}});return node;
}
function fixture({vendor='google',compute,fetchImpl,withBoard=false}={}) {
 const ids=Object.fromEntries(['panel','origin','destination','time','status','alternatives','itinerary','external','search','cancel','clear','form','gps','close','origin-note','observations','origin-options','destination-options','editor','details','mode','attribution'].map(id=>['transit-'+id,element(id==='origin'||id==='destination'?'input':'div')]));
 for(const [id,node]of Object.entries(ids))node.id=id;ids['transit-panel'].append(...Object.entries(ids).filter(([id])=>id!=='transit-panel').map(([,node])=>node));
 for(const id of ['chat-messages','welcome-prompts','environment-bar','environment-route','environment-eta','environment-route-refresh'])ids[id]=element();
 if(withBoard)ids['map-canvas-container']=element();
 const shell=element(),nav=['city-pulse','transit-live'].map(path=>{const e=element('a');e.dataset.path=path;return e;});
 const events={},calls=[];const map={vendor,clearRoute(){calls.push(['clear']);},showRoute(raw){calls.push(['route',raw]);return true;},showVehicles(vehicles){calls.push(['vehicles',vehicles]);},fitTo(){}};
 const doc={getElementById:id=>ids[id],querySelector:()=>shell,querySelectorAll:()=>nav,createElement:element,createElementNS:(_ns,tag)=>element(tag)};
 const host={getCityMap:()=>map,getCityLocation:()=>({status:'unavailable'}),expandCitySheet(){calls.push(['expand']);},addEventListener:(key,handler)=>events[key]=handler};
 const panel=mountTransit({doc,host,compute,fetchImpl});
 return {ids,shell,nav,events,calls,map,panel,host};
}
const route=id=>({id,origin:'Start <script>',destination:'Cel',durationMillis:1200000,departure:Date.parse('2026-10-17T12:00Z'),arrival:Date.parse('2026-10-17T12:20Z'),transfers:0,steps:[{mode:'TRANSIT',line:'17',from:'Dw. Centralny',to:'Anielewicza',headsign:'Nowodwory',start:Date.parse('2026-10-17T12:02Z'),end:Date.parse('2026-10-17T12:18Z'),stops:5,path:[{latitude:52.2,longitude:21},{latitude:52.25,longitude:21.02}],geometry:'gtfs_shape'}],warnings:['Sprawdź komunikat']});
const result=routes=>({routes,origin:{latitude:52.2,longitude:21},destination:{latitude:52.25,longitude:21.02},stops:[],departures:[],vehicles:[],sources:[],errors:[]});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('selected transit alone opens the map board; a new query, reset, close and walking selection remove it',async()=>{
 const transit={...route('board'),steps:[{...route('board').steps[0],fromStopId:'A',toStopId:'B'}]},walk={...route('walk'),steps:[{mode:'WALK',start:0,end:60000}]};
 let resolveBoard;const f=fixture({withBoard:true,compute:async()=>result([transit,walk]),fetchImpl:()=>new Promise(resolve=>resolveBoard=resolve)});
 f.panel.open({origin:'A',destination:'B'});await tick();const board=f.ids['map-canvas-container'].children[0];assert.equal(board.hidden,true);
 f.ids['transit-alternatives'].children[0].click();assert.equal(board.hidden,false);
 f.ids['transit-alternatives'].children[1].click();assert.equal(board.hidden,true);
 f.ids['transit-alternatives'].children[0].click();f.events['city:query']();assert.equal(board.hidden,true);
 resolveBoard({ok:true,json:async()=>({stop:{id:'A'},departures:[],windowEnd:Date.now()+7200000})});await tick();assert.equal(board.hidden,true);
 await f.panel.search();f.ids['transit-alternatives'].children[0].click();f.panel.reset();assert.equal(board.hidden,true);
 await f.panel.search();f.ids['transit-alternatives'].children[0].click();f.ids['transit-close'].click();assert.equal(board.hidden,true);
});

test('later connections show dated departure and separate waiting on cards and the selected ETA bar',async()=>{
 const future={...route('future'),nextAvailable:true,departure:Date.parse('2026-10-23T06:57:00Z'),firstBoarding:Date.parse('2026-10-23T07:00:00Z'),arrival:Date.parse('2026-10-23T07:20:00Z'),durationMillis:23*60000,waitingMillis:86400000};const f=fixture({compute:async()=>result([future])});
 f.panel.open({origin:'A',destination:'B'});await tick();const button=f.ids['transit-alternatives'].children[0],text=button.children.map(node=>node.textContent).join(' ');assert.match(text,/Najbliższe późniejsze/);assert.match(text,/23 min/);assert.match(text,/Wyjście 23 paź/);assert.match(text,/odjazd 23 paź/);assert.match(text,/Oczekiwanie przed wyjściem: 24 godz/);assert.match(departureLabel(future),/23 paź/);
 button.click();const eta=f.ids['environment-eta'];assert.equal(eta.children.length,2);assert.match(eta.children[0].textContent,/23 paź/);assert.match(eta.children[1].textContent,/Wyjście 23 paź/);assert.match(eta.attributes['aria-label'],/odjazd 23 paź/);f.panel.close?.();f.events['city:query']();
});

test('a new conversation question hides previous transport data and clears its selected map and bar',async()=>{
 const f=fixture({compute:async()=>result([route('old')])});
 f.events['city:query']();
 f.panel.open({origin:'Dw. Centralny',destination:'Anielewicza'});await tick();
 f.ids['transit-alternatives'].children[0].click();assert.equal(f.ids['environment-bar'].dataset.route,'true');
 f.events['city:query']();
 assert.equal(f.ids['transit-panel'].hidden,true);assert.equal(f.panel.getState().routeCount,0);
 assert.equal(f.ids['environment-bar'].dataset.route,'false');
 assert.equal(f.ids['transit-alternatives'].children.length,0);
 assert.deepEqual(f.calls.filter(c=>c[0]==='vehicles').at(-1)[1],[]);
});

test('a late route response cannot restore previous data after a new conversation question',async()=>{
 let resolve;const f=fixture({compute:()=>new Promise(done=>resolve=done)});
 f.events['city:query']();f.panel.open({origin:'Start',destination:'Cel'});
 f.events['city:query']();resolve(result([route('late')]));await tick();
 assert.equal(f.ids['transit-panel'].hidden,true);assert.equal(f.panel.getState().routeCount,0);
 assert.equal(f.calls.filter(c=>c[0]==='route').length,0);assert.equal(f.ids['environment-bar'].dataset.route,'false');
});
test('route search hides the cancel button and removes skeletons on results or a new question',async()=>{
 const skeleton=node=>node.querySelectorAll('*').filter(child=>child.className==='transit-skeleton');
 let resolve;const f=fixture({compute:()=>new Promise(done=>resolve=done)}),alternatives=f.ids['transit-alternatives'],status=f.ids['transit-status'];
 f.ids['transit-origin'].value='Start';f.ids['transit-destination'].value='Cel';const pending=f.panel.search();
 assert.equal(f.panel.getState().status,'loading');assert.equal(status.dataset.state,'loading');assert.match(status.textContent,/Porównuję dostępne trasy/);
 assert.equal(alternatives.attributes['aria-busy'],'true');assert.equal(alternatives.children.length,1);assert.equal(alternatives.children[0].attributes['aria-hidden'],'true');assert.equal(skeleton(alternatives).length,2);assert.equal(f.ids['transit-cancel'].hidden,true);
 resolve(result([route('done')]));await pending;
 assert.equal(f.panel.getState().status,'ready');assert.equal(skeleton(alternatives).length,0);assert.equal(alternatives.attributes['aria-busy'],'false');assert.equal(status.dataset.state,'info');
 const again=f.panel.search();assert.equal(skeleton(alternatives).length,2);f.events['city:query']();
 assert.equal(f.panel.getState().status,'idle');assert.equal(skeleton(alternatives).length,0);assert.equal(alternatives.attributes['aria-busy'],'false');assert.equal(status.dataset.state,'info');assert.equal(f.ids['transit-cancel'].hidden,true);
 resolve(result([route('late')]));await again;assert.equal(f.panel.getState().status,'idle');
});
test('Transit panel opens with no invented origin and validates missing start before provider calls',async()=>{
 let count=0;const f=fixture({compute:async()=>{count++;return result([]);}});f.panel.open({destination:{latitude:52.2,longitude:21,label:'Cel'}});assert.equal(f.ids['transit-origin'].focused,true);assert.equal(f.ids['transit-destination'].value,'Cel');assert.equal(f.shell.dataset.section,undefined);assert.ok(f.ids['chat-messages'].children.includes(f.ids['transit-panel']));await f.panel.search();assert.equal(count,0);assert.match(f.ids['transit-status'].textContent,/startowy/);
});
test('coordinate actions preserve start/goal and select municipal routes with safe text and provenance',async()=>{
 let request;const f=fixture({compute:async value=>{request=value;return result([route('first'),route('second')]);}});f.panel.open({origin:{latitude:52.23,longitude:21.01,label:'Mój start'},destination:{latitude:52.249,longitude:20.993,label:'Cel'}});await tick();assert.deepEqual(request.origin.value,{lat:52.23,lng:21.01});assert.deepEqual(request.destination.value,{lat:52.249,lng:20.993});assert.equal(f.panel.getState().status,'ready');assert.equal(f.ids['transit-alternatives'].children.length,2);assert.equal(f.calls.filter(c=>c[0]==='route').length,0);f.ids['transit-alternatives'].children[0].click();assert.equal(f.calls.filter(c=>c[0]==='route').at(-1)[1].id,'first');assert.equal(f.ids['environment-bar'].dataset.route,'true');f.ids['transit-alternatives'].children[1].click();assert.equal(f.calls.filter(c=>c[0]==='route').at(-1)[1].id,'second');assert.equal(f.panel.getState().selected,1);assert.ok(f.ids['transit-itinerary'].children.some(child=>child.textContent==='Start <script> → Cel'));f.ids['transit-destination'].listeners.input();assert.equal(f.panel.getState().routeCount,0);assert.equal(f.ids['transit-itinerary'].children.length,0);
});
test('municipal routes replay on replacement Leaflet map, including responses that arrive after replacement',async()=>{
 let resolve;const f=fixture({compute:()=>new Promise(done=>resolve=done)});f.ids['transit-origin'].value='Start';f.ids['transit-destination'].value='Cel';const pending=f.panel.search();f.map.vendor='leaflet';f.events['city:map']({detail:{vendor:'leaflet'}});resolve(result([route('current')]));await pending;f.ids['transit-alternatives'].children[0].click();assert.equal(f.panel.getState().routeCount,1);assert.equal(f.calls.filter(c=>c[0]==='route').at(-1)[1].id,'current');const before=f.calls.filter(c=>c[0]==='route').length;f.events['city:map']({detail:{vendor:'leaflet'}});assert.equal(f.calls.filter(c=>c[0]==='route').length,before+1);
});
test('missing graph and municipal errors do not fabricate ETA; cancellation and Pulse clear results',async()=>{
 const f=fixture({compute:async()=>({...result([]),reason:'GRAPH_UNAVAILABLE'})});f.ids['transit-origin'].value='Start';f.ids['transit-destination'].value='Cel';await f.panel.search();assert.equal(f.panel.getState().status,'limited');assert.match(f.ids['transit-status'].textContent,/bez ETA/);assert.equal(f.ids['transit-alternatives'].children.length,0);f.ids['transit-cancel'].click();assert.equal(f.panel.getState().status,'cancelled');f.events['city:pulse']();assert.equal(f.ids['transit-panel'].hidden,true);assert.equal(f.ids['environment-bar'].dataset.route,'false');
});

test('successful empty live snapshots replace old vehicle markers, and refresh outages clear current observations without removing route',async()=>{
 let mode='empty';const vehicle={latitude:52.2,longitude:21,line:'17',freshness:'recent',observedAt:new Date().toISOString()};const f=fixture({compute:async()=>({...result([route('current')]),vehicles:[vehicle],vehicleCount:1,vehicleProvided:1}),fetchImpl:async()=>{if(mode==='outage')throw new Error('offline');return{ok:true,json:async()=>({vehicles:mode==='nonempty'?[vehicle]:[],vehicleCount:mode==='nonempty'?1:0,vehicleProvided:mode==='nonempty'?1:0,liveModel:{trackedVehicles:1,confirmedTrips:0}})};}});
 f.ids['transit-origin'].value='Start';f.ids['transit-destination'].value='Cel';await f.panel.search();f.ids['transit-alternatives'].children[0].click();assert.equal(f.calls.filter(c=>c[0]==='vehicles').at(-1)[1].length,1);await f.panel.refreshLive();assert.deepEqual(f.calls.filter(c=>c[0]==='vehicles').at(-1)[1],[]);assert.equal(f.panel.getState().routeCount,1);
 mode='nonempty';await f.panel.refreshLive();assert.equal(f.calls.filter(c=>c[0]==='vehicles').at(-1)[1].length,1);mode='outage';await f.panel.refreshLive();assert.deepEqual(f.calls.filter(c=>c[0]==='vehicles').at(-1)[1],[]);assert.ok(f.ids['transit-observations'].children.some(node=>node.textContent.includes('Wcześniejsze znaczniki zostały ukryte')));assert.equal(f.panel.getState().routeCount,1);
});
test('a late failed refresh cannot clear a newer successful current vehicle snapshot',async()=>{
 const jobs=[];const f=fixture({compute:async()=>result([route('current')]),fetchImpl:()=>new Promise((resolve,reject)=>jobs.push({resolve,reject}))});f.ids['transit-origin'].value='Start';f.ids['transit-destination'].value='Cel';await f.panel.search();f.ids['transit-alternatives'].children[0].click();const first=f.panel.refreshLive(),second=f.panel.refreshLive();jobs[1].resolve({ok:true,json:async()=>({vehicles:[{line:'17',freshness:'recent',observedAt:new Date().toISOString()},{line:'unrelated',freshness:'recent',observedAt:new Date().toISOString()}],vehicleCount:1,vehicleProvided:1})});await second;jobs[0].reject(new Error('old request failed'));await first;assert.equal(f.calls.filter(c=>c[0]==='vehicles').at(-1)[1][0].line,'17');
});

test('expired and unconfirmed vehicle positions disappear before a hanging refresh without removing the selected route',async()=>{
 const originalNow=Date.now;let now=originalNow(),finish;
 Date.now=()=>now;
 try{
  const fresh={line:'17',freshness:'recent',observedAt:new Date(now).toISOString()},old={...fresh,freshness:'stale'},unknown={...fresh,freshness:'unknown'},unrelated={...fresh,line:'unrelated'};
  const f=fixture({compute:async()=>({...result([route('current')]),vehicles:[fresh,old,unknown,unrelated],vehicleProvided:4,vehicleCount:4}),fetchImpl:()=>new Promise(resolve=>finish=resolve)});
  f.ids['transit-origin'].value='Start';f.ids['transit-destination'].value='Cel';await f.panel.search();f.ids['transit-alternatives'].children[0].click();
  assert.deepEqual(f.calls.filter(call=>call[0]==='vehicles').at(-1)[1],[fresh]);
  assert.ok(f.ids['transit-observations'].children.some(node=>node.textContent.includes('Pomiary nieaktualne lub bez potwierdzonego czasu są ukryte')));
  now+=90001;const pending=f.panel.refreshLive();
  assert.deepEqual(f.calls.filter(call=>call[0]==='vehicles').at(-1)[1],[]);assert.equal(f.panel.getState().routeCount,1);assert.equal(f.ids['environment-bar'].dataset.route,'true');
  finish({ok:true,json:async()=>({vehicles:[fresh],vehicleProvided:1,vehicleCount:1})});await pending;
  assert.deepEqual(f.calls.filter(call=>call[0]==='vehicles').at(-1)[1],[]);
 }finally{Date.now=originalNow;}
});

test('route-bar refresh recomputes the journey once, clears old ETA while pending and selects the new plan',async()=>{
 const requests=[];let finish;const f=fixture({compute:async request=>{requests.push(request);return requests.length===1?result([route('old')]):new Promise(resolve=>finish=resolve);}});
 const start={latitude:52.23,longitude:21.01,label:'Mój start'},goal={latitude:52.25,longitude:21.02,label:'Cel'};
 f.panel.open({origin:start,destination:goal});await tick();f.ids['transit-alternatives'].children[0].click();
 const refresh=f.ids['environment-route-refresh'];assert.equal(refresh.hidden,false);assert.equal(f.ids['environment-eta'].children.length,1);assert.match(f.ids['environment-eta'].attributes['aria-label'],/wg rozkładu/);
 let prevented=0,stopped=0;refresh.listeners.click({preventDefault(){prevented++;},stopPropagation(){stopped++;}});
 assert.equal(prevented,1);assert.equal(stopped,1);assert.equal(refresh.disabled,true);assert.equal(refresh.attributes['aria-busy'],'true');assert.equal(f.ids['environment-eta'].children[0].textContent,'Odświeżam…');
 await f.panel.refreshRoute();assert.equal(requests.length,2);assert.deepEqual(requests[1].origin.value,{lat:52.23,lng:21.01});assert.deepEqual(requests[1].destination.value,{lat:52.25,lng:21.02});assert.ok(Math.abs(requests[1].departureTime.getTime()-Date.now())<1000);
 finish(result([route('new')]));await tick();assert.equal(refresh.disabled,false);assert.equal(refresh.attributes['aria-busy'],'false');assert.equal(f.panel.getState().selected,0);assert.equal(f.calls.filter(call=>call[0]==='route').at(-1)[1].id,'new');assert.match(f.ids['environment-eta'].children[0].textContent,/^ok\./);
});

test('route-bar refresh preserves a future departure and removes old ETA after failure',async()=>{
 const originalNow=Date.now;Date.now=()=>Date.parse('2026-10-17T12:00:00Z');
 try{
  let request,count=0;const f=fixture({compute:async next=>{request=next;if(++count>1)throw new Error('offline');return result([route('old')]);}});
  f.ids['transit-origin'].value='Start';f.ids['transit-destination'].value='Cel';f.ids['transit-time'].value='2026-10-17T16:00';await f.panel.search();f.ids['transit-alternatives'].children[0].click();await f.panel.refreshRoute();
  assert.equal(request.departureTime.toISOString(),'2026-10-17T14:00:00.000Z');assert.equal(f.panel.getState().status,'error');assert.equal(f.ids['environment-bar'].dataset.route,'false');assert.equal(f.ids['environment-eta'].hidden,true);assert.equal(f.ids['environment-route-refresh'].hidden,true);assert.equal(f.ids['environment-route-refresh'].disabled,false);assert.match(f.ids['transit-status'].textContent,/Nie udało się/);
 }finally{Date.now=originalNow;}
});

test('each answer retains its own selectable cards; switching plans clears selection and does not revive GPS snapshots',async()=>{
 let turn=0;const f=fixture({compute:async()=>({...result([route('plan-'+(++turn))]),vehicles:[{line:'old',freshness:'recent'}]})});
 const detail={origin:{latitude:52.23,longitude:21.01,label:'Start'},destination:{latitude:52.25,longitude:21.02,label:'Cel'}};
 f.panel.open(detail);await tick();const oldCard=f.ids['transit-alternatives'].children[0];oldCard.click();assert.equal(oldCard.attributes['aria-pressed'],'true');
 f.panel.open(detail);await tick();const plans=f.ids['chat-messages'].children.filter(node=>node.dataset.transit==='panel');assert.equal(plans.length,2);
 const newAlternatives=plans[1].querySelectorAll('*').find(node=>node.dataset.transit==='alternatives'),newCard=newAlternatives.children[0];
 assert.equal(oldCard.attributes['aria-pressed'],'false');assert.equal(f.ids['environment-bar'].dataset.route,'false');newCard.click();assert.equal(f.calls.filter(call=>call[0]==='route').at(-1)[1].id,'plan-2');
 oldCard.click();assert.equal(oldCard.attributes['aria-pressed'],'true');assert.equal(newCard.attributes['aria-pressed'],'false');assert.equal(f.calls.filter(call=>call[0]==='route').at(-1)[1].id,'plan-1');assert.deepEqual(f.calls.filter(call=>call[0]==='vehicles').at(-1)[1],[]);assert.match(f.ids['environment-eta'].attributes['aria-label'],/zapisany plan/);
});

test('a superseded pending plan cannot replace the newer answer or expand its route bar',async()=>{
 const jobs=[];const f=fixture({compute:()=>new Promise(resolve=>jobs.push(resolve))});const detail={origin:{latitude:52.23,longitude:21.01},destination:{latitude:52.25,longitude:21.02}};
 f.panel.open(detail);f.panel.open(detail);jobs[1](result([route('new')]));await tick();jobs[0](result([route('late')]));await tick();assert.equal(f.panel.getState().routeCount,1);assert.equal(f.ids['transit-alternatives'].children.length,0);assert.equal(f.ids['environment-bar'].dataset.route,'false');
});

test('route summaries preserve actual transfers, combine adjacent walks, and classify ETA freshness honestly',()=>{
 const steps=[{mode:'TRANSIT',line:'12',routeType:0},{mode:'TRANSIT',line:'14',routeType:0},{mode:'WALK',start:0,end:120000},{mode:'WALK',start:120000,end:300000}];const chain=routeChain({createElement:element,createElementNS:(_ns,tag)=>element(tag)},{steps});
 const legs=chain.children.filter(child=>child.className==='route-leg');assert.equal(legs.length,3);assert.equal(legs[0].attributes['aria-label'],'Tramwaj 12');assert.equal(legs[1].attributes['aria-label'],'Tramwaj 14');assert.equal(legs[2].attributes['aria-label'],'Pieszo 5 min');
 const now=Date.now(),route={steps:[{delay:{deltaMs:120000,observedAt:now}}]};assert.equal(timingLabel({steps:[]},{now}),'wg rozkładu');assert.equal(timingLabel(route,{now}),'szacunek GPS +2 min');assert.match(timingLabel(route,{now:now+180001,computedAt:now}),/zapisany/);assert.match(timingLabel(route,{now,archived:true}),/zapisany/);
});

test('compact ETA keeps dates for another Warsaw day and includes dates across midnight',()=>{
 const now=Date.parse('2026-10-17T20:00Z');assert.equal(compactTime(Date.parse('2026-10-17T21:15Z'),now),'23:15');assert.match(compactTime(Date.parse('2026-10-17T23:15Z'),now),/18.*01:15/);
});

test('card and selected ETA age before a hanging request, after outage and after successful refresh',async()=>{
 const originalNow=Date.now;let now=originalNow(),mode='pending',reject;
 Date.now=()=>now;
 try{
  const delayed=route('live');delayed.steps[0].delay={deltaMs:120000,observedAt:now};
  const f=fixture({compute:async()=>result([delayed]),fetchImpl:()=>mode==='pending'?new Promise((_resolve,fail)=>reject=fail):Promise.resolve({ok:true,json:async()=>({vehicles:[],vehicleCount:0,vehicleProvided:0})})});
  f.ids['transit-origin'].value='Start';f.ids['transit-destination'].value='Cel';await f.panel.search();f.ids['transit-alternatives'].children[0].click();const cardLabel=f.ids['transit-alternatives'].querySelectorAll('small')[0];assert.match(cardLabel.textContent,/GPS \+2/);assert.match(f.ids['environment-eta'].attributes['aria-label'],/GPS \+2/);
  now+=180001;const refresh=f.panel.refreshLive();assert.match(cardLabel.textContent,/zapisany plan/);assert.match(f.ids['environment-eta'].attributes['aria-label'],/zapisany plan/);reject(new Error('offline'));await refresh;assert.match(f.ids['environment-eta'].attributes['aria-label'],/zapisany plan/);
  mode='success';await f.panel.refreshLive();assert.match(cardLabel.textContent,/zapisany plan/);assert.match(f.ids['environment-eta'].attributes['aria-label'],/zapisany plan/);
 }finally{Date.now=originalNow;}
});

test('walking verification failures explain the missing pedestrian path without blaming a valid ZTM schedule or retaining ETA',async()=>{
 for(const reason of ['WALK_ROUTING_UNAVAILABLE','WALK_SCHEMA','WALK_VERIFICATION_LIMIT']){
  let calls=0;const f=fixture({compute:async()=>++calls===1?result([route('old')]):({...result([]),reason,graphSource:{validFrom:'2026-10-16',validTo:'2026-10-25',url:'https://gtfs.ztm.waw.pl/last'}})});
  f.ids['transit-origin'].value='Start';f.ids['transit-destination'].value='Cel';await f.panel.search();f.ids['transit-alternatives'].children[0].click();assert.equal(f.ids['environment-bar'].dataset.route,'true');
  await f.panel.search();assert.equal(f.panel.getState().status,'limited');assert.match(f.ids['transit-status'].textContent,/przejść pieszych/);assert.match(f.ids['transit-status'].textContent,/Odśwież trasę/);assert.doesNotMatch(f.ids['transit-status'].textContent,/rozkładu ZTM/);assert.equal(f.ids['transit-alternatives'].children.length,0);assert.equal(f.ids['environment-bar'].dataset.route,'false');assert.equal(f.ids['environment-eta'].hidden,true);assert.equal(f.ids['environment-route-refresh'].hidden,true);
 }
});


test('selecting a route collapses only a panel that leaves too little map beneath the weather bar',async()=>{
 for(const visibleBottom of [203,600]){
  const f=fixture({compute:async()=>result([route('selected')])});
  f.ids['city-map']={getBoundingClientRect:()=>({top:0,bottom:700})};f.ids['ai-sheet']={getBoundingClientRect:()=>({top:visibleBottom})};f.ids['environment-bar'].getBoundingClientRect=()=>({bottom:118});
  // The host supplies the same panel affordance the visible collapse button uses.
  f.ids['transit-origin'].value='Start';f.ids['transit-destination'].value='Cel';
  f.host.collapseCitySheet=()=>f.calls.push(['collapse']);await f.panel.search();f.ids['transit-alternatives'].children[0].click();
  assert.equal(f.calls.filter(call=>call[0]==='collapse').length,visibleBottom===203?1:0);assert.equal(f.calls.filter(call=>call[0]==='route').at(-1)[1].id,'selected');
 }
});


test('an event handoff reveals its planner even when the old conversation was scrolled away',()=>{
 const frames=[],f=fixture();f.host.requestAnimationFrame=callback=>frames.push(callback);
 f.ids['transit-panel'].scrollIntoView=options=>f.calls.push(['reveal',options]);
 f.events['city:transit']({detail:{destination:{latitude:52.2259,longitude:21.0015,label:'Wydarzenie na E. Plater 31'}}});
 assert.equal(f.ids['transit-editor'].open,true);assert.match(f.ids['transit-status'].textContent,/skąd/);
 frames.splice(0).forEach(callback=>callback());
 assert.deepEqual(f.calls.filter(call=>call[0]==='reveal').at(-1)[1],{block:'start',behavior:'smooth'});
});

test('event routes use a known location without freshness or accuracy gates',async()=>{
 let request;const f=fixture({compute:async value=>{request=value;return result([route('event')]);}});
 f.host.getCityLocation=()=>({status:'available',latitude:52.23,longitude:21.01,observedAt:'2020-01-01T00:00:00Z',accuracy:5000});
 f.events['city:transit']({detail:{destination:{latitude:52.2259,longitude:21.0015,label:'Wydarzenie'}}});await tick();
 assert.deepEqual(request.origin.value,{lat:52.23,lng:21.01});assert.deepEqual(request.destination.value,{lat:52.2259,lng:21.0015});assert.equal(f.panel.getState().status,'ready');
});

test('GPS from an event planner keeps it open and resumes the destination once location arrives',async()=>{
 let finish,request,location={status:'unavailable'};const f=fixture({compute:async value=>{request=value;return result([route('event')]);}});
 f.host.getCityLocation=()=>location;f.host.requestCityLocation=()=>new Promise(resolve=>finish=value=>{location=value;resolve(value);});
 let globalClicks=0;f.ids['gps-button']={click(){globalClicks++;}};
 f.panel.open({destination:{latitude:52.2259,longitude:21.0015,label:'Wydarzenie'}});
 const when=new Date(Date.now()+3600000),chosen=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(when).replace(' ','T');f.ids['transit-time'].value=chosen;
 const pending=f.ids['transit-gps'].click();assert.equal(f.ids['transit-panel'].hidden,false);assert.match(f.ids['transit-status'].textContent,/Ustalam/);assert.equal(globalClicks,0);
 finish({status:'available',latitude:52.23,longitude:21.01});await pending;
 assert.equal(f.ids['transit-panel'].hidden,false);assert.equal(f.panel.getState().status,'ready');assert.deepEqual(request.destination.value,{lat:52.2259,lng:21.0015});
 assert.deepEqual(request.origin.value,{lat:52.23,lng:21.01});assert.equal(globalClicks,0);assert.equal(f.ids['transit-time'].value,chosen);assert.ok(Math.abs(request.departureTime.getTime()-when.getTime())<60000);
});

test('unavailable GPS leaves the event editor open with an actionable start error',async()=>{
 let computes=0;const f=fixture({compute:async()=>{computes++;return result([]);}});f.host.requestCityLocation=async()=>({status:'unavailable',reason:'denied'});
 f.panel.open({destination:{latitude:52.2259,longitude:21.0015,label:'Wydarzenie'}});await f.ids['transit-gps'].click();
 assert.equal(computes,0);assert.equal(f.ids['transit-panel'].hidden,false);assert.equal(f.ids['transit-editor'].open,true);assert.match(f.ids['transit-status'].textContent,/Podaj punkt startowy/);assert.equal(f.ids['transit-origin'].focused,true);
});

test('late GPS cannot replace a manually entered origin or revive a hidden event plan',async()=>{
 for(const action of ['manual','new-question']){
  let finish,computes=0;const f=fixture({compute:async()=>{computes++;return result([]);}});f.host.requestCityLocation=()=>new Promise(resolve=>finish=resolve);
  f.panel.open({destination:{latitude:52.2259,longitude:21.0015,label:'Wydarzenie'}});const pending=f.ids['transit-gps'].click();
  if(action==='manual'){f.ids['transit-origin'].value='Dw. Centralny';f.ids['transit-origin'].listeners.input();}else f.events['city:query']();
  finish({status:'available',latitude:52.23,longitude:21.01});await pending;
  assert.equal(computes,0);assert.equal(f.ids['transit-origin'].value,action==='manual'?'Dw. Centralny':'');assert.equal(f.ids['transit-panel'].hidden,action==='new-question');
 }
});


for(const action of ['cancel','clear'])test('explicit '+action+' discards pending event GPS without resuming route search',async()=>{
 let finish,computes=0,location={status:'unavailable'};const f=fixture({compute:async()=>{computes++;return result([]);}});
 f.host.getCityLocation=()=>location;f.host.requestCityLocation=()=>new Promise(resolve=>finish=value=>{location=value;resolve(value);});
 f.panel.open({destination:{latitude:52.2259,longitude:21.0015,label:'Wydarzenie'}});const pending=f.ids['transit-gps'].click();
 f.ids['transit-'+action].click();const expected=action==='cancel'?'cancelled':'idle';assert.equal(f.panel.getState().status,expected);
 finish({status:'available',latitude:52.23,longitude:21.01});await pending;
 assert.equal(computes,0);assert.equal(f.panel.getState().status,expected);assert.equal(f.ids['transit-origin'].value,'');assert.equal(f.ids['environment-bar'].dataset.route,'false');
});


test('pure walking option uses walking estimates, no transit claims and preserves mode on route refresh',async()=>{
 const requests=[];let liveCalls=0;const walk={...route('walk'),mode:'walk',distanceMeters:450,timing:'walking_estimate',recommendationReason:'Pieszo dotrzesz wcześniej.',steps:[{mode:'WALK',from:'Start',to:'Cel',start:Date.now(),end:Date.now()+300000,geometry:'osm_pedestrian',path:[{latitude:52.2,longitude:21},{latitude:52.202,longitude:21.003}]}]};
 const f=fixture({compute:async request=>{requests.push(request);return result([walk]);},fetchImpl:async()=>{liveCalls++;throw new Error('walking must not poll vehicles');}});
 f.panel.open({origin:'A',destination:'B',mode:'walk'});await tick();assert.equal(requests[0].mode,'walk');const card=f.ids['transit-alternatives'].children[0];const text=card.children.map(child=>child.textContent).join(' ');assert.match(text,/Polecana · pieszo/);assert.match(text,/szacowany czas marszu/);assert.doesNotMatch(text,/przesiad|wg rozkładu|GPS/);assert.equal(f.ids['transit-mode'].value,'walk');
 card.click();assert.match(f.ids['transit-attribution'].textContent,/OpenStreetMap/);assert.doesNotMatch(f.ids['transit-attribution'].textContent,/ZTM|GPS/);await f.panel.refreshLive();assert.equal(liveCalls,0);await f.panel.refreshRoute();assert.equal(requests.at(-1).mode,'walk');assert.equal(f.calls.filter(call=>call[0]==='route').at(-1)[1].steps[0].geometry,'osm_pedestrian');
});

test('saved tourist focus ends the active transit board/camera lifecycle before restoring its trail',async()=>{
 const {readFile}=await import('node:fs/promises'),{runInNewContext}=await import('node:vm');
 const app=await readFile(new URL('../app.js',import.meta.url),'utf8'),start=app.indexOf('window.focusCityPlace ='),end=app.indexOf('\nfunction useMap(',start);
 let aborts=0;
 const f=fixture({withBoard:true,compute:async()=>result([{...route('active'),steps:[{...route('active').steps[0],fromStopId:'A',toStopId:'B'}]}]),fetchImpl:(_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>{aborts++;reject(new DOMException('aborted','AbortError'));}))});
 let cameraPoint=null,tourist=null;
 const originalClear=f.map.clearRoute;
 f.map.clearRoute=()=>{cameraPoint=null;originalClear();};
 f.map.clearMarkers=()=>{}; // Real adapters retain transit camera state here.
 f.map.highlightStop=point=>{cameraPoint=point;};
 f.map.highlightVehicle=point=>{cameraPoint=point;};
 f.map.showTouristRoutes=records=>{assert.equal(cameraPoint,null,'old board focus must not override full tourist trail framing');tourist=records[0];};
 f.panel.open({origin:'A',destination:'B'});await tick();f.ids['transit-alternatives'].children[0].click();
 const board=f.ids['map-canvas-container'].children[0];assert.equal(board.hidden,false);assert.equal(f.ids['environment-bar'].dataset.route,'true');
 f.map.highlightStop({id:'A'});f.map.highlightVehicle({id:'1',directionTripId:'active'});
 const place={id:'saved-route',category:'route',lat:52.2,lng:21,traceSegments:[[[52.2,21],[52.3,21.1]]]},markers=new Map();
 const context={window:{dispatchEvent:event=>f.events[event.type]?.()},CustomEvent:class{constructor(type){this.type=type;}},cityMap:f.map,placeMarkers:markers,setExpanded(){},
 showResults(action){f.map.clearMarkers();markers.set(place.id,{open(){f.map.showTouristRoutes(action.results);}});f.map.showTouristRoutes(action.results);}};
 runInNewContext(app.slice(start,end),context);assert.equal(context.window.focusCityPlace(place),true);
 await tick();
 assert.equal(tourist.id,place.id);assert.equal(board.hidden,true);assert.equal(f.ids['environment-bar'].dataset.route,'false');assert.equal(f.panel.getState().routeCount,0);assert.ok(aborts>0,'board request must be aborted');
 const routeCalls=f.calls.filter(call=>call[0]==='route').length;
 f.events['city:map']();assert.equal(f.calls.filter(call=>call[0]==='route').length,routeCalls,'provider replacement cannot replay the closed journey');
 await f.panel.refreshLive();assert.equal(f.calls.filter(call=>call[0]==='route').length,routeCalls);
});
