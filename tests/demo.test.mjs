import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createDemoService, createDemoHandler } from '../server/demo.mjs';
import { createDemoReceiver, receiverCredentials, receiverSession } from '../demo-receiver.mjs';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
const service = options => createDemoService({ enabled: true, pollMs: 30, ...options });
const setup = api => { const target = api.create({}); return { ...target, id: target.target, control: target.controlToken, receiver: target.receiverToken }; };
const poll = (api, target, ready = true, signal, client = 'receiver_client_123') => api.poll(target.id, target.receiver, { ready, client }, signal);
const command = (prompt = 'Pokaż spokojne miejsca', requestId = 'request_123') => ({ prompt, requestId });

test('one opted-in receiver gets a command once; acknowledgements and idempotency are honest', async () => {
  const api = service(), target = setup(api), waiting = poll(api, target);
  const result = api.prompt(target.id, target.control, command());
  assert.equal(result.state, 'delivered'); assert.equal((await waiting).command.prompt, command().prompt);
  assert.equal(api.status(target.id, target.control).connected, false);
  api.acknowledge(target.id, target.receiver, { client: 'receiver_client_123', id: result.id, state: 'started' });
  assert.equal(api.status(target.id, target.control, result.id).state, 'started');
  const next = poll(api, target);
  assert.equal(api.prompt(target.id, target.control, command()).state, 'started');
  assert.equal((await next).command, null);
  api.acknowledge(target.id, target.receiver, { client: 'receiver_client_123', id: result.id, state: 'finished' });
  assert.equal(api.status(target.id, target.control, result.id).state, 'finished');
  assert.throws(() => api.prompt(target.id, target.control, command('Other')), { status: 409 });
});

test('auth, absent receiver, busy draft, disconnected poll and receiver ownership reject delivery', async () => {
  const api = service(), target = setup(api);
  assert.throws(() => api.prompt(target.id, target.receiver, command()), { status: 401 });
  assert.throws(() => api.prompt(target.id, target.control, command()), { status: 409 });
  const controller = new AbortController(), waiting = poll(api, target, false, controller.signal);
  assert.throws(() => api.prompt(target.id, target.control, command()), { status: 409 });
  await assert.rejects(poll(api, target, true, undefined, 'another_receiver_123'), { status: 409 });
  controller.abort(); assert.equal((await waiting).command, null);
  assert.throws(() => api.prompt(target.id, target.control, command()), { status: 409 });
  assert.throws(() => api.acknowledge(target.id, target.control, {}), { status: 401 });
});

test('targets never expire; explicit revocation closes receiver; bounded targets and rolling deduplication', async () => {
  let now = 0; const api = service({ now: () => now }), target = setup(api), waiting = poll(api, target);
  now = 365 * 86400000; assert.equal(api.status(target.id, target.control).expiresAt, null); assert.equal(api.status(target.id, target.control).ready, true);
  api.revoke(target.id, target.control); assert.equal((await waiting).command, null); assert.throws(() => api.status(target.id, target.control), { status: 401 });
  for (let i = 0; i < 8; i++) setup(api); assert.throws(() => setup(api), { status: 429 });
  const other = service(), t = setup(other);
  for (const bad of [null, [], { prompt: '', requestId: 'request_123' }, command('x'.repeat(2001)), command('Hi', 'bad')]) assert.throws(() => other.prompt(t.id, t.control, bad), { status: 400 });
  for (let i = 0; i < 105; i++) { const pending = poll(other, t); other.prompt(t.id, t.control, command('Hi', `request_${i}`)); await pending; }
  assert.throws(() => other.status(t.id, t.control, 'request_0'), { status: 404 });
  assert.equal(other.status(t.id, t.control, 'request_104').state, 'delivered');
  const pending = poll(other, t); assert.equal(other.prompt(t.id, t.control, command('Hi', 'request_104')).state, 'delivered'); assert.equal((await pending).command, null);
});

