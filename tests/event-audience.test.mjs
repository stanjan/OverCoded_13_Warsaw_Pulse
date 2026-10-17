import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCatalog,normalizeRecord,matches,locate,audienceFilterMapping} from '../mcp/catalog.mjs';
import {createDispatcher} from '../mcp/protocol.mjs';
import {createMcpClient} from '../mcp/client.mjs';

const at='2026-10-17T12:00:00Z';
// Shape of the live calendar: audience labels are category entries; dedicated is absent.
const event=(title,labels=[])=>({title,text:'Opis wydarzenia',category:labels.map((name,i)=>({id:i+1,name})),localization:[{name:'Wola'}],occurrence:[{from:'2026-10-17T12:00:00+02',to:'2026-10-17T14:00:00+02'}],map:{features:[{geometry:{type:'Point',coordinates:[20.98,52.23]},properties:{district:'Wola'}}]}});
const record=(labels,extra={})=>normalizeRecord({...event('Wydarzenie',labels),...extra},'event',at);

test('calendar audience comes from explicit category labels and preserves legacy dedicated',()=>{
 const normalized=record(['Kultura','Dla dzieci','Dla seniorów'],{dedicated:[{name:'Seniorzy'},{name:'Dla dzieci'},{name:'Nieznana grupa'}]});
 assert.deepEqual(normalized.audience,['Seniorzy','Dla dzieci','Nieznana grupa','Dla seniorów']);
 assert.deepEqual(normalized.activities,['Kultura','Dla dzieci','Dla seniorów']);
 assert.deepEqual(record(['Kultura','Sport','Czas wolny']).audience,[]);
 const sports=normalizeRecord({title:'Zajęcia',dedicated:[{name:'Dzieci'},{name:'Dla rodzin'}]},'sports',at);
 assert.deepEqual(sports.audience,['Dzieci','Dla rodzin']);
 assert.equal(matches(sports,{audience:'dziecka'}),true);
 assert.equal(matches(sports,{audience:'rodziny'}),true);
 const mixed=record([],{dedicated:[{name:'Dzieci i młodzież'},{name:'Dzieci w wieku 7–12 lat'}]});
 assert.equal(matches(mixed,{audience:'dziecka'}),true);
 assert.equal(matches(mixed,{audience:'dzieci'}),true);
});

test('children aliases match only source audience evidence, never topic/title/description guesses',()=>{
 const child=record(['Dla dzieci','Edukacja']);
 for(const audience of ['dzieci','Dziecka','dziecko','dziećmi','dla dzieci','dla dziecka','z dziećmi']) assert.equal(matches(child,{audience}),true,audience);
 for(const other of [record(['Dla młodzieży i dorosłych']),record(['Dla seniorów']),record(['Edukacja']),record([],{title:'Dla dzieci',text:'Dla dzieci',dedicated:[{name:'Nie dla dzieci'}]})]) assert.equal(matches(other,{audience:'dzieci'}),false);
 assert.equal(matches(record(['Dla rodzin']),{audience:'dzieci'}),false,'family tag alone does not imply children');
});

test('family and child-family combinations disclose their source-label mapping without inventing record attributes',()=>{
 const child=record(['Dla dzieci']);
 for(const audience of ['rodziny','dla rodzin','rodzin z dziećmi','dla rodzin z dziećmi','dzieci/rodziny','dla dzieci i rodziny','dla rodzin/dzieci']) {
  assert.equal(matches(child,{audience}),true,audience);
  const mapping=audienceFilterMapping(audience);
  assert.equal(mapping.requested,audience);
  assert.deepEqual(mapping.sourceLabels,['Dla dzieci']);
  assert.match(mapping.note,/nie potwierdza.*dla rodzin/);
 }
 assert.deepEqual(child.audience,['Dla dzieci']);
 assert.equal(audienceFilterMapping('dzieci'),null);
 assert.equal(audienceFilterMapping('nie dla dzieci'),null);
 assert.equal(matches(record([],{dedicated:[{name:'Dla rodzin'}]}),{audience:'dla rodzin'}),true,'explicit legacy family label stays usable');
 assert.equal(matches(record(['Dla seniorów']),{audience:'rodziny'}),false);
 assert.equal(matches(record([]),{audience:'rodziny'}),false);
});

