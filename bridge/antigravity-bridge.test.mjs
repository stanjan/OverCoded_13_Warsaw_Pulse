import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('bridge preserves Codex and Antigravity model metadata and daemon forwarding', async () => {
  let lastPayload;
  const upstream = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); res.end('{"data":[]}'); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const payload = JSON.parse(raw); lastPayload = payload;
    if (payload.stream) { res.setHeader('content-type', 'text/event-stream'); res.end('data: {"choices":[{"delta":{"content":"PONG"}}]}\n\ndata: [DONE]\n\n'); }
    else { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ object: 'chat.completion', model: payload.model, choices: [{ message: { content: 'PONG' } }] })); }
  });
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  const listener = http.createServer();
  await new Promise((resolve) => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));

  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], {
    windowsHide: true,
    env: { ...process.env, CODEX_BRIDGE_PORT: String(port), ANTIGRAVITY_API_URL: `http://127.0.0.1:${upstream.address().port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const closed = new Promise((resolve) => child.once('close', resolve));

  try {
    const end = Date.now() + 10000;
    let ready = false;
    while (Date.now() < end) {
      try {
        const res = await fetch('http://127.0.0.1:' + port + '/health', { signal: AbortSignal.timeout(500) });
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    assert.ok(ready, 'Bridge failed to start on test port');

    // 1. Verify GET / exposes both providers
    const rootRes = await fetch('http://127.0.0.1:' + port + '/');
    assert.equal(rootRes.status, 200);
    const rootData = await rootRes.json();
    assert.deepEqual(rootData.providers, ['local-chatgpt-codex', 'antigravity', 'claude-cli']);

    // 2. Verify GET /v1/models returns both Codex and Antigravity models
    const modelsRes = await fetch('http://127.0.0.1:' + port + '/v1/models');
    assert.equal(modelsRes.status, 200);
    const modelsData = await modelsRes.json();
    assert.equal(modelsData.object, 'list');
    assert.ok(Array.isArray(modelsData.data));

    const modelIds = new Set(modelsData.data.map((m) => m.id));

    // Must include key Codex models
    assert.ok(modelIds.has('gpt-6-astra'));
    assert.ok(modelIds.has('gpt-6-astra@low'));
    assert.ok(modelIds.has('gpt-5.6-sol@high'));
    assert.ok(modelIds.has('gpt-5.6-luna@medium'));

    // Must include key Antigravity models
    assert.ok(modelIds.has('gemini-3.8-flash'));
    assert.ok(modelIds.has('gemini-3.7-flash'));
    assert.ok(modelIds.has('gemini-3.1-pro'));
    assert.ok(modelIds.has('claude-sonnet-4-6'));
    assert.ok(modelIds.has('antigravity'));
    assert.ok(modelIds.has('gpt-oss-120b'));

    // 3. Verify GET /v1/models/:id for an Antigravity model
    const singleRes = await fetch('http://127.0.0.1:' + port + '/v1/models/gemini-3.8-flash');
    assert.equal(singleRes.status, 200);
    const singleData = await singleRes.json();
    assert.equal(singleData.id, 'gemini-3.8-flash');
    assert.equal(singleData.provider, 'antigravity');
    assert.equal(singleData.base_model, 'gemini-3.8-flash');

    // 4. Verify GET /v1/models/:id for a Codex model
    const codexSingle = await fetch('http://127.0.0.1:' + port + '/v1/models/gpt-6-astra@low');
    assert.equal(codexSingle.status, 200);
    const codexData = await codexSingle.json();
    assert.equal(codexData.id, 'gpt-6-astra@low');
    assert.equal(codexData.owned_by, 'local-chatgpt-codex');

    // 5. Verify live chat completions dispatch to Antigravity (via HTTP or CLI)
    const chatRes = await fetch('http://127.0.0.1:' + port + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.7-flash@low',
        messages: [{ role: 'user', content: 'Respond with exactly: PONG' }],
        stream: false,
      }),
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(chatRes.status, 200);
    const chatData = await chatRes.json();
    assert.equal(chatData.object, 'chat.completion');
    assert.equal(chatData.model, 'gemini-3.7-flash@low');
    assert.ok(chatData.choices?.[0]?.message?.content?.length > 0);

    const streamRes = await fetch('http://127.0.0.1:' + port + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gemini-3.7-flash@low',
        messages: [{ role: 'user', content: 'Say hi' }],
        stream: true,
      }),
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(streamRes.status, 200);
    assert.match(streamRes.headers.get('content-type') || '', /text\/event-stream/);
    const text = await streamRes.text();
    assert.ok(text.includes('data:'));
    // Omitted models discover the available daemon and preserve its default.
    const automatic = await fetch('http://127.0.0.1:' + port + '/v1/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Default please' }] }),
    });
    assert.equal(automatic.status, 200);
    assert.equal((await automatic.json()).model, 'antigravity/default');
    assert.equal(Object.hasOwn(lastPayload, 'model'), false);
    // 6. Verify CORS headers and OPTIONS preflight for browser clients
    const optionsRes = await fetch('http://127.0.0.1:' + port + '/v1/chat/completions', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://127.0.0.1:5678',
        'Access-Control-Request-Method': 'POST',
      },
    });
    assert.equal(optionsRes.status, 403);

    assert.equal(chatRes.headers.get('access-control-allow-origin'), '*');
    assert.equal(streamRes.headers.get('access-control-allow-origin'), '*');
  } finally {
    upstream.closeAllConnections();
    await new Promise(r => upstream.close(r));
    if (child.exitCode === null) child.kill();
    await closed;
  }
});
