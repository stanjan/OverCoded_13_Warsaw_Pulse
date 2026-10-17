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
 const cards=panel.children.filter(e=>e.tag==='article');assert.equal(cards.length,3);
 assert.equal(cards[0].children[0].textContent,'★ Polecane: Koncert');
 assert.match(panel.children[1].textContent,/Niepełne/);
 assert.equal(cards[1].children.some(c=>c.tag==='button'),false);assert.equal(cards[2].children.some(c=>c.tag==='button'),false);
 cards[0].children.find(c=>c.tag==='button').listeners.click();
 const view=calls.find(c=>c[0]==='view');assert.equal(view[1].lat,52.23);assert.equal(view[1].lng,21.01);assert.equal(view[2],15);assert.ok(calls.some(c=>c[0]==='open'));
 const fit=calls.find(c=>c[0]==='fit');assert.equal(fit[1].length,1);assert.equal(fit[2].bottom,vendor==='google'?24:230);
});
test('result cards remain available while asynchronous map is not ready',()=>{
 const panel=element('section'),context={document:{createElement:element},resultPanel:panel,lastDisplayedAction:null,cityMap:undefined,action,drawer:{offsetHeight:150},mapCanvas:{clientHeight:700}};
 runInNewContext(render+'\nshowResults(action);',context);
 assert.equal(panel.children.filter(e=>e.tag==='article').length,3);assert.equal(context.lastDisplayedAction,action);
});
