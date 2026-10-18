import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { networkInterfaces, tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPrivateIPv4 } from './network.mjs';
import { bridgeCompletion } from '../server/assistant.mjs';
const wait = ms => new Promise(r => setTimeout(r, ms));
test('real LAN socket serves no-key health, rejects browsers/run and preserves Codex SSE sessions and cancellation', async t => {
  const ip = Object.values(networkInterfaces()).flat().find(i => !i.internal && isPrivateIPv4(i.address))?.address;
  if (!ip) return t.skip('No private IPv4 interface available; policy tests still run.');
  const root = await mkdtemp(join(tmpdir(), 'bridge-lan-')), capture = join(root, 'capture.jsonl');
  const listener = http.createServer(); await new Promise(r => listener.listen(0, '127.0.0.1', r)); const port = listener.address().port; await new Promise(r => listener.close(r));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], { windowsHide: true, env: { ...process.env,
    CODEX_BRIDGE_HOST: '0.0.0.0', CODEX_BRIDGE_ALLOWED_CLIENTS: ip, CODEX_BRIDGE_API_KEY: '', CODEX_BRIDGE_PORT: String(port),
    CODEX_APP_SERVER_PATH: fileURLToPath(new URL('./fixtures/codex-app-server.mjs', import.meta.url)), CODEX_FIXTURE_CAPTURE: capture }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', c => logs += c); child.stderr.on('data', c => logs += c);
  const closed = new Promise(r => child.once('close', r));
  t.after(async () => { if (child.exitCode === null) child.kill(); await closed; await rm(root, { recursive: true, force: true }); });
  const base = 'http://' + ip + ':' + port;
  let ready = false;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/health', { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; } } catch {} await wait(50); }
  assert.ok(ready, logs);
  assert.equal((await fetch('http://127.0.0.1:' + port + '/health')).status, 200);
  const invalidTargetStatus = await new Promise((resolve, reject) => { const req = http.request(base, { path: 'http://[', method: 'GET' }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); });
  assert.equal(invalidTargetStatus, 400);
  assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal((await fetch(base + '/health', { headers: { Origin: 'http://example.org' } })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => { const req = http.get(base + '/health', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); });
  assert.equal(hostStatus, 403);
  assert.equal((await fetch(base + '/v1/run', { method: 'POST', body: 'invalid' })).status, 403);
  const old = { url: process.env.CODEX_BRIDGE_URL, key: process.env.CODEX_BRIDGE_API_KEY, model: process.env.CODEX_BRIDGE_MODEL };
  t.after(() => { for (const [name, value] of [['CODEX_BRIDGE_URL', old.url], ['CODEX_BRIDGE_API_KEY', old.key], ['CODEX_BRIDGE_MODEL', old.model]]) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });
  process.env.CODEX_BRIDGE_URL = base + '/v1'; process.env.CODEX_BRIDGE_API_KEY = ''; process.env.CODEX_BRIDGE_MODEL = 'codex-chatgpt';
  const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', history = [{ role: 'user', content: 'Cześć' }], deltas = [];
  let finished = false;
  const first = await bridgeCompletion(history, { sessionId, onEvent: event => { if (event.type === 'text') { assert.equal(finished, false); deltas.push(event.delta); } } }); finished = true;
  assert.equal(deltas.join(''), 'Cześć Warszawo 🧡');
  history.push(first, { role: 'user', content: 'Dalej' }); await bridgeCompletion(history, { sessionId });
  const controller = new AbortController();
  const pending = bridgeCompletion([{ role: 'user', content: 'wait' }], { sessionId: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee', signal: controller.signal, onEvent: () => {} });
  const rejected = assert.rejects(pending);
  for (let i = 0; i < 100; i++) { if ((await readFile(capture, 'utf8')).includes('wait')) break; await wait(20); }
  controller.abort(); await rejected;
  let entries;
  for (let i = 0; i < 100; i++) { entries = (await readFile(capture, 'utf8')).trim().split('\n').map(JSON.parse); if (entries.some(e => e.method === 'turn/interrupt')) break; await wait(20); }
  const turns = entries.filter(e => e.method === 'turn/start'); assert.equal(turns[0].params.threadId, turns[1].params.threadId);
  assert.equal(JSON.parse(turns[1].params.input[0].text).messages.length, 1);
  assert.ok(entries.some(e => e.method === 'turn/interrupt'));
});
test('optional key protects health and completions before body/provider work on a real socket', async t => {
  const listener = http.createServer(); await new Promise(r => listener.listen(0, '127.0.0.1', r)); const port = listener.address().port; await new Promise(r => listener.close(r));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], { windowsHide: true, env: { ...process.env, CODEX_BRIDGE_HOST: '0.0.0.0', CODEX_BRIDGE_ALLOWED_CLIENTS: '', CODEX_BRIDGE_PORT: String(port), CODEX_BRIDGE_API_KEY: 'fixture-key' }, stdio: 'ignore' });
  const closed = new Promise(r => child.once('close', r)); t.after(async () => { if (child.exitCode === null) child.kill(); await closed; });
  const base = 'http://127.0.0.1:' + port;
  let ready = false; for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/health')).status === 401) { ready = true; break; } } catch {} await wait(50); } assert.ok(ready);
  for (const pathname of ['/health', '/health/deep', '/v1/models']) assert.equal((await fetch(base + pathname)).status, 401);
  assert.equal((await fetch(base + '/v1/chat/completions', { method: 'POST', body: 'invalid JSON' })).status, 401);
  assert.equal((await fetch(base + '/health', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await fetch(base + '/health', { headers: { Authorization: 'Bearer fixture-key' } })).status, 200);
});
