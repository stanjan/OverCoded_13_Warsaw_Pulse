import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { runClaudeProcess, subscriptionEnvironment, claudeCliSelection } from './claude-cli.mjs';
import { readSse } from '../server/assistant.mjs';
import { createAssistant } from '../server/assistant.mjs';
const fixturePath = fileURLToPath(new URL('./fixtures/claude.mjs', import.meta.url));
async function bridge(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'bridge-claude-test-'));
  const fixture = path.join(root, 'fixture.json'); writeFileSync(fixture, '{}');
  const listener = http.createServer(); await new Promise(r => listener.listen(0, '127.0.0.1', r));
  const port = listener.address().port; await new Promise(r => listener.close(r));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], { windowsHide: true,
    env: { ...process.env, CODEX_BRIDGE_PORT: String(port), CLAUDE_CLI_PATH: fixturePath,
      CLAUDE_FIXTURE_FILE: fixture, ANTHROPIC_API_KEY: 'never-forward-api-key', ANTHROPIC_AUTH_TOKEN: 'never-forward-bearer', DATA_API_KEY: 'never-forward-data-key', CLAUDE_CODE_OAUTH_TOKEN: 'fixture-oauth' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', c => logs += c); child.stderr.on('data', c => logs += c);
  const closed = new Promise(r => child.on('close', r));
  t.after(async () => { if (child.exitCode === null) child.kill(); await closed; rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 50)); }
  assert.equal(child.exitCode, null, logs);
  const configure = value => writeFileSync(fixture, JSON.stringify(value));
  const chat = (payload = {}, options = {}) => fetch(base + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-cli/sonnet', messages: [{ role: 'user', content: 'Cześć' }], ...payload }), ...options });
  return { root, base, chat, configure };
}
test('subscription environment removes billing credentials and keeps explicit subscription token', () => {
  assert.deepEqual(subscriptionEnvironment({ PATH: 'path', ANTHROPIC_API_KEY: 'x', ANTHROPIC_AUTH_TOKEN: 'x', ANTHROPIC_BASE_URL: 'x',
    CLAUDE_CODE_USE_BEDROCK: '1', DATA_API_KEY: 'x', CLAUDE_CODE_OAUTH_TOKEN: 'oauth', CLAUDE_CONFIG_DIR: 'account' }), { PATH: 'path', CLAUDE_CODE_OAUTH_TOKEN: 'oauth', CLAUDE_CONFIG_DIR: 'account' });
  assert.throws(() => claudeCliSelection('claude-cli/--anything'), /Use claude-cli/);
});
test('HTTP Claude models, isolated CLI flags, subscription health and structured response', async t => {
  const b = await bridge(t), capture = path.join(b.root, 'capture.json'); b.configure({ capture });
  assert.equal((await fetch(b.base + '/health/claude')).status, 200);
  const models = await (await fetch(b.base + '/v1/models')).json();
  assert.ok(models.data.some(m => m.id === 'codex-chatgpt')); assert.ok(models.data.some(m => m.id === 'claude-cli/sonnet'));
  assert.equal((await fetch(b.base + '/v1/models/claude-cli%2Fopus')).status, 200);
  const res = await b.chat(), body = await res.json(); assert.equal(res.status, 200); assert.equal(body.choices[0].message.content, 'Gotowe.'); assert.equal(body.usage.total_tokens, 7);
  const observed = JSON.parse(readFileSync(capture)); assert.equal(observed.secretPresent, false); assert.equal(observed.oauthPresent, true);
  for (const flag of ['--safe-mode', '--strict-mcp-config', '--no-session-persistence', '--json-schema']) assert.ok(observed.args.includes(flag));
  assert.equal(observed.args[observed.args.indexOf('--tools') + 1], ''); assert.equal(observed.args.includes('--bare'), false);
  assert.equal(observed.args.some(arg => /skip-permissions/.test(arg)), false); assert.ok(observed.cwd.startsWith(tmpdir()));
  await b.chat({ model: 'claude-cli/default' });
  assert.equal(JSON.parse(readFileSync(capture)).args.includes('--model'), false);
  assert.equal((await b.chat({}, { headers: { origin: 'https://example.org' } })).status, 403);
});
test('Console auth, failed/invalid outputs and unavailable tool calls fail closed', async t => {
  const b = await bridge(t);
  for (const authMethod of ['api_key', 'api_key_helper', 'third_party', 'none']) {
    b.configure({ authMethod }); const res = await b.chat(); assert.equal(res.status, 503); assert.match(await res.text(), /subscription login/);
  }
  b.configure({ mode: 'error' }); let res = await b.chat(); assert.equal(res.status, 503); assert.equal((await res.text()).includes('SECRET'), false);
  b.configure({ mode: 'invalid' }); res = await b.chat(); assert.equal(res.status, 502);
  b.configure({ response: { kind: 'tool_calls', content: null, tool_calls: [{ name: 'shell', arguments: '{}' }] } });
  res = await b.chat(); assert.equal(res.status, 502); assert.match(await res.text(), /unavailable/);
});
test('stream emits validated tool calls, honors tool choice and reports failures', async t => {
  const b = await bridge(t), call = { kind: 'tool_calls', content: null, tool_calls: [{ name: 'find', arguments: '{"q":"museum"}' }] };
  b.configure({ response: call });
  const tools = [{ type: 'function', function: { name: 'find', parameters: { type: 'object' } } }];
  let res = await b.chat({ tools, tool_choice: 'none' }); assert.equal(res.status, 502);
  res = await b.chat({ tools, stream: true, stream_options: { include_usage: true } }); let text = await res.text();
  assert.match(text, /tool_calls/); assert.match(text, /museum/); assert.match(text, /\[DONE\]/);
  b.configure({ mode: 'error' }); res = await b.chat({ stream: true }); text = await res.text(); assert.match(text, /"error"/); assert.doesNotMatch(text, /"finish_reason":"stop"/);
});
test('real app assistant searches and displays through Claude HTTP tool loop', async t => {
  const b = await bridge(t); b.configure({ mode: 'app' });
  const assistant = createAssistant({ completion: async messages => {
    const response = await b.chat({ messages, tools: (await import('../server/tools.mjs')).toolDefinitions });
    assert.equal(response.status, 200, await response.clone().text()); return (await response.json()).choices[0].message;
  } });
  const answer = await assistant.chat({ message: 'Pokaż muzea' });
  assert.match(answer.message, /demonstracyjnego/); assert.ok(answer.actions.some(action => action.type === 'display_results'));
});
test('cancellation stops the owned Claude process tree before resolving', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'claude-cancel-test-')), fixture = path.join(root, 'fixture.json'), pidFile = path.join(root, 'pids');
  writeFileSync(fixture, JSON.stringify({ mode: 'wait', pidFile }));
  const oldPath = process.env.CLAUDE_CLI_PATH, oldFixture = process.env.CLAUDE_FIXTURE_FILE;
  process.env.CLAUDE_CLI_PATH = fixturePath; process.env.CLAUDE_FIXTURE_FILE = fixture;
  t.after(() => { if (oldPath === undefined) delete process.env.CLAUDE_CLI_PATH; else process.env.CLAUDE_CLI_PATH = oldPath;
    if (oldFixture === undefined) delete process.env.CLAUDE_FIXTURE_FILE; else process.env.CLAUDE_FIXTURE_FILE = oldFixture; rmSync(root, { recursive: true, force: true }); });
  const controller = new AbortController(), promise = runClaudeProcess(['-p'], { input: '', cwd: root, signal: controller.signal });
  const rejection = assert.rejects(promise, error => error.statusCode === 499);
  for (let i = 0; i < 100 && (!existsSync(pidFile) || readFileSync(pidFile, 'utf8').trim().split('\n').length < 2); i++) await new Promise(r => setTimeout(r, 25));
  const pids = readFileSync(pidFile, 'utf8').trim().split('\n').map(Number); assert.equal(pids.length, 2);
  controller.abort(); await rejection;
  for (const pid of pids) assert.throws(() => process.kill(pid, 0), /ESRCH|no such process/);
});


test('Claude partial structured-output text reaches HTTP client before final; native-tool arguments stay private', async t => {
  const b = await bridge(t); b.configure({ streamDelay: 250, response: { kind: 'assistant', content: 'Cześć Warszawo. To odpowiedź na żywo.', tool_calls: [] } });
  const response = await b.chat({ stream: true });
  let text = '', sawPartial = false, done = false;
  for await (const raw of readSse(response.body)) {
    if (raw === '[DONE]') { done = true; continue; }
    const event = JSON.parse(raw), delta = event.choices?.[0]?.delta?.content;
    if (delta) { text += delta; if (!event.choices[0].finish_reason) sawPartial = true; }
    assert.doesNotMatch(raw, /SECRET SHOULD NOT ESCAPE|StructuredOutput|input_json_delta/);
  }
  assert.equal(sawPartial, true); assert.equal(done, true);
  assert.equal(text, 'Cześć Warszawo. To odpowiedź na żywo.');
});
