import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAssistant as createRealAssistant, bridgeCompletion, SYSTEM_PROMPT } from '../server/assistant.mjs';
import { executeTool as executeRealTool } from '../server/tools.mjs';
import { provider } from './catalog-fixture.mjs';
const createAssistant = options => createRealAssistant({ ...options, provider });
const executeTool = (name,args,state) => executeRealTool(name,args,state,provider);
const call = (name, args) => ({ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) } });
test('data inventory answers without fetching records or replacing a prior selection', async () => {
  let searches = 0, step = 0;
  const noFetch = { search: async () => { searches++; throw new Error('Inventory must not fetch'); } };
  const state = { results: [{ id: 'selected' }], actions: [], searchMeta: { complete: false } };
  const inventory = await executeRealTool('list_data_sources', {}, state, noFetch);
  assert.deepEqual(inventory.sources.map(s => s.category), ['event','sports','pitch','route']);
  assert.ok(inventory.filters.includes('district'));
  assert.match(inventory.limitations.join(' '), /teraz otwarty/);
  assert.deepEqual(state, { results: [{ id: 'selected' }], actions: [], searchMeta: { complete: false } });
  const assistant = createRealAssistant({ provider: noFetch, completion: async history => {
    if (++step === 1) return { tool_calls: [call('list_data_sources', {})] };
    assert.equal(JSON.parse(history.at(-1).content).sources.length, 4);
    return { content: 'Mogę wyszukać wydarzenia, zajęcia sportowe, boiska i trasy.' };
  } });
  const answer = await assistant.chat({ message: 'jakie dane masz dostępne?' });
  assert.equal(searches, 0);
  assert.deepEqual(answer.actions, []);
});

test('oversized search stays complete on server and can be refined next turn without refetching', async () => {
  const records = Array.from({length: 200}, (_, i) => ({id:`pitch-${i}`,name:'Boisko',category:'pitch',district:'Wola',districts:['Wola'],description:'Opis '.repeat(2000)}));
  records.push({id:'last',name:'Koncert',category:'event',district:'Ochota',districts:['Ochota'],description:'Muzyka'});
  const errors = [{category:'sports',code:'SOURCE_UNAVAILABLE'}];
  let searches = 0, step = 0;
  const largeProvider = {search:async()=>{searches++;return {results:records,total:records.length,complete:false,dataMode:'official',errors};}};
  const external = await executeRealTool('search_places', {}, {results:[],actions:[]}, largeProvider);
  assert.equal(external.results.length, 201);
  assert.equal(external.results.at(-1).id, 'last');
  searches = 0;
  const assistant = createRealAssistant({provider:largeProvider,completion:async history=>{
    assert.ok(JSON.stringify(history).length < 1000000);
    if (++step === 1) return {tool_calls:[call('search_places',{})]};
    if (step === 3) return {tool_calls:[call('filter_results',{district:'Ochota'})]};
    const result = JSON.parse(history.at(-1).content);
    if (step === 2) {
      assert.equal(result.status,'refinement_required');
      assert.equal(result.total,201);
      assert.equal(result.recordsProvided,0);
      assert.equal(Object.hasOwn(result,'results'),false);
      assert.deepEqual(result.countsByCategory,{pitch:200,event:1});
      assert.equal(result.complete,false);
      assert.deepEqual(result.errors,errors);
      return {content:'Która dzielnica Cię interesuje? Część źródeł jest niedostępna.'};
    }
    if (step === 4) {
      assert.deepEqual(result.results.map(r=>r.id),['last']);
      return {tool_calls:[call('display_results',{ids:['last'],highlightIds:['last'],title:'Ochota'})]};
    }
    return {content:'Pokazuję koncert na Ochocie. Część źródeł jest niedostępna.'};
  }});
  const first = await assistant.chat({message:'Pokaż wszystko'});
  assert.deepEqual(first.actions,[]);
  const next = await assistant.chat({message:'Ochota',sessionId:first.sessionId});
  assert.equal(searches,1);
  assert.deepEqual(next.actions[0].results.map(r=>r.id),['last']);
  assert.equal(next.actions[0].complete,false);
  assert.deepEqual(next.actions[0].errors,errors);
});
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
    assert.equal(history[0].content, SYSTEM_PROMPT);
    assert.ok(history.some(m => m.role === 'system' && m.content.startsWith('Data i czas rozmowy (Europe/Warsaw): ')));
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
      assert.equal(JSON.parse(init.body).tools.length, 6);
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

test('new turn time context preserves exact prior history prefix across minute changes', async () => {
  const histories = [];
  let time = new Date('2026-10-17T15:00:00Z');
  const assistant = createAssistant({
    now: () => time,
    completion: async history => {
      histories.push(structuredClone(history));
      return { content: histories.length === 1 ? 'Pierwsza odpowiedź.' : 'Druga odpowiedź.' };
    },
  });
  const first = await assistant.chat({ message: 'Pierwsze pytanie' });
  time = new Date('2026-10-17T15:01:00Z');
  await assistant.chat({ message: 'Drugie pytanie', sessionId: first.sessionId });
  const [before, after] = histories;
  assert.deepEqual(before[0], { role: 'system', content: SYSTEM_PROMPT });
  assert.deepEqual(after[0], before[0]);
  assert.deepEqual(after.slice(0, before.length), before);
  assert.deepEqual(after[before.length], { role: 'assistant', content: 'Pierwsza odpowiedź.' });
  assert.equal(before[1].role, 'system');
  assert.match(before[1].content, /Europe\/Warsaw.*17:00/);
  assert.equal(after.at(-2).role, 'system');
  assert.match(after.at(-2).content, /Europe\/Warsaw.*17:01/);
  assert.notEqual(after.at(-2).content, before[1].content);
  assert.deepEqual(after.at(-1), { role: 'user', content: 'Drugie pytanie' });
});

test('bridge adapter omits an unset model for automatic routing and preserves an explicit choice', async () => {
  const oldUrl = process.env.CODEX_BRIDGE_URL, oldModel = process.env.CODEX_BRIDGE_MODEL;
  try {
    process.env.CODEX_BRIDGE_URL = 'http://127.0.0.1:9999/v1';
    for (const model of ['', 'claude-cli/default']) {
      process.env.CODEX_BRIDGE_MODEL = model;
      await bridgeCompletion([{ role: 'user', content: 'Cześć' }], { fetchImpl: async (_url, init) => {
        const payload = JSON.parse(init.body);
        assert.equal(Object.hasOwn(payload, 'model'), !!model);
        if (model) assert.equal(payload.model, model);
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'Gotowe.' } }] }) };
      } });
    }
  } finally {
    if (oldUrl === undefined) delete process.env.CODEX_BRIDGE_URL; else process.env.CODEX_BRIDGE_URL = oldUrl;
    if (oldModel === undefined) delete process.env.CODEX_BRIDGE_MODEL; else process.env.CODEX_BRIDGE_MODEL = oldModel;
  }
});
