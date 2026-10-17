import test from 'node:test';
import assert from 'node:assert/strict';
import {mountTransit,routeChain,timingLabel,compactTime} from '../transit-ui.mjs';
import {TransitError} from '../transit-core.mjs';
function element(tag='div') {
 const node={tag,children:[],listeners:{},attributes:{},dataset:{},style:{},hidden:false,value:'',textContent:'',
 append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},
 setAttribute(k,v){this.attributes[k]=v;},getAttribute(k){return this.attributes[k]||null;},cloneNode(){const copy=element(this.tag);copy.id=this.id;copy.attributes={...this.attributes};copy.dataset={...this.dataset};copy.hidden=this.hidden;copy.children=this.children.map(child=>child.cloneNode(true));return copy;},removeAttribute(k){delete this.attributes[k];},addEventListener(k,v){this.listeners[k]=v;},focus(){this.focused=true;},click(){return this.listeners.click?.({});},
 querySelectorAll(selector){return this.children.flatMap(child=>[...((selector==='*'||selector===child.tag||(selector==='[id]'&&child.id))?[child]:[]),...child.querySelectorAll(selector)]);}};
 Object.defineProperty(node,'innerHTML',{set(){throw new Error('Untrusted route data must be text nodes');}});return node;
}
function fixture({vendor='google',compute,fetchImpl}={}) {
 const ids=Object.fromEntries(['panel','origin','destination','time','status','alternatives','itinerary','external','search','cancel','clear','form','gps','close','origin-note','observations','origin-options','destination-options','editor','details'].map(id=>['transit-'+id,element(id==='origin'||id==='destination'?'input':'div')]));
 for(const [id,node]of Object.entries(ids))node.id=id;ids['transit-panel'].append(...Object.entries(ids).filter(([id])=>id!=='transit-panel').map(([,node])=>node));
 for(const id of ['chat-messages','welcome-prompts','environment-bar','environment-route','environment-eta'])ids[id]=element();
 const shell=element(),nav=['city-pulse','transit-live'].map(path=>{const e=element('a');e.dataset.path=path;return e;});
 const events={},calls=[];const map={vendor,clearRoute(){calls.push(['clear']);},showRoute(raw){calls.push(['route',raw]);return true;},showVehicles(vehicles){calls.push(['vehicles',vehicles]);},fitTo(){}};
 const doc={getElementById:id=>ids[id],querySelector:()=>shell,querySelectorAll:()=>nav,createElement:element,createElementNS:(_ns,tag)=>element(tag)};
 const host={getCityMap:()=>map,getCityLocation:()=>({status:'unavailable'}),expandCitySheet(){calls.push(['expand']);},addEventListener:(key,handler)=>events[key]=handler};
 const panel=mountTransit({doc,host,compute,fetchImpl});
 return {ids,shell,nav,events,calls,map,panel};
}
const route=id=>({id,origin:'Start <script>',destination:'Cel',durationMillis:1200000,departure:Date.parse('2026-10-17T12:00Z'),arrival:Date.parse('2026-10-17T12:20Z'),transfers:0,steps:[{mode:'TRANSIT',line:'17',from:'Dw. Centralny',to:'Anielewicza',headsign:'Nowodwory',start:Date.parse('2026-10-17T12:02Z'),end:Date.parse('2026-10-17T12:18Z'),stops:5,path:[{latitude:52.2,longitude:21},{latitude:52.25,longitude:21.02}],geometry:'gtfs_shape'}],warnings:['Sprawdź komunikat']});
const result=routes=>({routes,origin:{latitude:52.2,longitude:21},destination:{latitude:52.25,longitude:21.02},stops:[],departures:[],vehicles:[],sources:[],errors:[]});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
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
 let mode='empty';const vehicle={latitude:52.2,longitude:21,line:'17',freshness:'recent'};const f=fixture({compute:async()=>({...result([route('current')]),vehicles:[vehicle],vehicleCount:1,vehicleProvided:1}),fetchImpl:async()=>{if(mode==='outage')throw new Error('offline');return{ok:true,json:async()=>({vehicles:mode==='nonempty'?[vehicle]:[],vehicleCount:mode==='nonempty'?1:0,vehicleProvided:mode==='nonempty'?1:0,liveModel:{trackedVehicles:1,confirmedTrips:0}})};}});
 f.ids['transit-origin'].value='Start';f.ids['transit-destination'].value='Cel';await f.panel.search();f.ids['transit-alternatives'].children[0].click();assert.equal(f.calls.filter(c=>c[0]==='vehicles').at(-1)[1].length,1);await f.panel.refreshLive();assert.deepEqual(f.calls.filter(c=>c[0]==='vehicles').at(-1)[1],[]);assert.equal(f.panel.getState().routeCount,1);
 mode='nonempty';await f.panel.refreshLive();assert.equal(f.calls.filter(c=>c[0]==='vehicles').at(-1)[1].length,1);mode='outage';await f.panel.refreshLive();assert.deepEqual(f.calls.filter(c=>c[0]==='vehicles').at(-1)[1],[]);assert.ok(f.ids['transit-observations'].children.some(node=>node.textContent.includes('Wcześniejsze znaczniki zostały ukryte')));assert.equal(f.panel.getState().routeCount,1);
});
test('a late failed refresh cannot clear a newer successful current vehicle snapshot',async()=>{
 const jobs=[];const f=fixture({compute:async()=>result([route('current')]),fetchImpl:()=>new Promise((resolve,reject)=>jobs.push({resolve,reject}))});f.ids['transit-origin'].value='Start';f.ids['transit-destination'].value='Cel';await f.panel.search();f.ids['transit-alternatives'].children[0].click();const first=f.panel.refreshLive(),second=f.panel.refreshLive();jobs[1].resolve({ok:true,json:async()=>({vehicles:[{line:'17'},{line:'unrelated'}],vehicleCount:1,vehicleProvided:1})});await second;jobs[0].reject(new Error('old request failed'));await first;assert.equal(f.calls.filter(c=>c[0]==='vehicles').at(-1)[1][0].line,'17');
});

