import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
const render=app.slice(app.indexOf('function showResults(action)'),app.indexOf('\nconst prompts'));
const startup=app.slice(app.indexOf('let mapWasReplaced ='),app.indexOf('const CENTER ='));
function element(tag){return{tag,children:[],listeners:{},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},addEventListener(name,callback){this.listeners[name]=callback;},setAttribute(){}};}
const place={id:'route-one',category:'route',name:'Spacer miejski',lengthKm:3.23,geometryStatus:'published',lat:52.23,lng:21.02,traceSegments:[[[52.23,21.02],[52.3,21.1]]],touristPoints:[]};
const action=()=>({type:'display_results',results:[place],highlightIds:[place.id],complete:true});
test('tourist result selection fits geometry through the adapter instead of zooming to the start, and replays on provider replacement',async()=>{
 const panel=element('section'),calls=[];let replace,resolveMap;
 const status={classList:{add(){},remove(){}},textContent:''};
 const adapter=vendor=>({vendor,clearMarkers(){calls.push([vendor,'clear']);},addMarker(record,{onOpen}){return{open(){onOpen();calls.push([vendor,'select',record.id]);}};},showTouristRoutes(records,options){calls.push([vendor,'tourism',records,options]);},setView(){calls.push([vendor,'start-only-view']);},fitTo(){},showUser(){}});
 const google=adapter('google'),leaflet=adapter('leaflet');
 const context={console,Promise,document:{createElement:element,querySelector:()=>status},window:{createCityMap(_element,options){replace=options.onReplace;return new Promise(resolve=>{resolveMap=resolve;});}},resultPanel:panel,mapCanvas:{clientHeight:700},drawer:{offsetHeight:150},setExpanded(){},lastPosition:null};
 runInNewContext('let cityMap,lastDisplayedAction;\n'+startup+render+'\nglobalThis.hooks={showResults,mapReady};',context);
 const selected=action();context.hooks.showResults(selected);resolveMap(google);await context.hooks.mapReady;
 panel.children[0].children[0].listeners.click();assert.equal(selected.selectedTouristId,place.id);assert.equal(calls.some(call=>call[1]==='start-only-view'),false);
 replace(leaflet);const replay=calls.filter(call=>call[0]==='leaflet'&&call[1]==='tourism').at(-1);assert.equal(replay[3].selectedId,place.id);assert.deepEqual(replay[2][0].traceSegments,place.traceSegments);
 const replacement={type:'display_results',results:[],highlightIds:[],complete:true};context.hooks.showResults(replacement);const cleared=calls.filter(call=>call[0]==='leaflet'&&call[1]==='tourism').at(-1);assert.equal(cleared[2].length,0);assert.equal(cleared[3].selectedId,undefined);
 replace(null);assert.doesNotThrow(()=>panel.children[0]?.children[0]?.listeners.click?.());
});
test('a delayed initial map receives only the newest search and unavailable geometry remains explicit on its card',async()=>{
 const panel=element('section'),received=[];let resolveMap;
 const status={classList:{add(){},remove(){}}};
 const map={vendor:'google',clearMarkers(){},addMarker(){return{open(){}};},fitTo(){},showTouristRoutes(records){received.push(records);}};
 const context={console,Promise,document:{createElement:element,querySelector:()=>status},window:{createCityMap(){return new Promise(resolve=>{resolveMap=resolve;});}},resultPanel:panel,mapCanvas:{clientHeight:700},drawer:{offsetHeight:150},setExpanded(){},lastPosition:null};
 runInNewContext('let cityMap,lastDisplayedAction;\n'+startup+render+'\nglobalThis.hooks={showResults,mapReady};',context);
 context.hooks.showResults(action());const newest={...place,id:'newest',geometryStatus:'unavailable',traceSegments:[],lat:undefined,lng:undefined};context.hooks.showResults({results:[newest],highlightIds:[],complete:true});resolveMap(map);await context.hooks.mapReady;
 assert.equal(received.length,1);assert.equal(received[0][0].id,'newest');assert.equal(panel.children[0].children[0].tag,'strong');assert.match(panel.children[0].children.find(node=>node.className==='tourist-card-note').textContent,/Brak pełnego śladu/);assert.equal(panel.children.some(node=>node.tag==='h2'),false);
});

for(const early of [false,true])test('active transit wins tourist result framing after provider replacement (early='+early+')',async()=>{
 const panel=element('section'),calls=[];let replace,resolveMap,currentMap;
 const status={classList:{add(){},remove(){}}};
 const adapter=vendor=>({vendor,clearMarkers(){calls.push([vendor,'clear-results']);},addMarker(){return{open(){}};},fitTo(){calls.push([vendor,'result-frame']);},showTouristRoutes(){calls.push([vendor,'tourist-frame']);},showRoute(){calls.push([vendor,'transit-frame']);},showUser(){}});
 const google=adapter('google'),leaflet=adapter('leaflet');
 const context={console,Promise,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},document:{createElement:element,querySelector:()=>status},window:{createCityMap(_element,options){replace=options.onReplace;return new Promise(resolve=>{resolveMap=resolve;});},dispatchEvent(event){if(event.type==='city:map'&&event.detail.vendor){currentMap=event.detail.vendor==='leaflet'?leaflet:google;currentMap.showRoute();}}},resultPanel:panel,mapCanvas:{clientHeight:700},drawer:{offsetHeight:150},setExpanded(){},lastPosition:null};
 runInNewContext('let cityMap,lastDisplayedAction;\n'+startup+render+'\nglobalThis.hooks={showResults,mapReady};',context);
 const selected=action();selected.selectedTouristId=place.id;context.hooks.showResults(selected);
 if(early)replace(leaflet);
 resolveMap(google);await context.hooks.mapReady;
 if(!early)replace(leaflet);
 assert.equal(calls.at(-1)[0],'leaflet');assert.equal(calls.at(-1)[1],'transit-frame');assert.equal(calls.filter(call=>call[0]==='leaflet'&&call[1]==='transit-frame').length,1,'one final active journey replay');
 if(early)assert.equal(calls.some(call=>call[0]==='google'),false,'obsolete startup cannot restore old result framing');
});
