import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createCatalog,normalizeRecord,matches} from '../mcp/catalog.mjs';
import {createDispatcher} from '../mcp/protocol.mjs';
import {createMcpClient} from '../mcp/client.mjs';
import {executeTool} from '../server/tools.mjs';
import {SYSTEM_PROMPT} from '../server/assistant.mjs';

const at='2026-10-17T14:30:00Z';
const feature=(properties={},geometry={type:'Point',coordinates:[20.9895859993675,52.2634839987203]})=>({type:'Feature',geometry,properties:{zarzadca:'Urząd Dzielnicy Żoliborz',typ:'toaleta stacjonarna',lokalizacja:'Inwalidów 3, Biblioteka Publiczna',dzielnica:'Żoliborz',dostepnosc:1,platnosc:0,przewijak:0,aktu_dan:'Kwiecień 2026',poch_dan:'Centrum Komunikacji Społecznej',godziny:'Poniedziałek: 09:00 - 19:00; Niedziela: nieczynne',uwagi:null,...properties}});
const provider=rows=>createCatalog({token:()=> 'test-city-token',now:()=>at,fetchImpl:async()=>Response.json(rows)});

test('toilets preserve GeoJSON coordinate order, explicit source flags and historical provenance',()=>{
 const record=normalizeRecord(feature(),'toilet',at);
 assert.equal(record.lat,52.2634839987203); assert.equal(record.lng,20.9895859993675);
 assert.equal(record.address,'Inwalidów 3, Biblioteka Publiczna'); assert.deepEqual(record.districts,['Żoliborz']);
 assert.equal(record.paid,false); assert.equal(record.accessible,true); assert.equal(record.changingTable,false);
 assert.equal(record.operator,'Urząd Dzielnicy Żoliborz'); assert.equal(record.dataOrigin,'Centrum Komunikacji Społecznej');
 assert.match(record.openingHours,/Niedziela: nieczynne/); assert.match(record.description,/Bezpłatna/);
 assert.equal(record.provenance.datasetId,'59485767-5566-4cb6-9545-a9053efca4ff');
 assert.equal(record.provenance.fetchedAt,at); assert.equal(record.provenance.sourceUpdatedAt,'Kwiecień 2026');
 assert.equal(record.provenance.freshness,'unknown'); assert.deepEqual(record.provenance.observedAt,[]);
 assert.equal(record.live,false); assert.equal(Object.hasOwn(record,'openNow'),false); assert.equal(Object.hasOwn(record,'feeAmount'),false);
});

test('toilet filters distinguish explicit false from unknown and do not apply traits to other categories',()=>{
 const record=normalizeRecord(feature(),'toilet',at);
 assert.equal(matches(record,{category:'toilet',paid:false,accessible:true,changingTable:false,district:'zoliborz',query:'Biblioteka',bounds:{south:52.26,north:52.27,west:20.98,east:21}}),true);
 for(const filters of [{paid:true},{accessible:false},{changingTable:true},{district:'Wola'},{dateFrom:'2026-10-17'},{bounds:{south:52.1,north:52.2,west:20.98,east:21}}]) assert.equal(matches(record,filters),false);
 for(const value of [undefined,null,'0','1',true,false,2,-1,'nie']) {
  const unknown=normalizeRecord(feature({platnosc:value,dostepnosc:value,przewijak:value}),'toilet',at);
  for(const key of ['paid','accessible','changingTable']) {assert.equal(unknown[key],null); assert.equal(matches(unknown,{[key]:false}),false); assert.equal(matches(unknown,{[key]:true}),false);}
 }
 assert.equal(matches({...record,category:'event'},{paid:false}),false);
 const other=normalizeRecord(feature({platnosc:1,dostepnosc:0,przewijak:1}),'toilet',at);
 assert.equal(matches(other,{paid:true,accessible:false,changingTable:true}),true);
 assert.match(other.description,/bariery architektoniczne/);
});

test('toilet adapter fetches full verified action and never treats changed source schema as an empty catalogue',async()=>{
 let calls=0;
 const catalog=createCatalog({token:()=> 'test-city-token',now:()=>at,fetchImpl:async(url,init)=>{
  calls++; assert.equal(url,'https://dane.um.warszawa.pl/api/action/get_m_toalety'); assert.equal(init.method,'POST');
  assert.equal(init.headers.Authorization,'test-city-token'); assert.equal(init.redirect,'error');
  return Response.json(Array.from({length:695},(_,i)=>feature({lokalizacja:'Adres '+i})));
 }});
 const result=await catalog.search({category:'toilet'});
 assert.equal(calls,1); assert.equal(result.total,695); assert.equal(result.complete,true); assert.equal(result.sources[0].fetched,695); assert.equal(result.sources[0].pagination,'full_dataset_response');
 for(const payload of [{features:[feature()]},{result:[feature()],next:'page2'},[{lokalizacja:'Changed schema'}],[feature({lokalizacja:''})]]) {
  const failure=await provider(payload).search({category:'toilet'});
  assert.equal(failure.complete,false); assert.equal(failure.errors.length,1); assert.equal(failure.errors[0].category,'toilet'); assert.deepEqual(failure.results,[]);
 }
 for(const status of [401,503]) {
  const failure=await createCatalog({token:()=> 'test',fetchImpl:async()=>({ok:false,status})}).search({category:'toilet'});
  assert.equal(failure.complete,false); assert.equal(failure.errors[0].code,status===401?'SOURCE_AUTH':'SOURCE_HTTP_503');
 }
});