test('persistent targets survive restart without prompt text or replay; revocation persists', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'warsaw-demo-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const storePath = join(directory, 'targets.json');
  let api = service({ storePath }), target = setup(api), pending = poll(api, target);
  const sent = api.prompt(target.id, target.control, command('Private one-off example'));
  await pending;
  api.acknowledge(target.id, target.receiver, { client: 'receiver_client_123', id: sent.id, state: 'started' });
  const raw = readFileSync(storePath, 'utf8'); assert.ok(!raw.includes('Private one-off example')); assert.ok(!raw.includes('prompt')); assert.ok(!raw.includes('waiter'));
  api = service({ storePath });
  assert.deepEqual(api.status(target.id, target.control), { target: target.id, expiresAt: null, connected: false, ready: false });
  assert.equal(api.status(target.id, target.control, sent.id).state, 'started');
  await assert.rejects(poll(api, target, true, undefined, 'different_client_123'), { status: 409 });
  pending = poll(api, target);
  assert.equal(api.prompt(target.id, target.control, command('Private one-off example')).state, 'started');
  assert.equal((await pending).command, null);
  pending = poll(api, target); api.prompt(target.id, target.control, command('New after restart', 'request_after_restart')); assert.equal((await pending).command.prompt, 'New after restart');
  api.revoke(target.id, target.control);
  api = service({ storePath }); assert.throws(() => api.status(target.id, target.control), { status: 401 });
});

test('storage errors fail explicitly instead of generating replacement links or claiming successful writes', t => {
  const directory = mkdtempSync(join(tmpdir(), 'warsaw-demo-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const storePath = join(directory, 'targets.json'); writeFileSync(storePath, 'broken');
  assert.throws(() => service({ storePath }), /Nie można odczytać/);
  rmSync(storePath); const api = service({ storePath }), target = setup(api);
  // Replace the parent directory with a file, producing a deterministic ENOTDIR on all platforms.
  rmSync(directory, { recursive: true }); writeFileSync(directory, 'blocked');
  assert.throws(() => api.revoke(target.id, target.control), { status: 503 });
  assert.equal(api.status(target.id, target.control).expiresAt, null);
});

test('explicit RAM-era migration preserves existing tile capabilities, validates the whole batch and never resets pairing', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'warsaw-demo-import-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const old = service(), existing = setup(old), storePath = join(directory, 'targets.json');
  const entry = { target: existing.id, controlToken: existing.control, receiverToken: existing.receiver };
  let api = service({ storePath });
  assert.throws(() => api.importTargets([entry, { ...entry, target: 'invalid' }]), { status: 400 });
  assert.throws(() => api.status(existing.id, existing.control), { status: 401 });
  assert.deepEqual(api.importTargets([entry]), { imported: 1 });
  api = service({ storePath }); const waiting = poll(api, existing);
  api.prompt(existing.id, existing.control, command('Unchanged old tile')); assert.equal((await waiting).command.prompt, 'Unchanged old tile');
  api.importTargets([entry]);
  await assert.rejects(poll(api, existing, true, undefined, 'different_client_123'), { status: 409 });
  assert.throws(() => api.importTargets([{ ...entry, controlToken: 'x'.repeat(43) }]), { status: 409 });
  assert.equal(api.status(existing.id, existing.control).expiresAt, null);
});

test('receiver tab reload restores the same explicit target and client; ordinary tabs stay unpaired', () => {
  const entries = new Map(); const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  assert.equal(receiverSession('', storage), null);
  const credentials = { target: 'a'.repeat(24), token: 'x'.repeat(43) };
  const fragment = '#' + new URLSearchParams({ 'demo-receiver': JSON.stringify(credentials) });
  const original = receiverSession(fragment, storage);
  assert.ok(original.client); assert.deepEqual(receiverSession('', storage), original); assert.deepEqual(receiverSession(fragment, storage), original);
  assert.equal(receiverSession('', { getItem: () => null }), null);
  assert.throws(() => receiverSession(fragment, { getItem: () => null, setItem() { throw new Error('blocked'); } }), /blocked/);
});

test('controller reload keeps access but never repeats the prompt from its original tile link', async () => {
  const source = readFileSync(new URL('../demo-control.mjs', import.meta.url), 'utf8');
  const entries = new Map(), calls = [];
  const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) };
  const load = hash => {
    const elements = new Map();
    const $ = selector => { if (!elements.has(selector)) elements.set(selector, { hidden: true, value: '', addEventListener() {} }); return elements.get(selector); };
    runInNewContext(source, { document: { querySelector: $ }, location: { hash, pathname: '/demo', search: '', origin: 'http://localhost:5173' }, history: { replaceState() {} }, sessionStorage: storage, URL, URLSearchParams, crypto, setTimeout: () => 1, clearTimeout() {}, fetch: async (url, options) => { calls.push({ url, method: options.method }); return { ok: true, json: async () => options.method === 'POST' ? { state: 'finished' } : { ready: true } }; } });
    return elements;
  };
  const hash = '#' + new URLSearchParams({ 'demo-control': JSON.stringify({ target: 'a'.repeat(24), token: 'x'.repeat(43), prompt: 'A one-time tile click' }) });
  load(hash); await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  assert.ok(!entries.get('warsaw-ai-demo-control').includes('A one-time tile click'));
  const reloaded = load(''); await new Promise(resolve => setImmediate(resolve));
  assert.equal(reloaded.get('#control').hidden, false);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});

