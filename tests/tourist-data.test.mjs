import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRecord,createCatalog} from '../mcp/catalog.mjs';
import {fitResultBudget,boundDisplayAction} from '../server/result-budget.mjs';
import {createAssistant,SYSTEM_PROMPT} from '../server/assistant.mjs';
import {runTool} from '../mcp/tools.mjs';

// Published city example: sbt_trasy_turystyczne_pw.json, verified 2026-10-18.
const raw={title:'Trakt Królewski cz. 2',length:'3.23',description:'Spacer',traces:[[52.2317949,21.0208465],[52.231948,21.020786]],tourist_points:[{name:'Palma na rondzie de Gaulle’a',latlng:{lat:'52.2317949',lng:'21.0208465'}}]};
const normalize=value=>normalizeRecord(value,'route','2026-10-18T00:00Z');
test('tourist traces preserve official latitude/longitude order, exact vertices and safe named points',()=>{
 const record=normalize(raw);assert.deepEqual(record.traceSegments,[raw.traces]);assert.equal(record.geometryStatus,'published');assert.equal(record.traceVertexCount,2);assert.equal(record.lat,52.2317949);assert.equal(record.lng,21.0208465);assert.equal(record.name,raw.title);assert.equal(record.lengthKm,3.23);assert.deepEqual(record.touristPoints,[{name:'Palma na rondzie de Gaulle’a',lat:52.2317949,lng:21.0208465}]);assert.equal(normalize(raw).id,record.id);
});
test('invalid vertices split the trace rather than inventing a bridge; missing geometry preserves honest point/list fallbacks',()=>{
 const a=[52.2,21],b=[52.21,21.01],c=[52.22,21.02],d=[52.23,21.03];
 const record=normalize({...raw,traces:[a,b,null,c,d]});assert.deepEqual(record.traceSegments,[[a,b],[c,d]]);assert.equal(record.geometryStatus,'partial');
 for(const traces of [undefined,[],[null],[a],[['',21]],[['52',181]]]){const result=normalize({...raw,traces});assert.equal(result.traceSegments.length,0);assert.equal(result.geometryStatus,'unavailable');assert.equal(result.name,raw.title);}
 const points=normalize({...raw,traces:[],tourist_points:[null,{name:'Broken'},{name:'<b>Published</b>',latlng:{lat:'52.3',lng:'21.1'}}]});assert.equal(points.name,raw.title);assert.equal(points.lat,52.3);assert.deepEqual(points.touristPoints,[{name:'Published',lat:52.3,lng:21.1}]);
 assert.equal(normalize({...raw,traces:Array(10001).fill(a)}).geometryStatus,'too_large');
});
test('MCP retains full official geometry while model budgeting omits vertices and hydrates exact selected records',async()=>{
 const provider=createCatalog({token:()=> 'fixture',fetchImpl:async()=>new Response(JSON.stringify({result:[raw]}))});
 const state={results:[],actions:[]};const result=await runTool('search_places',{category:'route'},state,provider);const original=state.results[0];assert.deepEqual(result.results[0].traceSegments,[raw.traces]);
 const fitted=fitResultBudget(result);assert.equal(fitted.records[0],original);assert.equal(Object.hasOwn(fitted.response.results[0],'traceSegments'),false);assert.equal(fitted.response.results[0].traceVertexCount,2);
 state.results=fitted.records;const display=await runTool('display_results',{ids:[original.id],highlightIds:[original.id],title:'Spacer'},state);assert.deepEqual(display.action.results[0].traceSegments,[raw.traces]);
});
test('browser description projection preserves real tourist geometry; excessive geometry falls back explicitly without truncated paths',()=>{
 const record=normalize({...raw,description:'x'.repeat(300000)}),action={type:'display_results',results:[record],highlightIds:[record.id],highlights:[record]};boundDisplayAction(action);assert.deepEqual(action.results[0].traceSegments,[raw.traces]);assert.deepEqual(action.highlights[0].touristPoints,record.touristPoints);assert.ok(JSON.stringify(action).length<250000);
 const large=normalize({...raw,traces:Array.from({length:10000},(_,i)=>[52.2+i/1000000,21.0123456789])}),huge={type:'display_results',results:[large],highlightIds:[large.id],highlights:[large]};boundDisplayAction(huge);assert.equal(huge.results[0].traceSegments.length,0);assert.equal(huge.results[0].geometryStatus,'browser_capacity');assert.equal(large.traceSegments[0].length,10000);assert.ok(JSON.stringify(huge).length<250000);
});
test('assistant exposes geometry to browser actions without sending vertices in search or display tool history',async()=>{
 const histories=[];let turn=0;const record=normalize(raw);
 const assistant=createAssistant({provider:{search:async()=>({results:[record],total:1,complete:true,sources:[],errors:[]})},completion:async history=>{histories.push(structuredClone(history));turn++;if(turn===1)return{tool_calls:[{id:'search',type:'function',function:{name:'search_places',arguments:'{"category":"route"}'}}]};if(turn===2)return{tool_calls:[{id:'display',type:'function',function:{name:'display_results',arguments:JSON.stringify({ids:[record.id],highlightIds:[record.id],title:'Spacer'})}}]};return{content:'Oto trasa.'};}});
 const result=await assistant.chat({message:'Pokaż spacer'});assert.deepEqual(result.actions.find(action=>action.type==='display_results').results[0].traceSegments,[raw.traces]);for(const history of histories)for(const item of history.filter(item=>item.role==='tool'))assert.doesNotMatch(item.content,/traceSegments/);
});

