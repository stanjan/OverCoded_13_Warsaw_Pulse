import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTool, mcpTools } from '../mcp/tools.mjs';
import { createAssistant, SYSTEM_PROMPT } from '../server/assistant.mjs';
import { fitResultBudget, requestFits, RESULT_LIMITS } from '../server/result-budget.mjs';
import { matches } from '../mcp/catalog.mjs';
const call=(name,args)=>({id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}});
const route={id:'route-1',name:'Spacer nad Wisłą',category:'route',lengthKm:2,description:'Nad Wisłą',districts:['Śródmieście'],dates:[],provenance:{datasetId:'routes'}};
const event={id:'event-1',name:'Wystawa fotografii',category:'event',districts:['Śródmieście'],dates:[{from:'2026-11-20',to:'2026-11-20'}],provenance:{datasetId:'events'}};
const alternatives=[{category:'route',maxLengthKm:3,district:'Śródmieście'},{category:'event',dateFrom:'2026-11-20',dateTo:'2026-11-20',district:'Śródmieście'}];
const envelope=results=>({results,total:results.length,complete:true,dataMode:'official',sources:results.map(record=>({category:record.category,datasetId:record.provenance?.datasetId})),errors:[]});
const provider={search:async filters=>envelope([route,event].filter(record=>matches(record,filters)))};

test('needs instructions explicitly encourage varied sourced suggestions while concrete requests stay focused',()=>{
 assert.match(SYSTEM_PROMPT,/AKTYWNIE zaproponuj kilka różnych/);
 assert.match(SYSTEM_PROMPT,/zmęczony i chcę się zrelaksować/);
 assert.match(SYSTEM_PROMPT,/Nie blokuj pierwszych sugestii pytaniem/);
 assert.match(SYSTEM_PROMPT,/Konkretna prośba o jeden obiekt, kategorię lub dojazd pozostaje skupiona/);
 assert.match(SYSTEM_PROMPT,/Limit jednej polecanej trasy dotyczy kategorii route, a nie całego zestawu inspiracji/);
 assert.ok(mcpTools.find(tool=>tool.name==='search_places').inputSchema.properties.alternatives);
 assert.equal(mcpTools.find(tool=>tool.name==='filter_results').inputSchema.properties.alternatives,undefined);
});

test('atomic alternatives keep independent date and route filters and display one verified mixed set',async()=>{
 const seen=[],state={results:[{id:'old'}],actions:[]};
 const found=await runTool('search_places',{alternatives},state,{search:async filters=>{seen.push(filters);return provider.search(filters);}});
 assert.deepEqual(seen,alternatives);
 assert.deepEqual(found.results.map(record=>record.id),['route-1','event-1']);
 assert.deepEqual(found.searches.map(search=>search.filters),alternatives);
 assert.deepEqual(found.results.map(record=>record.provenance.datasetId),['routes','events']);
 const shown=await runTool('display_results',{ids:['route-1','event-1'],highlightIds:['route-1','event-1'],title:'Pomysły na odpoczynek'},state);
 assert.deepEqual(shown.action.results.map(record=>record.category),['route','event']);
 assert.deepEqual(shown.action.highlightIds,['route-1','event-1']);
 assert.deepEqual(shown.action.searches,found.searches);
 for(const id of ['old','invented'])await assert.rejects(runTool('display_results',{ids:[id],highlightIds:[id],title:'Niezweryfikowane'},state));
});

test('invalid batches fail before fetching or altering the previous selection',async()=>{
 let calls=0;const state={results:[route],actions:[]};
 for(const args of [
 {alternatives:[]},{alternatives:[{category:'route'}]},
 {alternatives:[{category:'route'},{category:'route'}]},
 {alternatives:[{category:'route'},{category:'event'}],district:'Wola'},
 {alternatives:[{category:'route'},{category:'event',dateFrom:'not-a-date'}]},
 {alternatives:[{category:'route'},{category:'parks'}]},
 {alternatives:[{category:'route'},{category:'event'},{category:'sports'},{category:'pitch'}]},
 ])await assert.rejects(runTool('search_places',args,state,{search:async()=>{calls++;return [];}}));
 assert.equal(calls,0);assert.deepEqual(state.results,[route]);
});

test('partial category failure preserves real alternatives and disclosed source errors without leaking exception details',async()=>{
 const state={results:[{id:'previous'}],actions:[]};
 const found=await runTool('search_places',{alternatives},state,{search:async filters=>{
  if(filters.category==='event')throw new Error('private provider exception');return envelope([route]);
 }});
 assert.equal(found.complete,false);assert.deepEqual(found.results,[route]);
 assert.deepEqual(found.errors,[{category:'event',code:'SOURCE_UNAVAILABLE'}]);
 assert.equal(found.searches[1].complete,false);
 assert.equal(JSON.stringify(found).includes('private provider exception'),false);
 await assert.rejects(runTool('display_results',{ids:['previous'],highlightIds:['previous'],title:'Old'},state));
});

test('ordinary search still replaces a mixed batch, and failed refresh cannot revive its IDs',async()=>{
 const state={results:[],actions:[]};await runTool('search_places',{alternatives},state,provider);
 await runTool('search_places',{category:'event'},state,provider);
 assert.deepEqual(state.results,[event]);
 await assert.rejects(runTool('display_results',{ids:['route-1'],highlightIds:['route-1'],title:'Old route'},state));
 await assert.rejects(runTool('search_places',{category:'event'},state,{search:async()=>{throw new Error('down');}}));
 assert.deepEqual(state.results,[]);assert.equal(state.searchMeta.complete,false);
});

