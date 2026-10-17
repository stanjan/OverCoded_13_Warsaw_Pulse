import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const source=await readFile(new URL('../map.js',import.meta.url),'utf8');
function element(tag){
 const node={tag,children:[],dataset:{},attributes:{},listeners:{},setAttribute(key,value){this.attributes[key]=value;},append(...children){for(const child of children){child.parent=this;this.children.push(child);}},addEventListener(name,callback){this.listeners[name]=callback;},remove(){this.parent.children=this.parent.children.filter(child=>child!==this);}};
 Object.defineProperty(node,'innerHTML',{set(){throw new Error('Untrusted content must use text nodes');}});
 return node;
}
function helpers(){
 const context={URL,document:{createElement:element}};
 runInNewContext(source.slice(source.indexOf('  const categoryLabels ='),source.indexOf('  async function readConfig'))+'\nglobalThis.ui={resultBubble,resultDetails,thumbnail};',context);
 return context.ui;
}
test('map bubbles show real thumbnails, accessible titles and recommendation labels',()=>{
 const ui=helpers(),place={name:'Koncert <img onerror=alert(1)>',category:'event',imageUrl:'https://um.warszawa.pl/photo.jpg'};
 const bubble=ui.resultBubble(place,true);
 assert.equal(bubble.tag,'button');assert.equal(bubble.type,'button');
 assert.equal(bubble.attributes['aria-expanded'],'false');assert.ok(bubble.attributes['aria-label'].includes(place.name));
 assert.equal(bubble.children[1].children[0].textContent,place.name);
 assert.equal(bubble.children[1].children[1].textContent,'★ Polecane');
 const image=bubble.children[0].children.find(child=>child.tag==='img');
 assert.equal(image.src,place.imageUrl);assert.equal(image.referrerPolicy,'no-referrer');
 image.listeners.error();assert.equal(bubble.children[0].children.length,1);
 assert.equal(bubble.children[0].children[0].textContent,'local_activity');
});
test('expanded details contain the source data and omit unsafe links and image URLs',()=>{
 const ui=helpers();
 const card=ui.resultDetails({name:'Koncert',category:'event',district:'Wola',addresses:['Sala koncertowa'],description:'Treść <script> z danych',dates:[{from:'2026-10-17',to:'2026-10-17',sourceFrom:'2026-10-17T17:30:00Z',sourceTo:'2026-10-17T19:30:00Z'}],url:'javascript:alert(1)',imageUrl:'data:image/svg+xml,unsafe'},false);
 assert.equal(card.children[0].children.some(child=>child.tag==='img'),false);
 const body=card.children[1];assert.ok(body.children.some(child=>child.textContent==='Koncert'));
 const facts=body.children.find(child=>child.className==='result-detail__facts');
 const fact=kind=>facts.children.find(row=>row.dataset.kind===kind).children[1].textContent;
 assert.equal(fact('time'),'17 października 2026 · 19:30–21:30');
 assert.equal(fact('place'),'Wola · Sala koncertowa');
 assert.equal(fact('price'),'Cena: sprawdź u organizatora');
 assert.ok(body.children.some(child=>child.textContent==='Treść <script> z danych'));
 assert.equal(body.children.some(child=>child.tag==='a'),false);
});

test('Leaflet shows every overlapping result pin and opens a result from its card',async()=>{
 const markers=[];
 const map={setView(){return this;},on(){return this;},invalidateSize(){},getZoom(){return 16;},latLngToContainerPoint(){return{x:300,y:200};}};
 const layer={addTo(){return this;},clearLayers(){}};
 const L={map:()=>map,tileLayer:()=>({addTo(){}}),layerGroup:()=>layer,divIcon:options=>options,DomEvent:{disableClickPropagation(){}},marker:(position,options)=>{
  const marker={position,options,events:{},icon:{style:{}},getLatLng(){return this.position;},getElement(){return this.icon;},bindPopup(content){this.popup=content;return this;},on(name,callback){this.events[name]=callback;return this;},addTo(){return this;},openPopup(){this.events.popupopen();return this;}};
  markers.push(marker);return marker;
 }};
 const context={URL,URLSearchParams,console,L,window:{L},document:{createElement:element},fetch:async()=>({ok:true,json:async()=>({})}),ResizeObserver:class{observe(){}}};
 runInNewContext(source,context);
 const adapter=await context.window.createCityMap(element('div'));
 let opened=0;
 const first=adapter.addMarker({name:'Pierwszy koncert',category:'event',lat:52,lng:21},{onOpen:()=>opened++});
 adapter.addMarker({name:'Polecany koncert',category:'event',lat:52,lng:21},{recommended:true});
 assert.equal(markers[0].icon.style.visibility,'');assert.equal(markers[0].options.icon.html.tabIndex,0);
 assert.equal(markers[1].icon.style.visibility,'');
 first.open();assert.equal(opened,1);assert.equal(markers[0].icon.style.visibility,'');
 assert.equal(markers[1].icon.style.visibility,'');assert.equal(markers[0].options.icon.html.attributes['aria-expanded'],'true');
 assert.ok(markers[0].popup.children[1].children.some(child=>child.textContent==='Pierwszy koncert'));
 markers[0].events.popupclose();assert.equal(markers[0].options.icon.html.attributes['aria-expanded'],'false');
 assert.equal(markers[1].icon.style.visibility,'');
});

test('event cloud marks free and paid events from the source text',()=>{
 const ui=helpers();
 const price=place=>{const facts=ui.resultDetails({category:'event',...place},false).children[1].children.find(c=>c.className==='result-detail__facts');return facts.children.find(r=>r.dataset.kind==='price').dataset.price;};
 assert.equal(price({name:'Koncert',description:'Wstęp wolny dla wszystkich'}),'free');
 assert.equal(price({name:'Spektakl',description:'Zajęcia bezpłatne'}),'free');
 assert.equal(price({name:'Koncert',description:'Bilety 40 zł'}),'paid');
 assert.equal(price({name:'Wystawa',description:'Otwarcie wystawy'}),'unknown');
});

test('toilets have a WC marker and source details without event ticket assumptions',()=>{
 const ui=helpers(),place={name:'Toaleta · Inwalidów 3',category:'toilet',address:'Inwalidów 3',district:'Żoliborz',description:'Bezpłatna. Przewijak: nie. Aktualizacja danych: Kwiecień 2026',paid:false};
 const bubble=ui.resultBubble(place,false);
 assert.equal(bubble.children[0].children[0].textContent,'wc');
 assert.equal(bubble.children[1].children[1].textContent,'Toaleta');
 assert.equal(bubble.children[2].children[0].textContent,'wc');
 const body=ui.resultDetails(place,false).children[1];
 assert.ok(body.children.some(node=>node.textContent===place.description));
 const facts=body.children.find(node=>node.className==='result-detail__facts');
 assert.equal(facts.children.some(node=>node.dataset.kind==='price'),false);
 assert.equal(facts.children.find(node=>node.dataset.kind==='place').children[1].textContent,'Żoliborz · Inwalidów 3');
});