test('HTTP contract: disabled gate, exact CORS, target creation, auth, content and body bounds', async t => {
  const api = service({ origins: ['https://slides.example'], pollMs: 25000 }), handle = createDemoHandler(api);
  const server = createServer((req, res) => { const self = `http://${req.headers.host}`; handle(req, res, new URL(req.url, self), self).then(handled => { if (!handled) res.end('no'); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, options) => fetch(base + path, options);
  assert.equal((await request('/api/demo/targets', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' })).status, 403);
  const created = await request('/api/demo/targets', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: '{}' }); assert.equal(created.status, 201);
  const target = await created.json(), path = `/api/demo/targets/${target.target}`;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${target.controlToken}`, Origin: 'https://slides.example' };
  const cors = await request(path, { headers }); assert.equal(cors.status, 200); assert.equal(cors.headers.get('access-control-allow-origin'), 'https://slides.example'); assert.equal(cors.headers.get('cache-control'), 'no-store');
  assert.equal((await request(path, { headers: { ...headers, Origin: 'https://slides.example.evil' } })).status, 403);
  assert.equal((await request(path + '/prompts', { method: 'OPTIONS', headers: { Origin: 'https://slides.example', 'Access-Control-Request-Headers': 'authorization,content-type' } })).status, 204);
  assert.equal((await request(path + '/poll', { method: 'OPTIONS', headers: { Origin: 'https://slides.example' } })).status, 403);
  assert.equal((await request(path + '/prompts', { method: 'POST', headers: { ...headers, Authorization: 'Bearer ' + 'x'.repeat(43) }, body: JSON.stringify(command()) })).status, 401);
  assert.equal((await request(path + '/prompts', { method: 'POST', headers, body: 'oops' })).status, 400);
  assert.equal((await request(path + '/prompts', { method: 'POST', headers: { Authorization: headers.Authorization }, body: '{}' })).status, 415);
  assert.equal((await request(path + '/prompts', { method: 'POST', headers, body: JSON.stringify({ prompt: 'x'.repeat(12000) }) })).status, 413);
  const receiving = fetch(base + path + '/poll', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.receiverToken}` }, body: JSON.stringify({ client: 'http_receiver_123', ready: true }) });
  // Wait for the real receiver HTTP request to register, rather than guessing a scheduling delay.
  const deadline = Date.now() + 5000;
  while (!(await (await request(path, { headers })).json()).ready) {
    assert.ok(Date.now() < deadline, 'receiver did not finish its ready handshake');
    await new Promise(resolve => setImmediate(resolve));
  }
  const result = await request(path + '/prompts', { method: 'POST', headers, body: JSON.stringify(command()) }); assert.equal(result.status, 202); assert.equal((await result.json()).state, 'delivered'); assert.equal((await (await receiving).json()).command.id, 'request_123');
  const disabled = createDemoHandler(createDemoService()); let status;
  await disabled({ method: 'GET', headers: {} }, { destroyed: false, writeHead(code) { status = code; }, end() {} }, new URL(base + '/api/demo/targets'), base); assert.equal(status, 503);
  assert.throws(() => service({ origins: ['*'] })); assert.throws(() => service({ origins: ['https://slides.example/path'] }));
});

test('browser receiver uses its explicit target and normal start callback, not another chat API', async () => {
  const api = service({ pollMs: 10 }), target = setup(api); let ready = true, starts = [], release;
  const completion = new Promise(resolve => { release = resolve; });
  const fetcher = async (url, options) => {
    const action = url.split('/').at(-1), data = JSON.parse(options.body), bearer = options.headers.Authorization.slice(7);
    try { const result = action === 'poll' ? await api.poll(target.id, bearer, data, options.signal) : api.acknowledge(target.id, bearer, data); return { ok: true, json: async () => result }; }
    catch (error) { return { ok: false, status: error.status, json: async () => ({ error: error.message }) }; }
  };
  const receiver = createDemoReceiver({ credentials: { target: target.id, token: target.receiver }, isReady: () => ready, start: prompt => { starts.push(prompt); ready = false; return { completion }; }, fetcher });
  const first = api.prompt(target.id, target.control, command());
  await new Promise(resolve => setTimeout(resolve, 10)); assert.deepEqual(starts, [command().prompt]); assert.equal(api.status(target.id, target.control, first.id).state, 'started');
  assert.throws(() => api.prompt(target.id, target.control, command('Second', 'request_second')), { status: 409 });
  ready = true; release(); await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(api.status(target.id, target.control, first.id).state, 'finished');
  api.prompt(target.id, target.control, command()); await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(starts.length, 1);
  receiver.stop();
});

test('draft typed between ready poll and delivery wins; reconnect never replays delivered command', async () => {
  const api = service({ pollMs: 10 }), target = setup(api); let ready = true, starts = 0;
  const fetcher = async (url, options) => { const data = JSON.parse(options.body); const result = url.endsWith('/poll') ? await api.poll(target.id, target.receiver, data, options.signal) : api.acknowledge(target.id, target.receiver, data); return { ok: true, json: async () => result }; };
  const receiver = createDemoReceiver({ credentials: { target: target.id, token: target.receiver }, isReady: () => ready, start: () => { starts++; return { completion: Promise.resolve() }; }, fetcher });
  const result = api.prompt(target.id, target.control, command()); ready = false;
  await new Promise(resolve => setTimeout(resolve, 10)); assert.equal(starts, 0); assert.equal(api.status(target.id, target.control, result.id).state, 'rejected');
  assert.equal(api.status(target.id, target.control).ready, false); receiver.stop();
  assert.equal(receiverCredentials('#anything'), null); assert.equal(receiverCredentials('#demo-receiver=oops'), null);
  assert.deepEqual(receiverCredentials('#' + new URLSearchParams({ 'demo-receiver': JSON.stringify({ target: target.id, token: target.receiver }) })), { target: target.id, token: target.receiver });
});
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
test('real application server exposes opt-in setup and receiver assets without publishing capability in public config', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'warsaw-demo-http-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const reserve = createServer(); await new Promise(resolve => reserve.listen(0, '127.0.0.1', resolve)); const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  const child = spawn(process.execPath, ['scripts/serve.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', HTTPS_PORT: '', DATA_API_KEY: '', CODEX_BRIDGE_URL: '', DEMO_REMOTE_ENABLED: '1', DEMO_ALLOWED_ORIGINS: '', DEMO_STORE_FILE: join(directory, 'targets.json') }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => { child.stdout.on('data', data => { if (data.toString().includes('Local:')) resolve(); }); child.once('error', reject); child.once('exit', code => reject(new Error('preview exited ' + code))); });
  const base = `http://127.0.0.1:${port}`;
  const html = await fetch(base + '/demo'); assert.equal(html.status, 200); assert.equal(html.headers.get('cache-control'), 'no-store'); assert.match(html.headers.get('content-security-policy'), /frame-ancestors 'none'/); assert.match(await html.text(), /demo-control.mjs/);
  assert.equal((await fetch(base + '/demo-receiver.mjs')).status, 200); assert.equal((await fetch(base + '/demo-control.mjs')).status, 200);
  const created = await fetch(base + '/api/demo/targets', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: '{}' }); assert.equal(created.status, 201); const target = await created.json();
  const config = await (await fetch(base + '/api/config')).text(); assert.ok(!config.includes(target.controlToken)); assert.ok(!config.includes(target.receiverToken));
  const source = await readFile(new URL('../app.js', import.meta.url), 'utf8'); assert.match(source, /if \(pending \|\| input.value.trim\(\)\) return null/); assert.match(source, /completion: send\(\)/); assert.match(source, /history.replaceState\(null, '', location.pathname \+ location.search\)/);
});
