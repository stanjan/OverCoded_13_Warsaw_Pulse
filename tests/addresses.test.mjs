import test from 'node:test';
import assert from 'node:assert/strict';
import { createAddressProvider, ADDRESS_SOURCE, ADDRESS_TTL_MS } from '../mcp/addresses.mjs';
import { createDispatcher } from '../mcp/protocol.mjs';
import { createMcpClient } from '../mcp/client.mjs';
import { executeTool } from '../server/tools.mjs';
import { createAssistant, SYSTEM_PROMPT } from '../server/assistant.mjs';

const raw = (street = 'ulica Kolejowa', number = '9', extra = {}) => ({ city: 'Warszawa', street, number, x: '20.9722382168962', y: '52.2238344514483', accuracy: '0.76', street_accuracy: '0.6', ...extra });
const envelope = results => ({ type: 'address', 'found objects': 15, 'returned objects': results.length, results: results.length ? Object.fromEntries(results.map((v,i)=>[i+1,v])) : null });
const provider = (results, options = {}) => createAddressProvider({ fetchImpl: async () => Response.json(envelope(results)), ...options });
const query = { street: 'Kolejowa', number: '9' };
const toolCall = (name,args) => ({id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}});

test('GUGiK requests exact house number, EPSG:4326, rejects redirects and verifies local names rather than confidence scores', async () => {
  const source = provider([raw(),raw('ulica Szalejowa'),raw('ulica Kolorowa')], { now:()=>Date.parse('2026-10-17T12:00:00Z'), fetchImpl: async (url,options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, ADDRESS_SOURCE.url);
    assert.equal(parsed.searchParams.get('address'),'Warszawa, ul. KOLEJOWA 9');
    assert.equal(parsed.searchParams.get('exact_number'),'1'); assert.equal(parsed.searchParams.get('srid'),'4326');
    assert.equal(options.redirect,'error'); assert.equal(options.headers.Authorization,undefined); assert.ok(options.signal);
    return Response.json(envelope([raw(),raw('ulica Szalejowa'),raw('ulica Kolorowa')]));
  }});
  const found = await source.search({street:'ul. KOLEJOWA',number:'9'});
  assert.equal(found.status,'exact_match'); assert.equal(found.returned,3);
  assert.equal(found.addressId,found.candidates[0].id); assert.equal(found.candidates[0].match,'exact');
  assert.deepEqual(found.candidates.slice(1).map(c=>c.match),['approximate','approximate']);
  assert.equal(found.candidates[0].latitude,52.2238344514483); assert.equal(found.candidates[0].longitude,20.9722382168962);
  assert.equal(found.source.fetchedAt,'2026-10-17T12:00:00.000Z'); assert.equal(found.source.crs,'EPSG:4326');
});

test('address normalization handles Polish case/diacritics and exact suffixes without substituting another house or city', async () => {
  assert.equal((await provider([raw('ulica Łąkowa','9A')]).search({street:'lakowa',number:'9a'})).status,'exact_match');
  for (const row of [raw('ulica Kolejowa','9A'),raw('ulica Kolejowa','11'),raw('ulica Kolorowa','9')]) {
    const found=await provider([row]).search(query); assert.equal(found.status,'clarification_required'); assert.equal(found.addressId,undefined);
  }
  const outside=await provider([raw('ulica Kolejowa','9',{city:'Kraków'})]).search(query);
  assert.equal(outside.status,'not_found'); assert.deepEqual(outside.candidates,[]);
  const multiple=await provider([raw(),raw('ulica Kolejowa','9',{x:20.98})]).search(query);
  assert.equal(multiple.status,'clarification_required'); assert.equal(multiple.addressId,undefined);
  assert.equal((await provider([raw(),raw()]).search(query)).candidates.length,1);
});

test('real no-building schema with found objects 15 and results null is an honest not_found', async () => {
  const found=await provider([]).search(query); assert.equal(found.status,'not_found'); assert.equal(found.returned,0); assert.deepEqual(found.candidates,[]);
});

test('source errors, street centroids, invalid coordinates, malformed payloads, overflow and timeout never become not_found', async () => {
  const cases=[
    async()=>new Response('Unavailable',{status:503}),
    async()=>Response.json({...envelope([raw()]),type:'street'}),
    async()=>Response.json(envelope([raw('ulica Kolejowa','9',{x:'52.22',y:'20.97'})])),
    async()=>Response.json(envelope([raw('ulica Kolejowa','9',{x:'NaN'})])),
    async()=>Response.json(envelope([raw('ulica Kolejowa','9',{y:null})])),
    async()=>Response.json(envelope([raw('<script>bad</script>')])),
    async()=>Response.json({...envelope([]),results:[]}),
    async()=>Response.json({...envelope([raw()]),'returned objects':0}),
    async()=>new Response('bad JSON'),
    async()=>new Response('x'.repeat(256*1024+1)),
    async()=>new Response('{}',{headers:{'content-length':String(256*1024+1)}}),
    async()=>{throw new Error('Do not expose provider secret');},
    async(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})),
  ];
  for (const fetchImpl of cases) await assert.rejects(createAddressProvider({fetchImpl,timeoutMs:5}).search(query), error => error.code.startsWith('ADDRESS_') && !error.message.includes('secret'));
});

test('query validation rejects missing house numbers, non-Warsaw and control/markup before any network call', async () => {
  let fetched=false; const source=createAddressProvider({fetchImpl:async()=>{fetched=true;}});
  for (const args of [{street:'Kolejowa',number:''},{street:'',number:'9'},{...query,city:'Kraków'},{...query,street:'<b>Kolejowa</b>'},{...query,number:'9\n'}]) {
    await assert.rejects(source.search(args),{code:'ADDRESS_QUERY_INVALID'});
  }
  assert.equal(fetched,false);
});

