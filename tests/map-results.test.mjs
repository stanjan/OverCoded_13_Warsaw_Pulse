import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
const render=app.slice(app.indexOf('function showResults(action)'),app.indexOf('\nconst prompts'));
function element(tag){
 return {tag,children:[],listeners:{},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},addEventListener(name,handler){this.listeners[name]=handler;}};
}
const action={title:'Wyniki',complete:false,highlightIds:['valid'],results:[
 {id:'valid',name:'Koncert',description:'Opis',lat:52.23,lng:21.01,source:'Miasto',sourceUrl:'https://dane.um.warszawa.pl/'},
 {id:'missing',name:'Boisko bez współrzędnych',description:'Opis',source:'Miasto',sourceUrl:'https://dane.um.warszawa.pl/'},
 {id:'invalid',name:'Niepoprawny punkt',lat:900,lng:21,source:'Miasto',sourceUrl:'https://dane.um.warszawa.pl/'},
]};
for(const vendor of ['google','leaflet'])test('MCP result cards use '+vendor+' adapter with validated spatial points',()=>{
 const calls=[],panel=element('section');
 const context={document:{createElement:element},resultPanel:panel,lastDisplayedAction:null,drawer:{offsetHeight:150},mapCanvas:{clientHeight:700},setExpanded:value=>calls.push(['expanded',value]),
 cityMap:{vendor,clearMarkers:()=>calls.push(['clear']),addMarker:place=>{calls.push(['add',place]);return {open:()=>calls.push(['open'])};},setView:(position,zoom)=>calls.push(['view',position,zoom]),fitTo:(points,padding)=>calls.push(['fit',points,padding])}};
 runInNewContext(render+'\nshowResults(action);',{...context,action});
 assert.equal(calls.filter(c=>c[0]==='add').length,1);
 const cards=panel.children.filter(e=>e.tag==='article');assert.equal(cards.length,1); // only the ★ recommended result is listed
 assert.equal(cards[0].children[0].textContent,'Koncert');
 assert.match(cards[0].children.find(c=>c.className==='rec-card__meta').children[0].textContent,/^★ /);
 assert.equal(panel.children.every(child=>child.tag==='article'),true); // no redundant heading or diagnostic block
 cards[0].children.find(c=>c.tag==='button').listeners.click();
 const view=calls.find(c=>c[0]==='view');assert.equal(view[1].lat,52.23);assert.equal(view[1].lng,21.01);assert.equal(view[2],16);assert.ok(calls.some(c=>c[0]==='open'));
 const fit=calls.find(c=>c[0]==='fit');assert.equal(fit[1].length,1);assert.equal(fit[2].bottom,vendor==='google'?24:230);
});
test('result cards remain available while asynchronous map is not ready',()=>{
 const panel=element('section'),context={document:{createElement:element},resultPanel:panel,lastDisplayedAction:null,cityMap:undefined,action,drawer:{offsetHeight:150},mapCanvas:{clientHeight:700}};
 runInNewContext(render+'\nshowResults(action);',context);
 assert.equal(panel.children.filter(e=>e.tag==='article').length,1);assert.equal(context.lastDisplayedAction,action);
});

test('address-only pitches remain readable on the list without implying a measured distance',()=>{
 const panel=element('section'),place={id:'pitch',category:'pitch',name:'Boisko szkolne',address:'ul. Testowa 9',district:'Wola'};
 const context={document:{createElement:element},resultPanel:panel,lastDisplayedAction:null,cityMap:undefined,action:{title:'Boiska',results:[place],highlightIds:[],complete:true},drawer:{offsetHeight:150},mapCanvas:{clientHeight:700}};
 runInNewContext(render+'\nshowResults(action);',context);
 const card=panel.children.find(e=>e.tag==='article');assert.ok(card);
 assert.equal(card.children.find(e=>e.className==='place-card__address').textContent,'ul. Testowa 9 · Wola');
 assert.equal(panel.children.every(child=>child.tag==='article'),true);
 assert.equal(card.children.some(e=>e.tag==='button'),false);
});

