import test from 'node:test';
import assert from 'node:assert/strict';
import { runOwnedProcess, supervisorInvocation } from './owned-process.mjs';

test('already cancelled requests never launch an owned process', async () => {
  let started = false;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runOwnedProcess('must-not-run', { signal: controller.signal, onStarted() { started = true; } }),
    (error) => error.statusCode === 499);
  assert.equal(started, false);
});
test('supervisor uses a fixed private Linux executable, never command interpolation', () => {
  const [binary, args] = supervisorInvocation();
  if (process.platform === 'win32') {
    assert.equal(binary, 'wsl.exe');
    assert.ok(args.includes('--exec'));
    assert.ok(args.includes(process.env.CODEX_WSL_NODE ?? '/usr/bin/node'));
    assert.match(args.at(-1), /^\/mnt\/[a-z]\/.+\/owned-process-supervisor\.mjs$/);
  } else assert.equal(binary, process.execPath);
});
