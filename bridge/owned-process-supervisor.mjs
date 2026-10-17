// Linux-side private transport. The parent holds stdin open for this job's lifetime.
// A lost Windows parent therefore cancels work without a second WSL invocation.
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import readline from 'node:readline';
import {validCleanupDescriptor,writeCleanupReceipt} from './process-cleanup-receipt.mjs';

if (process.platform !== 'linux') throw new Error('Owned process supervisor requires Linux');
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
let child, timer, killTimer, monitor, stopping = false, closed = false, reason = null;
let exitCode = null, exitSignal = null, started = false, disconnected = false, cleanupReceipt, finished=false;
const signalGroup = (signal) => {
  if (!child?.pid) return;
  try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
};
function liveGroup() {
  if (!child?.pid) return false;
  // Zombies cannot execute or perform side effects, and may await WSL init reaping.
  return readdirSync('/proc').some((name) => {
    if (!/^\d+$/.test(name)) return false;
    try {
      const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      return Number(fields[2]) === child.pid && !['Z', 'X'].includes(fields[0]);
    } catch (error) { if (['ENOENT', 'ESRCH'].includes(error.code)) return false; throw error; }
  });
}
function finishWhenStopped() {
  if (finished || !closed || liveGroup()) return;
  finished=true;
  clearTimeout(timer); clearTimeout(killTimer); clearInterval(monitor);
  const outcome={type:'stopped',code:exitCode,signal:exitSignal,reason,cleanupConfirmed:true,processGroup:child?.pid??null};
  // Write before IPC: the bridge may already be dead and unable to receive it.
  if(cleanupReceipt){try{writeCleanupReceipt(cleanupReceipt,outcome);outcome.durableCleanup=true;}catch{outcome.durableCleanup=false;}}
  emit(outcome);
  process.stdin.destroy();
  process.stdout.end(() => process.exit(0));
  setTimeout(() => process.exit(0), 100).unref();
}
function stop(cause) {
  reason ??= cause;
  if (!child || stopping) return;
  stopping = true;
  signalGroup('SIGTERM');
  killTimer = setTimeout(() => signalGroup('SIGKILL'), 1500);
  monitor = setInterval(finishWhenStopped, 50);
}
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  if (started) { stop('cancelled'); return; }
  started = true;
  const request = JSON.parse(line);
  if (typeof request.command !== 'string' || typeof request.input !== 'string' ||
      !Number.isFinite(request.timeoutMs) || request.timeoutMs < 1 || request.timeoutMs > 1_230_000) {
    throw new Error('Invalid private supervisor request');
  }
  if(request.cleanupReceipt&&!validCleanupDescriptor(request.cleanupReceipt))throw new Error('Invalid private cleanup descriptor');
  cleanupReceipt=request.cleanupReceipt;
  child = spawn('/bin/bash', ['-lc', request.command], {
    detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: process.env,
  });
  child.stdout.on('data', (data) => emit({ type: 'stdout', data: data.toString('base64') }));
  child.stderr.on('data', (data) => emit({ type: 'stderr', data: data.toString('base64') }));
  child.stdin.on('error', () => {}); // Early exit may close the prompt pipe.
  child.on('error', () => { closed = true; exitCode = 127; stop('spawn_failed'); });
  child.on('exit', (code, signal) => {
    exitCode = code; exitSignal = signal;
    // Also clean up descendants after an otherwise successful CLI exit.
    stop(reason);
  });
  child.on('close', () => { closed = true; finishWhenStopped(); });
  child.stdin.end(request.input);
  emit({ type: 'started', pid: child.pid });
  timer = setTimeout(() => stop('timeout'), request.timeoutMs);
  if (disconnected) stop('parent_disconnected');
});
input.on('close', () => { disconnected = true; if (started) stop('parent_disconnected'); else process.exit(0); });
process.on('SIGTERM', () => stop('supervisor_shutdown'));
process.on('SIGINT', () => stop('supervisor_shutdown'));
// WSL may hang up the session as the Windows transport vanishes, before stdin
// emits EOF. Default SIGHUP would kill the supervisor before its durable receipt.
process.on('SIGHUP', () => stop('parent_hangup'));
process.stdout.on('error', () => { /* Parent is gone; finish group cleanup before exiting. */ });
