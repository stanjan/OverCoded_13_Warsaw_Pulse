import { StringDecoder } from 'node:string_decoder';
import { StructuredContentStream } from './structured-stream.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PREFIX = 'claude-cli/';
const aliases = ['default', 'sonnet', 'opus', 'haiku'];
const failure = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode });
export const isClaudeCliModel = model => typeof model === 'string' && model.startsWith(PREFIX);
export function claudeCliSelection(model) {
  const target = model.slice(PREFIX.length);
  if (!aliases.includes(target) && !/^claude-[a-z0-9][a-z0-9.-]{0,99}$/.test(target))
    throw failure('Use claude-cli/sonnet, claude-cli/opus, claude-cli/haiku or claude-cli/<Claude model ID>.', 400);
  return { requestedId: model, model: target };
}
export const claudeCliModels = () => aliases.map(alias => ({ id: PREFIX + alias, object: 'model',
  created: 0, owned_by: 'anthropic', provider: 'claude-cli', description: 'Local Claude CLI subscription login; installation and authentication checked on use.' }));

// Never let ambient API/cloud credentials quietly switch subscription requests to billing.
export function subscriptionEnvironment(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([key]) => {
    if (key === 'CLAUDE_CODE_OAUTH_TOKEN') return true;
    return !/^(ANTHROPIC_|CLAUDE_CODE_USE_|CLAUDE_CODE_SUBAGENT_MODEL$)/i.test(key)
      && !/(KEY|TOKEN|SECRET|PASSWORD)/i.test(key);
  }));
}
const commonArgs = ['--safe-mode', '--setting-sources', '', '--settings', '{"forceLoginMethod":"claudeai"}'];
function invocation(args) {
  const executable = process.env.CLAUDE_CLI_PATH || 'claude';
  if (/\.(?:cmd|bat)$/i.test(executable)) throw failure('CLAUDE_CLI_PATH must be a native executable or the Claude CLI JavaScript entry point, not a .cmd/.bat wrapper.', 503);
  return /\.(?:mjs|cjs|js)$/i.test(executable) ? [process.execPath, [executable, ...args]] : [executable, args];
}

// No shell command is built from prompts or model input. Keep capacity until the
// owned child tree has stopped, including cancellation and output-limit failures.
export function runClaudeProcess(args, { input = '', cwd, signal, timeoutMs = 600_000, outputLimit = 16 * 1024 * 1024, onStdout } = {}) {
  if (signal?.aborted) return Promise.reject(failure('Claude CLI request cancelled.', 499));
  const [command, commandArgs] = invocation(args);
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { cwd, env: subscriptionEnvironment(), windowsHide: true,
      detached: process.platform !== 'win32', shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const output = [];
    const decoder = new StringDecoder('utf8');
    let bytes = 0, problem, killer, killTimer, exited = false;
    const terminate = () => {
      if (exited || killer) return;
      if (process.platform === 'win32') {
        killer = new Promise(done => {
          const kill = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
            ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          kill.on('error', () => { problem = Object.assign(failure('Claude CLI process cleanup could not be confirmed.', 503), { cleanupUnconfirmed: true }); child.kill(); done(); });
          kill.on('close', code => { if (code !== 0) problem = Object.assign(failure('Claude CLI process cleanup could not be confirmed.', 503), { cleanupUnconfirmed: true }); done(); });
        });
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch {}
        killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, 500);
      }
    };
    const cancel = () => { problem ||= failure('Claude CLI request cancelled.', 499); terminate(); };
    const timer = setTimeout(() => { problem ||= failure('Claude CLI timed out.', 504); terminate(); }, timeoutMs);
    signal?.addEventListener('abort', cancel, { once: true });
    child.stdin.on('error', () => {});
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > outputLimit) { problem ||= failure('Claude CLI response exceeded the bridge limit.'); terminate(); } else { output.push(chunk); try { onStdout?.(decoder.write(chunk)); } catch { problem ||= failure('Invalid Claude stream.'); terminate(); } } });
    child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > outputLimit) { problem ||= failure('Claude CLI output exceeded the bridge limit.'); terminate(); } });
    child.on('error', () => { problem ||= failure('Claude CLI could not start. Install Claude Code, run claude and sign in with your subscription; set CLAUDE_CLI_PATH if needed.', 503); });
    child.on('close', async code => {
      exited = true;
      clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      if (process.platform !== 'win32') {
        // A child may leave descendants holding no stdio. Kill its isolated group.
        try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      }
      clearTimeout(killTimer); await killer;
      if (problem) reject(problem); else resolve({ code, stdout: Buffer.concat(output).toString('utf8') });
    });
    child.stdin.end(input);
    if (signal?.aborted) cancel();
  });
}