test('category-balanced capacity preview retains dated future events and a route, with full originals only on server',async()=>{
 const records=[...Array.from({length:40},(_,i)=>({...event,id:'event-'+i,description:'x'.repeat(160000)})),{...route,description:'r'.repeat(160000)}];
 const result={...envelope(records),searches:alternatives.map(filters=>({filters,complete:true}))};
 const fitted=fitResultBudget(result,{now:new Date('2026-10-18'),filters:{alternatives},location:{status:'available',source:'browser_geolocation',latitude:52.23,longitude:21.01}});
 assert.equal(fitted.response.status,'preview');
 assert.equal(fitted.response.narrowing.selection,'category_balanced_examples');
 assert.equal(fitted.response.narrowing.fieldsProjected,true);
 assert.deepEqual(fitted.records.slice(0,2).map(record=>record.category),['route','event']);
 assert.ok(fitted.response.results.every(record=>record.description.length<=1500));
 assert.ok(fitted.records.every(record=>record.description.length===160000));
 assert.equal(fitted.response.results.find(record=>record.category==='event').dates[0].from,'2026-11-20');
 assert.ok(JSON.stringify(fitted.response).length<=RESULT_LIMITS.toolCharacters);
 assert.ok(requestFits([{role:'tool',content:JSON.stringify(fitted.response)}]));
});

test('assistant publishes varied verified suggestions together; later filtering recovers full batch records without refetching',async()=>{
 const extra={...event,id:'event-extra',districts:['Wola'],description:'x'.repeat(160000)};
 const many=[...Array.from({length:100},(_,i)=>({...event,id:'event-'+i,description:'x'.repeat(160000)})),extra,route];
 const batch=alternatives.map(({district,...filters})=>filters);
 let searches=0,step=0;
 const assistant=createAssistant({now:()=>new Date('2026-10-18'),provider:{search:async filters=>{searches++;return envelope(many.filter(record=>record.category===filters.category));}},completion:async history=>{
  if(++step===1)return{tool_calls:[call('search_places',{alternatives:batch})]};
  if(step===2){
   const found=JSON.parse(history.at(-1).content);assert.equal(found.status,'preview');
   assert.deepEqual(found.results.slice(0,2).map(record=>record.category),['route','event']);
   assert.equal(found.results.some(record=>record.id==='event-extra'),false);
   return{tool_calls:[call('display_results',{ids:found.results.slice(0,2).map(record=>record.id),highlightIds:found.results.slice(0,2).map(record=>record.id),title:'Różne pomysły'})]};
  }
  if(step===3)return{content:'Możesz wybrać spacer nad Wisłą albo wystawę fotografii. Co Ci bardziej odpowiada?'};
  if(step===4)return{tool_calls:[call('filter_results',{district:'Wola',category:'event'})]};
  if(step===5){assert.deepEqual(JSON.parse(history.at(-1).content).results.map(record=>record.id),['event-extra']);return{content:'Pokazuję propozycję na Woli.'};}
  throw new Error('Unexpected completion');
 }});
 const first=await assistant.chat({message:'Jestem zmęczony, chcę się zrelaksować'});
 assert.equal(first.actions.length,1);assert.deepEqual(first.actions[0].results.map(record=>record.category),['route','event']);
 const next=await assistant.chat({message:'Pokaż wydarzenia na Woli',sessionId:first.sessionId});
 assert.equal(searches,2);assert.deepEqual(next.actions[0].results.map(record=>record.id),['event-extra']);
});

test('mixed display permits two other recommendations but only one tourist route',async()=>{
 const records=[route,{...route,id:'route-2'},event,{...event,id:'event-2'}],state={results:records,searchMeta:{complete:true},actions:[]};
 const shown=await runTool('display_results',{ids:records.map(record=>record.id),highlightIds:['route-1','event-1','event-2'],title:'Różnorodnie'},state);
 assert.equal(shown.highlightIds.length,3);
 const clamped=await runTool('display_results',{ids:records.map(record=>record.id),highlightIds:['route-1','route-2','event-1'],title:'Jedna trasa'},state);
 assert.deepEqual(clamped.highlightIds,['route-1','event-1']);
});


test('automatic fallback highlights different categories before repeating one and names those real examples',async()=>{
 let step=0;const otherRoute={...route,id:'route-2',name:'Drugi spacer'},sports={id:'sports-1',category:'sports',name:'Zajęcia',weekdays:['Poniedziałek']};
 const sets=[{category:'route'},{category:'event'},{category:'sports'}];
 const assistant=createAssistant({provider:{search:async filters=>envelope([route,otherRoute,event,sports].filter(record=>record.category===filters.category))},completion:async()=>{
  if(++step===1)return{tool_calls:[call('search_places',{alternatives:sets})]};
  return{content:'Jakiej aktywności szukasz?'};
 }});
 const reply=await assistant.chat({message:'Nie wiem co robić, podaj różne pomysły'});
 assert.deepEqual(reply.actions[0].highlightIds,['route-1','event-1','sports-1']);
 assert.match(reply.message,/Spacer nad Wisłą/);assert.match(reply.message,/Wystawa fotografii/);assert.match(reply.message,/Zajęcia/);
 assert.equal(reply.message.includes('Drugi spacer'),false);
});
