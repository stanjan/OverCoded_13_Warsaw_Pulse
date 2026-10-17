import { randomUUID } from 'node:crypto';
export function openCompletionStream(response, model, { includeUsage = false, intervalMs = 15000 } = {}) {
  const id = `chatcmpl-${randomUUID()}`, created = Math.floor(Date.now() / 1000);
  let closed = false, content = '';
  const base = (delta, finishReason = null) => ({ id, object: 'chat.completion.chunk', created, model,
    choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }], system_fingerprint: 'warsaw-cli-bridge' });
  const write = chunk => { if (!closed && !response.destroyed && !response.writableEnded) response.write(`data: ${JSON.stringify(chunk)}\n\n`); };
  response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-store',
    connection: 'keep-alive', 'x-accel-buffering': 'no', 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*' });
  response.flushHeaders?.(); write(base({ role: 'assistant', content: '' }));
  const timer = intervalMs > 0 ? setInterval(() => { if (!closed && !response.destroyed) response.write(': keepalive\n\n'); }, intervalMs) : null;
  timer?.unref?.();
  const close = () => { if (closed) return; closed = true; clearInterval(timer); response.removeListener('close', close); };
  response.once('close', close);
  const end = () => { if (!response.destroyed && !response.writableEnded) response.end('data: [DONE]\n\n'); close(); };
  return {
    text(delta) { if (typeof delta === 'string' && delta) { content += delta; write(base({ content: delta })); } },
    progress(stage) { write({ bridge_progress: stage }); },
    complete(chat) {
      if (closed) return;
      if (chat.toolCalls.length) {
        if (content) return this.fail(new Error('Model returned tools after streaming assistant text.'));
        chat.toolCalls.forEach((call, index) => write(base({ tool_calls: [{ index, id: call.id, type: 'function', function: call.function }] })));
        write(base({}, 'tool_calls'));
      } else {
        const final = chat.content || '';
        if (!final.startsWith(content)) return this.fail(new Error('Streamed response does not match the validated answer.'));
        if (final.length > content.length) this.text(final.slice(content.length));
        write(base({}, 'stop'));
      }
      if (includeUsage) write({ ...base({}), choices: [], usage: chat.usage });
      end();
    },
    fail(error) { write({ error: { message: String(error.message || 'Model request failed'), type: 'server_error', code: error.code || 'bridge_error' } }); end(); },
    close,
  };
}