test('invalid toilet coordinates stay unlocated and unknown properties do not invent facts',()=>{
 for(const geometry of [null,{type:'LineString',coordinates:[[21,52],[21.1,52.1]]},{type:'Point',coordinates:[null,null]},{type:'Point',coordinates:[21,999]}]) {
  const record=normalizeRecord(feature({platnosc:null,dostepnosc:null,przewijak:null,aktu_dan:null,godziny:null},geometry),'toilet',at);
  assert.equal(record.lat,undefined); assert.equal(record.lng,undefined); assert.equal(record.paid,null);
  assert.equal(record.openingHours,''); assert.equal(record.provenance.sourceUpdatedAt,null);
  assert.equal(matches(record,{district:'Żoliborz'}),true);
  assert.equal(matches(record,{bounds:{south:50,north:53,west:20,east:22}}),false);
 }
});

test('serialized MCP and app expose toilet discovery, boolean filters, display and verified routing',async()=>{
 const state={results:[],actions:[]};
 const catalog=provider([feature(),feature({lokalizacja:'Płatna',platnosc:1,przewijak:1})]);
 const client=createMcpClient(createDispatcher({state,provider:catalog}));
 const inventory=await client.callTool('list_data_sources',{});
 assert.equal(inventory.sources.find(s=>s.category==='toilet').title,'Toalety');
 for(const key of ['paid','accessible','changingTable']) assert.ok(inventory.filters.includes(key));
 const all=await client.callTool('search_places',{category:'toilet',accessible:true}); assert.equal(all.total,2);
 const selected=await client.callTool('filter_results',{paid:false,changingTable:false}); assert.equal(selected.total,1);
 const id=selected.results[0].id;
 const displayed=await client.callTool('display_results',{ids:[id],highlightIds:[id],title:'Toalety'});
 assert.equal(displayed.action.results[0].paid,false); assert.equal(displayed.action.highlights[0].lat,52.2634839987203);
 const plan=await client.callTool('plan_transit',{destinationId:id}); assert.equal(plan.action.destination.longitude,20.9895859993675);
 for(const value of ['false',0,1,null,{},[]]) for(const name of ['search_places','filter_results']) await assert.rejects(client.callTool(name,{paid:value}));
 const appState={results:[],actions:[]};
 const app=await executeTool('search_places',{category:'toilet',paid:true,changingTable:true},appState,catalog);
 assert.equal(app.total,1); assert.equal(app.results[0].address,'Płatna');
 assert.match(SYSTEM_PROMPT,/category toilet/); assert.match(SYSTEM_PROMPT,/nie potwierdzają otwarcia teraz/);
});

test('real stdio accepts toilet filters and emits sourced display records',{timeout:5000},async()=>{
 // Real entry point and protocol with a deterministic public-record transport fixture.
 const boot=`globalThis.fetch=async()=>Response.json(${JSON.stringify([feature()])});await import('./mcp/stdio.mjs');`;
 const proc=spawn(process.execPath,['--input-type=module','--eval',boot],{cwd:new URL('..',import.meta.url),stdio:['pipe','pipe','pipe'],env:{...process.env,DATA_API_KEY:'test-city-token'}});
 const lines=createInterface({input:proc.stdout}),pending=new Map(); let stderr='';
 proc.stderr.on('data',d=>stderr+=d);
 lines.on('line',line=>{const msg=JSON.parse(line);pending.get(msg.id)?.(msg);pending.delete(msg.id);});
 const request=(id,method,params)=>new Promise(resolve=>{pending.set(id,resolve);proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 const call=async(id,name,args)=>JSON.parse((await request(id,'tools/call',{name,arguments:args})).result.content[0].text);
 try {
  await request(1,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'toilet-test',version:'1'}});
  proc.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const inventory=await call(2,'list_data_sources',{}); assert.ok(inventory.sources.some(s=>s.category==='toilet'));
  const found=await call(3,'search_places',{category:'toilet',paid:false}); assert.equal(found.complete,true); assert.equal(found.total,1);
  const id=found.results[0].id;
  const displayed=await call(4,'display_results',{ids:[id],highlightIds:[id],title:'Toalety'});
  assert.equal(displayed.action.results[0].category,'toilet'); assert.match(displayed.action.results[0].sourceUrl,/59485767/);
  assert.equal(stderr,'');
 } finally {proc.stdin.end();proc.kill();}
});