function jsonOutput(stdout) {
  try { return JSON.parse(stdout); } catch { throw failure('Claude CLI returned invalid JSON. Update Claude Code to a version supporting safe mode and structured output.'); }
}
async function verifySubscription(options) {
  const result = await runClaudeProcess([...commonArgs, 'auth', 'status', '--json'], { ...options, timeoutMs: 15_000 });
  const auth = jsonOutput(result.stdout);
  if (result.code !== 0 || auth.loggedIn !== true || !['claude.ai', 'oauth_token'].includes(auth.authMethod))
    throw failure('Claude CLI needs a Claude subscription login. Run claude, sign in with your Claude account, then retry. API-key and Console authentication are not accepted for this provider.', 503);
}
export async function claudeCliHealth(signal) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'warsaw-claude-health-'));
  try { await verifySubscription({ cwd, signal }); return { ok: true, provider: 'claude-cli', subscriptionAuthenticated: true }; }
  finally { await rm(cwd, { recursive: true, force: true }); }
}
export async function executeClaudeCli({ payload, schema, policy, normalize, signal, onText }) {
  const selection = claudeCliSelection(payload.model);
  const cwd = await mkdtemp(path.join(tmpdir(), 'warsaw-claude-'));
  try {
    await verifySubscription({ cwd, signal });
    const request = { messages: payload.messages, tools: payload.tools || [], tool_choice: payload.tool_choice || 'auto',
      parallel_tool_calls: payload.parallel_tool_calls ?? true, response_format: payload.response_format || null };
    const input = `${policy}\nIn this Claude CLI provider no native tools, including web search, are available. Use only the supplied application tool definitions as structured tool_calls in your response. Never execute tools yourself.\nRequest:\n${JSON.stringify(request)}`;
    if (input.length > 1_000_000) throw failure('Claude CLI prompt exceeds the bridge limit.', 413);
    let parser, blockIndex;
    let lines = '', finalOutput;
    const consume = chunk => {
      lines += chunk;
      let end; while ((end = lines.indexOf('\n')) >= 0) {
        const line = lines.slice(0, end); lines = lines.slice(end + 1);
        let event; try { event = JSON.parse(line); } catch { continue; }
        if (event.type === 'result') finalOutput = event;
        const delta = event.type === 'stream_event' ? event.event : null;
        if (delta?.type === 'content_block_start') {
          const block = delta.content_block;
          if (block?.type === 'text' || (block?.type === 'tool_use' && block.name === 'StructuredOutput')) {
            parser = new StructuredContentStream(onText); blockIndex = delta.index;
          } else { parser = null; blockIndex = undefined; }
        }
        if (delta?.type === 'content_block_delta' && parser && delta.index === blockIndex) {
          const part = delta.delta?.partial_json ?? delta.delta?.text;
          if (typeof part === 'string') parser.feed(part);
        }
      }
    };
    const result = await runClaudeProcess([...commonArgs, '-p', ...(selection.model === 'default' ? [] : ['--model', selection.model]), '--output-format', ...(onText ? ['stream-json', '--verbose', '--include-partial-messages'] : ['json']),
      '--json-schema', JSON.stringify(schema), '--tools', '', '--disallowedTools', 'mcp__*',
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence', '--permission-mode', 'dontAsk'], { input, cwd, signal, onStdout: onText ? consume : undefined });
    consume('\n');
    const response = finalOutput || jsonOutput(result.stdout);
    if (result.code !== 0 || response.is_error || response.subtype !== 'success') {
      const status = response.subtype === 'error_max_turns' ? 502 : 503;
      throw failure('Claude CLI could not complete the request. Check your subscription login, usage limits and Claude Code version.', status);
    }
    if (!response.structured_output || typeof response.structured_output !== 'object')
      throw failure('Claude CLI did not return the required structured response.');
    return { ...normalize(JSON.stringify(response.structured_output), payload), requestedModel: selection.requestedId,
      usage: { prompt_tokens: Number(response.usage?.input_tokens || 0) + Number(response.usage?.cache_read_input_tokens || 0) + Number(response.usage?.cache_creation_input_tokens || 0),
        completion_tokens: Number(response.usage?.output_tokens || 0) } };
  } finally { await rm(cwd, { recursive: true, force: true }); }
}