test('audience matching composes with exact source dates, locations and other known filters',()=>{
 const child=record(['Dla dzieci','Kultura']);
 const filters={audience:'dla rodzin',activity:'Kultura',district:'Wola',dateFrom:'2026-10-17',dateTo:'2026-10-17',bounds:{south:52.22,north:52.24,west:20.97,east:20.99}};
 assert.equal(matches(child,filters),true);
 assert.equal(locate(child,filters).lat,52.23);
 assert.equal(matches(child,{...filters,dateFrom:'2026-10-18',dateTo:'2026-10-18'}),false);
 assert.equal(matches(child,{...filters,bounds:{south:52.25,north:52.26,west:20.97,east:20.99}}),false);
 assert.equal(matches(child,{...filters,activity:'Sport'}),false);
 assert.equal(matches(child,{...filters,district:'Ochota'}),false);
});

test('catalog filters actual category audiences and returns truthful family mapping alongside source totals',async()=>{
 const rows=[event('Dzieci',['Kultura','Dla dzieci']),event('Młodzież',['Dla młodzieży i dorosłych']),event('Seniorzy',['Dla seniorów']),event('Bez oznaczenia',['Edukacja'])];
 const provider=createCatalog({token:()=> 'fixture-only',now:()=>at,fetchImpl:async()=>({ok:true,json:async()=>rows})});
 const families=await provider.search({category:'event',audience:'rodziny'});
 assert.equal(families.complete,true);assert.equal(families.sources[0].fetched,4);assert.equal(families.sources[0].matched,1);
 assert.deepEqual(families.results.map(r=>r.name),['Dzieci']);
 assert.deepEqual(families.results[0].audience,['Dla dzieci']);
 assert.equal(families.audienceFilterMapping.requested,'rodziny');
 const children=await provider.search({category:'event',audience:'dzieci'});
 assert.equal(children.total,1);assert.equal(children.audienceFilterMapping,undefined);
 const seniors=await provider.search({category:'event',audience:'seniorów'});
 assert.deepEqual(seniors.results.map(r=>r.name),['Seniorzy']);
 const empty=await provider.search({category:'event',audience:'rodziny',dateFrom:'2026-10-18'});
 assert.equal(empty.total,0);assert.equal(empty.complete,true);assert.ok(empty.audienceFilterMapping);
});

test('MCP filtering carries family disclosure through display and clears it for a new explicit audience',async()=>{
 const rows=[event('Dzieci',['Dla dzieci']),event('Seniorzy',['Dla seniorów'])];
 const provider=createCatalog({token:()=> 'fixture-only',now:()=>at,fetchImpl:async()=>({ok:true,json:async()=>rows})});
 const state={results:[],actions:[]},dispatch=createDispatcher({state,provider});
 const client=createMcpClient(async request=>JSON.parse(JSON.stringify(await dispatch(request)||null))||undefined);
 await client.callTool('search_places',{category:'event'});
 const filtered=await client.callTool('filter_results',{audience:'rodziny'});
 assert.equal(filtered.total,1);assert.equal(filtered.audienceFilterMapping.requested,'rodziny');
 const narrowed=await client.callTool('filter_results',{district:'Wola'});
 assert.equal(narrowed.audienceFilterMapping.requested,'rodziny');
 const shown=await client.callTool('display_results',{ids:[filtered.results[0].id],highlightIds:[filtered.results[0].id],title:'Dla dzieci'});
 assert.deepEqual(shown.action.audienceFilterMapping.sourceLabels,['Dla dzieci']);
 const explicit=await client.callTool('filter_results',{audience:'Dla dzieci'});
 assert.equal(explicit.audienceFilterMapping,undefined);
 const latest=await client.callTool('display_results',{ids:[explicit.results[0].id],highlightIds:[explicit.results[0].id],title:'Dla dzieci'});
 assert.equal(latest.action.audienceFilterMapping,undefined);
});
