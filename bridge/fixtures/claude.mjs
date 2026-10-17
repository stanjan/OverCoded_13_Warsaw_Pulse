import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const args = process.argv.slice(2);
const file = process.env.CLAUDE_FIXTURE_FILE;
const fixture = file ? JSON.parse(readFileSync(file, 'utf8')) : {};
if (args.includes('auth')) {
  console.log(JSON.stringify({ loggedIn: true, authMethod: fixture.authMethod || 'claude.ai' }));
} else {
  let input = ''; for await (const chunk of process.stdin) input += chunk;
  if (fixture.capture) writeFileSync(fixture.capture, JSON.stringify({ args, input, cwd: process.cwd(),
    secretPresent: !!process.env.DATA_API_KEY || !!process.env.ANTHROPIC_API_KEY || !!process.env.ANTHROPIC_AUTH_TOKEN,
    oauthPresent: !!process.env.CLAUDE_CODE_OAUTH_TOKEN }));
  if (fixture.mode === 'wait') {
    if (fixture.pidFile) appendFileSync(fixture.pidFile, `${process.pid}\n`);
    const child = spawn(process.execPath, ['-e', `require('fs').appendFileSync(${JSON.stringify(fixture.pidFile)}, process.pid+'\\n');setInterval(()=>{},1000)`], { stdio: 'inherit' });
    child.on('error', () => {});
    setInterval(() => {}, 1000);
  } else if (fixture.mode === 'invalid') console.log('invalid');
  else if (fixture.mode === 'error') console.log(JSON.stringify({ is_error: true, subtype: 'error_during_execution', result: 'SECRET SHOULD NOT ESCAPE' }));
  else {
    const request = JSON.parse(input.slice(input.lastIndexOf('\nRequest:\n') + '\nRequest:\n'.length));
    let structured = fixture.response || { kind: 'assistant', content: 'Gotowe.', tool_calls: [] };
    if (fixture.mode === 'app') {
      const results = request.messages.filter(m => m.role === 'tool');
      const ids = results.length ? JSON.parse(results[0].content).results.map(r => r.id) : [];
      structured = results.length === 0 ? { kind: 'tool_calls', content: null, tool_calls: [{ name: 'search_places', arguments: '{"category":"event"}' }] }
        : results.length === 1 ? { kind: 'tool_calls', content: null, tool_calls: [{ name: 'display_results', arguments: JSON.stringify({ ids, highlightIds: ids.slice(0, 1), title: 'Kultura' }) }] }
        : { kind: 'assistant', content: 'Pokazuję miejsca z katalogu demonstracyjnego.', tool_calls: [] };
    }
    if (args.includes('stream-json')) {
      const emit = event => console.log(JSON.stringify({ type: 'stream_event', event }));
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', name: 'shell' } });
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"kind":"assistant","content":"SECRET SHOULD NOT ESCAPE","tool_calls":[]}' } });
      emit({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', name: 'StructuredOutput' } });
      const raw = JSON.stringify(structured), split = raw.indexOf('content') + 13;
      emit({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: raw.slice(0, split) } });
      if (fixture.streamDelay) await new Promise(resolve => setTimeout(resolve, fixture.streamDelay));
      emit({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: raw.slice(split) } });
    }
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: structured, usage: { input_tokens: 4, output_tokens: 3 } }));
  }
}
