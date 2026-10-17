import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import {validCleanupDescriptor} from './process-cleanup-receipt.mjs';

const helperPath = fileURLToPath(new URL('./owned-process-supervisor.mjs', import.meta.url));
export function supervisorInvocation() {
  if (process.platform === 'linux') return [process.execPath, [helperPath]];
  if (!/^[A-Za-z]:\\/.test(helperPath)) throw new Error('Expected a local Windows helper path');
  const linuxPath = `/mnt/${helperPath[0].toLowerCase()}${helperPath.slice(2).replaceAll('\\', '/')}`;
  const nodeBinary = process.env.CODEX_WSL_NODE ?? '/usr/bin/node';
  return ['wsl.exe', [...(process.env.CODEX_WSL_DISTRO ? ['-d', process.env.CODEX_WSL_DISTRO] : []), '--exec', nodeBinary, linuxPath]];
}

// Does not settle on abort: capacity belongs to this job until cleanup is confirmed.
export function runOwnedProcess(command, { input = '', timeoutMs = 30_000, signal,
  stdoutLimit = 16 * 1024 * 1024, stderrLimit = 2 * 1024 * 1024, onStarted, cleanupReceipt } = {}) {
  if(cleanupReceipt&&!validCleanupDescriptor(cleanupReceipt))return Promise.reject(new Error('Invalid private cleanup descriptor'));
  if (signal?.aborted) return Promise.reject(Object.assign(new Error('Request cancelled'), { statusCode: 499 }));
  return new Promise((resolve, reject) => {
    const [binary, args] = supervisorInvocation();
    const transport = spawn(binary, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [], stderr = [];
    let outBytes = 0, errBytes = 0, receipt, failure, settled = false;
    const cancel = () => { transport.stdin.end(); };
    const fail = (message, code) => { failure ??= Object.assign(new Error(message), { code }); cancel(); };
    signal?.addEventListener('abort', cancel, { once: true });
    transport.stdin.on('error', () => {});
    // Closing the control pipe requests owned cleanup. Never kill just wsl.exe.
    const timer = setTimeout(() => fail('Owned job transport exceeded its deadline', 'TIMEOUT'), timeoutMs + 20_000);
    const lines = readline.createInterface({ input: transport.stdout, crlfDelay: Infinity });
    lines.on('line', (line) => {
      try {
        const event = JSON.parse(line);
        if (event.type === 'started') onStarted?.(event.pid);
        else if (event.type === 'stopped') receipt = event;
        else if (event.type === 'stdout' || event.type === 'stderr') {
          const data = Buffer.from(event.data, 'base64');
          if (event.type === 'stdout') {
            outBytes += data.length;
            if (outBytes > stdoutLimit) fail('Codex output exceeded the bridge limit', 'OUTPUT_LIMIT');
            else stdout.push(data);
          } else { errBytes += data.length; if (errBytes <= stderrLimit) stderr.push(data); }
        } else fail('Invalid owned supervisor event', 'TRANSPORT_PROTOCOL');
      } catch { fail('Invalid owned supervisor response', 'TRANSPORT_PROTOCOL'); }
    });
    transport.stderr.on('data', () => {}); // Private transport errors never contain model prompts in responses.
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
    transport.on('error', () => {
      if (settled) return;
      settled = true; cleanup();
      reject(Object.assign(new Error('Owned process transport could not start'), { cleanupUnconfirmed: true }));
    });
    transport.on('close', () => {
      if (settled) return;
      settled = true; cleanup();
      if (!receipt?.cleanupConfirmed) {
        reject(Object.assign(new Error('Owned process cleanup is unconfirmed; bridge requires recovery'), { cleanupUnconfirmed: true }));
      } else if (failure) reject(failure);
      else if (signal?.aborted || receipt.reason) {
        reject(Object.assign(new Error(signal?.aborted ? 'Request cancelled after owned process cleanup' : `Owned process stopped: ${receipt.reason}`),
          { statusCode: signal?.aborted ? 499 : 504, cleanupConfirmed: true }));
      } else resolve({ ...receipt, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
    const descriptor=cleanupReceipt?{...cleanupReceipt}:undefined;
    if(descriptor&&process.platform==='win32')descriptor.file=`/mnt/${descriptor.file[0].toLowerCase()}${descriptor.file.slice(2).replaceAll('\\','/')}`;
    transport.stdin.write(`${JSON.stringify({ command, input, timeoutMs, cleanupReceipt:descriptor })}\n`);
    if (signal?.aborted) cancel();
  });
}