test('MCP and browser boundaries permit one tourist highlight while keeping three event highlights',async()=>{
 const records=[1,2,3].map(number=>({...normalize(raw),id:'route'+number}));const events=[1,2,3].map(number=>({id:'event'+number,category:'event',name:'Event '+number}));
 const display=async(results,highlightIds)=>runTool('display_results',{ids:results.map(record=>record.id),highlightIds,title:'Propozycje'},{results,actions:[],searchMeta:{complete:true}});
 assert.deepEqual((await display(records,records.map(record=>record.id))).highlightIds,['route1']);assert.deepEqual((await display(events,events.map(record=>record.id))).highlightIds,['event1','event2','event3']);assert.deepEqual((await display([...records,...events],['route2','event1','route1'])).highlightIds,['route2','event1']);
 const action={type:'display_results',results:records,highlightIds:['route3','route2'],highlights:[records[2],records[1]]};boundDisplayAction(action);assert.deepEqual(action.highlightIds,['route3']);assert.equal(action.highlights[0],records[2]);
});
test('tourist selection guidance uses explicit needs and fallback gives one sourced proposal before asking a useful question',async()=>{
 assert.match(SYSTEM_PROMPT,/JEDNĄ polecaną trasę/);assert.match(SYSTEM_PROMPT,/lengthKm.*touristPoints/);assert.match(SYSTEM_PROMPT,/maxLengthKm/);assert.match(SYSTEM_PROMPT,/krótko uzasadnij/);assert.match(SYSTEM_PROMPT,/Nie wnioskuj dostępności/);
 const records=[{...normalize(raw),id:'short',name:'Krótki szlak',lengthKm:2},{...normalize(raw),id:'long',name:'Długi szlak',lengthKm:8}];let turn=0;
 const assistant=createAssistant({provider:{search:async()=>({results:records,total:2,complete:true,sources:[],errors:[]})},completion:async()=>++turn===1?{tool_calls:[{id:'search',type:'function',function:{name:'search_places',arguments:'{"category":"route"}'}}]}:{content:'Jaka trasa Cię interesuje?'}});
 const reply=await assistant.chat({message:'Pokaż trasy turystyczne'});const display=reply.actions.find(action=>action.type==='display_results');assert.deepEqual(display.highlightIds,['short']);assert.match(reply.message,/Krótki szlak/);assert.match(reply.message,/2 km według źródła/);assert.match(reply.message,/Palma na rondzie/);assert.match(reply.message,/Wolisz krótszy spacer czy konkretny temat\?/);
});
