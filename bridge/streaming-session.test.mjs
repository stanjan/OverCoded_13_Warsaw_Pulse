import test from 'node:test';
import assert from 'node:assert/strict';
import { StructuredContentStream } from './structured-stream.mjs';
import { CodexSessionClient } from './codex-session.mjs';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('structured deltas stream only assistant content, with escapes, reordered fields and no tool leakage', () => {
  for (const raw of [
    JSON.stringify({ kind: 'assistant', content: 'Cześć\n"Warszawo" 🧡', tool_calls: [] }),
    '{"content":"Cześć\\n\\\"Warszawo\\\" \\ud83e\\udde1","tool_calls":[],"kind":"assistant"}',
  ]) {
    const deltas = [], parser = new StructuredContentStream(text => deltas.push(text));
    for (const character of raw) parser.feed(character);
    assert.equal(deltas.join(''), 'Cześć\n"Warszawo" 🧡');
  }
  const deltas = [], parser = new StructuredContentStream(text => deltas.push(text));
  const raw = JSON.stringify({ kind: 'tool_calls', content: null, tool_calls: [{ name: 'secret', arguments: '{"content":"DO NOT DISPLAY"}' }] });
  for (const character of raw) parser.feed(character);
  assert.deepEqual(deltas, []);
});

test('one transport reuses isolated threads, sends only new history, streams before final and interrupts cancellation', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'codex-session-test-')), capture = path.join(root, 'capture.jsonl');
  const old = process.env.CODEX_FIXTURE_CAPTURE; process.env.CODEX_FIXTURE_CAPTURE = capture;
  const client = new CodexSessionClient({ executable: fileURLToPath(new URL('./fixtures/codex-app-server.mjs', import.meta.url)), ttlMs: 1000 });
  t.after(async () => { await client.close(); if (old === undefined) delete process.env.CODEX_FIXTURE_CAPTURE; else process.env.CODEX_FIXTURE_CAPTURE = old; await rm(root, { recursive: true, force: true }); });
  const selection = { model: 'gpt-6.1-sol', effort: 'low', requestedId: 'codex-chatgpt' };
  const run = async (payload, options = {}) => client.complete({ payload, selection, schema: {}, policy: 'Application only', normalize: raw => { const v = JSON.parse(raw); return { content: v.content, toolCalls: [] }; }, ...options });
  const key = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', history = [{ role: 'user', content: 'Cześć' }];
  let resolved = false, firstText = false;
  const first = run({ bridge_session_id: key, messages: history }, { onText: text => { assert.equal(resolved, false); assert.ok(text); firstText = true; } });
  const answer = await first; resolved = true; assert.equal(firstText, true); assert.equal(answer.usage.total_tokens, 12);
  history.push({ role: 'assistant', content: answer.content }, { role: 'user', content: 'Dalej' });
  await run({ bridge_session_id: key, messages: history });
  await run({ bridge_session_id: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee', messages: [{ role: 'user', content: 'Inny' }] });
  const controller = new AbortController();
  const waiting = run({ bridge_session_id: 'cccccccc-bbbb-cccc-dddd-eeeeeeeeeeee', messages: [{ role: 'user', content: 'wait' }] }, { signal: controller.signal });
  const rejection = assert.rejects(waiting, error => error.statusCode === 499);
  await new Promise(r => setTimeout(r, 40)); controller.abort(); await rejection;
  const entries = (await readFile(capture, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(new Set(entries.map(e => e.pid)).size, 1);
  const turns = entries.filter(e => e.method === 'turn/start');
  assert.equal(turns[0].params.threadId, turns[1].params.threadId);
  assert.notEqual(turns[1].params.threadId, turns[2].params.threadId);
  assert.equal(JSON.parse(turns[1].params.input[0].text).messages.length, 1);
  assert.ok(entries.some(e => e.method === 'turn/interrupt'));
  const thread = entries.find(e => e.method === 'thread/start');
  assert.equal(thread.params.config['mcp_servers.fixture_server.enabled'], false);
  assert.doesNotMatch(JSON.stringify(thread.params) + JSON.stringify(turns.map(turn => turn.params.input)), /n8n|workflow reference|builderGuide/i);
  assert.equal(thread.params.ephemeral, true); assert.equal(thread.params.approvalPolicy, 'never');
  assert.deepEqual(thread.params.environments, []);
});


test('session admission serializes identical keys and reconnects cleanly after process failure', async t => {
  const client = new CodexSessionClient({ executable: fileURLToPath(new URL('./fixtures/codex-app-server.mjs', import.meta.url)) });
  t.after(() => client.close());
  const key = 'dddddddd-bbbb-cccc-dddd-eeeeeeeeeeee';
  const run = (message, options = {}) => client.complete({ payload: { bridge_session_id: key, messages: [{ role: 'user', content: message }] }, selection: { model: 'gpt-6.1-sol', effort: 'low', requestedId: 'codex-chatgpt' }, schema: {}, policy: 'Application only', normalize: raw => ({ content: JSON.parse(raw).content, toolCalls: [] }), ...options });
  const first = run('Cześć');
  await assert.rejects(run('Równolegle'), error => error.statusCode === 409);
  await first;
  await assert.rejects(run('exit'), /stopped/);
  const answer = await run('Po awarii');
  assert.equal(answer.content, 'Cześć Warszawo 🧡');
});


test('expired and discarded ephemeral sessions unsubscribe and unload without archive', async t => {
  const client = new CodexSessionClient({ executable: fileURLToPath(new URL('./fixtures/codex-app-server.mjs', import.meta.url)), ttlMs: 60000 });
  t.after(() => client.close());
  const key = 'eeeeeeee-bbbb-cccc-dddd-eeeeeeeeeeee';
  const run = sessionId => client.complete({ payload: { ...(sessionId ? { bridge_session_id: sessionId } : {}), messages: [{ role: 'user', content: 'Cześć' }] }, selection: { model: 'gpt-6.1-sol', effort: 'low', requestedId: 'codex-chatgpt' }, schema: {}, policy: 'Application only', normalize: raw => ({ content: JSON.parse(raw).content, toolCalls: [] }) });
  await run(key);
  const session = client.sessions.get(key);
  assert.deepEqual((await client.rpc('thread/loaded/list', {})).data, [session.threadId]);
  // The fixture reproduces native archive's actual ephemeral-thread failure.
  await assert.rejects(client.rpc('thread/archive', { threadId: session.threadId }), /no rollout/);
  session.updatedAt = Date.now() - 60001;
  client.expire();
  for (let tries = 0; tries < 100 && (await client.rpc('thread/loaded/list', {})).data.length; tries++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(client.sessions.size, 0);
  assert.deepEqual((await client.rpc('thread/loaded/list', {})).data, []);
  await run(); // A stateless HTTP request must discard its ephemeral thread too.
  for (let tries = 0; tries < 100 && (await client.rpc('thread/loaded/list', {})).data.length; tries++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual((await client.rpc('thread/loaded/list', {})).data, []);
});


test('closing during asynchronous startup prevents a late child and cleans its workspace', async () => {
  const client = new CodexSessionClient({ executable: fileURLToPath(new URL('./fixtures/codex-app-server.mjs', import.meta.url)) });
  const starting = client.start();
  // connect() is suspended at the real asynchronous mkdtemp here. No scheduler
  // sleeps are needed to reproduce the startup/shutdown interleaving.
  const startupRejection = assert.rejects(starting, /shutting down/);
  const closing = client.close();
  await assert.rejects(client.start(), /shutting down/);
  await assert.rejects(client.complete({}), /shutting down/);
  await Promise.all([closing, startupRejection]);
  assert.equal(client.child, null);
  assert.ok(client.cwd);
  await assert.rejects(access(client.cwd), error => error.code === 'ENOENT');
  assert.equal(client.close(), closing, 'shutdown is idempotent');
});
