import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeCompletion, createAssistant, readSse } from '../server/assistant.mjs';
import { provider } from './catalog-fixture.mjs';

const frame = data => `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\r\n\r\n`;
async function* bytes(text) { for (const byte of Buffer.from(text)) yield Uint8Array.of(byte); }

test('SSE survives arbitrary UTF-8 and CRLF fragmentation and rejects truncated frames', async () => {
  const raw = frame({ text: 'Zażółć 🧡' }) + ': heartbeat\r\n\r\n' + frame('[DONE]');
  const events = []; for await (const value of readSse(bytes(raw))) events.push(value);
  assert.deepEqual(events, [JSON.stringify({ text: 'Zażółć 🧡' }), '[DONE]']);
  await assert.rejects(async () => { for await (const value of readSse(bytes('data: {"text":"broken"}'))) void value; }, /przerwane/);
});

test('bridge streams real text before final while tool JSON stays out of public events', async () => {
  const oldUrl = process.env.CODEX_BRIDGE_URL; process.env.CODEX_BRIDGE_URL = 'http://127.0.0.1:8780/v1';
  try {
    let finalReached = false; const events = [];
    async function* body() {
      yield Buffer.from(frame({ choices: [{ delta: { content: 'Cześć ' } }] }));
      assert.equal(events.some(event => event.type === 'text'), true);
      await new Promise(resolve => setTimeout(resolve, 10));
      yield Buffer.from(frame({ choices: [{ delta: { content: 'Warszawo 🧡' } }] }));
      finalReached = true;
      yield Buffer.from(frame({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + frame('[DONE]'));
    }
    const reply = await bridgeCompletion([{ role: 'user', content: 'Cześć' }], { sessionId: 'example-session', onEvent: event => { if (!events.length) assert.equal(finalReached, false); events.push(event); }, fetchImpl: async (_url, init) => {
      const payload = JSON.parse(init.body); assert.equal(payload.stream, true); assert.equal(payload.bridge_session_id, 'example-session');
      return { ok: true, headers: new Headers({ 'content-type': 'text/event-stream' }), body: body() };
    } });
    assert.equal(reply.content, 'Cześć Warszawo 🧡');
    const toolEvents = [], calls = [
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call1', function: { name: 'search_places', arguments: '{"category":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"culture"}' } }] }, finish_reason: 'tool_calls' }] },
    ];
    const toolReply = await bridgeCompletion([], { onEvent: event => toolEvents.push(event), fetchImpl: async () => ({ ok: true, headers: new Headers({ 'content-type': 'text/event-stream' }), body: bytes(calls.map(frame).join('') + frame('[DONE]')) }) });
    assert.equal(toolReply.tool_calls[0].function.arguments, '{"category":"culture"}'); assert.deepEqual(toolEvents, []);
  } finally { if (oldUrl === undefined) delete process.env.CODEX_BRIDGE_URL; else process.env.CODEX_BRIDGE_URL = oldUrl; }
});

test('assistant publishes validated map actions and activity before final response and reuses conversation id', async () => {
  let round = 0, finished = false; const events = [];
  const call = (name, args) => ({ id: `call-${round}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const assistant = createAssistant({ provider, completion: async (history, options) => {
    assert.ok(options.sessionId); round++;
    if (round === 1) return { tool_calls: [call('search_places', { category: 'event' })] };
    if (round === 2) return { tool_calls: [call('display_results', { ids: ['demo-kopernik'], highlightIds: ['demo-kopernik'], title: 'Kultura' })] };
    assert.ok(events.some(event => event.type === 'action'));
    options.onEvent({ type: 'text', delta: 'Pokazuję miejsca.' });
    await new Promise(resolve => setTimeout(resolve, 10)); finished = true;
    return { content: 'Pokazuję miejsca.' };
  } });
  const result = await assistant.chat({ message: 'Pokaż muzea' }, undefined, event => {
    if (event.type === 'action') assert.equal(finished, false);
    if (event.type === 'text') assert.equal(finished, true);
    events.push(event);
  });
  assert.equal(events[0].sessionId, result.sessionId);
  assert.equal(events.filter(event => event.type === 'action').length, 1);
  assert.deepEqual(events.filter(event => event.type === 'text').map(event => event.delta), ['Pokazuję miejsca.']);
  assert.ok(events.some(event => event.type === 'activity' && /Zaktualizowano/.test(event.label)));
});

test('interrupted streamed display retains the displayed records and their source warnings together', async () => {
  let round = 0;
  const events = [];
  const record = { id: 'official-one', name: 'Koncert', category: 'event', district: 'Wola', districts: ['Wola'] };
  const errors = [{ category: 'sports', code: 'SOURCE_UNAVAILABLE' }];
  const call = (name, args) => ({ id: `call-${round}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const assistant = createAssistant({ provider: { search: async () => ({ results: [record], total: 1, complete: false, dataMode: 'official', sources: [], errors }) }, completion: async () => {
    round++;
    if (round === 1) return { tool_calls: [call('search_places', { category: 'event' })] };
    if (round === 2 || round === 4) return { tool_calls: [call('display_results', { ids: [record.id], highlightIds: [record.id], title: 'Wyniki' })] };
    if (round === 3) throw new Error('Disconnected after published action');
    return { content: 'Pokazuję koncert. Część źródeł jest niedostępna.' };
  } });
  await assert.rejects(assistant.chat({ message: 'Koncerty' }, undefined, event => events.push(event)), /Disconnected/);
  const shown = events.find(event => event.type === 'action').action;
  assert.equal(shown.complete, false);
  const result = await assistant.chat({ message: 'Pokaż ponownie', sessionId: events[0].sessionId });
  assert.equal(result.actions[0].results[0].id, record.id);
  assert.equal(result.actions[0].complete, false);
  assert.deepEqual(result.actions[0].errors, errors);
});

test('failed nonstream display preserves the existing session records, warnings and history', async () => {
  let round = 0, searches = 0;
  let priorHistory;
  const call = (name, args) => ({ id: `call-${round}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const records = ['old', 'new'].map(id => ({ id, name: id, category: 'event', districts: ['Wola'] }));
  const assistant = createAssistant({ provider: { search: async () => ({ results: [records[searches++]], total: 1, complete: searches !== 1, dataMode: 'official', sources: [], errors: searches === 1 ? [{ category: 'sports', code: 'SOURCE_UNAVAILABLE' }] : [] }) }, completion: async history => {
    round++;
    if (round === 1 || round === 4) return { tool_calls: [call('search_places', { category: 'event' })] };
    if (round === 2 || round === 8) return { tool_calls: [call('display_results', { ids: ['old'], highlightIds: ['old'], title: 'Poprzednie' })] };
    if (round === 3) { priorHistory = structuredClone(history); return { content: 'Pierwsza odpowiedź.' }; }
    if (round === 5) return { tool_calls: [call('display_results', { ids: ['new'], highlightIds: ['new'], title: 'Nieopublikowane' })] };
    if (round === 6) throw new Error('Failed before nonstream reply');
    if (round === 7) {
      assert.deepEqual(history.slice(0, priorHistory.length), priorHistory);
      assert.equal(history.some(m => m.role === 'user' && m.content === 'Nieudane pytanie'), false);
      return { tool_calls: [call('filter_results', { category: 'event' })] };
    }
    return { content: 'Wrócono do poprzednich wyników.' };
  } });
  const first = await assistant.chat({ message: 'Pierwsze pytanie' });
  await assert.rejects(assistant.chat({ message: 'Nieudane pytanie', sessionId: first.sessionId }), /Failed before/);
  const next = await assistant.chat({ message: 'Poprzednie wyniki', sessionId: first.sessionId });
  assert.equal(next.actions[0].results[0].id, 'old');
  assert.equal(next.actions[0].complete, false);
  assert.equal(next.actions[0].errors[0].code, 'SOURCE_UNAVAILABLE');
});

for (const publishDisplay of [true, false]) test(`failed stream retains the last displayed snapshot after an undisplayed search (display=${publishDisplay})`, async () => {
  let round = 0, searches = 0;
  const events = [];
  const call = (name, args) => ({ id: `call-${round}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });
  const records = ['shown', 'hidden'].map(id => ({ id, name: id, category: 'event', districts: ['Wola'] }));
  const assistant = createAssistant({ provider: { search: async () => {
    const index = searches++;
    return { results: [records[index]], total: 1, complete: index !== 0, dataMode: 'official', sources: [], errors: index === 0 ? [{ category: 'sports', code: 'SOURCE_UNAVAILABLE' }] : [] };
  } }, completion: async () => {
    round++;
    if (round === 1 || round === 4) return { tool_calls: [call('search_places', { category: 'event' })] };
    if (round === 2) return { tool_calls: [call('display_results', { ids: ['shown'], highlightIds: ['shown'], title: 'Widoczne' })] };
    if (round === 3) return { content: 'Widoczne wyniki.' };
    if (round === 5) return { tool_calls: [call(publishDisplay ? 'display_results' : 'focus_map', publishDisplay ? { ids: ['hidden'], highlightIds: ['hidden'], title: 'Nowe widoczne' } : { latitude: 52, longitude: 21, zoom: 12 })] };
    if (round === 6 && publishDisplay) return { tool_calls: [call('search_places', { category: 'event' })] };
    if ((round === 6 && !publishDisplay) || (round === 7 && publishDisplay)) throw new Error('Failure after undisplayed search');
    const expected = publishDisplay ? 'hidden' : 'shown';
    if ((round === 7 && !publishDisplay) || (round === 8 && publishDisplay)) return { tool_calls: [call('display_results', { ids: [expected], highlightIds: [expected], title: 'Ponownie' })] };
    return { content: 'Przywrócono widoczne wyniki.' };
  } });
  const first = await assistant.chat({ message: 'Pierwsze wyniki' });
  // A third search after the streamed display is deliberately different again.
  if (publishDisplay) records.push({ id: 'never-shown', name: 'never-shown', category: 'event', districts: ['Wola'] });
  await assert.rejects(assistant.chat({ message: 'Następne wyszukiwanie', sessionId: first.sessionId }, undefined, event => events.push(event)), /Failure after/);
  const next = await assistant.chat({ message: 'Pokaż widoczne', sessionId: first.sessionId });
  assert.equal(next.actions[0].results[0].id, publishDisplay ? 'hidden' : 'shown');
  assert.equal(next.actions[0].complete, publishDisplay);
  assert.deepEqual(next.actions[0].errors, publishDisplay ? [] : [{ category: 'sports', code: 'SOURCE_UNAVAILABLE' }]);
});
