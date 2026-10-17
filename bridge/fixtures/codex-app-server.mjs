import readline from 'node:readline';
import { appendFileSync } from 'node:fs';
let next = 0; const threads = new Set(), timers = new Map();
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const notify = (method, params) => send({ method, params });
for await (const line of readline.createInterface({ input: process.stdin })) {
  const message = JSON.parse(line); if (!message.id) continue;
  const { id, method, params = {} } = message;
  if (process.env.CODEX_FIXTURE_CAPTURE) appendFileSync(process.env.CODEX_FIXTURE_CAPTURE, JSON.stringify({ pid: process.pid, method, params }) + '\n');
  const result = value => send({ id, result: value });
  if (method === 'initialize') result({});
  else if (method === 'config/read') result({ config: { mcp_servers: { fixture_server: { enabled: true, tool_timeout_sec: '' } } } });
  else if (method === 'thread/start') { const threadId = 'thread-' + ++next; threads.add(threadId); result({ thread: { id: threadId } }); }
  else if (method === 'thread/loaded/list') result({ data: [...threads], nextCursor: null });
  else if (method === 'thread/archive') send({ id, error: { code: -32600, message: 'no rollout found for ephemeral thread' } });
  else if (method === 'thread/unsubscribe') {
    const loaded = threads.has(params.threadId);
    result({ status: loaded ? 'unsubscribed' : 'notLoaded' });
    // Like native Codex, successful unsubscribe acknowledges before unload.
    // An unsubscribed client is not guaranteed to receive thread/closed.
    if (loaded) setTimeout(() => threads.delete(params.threadId), 15);
  }
  else if (method === 'turn/start') {
    const threadId = params.threadId, turnId = 'turn-' + ++next;
    const request = JSON.parse(params.input[0].text), text = request.messages.at(-1)?.content;
    if (text === 'exit') { process.exit(1); }
    result({ turn: { id: turnId } }); notify('turn/started', { threadId, turn: { id: turnId } });
    if (text === 'wait') continue;
    const raw = JSON.stringify({ kind: 'assistant', content: 'Cześć Warszawo 🧡', tool_calls: [] });
    // Two partial wire deltas are deliberately emitted long before final completion.
    const split = raw.indexOf('Warszawo');
    notify('item/agentMessage/delta', { threadId, turnId, itemId: 'answer', delta: raw.slice(0, split) });
    timers.set(threadId, setTimeout(() => {
      notify('item/agentMessage/delta', { threadId, turnId, itemId: 'answer', delta: raw.slice(split) });
      notify('item/completed', { threadId, turnId, item: { type: 'agentMessage', text: raw } });
      notify('thread/tokenUsage/updated', { threadId, tokenUsage: { last: { inputTokens: 5, outputTokens: 7, totalTokens: 12 } } });
      notify('turn/completed', { threadId, turn: { id: turnId, status: 'completed' } });
    }, 200));
  } else if (method === 'turn/interrupt') { clearTimeout(timers.get(params.threadId)); result({}); notify('turn/completed', { threadId: params.threadId, turn: { id: params.turnId, status: 'interrupted' } }); }
  else result({});
}
for (const timer of timers.values()) clearTimeout(timer);
