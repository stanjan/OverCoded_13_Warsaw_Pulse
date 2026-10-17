import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeCompletion, createAssistant, readSse } from '../server/assistant.mjs';

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
  const assistant = createAssistant({ completion: async (history, options) => {
    assert.ok(options.sessionId); round++;
    if (round === 1) return { tool_calls: [call('search_places', { category: 'culture' })] };
    if (round === 2) return { tool_calls: [call('display_results', { ids: ['demo-kopernik'], title: 'Kultura' })] };
    assert.ok(events.some(event => event.type === 'action'));
    options.onEvent({ type: 'text', delta: 'Pokazuję miejsca.' });
    await new Promise(resolve => setTimeout(resolve, 10)); finished = true;
    return { content: 'Pokazuję miejsca.' };
  } });
  const result = await assistant.chat({ message: 'Pokaż muzea' }, undefined, event => { if (event.type === 'action' || event.type === 'text') assert.equal(finished, false); events.push(event); });
  assert.equal(events[0].sessionId, result.sessionId);
  assert.equal(events.filter(event => event.type === 'action').length, 1);
  assert.ok(events.some(event => event.type === 'activity' && /Zaktualizowano/.test(event.label)));
});