for(const early of [false,true])test('MCP results follow a replacement map without stale markers (early='+early+')',async()=>{
 const panel=element('section'),calls=[];
 const node={classList:{add(){},remove(){}},textContent:''};
 let replace,resolveMap;
 const map=vendor=>({vendor,clearMarkers(){calls.push([vendor,'clear']);},addMarker(place){calls.push([vendor,'add',place.id]);return{open(){calls.push([vendor,'open']);}};},setView(){calls.push([vendor,'view']);},fitTo(){},showUser(){calls.push([vendor,'user']);}});
 const google=map('google'),leaflet=map('leaflet');
 const startup=app.slice(app.indexOf('let mapWasReplaced ='),app.indexOf('const CENTER ='));
 const context={console,Promise,document:{querySelector(){return node;},createElement:element},window:{createCityMap(_element,options){replace=options.onReplace;return new Promise(resolve=>{resolveMap=resolve;});}},resultPanel:panel,mapCanvas:{clientHeight:700},drawer:{offsetHeight:150},setExpanded(){},lastPosition:{lat:52,lng:21,accuracy:10}};
 runInNewContext('let cityMap,lastDisplayedAction;\n'+startup+render+'\nglobalThis.hooks={showResults,mapReady,getMap:()=>cityMap};',context);
 context.hooks.showResults(action);
 if(early)replace(leaflet);
 resolveMap(google);await context.hooks.mapReady;
 if(!early)replace(leaflet);
 assert.equal(context.hooks.getMap(),leaflet);
 assert.equal(panel.children.filter(e=>e.tag==='article').length,1);
 assert.ok(calls.some(c=>c[0]==='leaflet'&&c[1]==='add'&&c[2]==='valid'));
 assert.equal(calls.some(c=>c[1]==='add'&&c[2]!=='valid'),false);
 if(early)assert.equal(calls.some(c=>c[0]==='google'&&c[1]==='add'),false);
 const focus=panel.children.find(e=>e.tag==='article').children.find(e=>e.tag==='button');
 focus.listeners.click();assert.ok(calls.some(c=>c[0]==='leaflet'&&c[1]==='open'));
 replace(null);assert.equal(context.hooks.getMap(),undefined);assert.doesNotThrow(()=>focus.listeners.click());
});

test('conversation lists at most 3 recommended results, falling back to the first 3',()=>{
 const run=highlightIds=>{
  const panel=element('section'),added=[];
  const results=[1,2,3,4,5].map(i=>({id:'r'+i,name:'Wydarzenie '+i,lat:52.2,lng:21,source:'Miasto',sourceUrl:'https://dane.um.warszawa.pl/'}));
  const context={document:{createElement:element},resultPanel:panel,lastDisplayedAction:null,drawer:{offsetHeight:150},mapCanvas:{clientHeight:700},setExpanded(){},
   cityMap:{vendor:'google',clearMarkers(){},addMarker:place=>{added.push(place.id);return {open(){}};},setView(){},fitTo(){}}};
  runInNewContext(render+'\nshowResults(action);',{...context,action:{title:'Wyniki',complete:true,highlightIds,results}});
  return {titles:panel.children.filter(e=>e.tag==='article').map(card=>card.children[0].textContent),added};
 };
 const starred=run(['r1','r2','r3','r4']);
 assert.deepEqual(starred.titles,['Wydarzenie 1','Wydarzenie 2','Wydarzenie 3']);
 assert.equal(starred.added.length,5);
 assert.deepEqual(run([]).titles,['Wydarzenie 1','Wydarzenie 2','Wydarzenie 3']);
});


test('recommendation cards stagger on new answers and do not replay on map-ready redraw',()=>{
 const panel=element('section'),context={document:{createElement:element},resultPanel:panel,lastDisplayedAction:null,cityMap:undefined,drawer:{offsetHeight:150},mapCanvas:{clientHeight:700},action:{results:[{id:'a',name:'Spacer'},{id:'b',name:'Park'},{id:'c',name:'Wystawa'}]}};
 runInNewContext(render+'\nshowResults(action);',context);
 assert.ok(panel.children.every(card=>card.className.includes('rec-card--reveal')));assert.equal(panel.children.length,3);
 runInNewContext('showResults(action);',context);assert.ok(panel.children.every(card=>!card.className.includes('rec-card--reveal')));
 context.action={results:[{id:'d',name:'Inny spacer'}]};runInNewContext('showResults(action);',context);assert.ok(panel.children[0].className.includes('rec-card--reveal'));assert.equal(panel.children.length,1);
});
