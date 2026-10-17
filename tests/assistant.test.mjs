import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAssistant as createRealAssistant, bridgeCompletion, SYSTEM_PROMPT } from '../server/assistant.mjs';
import { executeTool as executeRealTool } from '../server/tools.mjs';
import { provider } from './catalog-fixture.mjs';
const createAssistant = options => createRealAssistant({ ...options, provider });
const executeTool = (name,args,state) => executeRealTool(name,args,state,provider);
const call = (name, args) => ({ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } });
test('search, filter and display share verified results', async () => {
  const state = { results: [], actions: [] };
  const found = await executeTool('search_places', { category: 'event' }, state);
  assert.equal(found.results.length, 2);
  await executeTool('filter_results', { bounds: { south: 52.24, north: 52.25, west: 21.02, east: 21.04 } }, state);
  assert.equal(state.results.length, 1);
  await executeTool('display_results', { ids: ['demo-kopernik'], highlightIds: ['demo-kopernik'], title: 'Kultura' }, state);
  assert.equal(state.actions[0].results[0].id, 'demo-kopernik');
  await assert.rejects(executeTool('display_results', { ids: ['invented'], highlightIds: ['invented'], title: 'Fake' }, state));
});
test('tool arguments reject out-of-range coordinates and unsupported filters', async () => {
  const state = { results: [], actions: [] };
  for (const args of [{ latitude: 900, longitude: 21, zoom: 12 }, { latitude: 52, longitude: 21, zoom: '12' }, { latitude: 52, longitude: 21, zoom: 12, command: 'exec' }]) await assert.rejects(executeTool('focus_map', args, state));
  await assert.rejects(executeTool('search_places', { limit: 500 }, state));
  await assert.rejects(executeTool('search_places', { bounds: { south: 53, north: 52, east: 21, west: 20 } }, state));
});
test('assistant runs tools and retains context without sharing sessions', async () => {
  let turn = 0;
  const assistant = createAssistant({ completion: async history => {
    assert.ok(history[0].content.startsWith(SYSTEM_PROMPT));
    assert.match(history[0].content,/Europe\/Warsaw/);
    if (++turn === 1) return { content: null, tool_calls: [call('search_places', { category: 'event' })] };
    if (turn === 2) {
      assert.equal(JSON.parse(history.at(-1).content).results.length, 2);
      return { content: null, tool_calls: [call('display_results', { ids: ['demo-kopernik'], highlightIds: ['demo-kopernik'], title: 'Kultura' })] };
    }
    return { content: 'Pokazuję miejsce na mapie. To dane demonstracyjne.' };
  } });
  const first = await assistant.chat({ message: 'Pokaż kulturę' });
  assert.equal(first.actions[0].results[0].id, 'demo-kopernik');
  const second = await assistant.chat({ message: 'Dziękuję', sessionId: first.sessionId });
  assert.equal(second.sessionId, first.sessionId);
  const separate = await assistant.chat({ message: 'Cześć' });
  assert.notEqual(separate.sessionId, first.sessionId);
});
test('failed turns do not commit partial conversation or UI actions', async () => {
  let step = 0;
  const assistant = createAssistant({ completion: async history => {
    step++;
    if (step === 1) return { tool_calls: [call('search_places', {})] };
    if (step === 2) throw new Error('offline');
    assert.equal(history.filter(m => m.role === 'user').length, 1);
    return { content: 'Cześć!' };
  } });
  await assert.rejects(assistant.chat({ message: 'Pokaż miejsca' }));
  assert.deepEqual((await assistant.chat({ message: 'Cześć' })).actions, []);
});
test('tool loops are bounded', async () => {
  let calls = 0;
  const assistant = createAssistant({ completion: async () => { calls++; return { tool_calls: [call('search_places', {})] }; } });
  await assert.rejects(assistant.chat({ message: 'Test' }), /zbyt wielu/);
  assert.equal(calls, 6);
});
test('bridge adapter sends tool schemas and uses only loopback', async () => {
  const old = process.env.CODEX_BRIDGE_URL;
  try {
    process.env.CODEX_BRIDGE_URL = 'http://127.0.0.1:9999/v1';
    const reply = await bridgeCompletion([{ role: 'user', content: 'Cześć' }], { fetchImpl: async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:9999/v1/chat/completions');
      assert.equal(JSON.parse(init.body).tools.length, 4);
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'Cześć!' } }] }) };
    } });
    assert.equal(reply.content, 'Cześć!');
    process.env.CODEX_BRIDGE_URL = 'http://example.com/v1';
    await assert.rejects(bridgeCompletion([]), /lokalny/);
    delete process.env.CODEX_BRIDGE_URL;
    await assert.rejects(bridgeCompletion([]), /połączony/);
  } finally { if (old === undefined) delete process.env.CODEX_BRIDGE_URL; else process.env.CODEX_BRIDGE_URL = old; }
});

test('assistant selects context subset from all MCP matches and preserves incomplete provenance next turn', async () => {
  const records = [
    {id:'one',name:'Koncert',category:'event',district:'Wola',districts:['Wola'],description:'Muzyka'},
    {id:'two',name:'Wystawa',category:'event',district:'Wola',districts:['Wola'],description:'Sztuka'},
    {id:'three',name:'Koncert 2',category:'event',district:'Ochota',districts:['Ochota'],description:'Muzyka'},
  ];
  let step=0;
  const assistant=createRealAssistant({provider:{search:async()=>({results:records,total:3,complete:false,dataMode:'official',sources:[{category:'event',complete:true}],errors:[{category:'sports',code:'SOURCE_UNAVAILABLE'}]})},completion:async history=>{
    step++;
    if(step===1)return{tool_calls:[call('search_places',{category:'event'})]};
    if(step===2){assert.equal(JSON.parse(history.at(-1).content).results.length,3);return{tool_calls:[call('display_results',{ids:['one'],highlightIds:['one'],title:'Muzyka na Woli'})]};}
    if(step===3)return{content:'Polecam koncert na Woli. Część źródeł jest niedostępna.'};
    if(step===4)return{tool_calls:[call('display_results',{ids:['one'],highlightIds:['one'],title:'Ponownie'})]};
    return{content:'Pokazuję koncert. Część źródeł jest niedostępna.'};
  }});
  const first=await assistant.chat({message:'Chcę muzykę na Woli'});
  assert.deepEqual(first.actions[0].results.map(r=>r.id),['one']);assert.equal(first.actions[0].complete,false);
  const next=await assistant.chat({message:'Pokaż ponownie',sessionId:first.sessionId});
  assert.equal(next.actions[0].complete,false);assert.equal(next.actions[0].errors[0].category,'sports');
});
test('bridge rejects oversized complete result payload explicitly before network, without slicing',async()=>{
 const old=process.env.CODEX_BRIDGE_URL;let called=false;
 try{
  process.env.CODEX_BRIDGE_URL='http://127.0.0.1:8780/v1';
  await assert.rejects(bridgeCompletion([{role:'tool',content:'x'.repeat(1000001)}],{fetchImpl:async()=>{called=true;}}),error=>error.status===413&&/żaden wynik/.test(error.message));
  assert.equal(called,false);
 }finally{if(old===undefined)delete process.env.CODEX_BRIDGE_URL;else process.env.CODEX_BRIDGE_URL=old;}
});
