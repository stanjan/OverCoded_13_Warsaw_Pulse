import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createCatalog,normalizeRecord,matches,locate} from '../mcp/catalog.mjs';
import {createDispatcher} from '../mcp/protocol.mjs';
import {createMcpClient} from '../mcp/client.mjs';
import {executeTool} from '../server/tools.mjs';
const response = payload => ({ok:true,json:async()=>payload});
const event = {title:'Koncert',text:'<p>Muzyka dla rodzin</p>',localization:[{name:'Praga-Północ'},{name:'Targówek'}],map:{features:[{geometry:{type:'Point',coordinates:[21.03,52.25]},properties:{district:'Praga-Północ'}},{geometry:{type:'Point',coordinates:[21.05,52.28]},properties:{district:'Targówek'}}]},occurrence:[{from:'2026-10-17T12:00:00+02',to:'2026-10-18T12:00:00+02'}]};
const pitch={Dzielnica:'Wola','Nazwa placówki oświatowej':'Szkoła','Typ obiektu':'Koszykówka',Poniedziałek:'Od 17:00 do 20:00',Wtorek:'Zamknięte',Środa:'-','Data aktualizacji':'2026-07-02'};
const at='2026-10-17T14:30:00Z';
test('official event photos survive normalization as HTTPS without accepting executable or credential URLs',()=>{
 const record=normalizeRecord({...event,image:{small:{path:'http://um.warszawa.pl/documents/event.jpg'},highlighted:{path:'https://um.warszawa.pl/documents/large.jpg'}}},'event',at);
 assert.equal(record.imageUrl,'https://um.warszawa.pl/documents/event.jpg');
 for(const path of ['javascript:alert(1)','data:image/svg+xml,unsafe','https://user:password@example.com/event.jpg']) {
  assert.equal(normalizeRecord({...event,image:{small:{path}}},'event',at).imageUrl,null);
 }
 assert.equal(normalizeRecord(event,'event',at).imageUrl,null);
});
test('city POST uses raw authorization and returns entire 1227-record dataset without truncation',async()=>{
 let calls=0;
 const provider=createCatalog({token:()=> 'test-city-token',now:()=>at,fetchImpl:async(url,init)=>{
   calls++;assert.equal(url,'https://dane.um.warszawa.pl/api/action/get_be_otwarte_boiska');assert.equal(init.method,'POST');assert.equal(init.headers.Authorization,'test-city-token');
   return response(Array.from({length:1227},(_,i)=>({...pitch,'Nazwa placówki oświatowej':'Szkoła '+i})));
 }});
 const result=await provider.search({category:'pitch',district:'wola'});
 assert.equal(result.results.length,1227);assert.equal(result.total,1227);assert.equal(result.complete,true);assert.equal(calls,1);assert.equal(result.sources[0].fetched,1227);
 assert.equal(result.results[0].lat,undefined);assert.equal(result.results[0].provenance.sourceUpdatedAt,'2026-07-02');assert.equal(result.results[0].provenance.fetchedAt,at);
});
test('routes use verified result wrapper; unknown paginated envelope reports incomplete source',async()=>{
 const source=createCatalog({token:()=> 'test',fetchImpl:async()=>response({result:[{title:'Spacer',length:'3.23',description:'Trasa',traces:[[52.23,21.02]]}]})});
 const found=await source.search({category:'route',maxLengthKm:4});assert.equal(found.results.length,1);assert.equal(found.results[0].lat,52.23);
 const changed=createCatalog({token:()=> 'test',fetchImpl:async()=>response({result:[event],next:'page2'})});
 const failed=await changed.search({category:'event'});assert.equal(failed.complete,false);assert.equal(failed.errors[0].code,'SOURCE_SCHEMA_OR_PAGINATION_CHANGED');
});
test('missing key, HTTP failures and bad records cannot appear as successful empty catalogues',async()=>{
 for(const provider of [
 createCatalog({token:()=>''}),
 createCatalog({token:()=> 'test',fetchImpl:async()=>({ok:false,status:401})}),
 createCatalog({token:()=> 'test',fetchImpl:async()=>{throw new Error('secret credential should not escape');}}),
 createCatalog({token:()=> 'test',fetchImpl:async()=>response([{unexpected:'schema'}])}),
 ]){const found=await provider.search({category:'event'});assert.equal(found.complete,false);assert.equal(found.errors.length,1);assert.deepEqual(found.results,[]);assert.ok(!JSON.stringify(found).includes('secret credential'));}
});
test('partial multi-source failures retain working sources with explicit completeness and errors',async()=>{
 const provider=createCatalog({token:()=> 'test',fetchImpl:async url=> url.endsWith('get_bmm_kalendarz_wydarzen')?response([event]):({ok:false,status:503})});
 const found=await provider.search();assert.equal(found.results.length,1);assert.equal(found.complete,false);assert.equal(found.errors.length,5);
});
test('event date, district and bounds select the same actual source location',()=>{
 const record=normalizeRecord(event,'event',at);
 const filters={district:'Targówek',bounds:{south:52.27,north:52.29,west:21.04,east:21.06},dateFrom:'2026-10-18',dateTo:'2026-10-18'};
 assert.equal(matches(record,filters),true);assert.equal(locate(record,filters).lat,52.28);
 assert.equal(matches(record,{...filters,bounds:{south:52.24,north:52.26,west:21.02,east:21.04}}),false);
 assert.equal(matches(record,{dateFrom:'2026-10-19'}),false);
 assert.equal(record.locations.length,2);
});
test('unknown metadata and undated recurring sports do not satisfy date/audience/spatial filters',()=>{
 const record=normalizeRecord({title:'Fitness',day:[{name:'Poniedziałek'}],dedicated:[{name:'Seniorzy'}],localization:[{name:'Wola'}],time:'17:00'},'sports',at);
 assert.equal(matches(record,{weekday:'Poniedziałek',audience:'Seniorzy'}),true);
 assert.equal(matches(record,{dateFrom:'2026-10-17'}),false);
 assert.equal(matches(record,{audience:'Dzieci'}),false);
 assert.equal(matches(record,{bounds:{south:50,north:53,west:20,east:22}}),false);
});
test('pitch weekdays require source hours and exclude explicit closed/unknown schedules',()=>{
 const record=normalizeRecord(pitch,'pitch',at);
 assert.equal(matches(record,{weekday:'Poniedziałek'}),true);assert.equal(matches(record,{weekday:'Wtorek'}),false);assert.equal(matches(record,{weekday:'Środa'}),false);
});
test('weather/air preserve observation times separately from fetch and reject invalid coordinates',()=>{
 const weather=normalizeRecord({lokalizacja:'Stacja',czas:'2026-01-01 12:00:00',lat:999,lon:21,temp_pow:0},'weather',at);
 assert.equal(weather.lat,undefined);assert.equal(weather.airTemperatureC,0);assert.equal(weather.live,false);assert.equal(weather.provenance.observedAt[0],'2026-01-01 12:00:00');assert.equal(weather.provenance.freshness,'unverified_source_time');
 const air=normalizeRecord({name:'Stacja',data:[{time:'2026-10-17 16:00:00',value:0,unit:'µg/m3',param_code:'PM10'}],lat:52,lon:21},'air_quality',at);
 assert.equal(air.measurements[0].value,0);assert.equal(air.provenance.timeZone,'Europe/Warsaw');
});
test('application search/display cross MCP client lifecycle and preserve all selected records',async()=>{
 const records=Array.from({length:25},(_,i)=>normalizeRecord({...event,title:'Wydarzenie '+i},'event',at));
 const state={results:[],actions:[]},provider={search:async()=>({results:records,total:25,complete:true,dataMode:'official',sources:[],errors:[]})};
 const found=await executeTool('search_places',{category:'event'},state,provider);assert.equal(found.results.length,25);
 const result=await executeTool('display_results',{ids:records.map(r=>r.id),highlightIds:[records[24].id],title:'Polecane'},state,provider);
 assert.equal(result.displayed,25);assert.equal(result.action,undefined);assert.equal(state.actions[0].highlights[0].id,records[24].id);
 for(const args of [
 {ids:[records[0].id],highlightIds:[],title:'A'},
 {ids:[records[0].id],highlightIds:[records[1].id],title:'A'},
 {ids:['fake'],highlightIds:['fake'],title:'A'},
 {ids:[records[0].id],highlightIds:[records[0].id,records[0].id],title:'A'},
 ])await assert.rejects(executeTool('display_results',args,state,provider));
});
test('MCP malformed params, initialization ordering, unknown tools and execution failures are distinguished',async()=>{
 const dispatch=createDispatcher();
 const rpc=(id,method,params)=>dispatch({jsonrpc:'2.0',id,method,params});
 assert.equal((await rpc(1,'tools/list',{})).error.code,-32000);
 assert.equal((await rpc(2,'initialize',null)).error.code,-32602);
 const client=createMcpClient(dispatch);assert.equal((await client.listTools()).length,5);
 assert.equal((await rpc(3,'tools/call',null)).error.code,-32602);
 assert.equal((await rpc(4,'tools/call',{name:'fake'})).error.code,-32602);
 assert.equal((await rpc(40,'tools/call',{name:'search_places',arguments:null})).error.code,-32602);
 assert.equal((await rpc(5,'tools/call',{name:'display_results',arguments:{ids:['fake'],highlightIds:['fake'],title:'A'}})).result.isError,true);
 await assert.rejects(client.callTool('search_places',{limit:10}));
 for(const dateFrom of ['','2026-02-30','bad'])await assert.rejects(client.callTool('search_places',{dateFrom}));
});
test('real stdio subprocess emits only newline JSON-RPC and supports initialize/list/call',{timeout:5000},async()=>{
 const proc=spawn(process.execPath,['mcp/stdio.mjs'],{cwd:new URL('..',import.meta.url),stdio:['pipe','pipe','pipe'],env:{...process.env,DATA_API_KEY:''}});
 const lines=createInterface({input:proc.stdout}),pending=new Map();let stderr='';
 proc.stderr.on('data',d=>stderr+=d);
 lines.on('line',line=>{const message=JSON.parse(line);pending.get(message.id)?.(message);pending.delete(message.id);});
 const request=(id,method,params)=>new Promise(resolve=>{pending.set(id,resolve);proc.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
 try{
 assert.equal((await request(1,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}})).result.serverInfo.name,'warsaw-city-data');
 proc.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
 assert.equal((await request(2,'tools/list',{})).result.tools.length,5);
 const reply=await request(3,'tools/call',{name:'search_places',arguments:{category:'weather'}});const data=JSON.parse(reply.result.content[0].text);assert.equal(data.complete,false);assert.equal(data.errors[0].code,'SOURCE_NOT_CONFIGURED');
 assert.equal(stderr,'');
 }finally{proc.stdin.end();proc.kill();}
});
