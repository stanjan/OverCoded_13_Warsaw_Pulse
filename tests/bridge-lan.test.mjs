import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bridgeCompletion } from '../server/assistant.mjs';
test('assistant supports LAN endpoint, keeps session/stream/cancellation and refuses redirects', async t => {
  const previous = { url: process.env.CODEX_BRIDGE_URL, key: process.env.CODEX_BRIDGE_API_KEY };
  t.after(() => { for (const [name, value] of [['CODEX_BRIDGE_URL', previous.url], ['CODEX_BRIDGE_API_KEY', previous.key]]) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  process.env.CODEX_BRIDGE_URL = 'http://192.168.1.22:8780/v1'; process.env.CODEX_BRIDGE_API_KEY = 'test-only-key';
  const controller = new AbortController(); let observed;
  const reply = await bridgeCompletion([{ role: 'user', content: 'Cześć' }], { sessionId: 'session-example', signal: controller.signal, fetchImpl: async (url, init) => {
    observed = { url, init }; return Response.json({ choices: [{ message: { role: 'assistant', content: 'Gotowe' } }] });
  } });
  assert.equal(reply.content, 'Gotowe'); assert.equal(observed.url, 'http://192.168.1.22:8780/v1/chat/completions');
  assert.equal(observed.init.signal, controller.signal); assert.equal(observed.init.redirect, 'error'); assert.equal(observed.init.headers.Authorization, 'Bearer test-only-key');
  assert.equal(JSON.parse(observed.init.body).bridge_session_id, 'session-example');
  delete process.env.CODEX_BRIDGE_API_KEY;
  await bridgeCompletion([], { fetchImpl: async (_url, init) => { assert.equal(init.headers.Authorization, undefined); return Response.json({ choices: [{ message: { content: 'No key' } }] }); } });
  let targetHits = 0;
  const target = http.createServer((_req, res) => { targetHits++; res.end('{}'); }); await new Promise(r => target.listen(0, '127.0.0.1', r));
  const redirect = http.createServer((_req, res) => { res.writeHead(307, { location: 'http://127.0.0.1:' + target.address().port + '/v1/chat/completions' }); res.end(); }); await new Promise(r => redirect.listen(0, '127.0.0.1', r));
  t.after(async () => { for (const server of [target, redirect]) { server.closeAllConnections(); await new Promise(r => server.close(r)); } });
  process.env.CODEX_BRIDGE_URL = 'http://127.0.0.1:' + redirect.address().port + '/v1'; process.env.CODEX_BRIDGE_API_KEY = 'never-forward-on-redirect';
  await assert.rejects(bridgeCompletion([]), /połączyć/); assert.equal(targetHits, 0);
});