test('shared MCP protocol retains independent origin+destination address IDs and event results; rejects fuzzy/stale IDs and mixed targets', async () => {
  const state={results:[{id:'event-1',name:'Koncert',lat:52.2,lng:21}],actions:[]};
  const addressProvider=createAddressProvider({fetchImpl:async url=>Response.json(envelope([new URL(url).searchParams.get('address').includes('Prosta')?raw('ulica Prosta','1',{x:21}):raw(),raw('ulica Kolorowa')]))});
  const client=createMcpClient(createDispatcher({state,addressProvider}));
  assert.ok((await client.listTools()).find(t=>t.name==='search_addresses'));
  const start=await client.callTool('search_addresses',{street:'Prosta',number:'1'}), goal=await client.callTool('search_addresses',query);
  const plan=await client.callTool('plan_transit',{originAddressId:start.addressId,destinationAddressId:goal.addressId});
  assert.equal(plan.status,'planning_requested'); assert.equal(plan.action.origin.label,'ulica Prosta 1, Warszawa'); assert.equal(plan.action.destination.longitude,20.9722382168962);
  assert.deepEqual(state.results,[{id:'event-1',name:'Koncert',lat:52.2,lng:21}]);
  for (const args of [{destinationAddressId:goal.candidates[1].id},{destinationAddressId:'invented'},{destinationAddressId:goal.addressId,destinationId:'event-1'},{destinationAddressId:goal.addressId,originAddressId:start.addressId,originQuery:'Dw. Centralny'}]) await assert.rejects(client.callTool('plan_transit',args));
  const gpsPlan=await client.callTool('plan_transit',{destinationAddressId:goal.addressId}); assert.equal(Object.hasOwn(gpsPlan.action,'origin'),false);
  state.addressSearches.forEach(set=>set.expiresAt=Date.now()-1);
  await assert.rejects(client.callTool('plan_transit',{destinationAddressId:goal.addressId}));
  const old=await client.callTool('plan_transit',{destinationId:'event-1'}); assert.equal(old.action.destination.label,'Koncert');
});

test('bounded address sets expire/replace without touching event results and failed refresh cannot reuse prior query IDs', async () => {
  const state={results:[],actions:[]}; let fail=false;
  const addressProvider=createAddressProvider({fetchImpl:async url=>{
    if(fail) throw Error('unavailable');
    const address=new URL(url).searchParams.get('address'); const number=address.match(/\d+$/)[0];
    return Response.json(envelope([raw('ulica Kolejowa',number)]));
  }});
  const search=number=>executeTool('search_addresses',{street:'Kolejowa',number},state,undefined,addressProvider);
  const prior=await search('9'), different=await search('8'); fail=true;
  await assert.rejects(search('9'));
  await assert.rejects(executeTool('plan_transit',{destinationAddressId:prior.addressId},state));
  await executeTool('plan_transit',{destinationAddressId:different.addressId},state);
  fail=false;
  for(let i=1;i<=7;i++)await search(String(i));
  assert.equal(state.addressSearches.length,4); assert.ok(state.addressSearches.every(s=>s.expiresAt<=Date.now()+ADDRESS_TTL_MS));
});

test('assistant retains address clarification state across turns and preserves GPS-origin behavior', async () => {
  let step=0, chosen;
  const assistant=createAssistant({addressProvider:provider([raw(),raw('ulica Kolejowa','9',{x:20.98})]),completion:async history=>{
    if(++step===1)return{tool_calls:[toolCall('search_addresses',query)]};
    if(step===2){const result=JSON.parse(history.at(-1).content);assert.equal(result.status,'clarification_required');chosen=result.candidates[1].id;return{content:'Który z dwóch punktów Kolejowej 9 wybierasz?'};}
    if(step===3)return{tool_calls:[toolCall('plan_transit',{destinationAddressId:chosen})]};
    return{content:'Sprawdzam połączenia do wybranego adresu.'};
  }});
  const first=await assistant.chat({message:'Jak dojechać na Kolejową 9?'}); assert.deepEqual(first.actions,[]);
  const second=await assistant.chat({message:'Drugi punkt',sessionId:first.sessionId});
  assert.equal(second.actions[0].destination.longitude,20.98); assert.equal(Object.hasOwn(second.actions[0],'origin'),false);
  assert.match(SYSTEM_PROMPT,/search_addresses/); assert.match(SYSTEM_PROMPT,/Nie proś o stanowisko/);
});

test('assistant failed refresh invalidation survives a subsequent reply failure instead of resurrecting an old ID', async () => {
  let step=0, oldId, fail=false;
  const source=provider([raw()],{fetchImpl:async()=>{if(fail)throw Error('unavailable');return Response.json(envelope([raw()]));}});
  const assistant=createAssistant({addressProvider:source,completion:async history=>{
    if(++step===1)return{tool_calls:[toolCall('search_addresses',query)]};
    if(step===2){oldId=JSON.parse(history.at(-1).content).addressId;return{content:'Adres potwierdzony.'};}
    if(step===3)return{tool_calls:[toolCall('search_addresses',query)]};
    if(step===4)throw Error('Reply failed after address refresh');
    if(step===5)return{tool_calls:[toolCall('plan_transit',{destinationAddressId:oldId})]};
    assert.ok(JSON.parse(history.at(-1).content).error);
    return{content:'Muszę ponownie sprawdzić adres.'};
  }});
  const first=await assistant.chat({message:'Sprawdź Kolejową 9'}); fail=true;
  await assert.rejects(assistant.chat({message:'Sprawdź ponownie',sessionId:first.sessionId}));
  const third=await assistant.chat({message:'Jedź tam',sessionId:first.sessionId}); assert.deepEqual(third.actions,[]);
});