test('each answer retains its own selectable cards; switching plans clears selection and does not revive GPS snapshots',async()=>{
 let turn=0;const f=fixture({compute:async()=>({...result([route('plan-'+(++turn))]),vehicles:[{line:'old',freshness:'recent'}]})});
 const detail={origin:{latitude:52.23,longitude:21.01,label:'Start'},destination:{latitude:52.25,longitude:21.02,label:'Cel'}};
 f.panel.open(detail);await tick();const oldCard=f.ids['transit-alternatives'].children[0];oldCard.click();assert.equal(oldCard.attributes['aria-pressed'],'true');
 f.panel.open(detail);await tick();const plans=f.ids['chat-messages'].children.filter(node=>node.dataset.transit==='panel');assert.equal(plans.length,2);
 const newAlternatives=plans[1].querySelectorAll('*').find(node=>node.dataset.transit==='alternatives'),newCard=newAlternatives.children[0];
 assert.equal(oldCard.attributes['aria-pressed'],'false');assert.equal(f.ids['environment-bar'].dataset.route,'false');newCard.click();assert.equal(f.calls.filter(call=>call[0]==='route').at(-1)[1].id,'plan-2');
 oldCard.click();assert.equal(oldCard.attributes['aria-pressed'],'true');assert.equal(newCard.attributes['aria-pressed'],'false');assert.equal(f.calls.filter(call=>call[0]==='route').at(-1)[1].id,'plan-1');assert.deepEqual(f.calls.filter(call=>call[0]==='vehicles').at(-1)[1],[]);assert.match(f.ids['environment-eta'].children[1].textContent,/zapisany plan/);
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
  f.ids['transit-origin'].value='Start';f.ids['transit-destination'].value='Cel';await f.panel.search();f.ids['transit-alternatives'].children[0].click();const cardLabel=f.ids['transit-alternatives'].querySelectorAll('small')[0];assert.match(cardLabel.textContent,/GPS \+2/);assert.match(f.ids['environment-eta'].children[1].textContent,/GPS \+2/);
  now+=180001;const refresh=f.panel.refreshLive();assert.match(cardLabel.textContent,/zapisany plan/);assert.match(f.ids['environment-eta'].children[1].textContent,/zapisany plan/);reject(new Error('offline'));await refresh;assert.match(f.ids['environment-eta'].children[1].textContent,/zapisany plan/);
  mode='success';await f.panel.refreshLive();assert.match(cardLabel.textContent,/zapisany plan/);assert.match(f.ids['environment-eta'].children[1].textContent,/zapisany plan/);
 }finally{Date.now=originalNow;}
});
