import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { createServer } from 'node:net';
import { request } from 'node:https';
import { spawn } from 'node:child_process';
import { generateDevCertificate } from '../scripts/dev-cert.mjs';

async function port() { const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
function https(url, ca, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { ca, method, headers }, res => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })); });
    req.on('error', reject); req.end(body);
  });
}
test('local CA is reusable, certificates cover the phone address, HTTPS shares APIs and only publishes the public CA', { timeout: 90000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'warsaw-local-tls-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const hosts = ['localhost', '127.0.0.1', '192.168.1.222'];
  const first = await generateDevCertificate({ directory, hosts });
  const caBytes = await readFile(join(directory, 'ca.pem'));
  const caKey = await readFile(join(directory, 'ca.key'));
  const ca = new X509Certificate(caBytes), leaf = new X509Certificate(await readFile(join(directory, 'server.pem')));
  assert.equal(ca.ca, true); assert.equal(leaf.ca, false); assert.equal(leaf.verify(ca.publicKey), true);
  assert.equal(leaf.checkIP('192.168.1.222'), '192.168.1.222'); assert.equal(leaf.checkIP('127.0.0.1'), '127.0.0.1'); assert.equal(leaf.checkHost('localhost'), 'localhost');
  assert.ok(leaf.keyUsage.includes('1.3.6.1.5.5.7.3.1'));
  assert.equal(first.reusedCA, false);
  const second = await generateDevCertificate({ directory, hosts: [...hosts, '192.168.1.223'] });
  assert.equal(second.reusedCA, true); assert.equal(second.fingerprint, first.fingerprint);
  assert.deepEqual(await readFile(join(directory, 'ca.key')), caKey); assert.deepEqual(await readFile(join(directory, 'ca.pem')), caBytes);
  assert.equal(new X509Certificate(await readFile(join(directory, 'server.pem'))).checkIP('192.168.1.223'), '192.168.1.223');
  const httpPort = await port(), httpsPort = await port();
  const child = spawn(process.execPath, ['scripts/serve.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, HOST: '127.0.0.1', PORT: String(httpPort), HTTPS_PORT: String(httpsPort), TLS_CERT_FILE: join(directory, 'server.pem'), TLS_KEY_FILE: join(directory, 'server.key'), TLS_CA_FILE: join(directory, 'ca.cer'), DATA_API_KEY: '', CODEX_BRIDGE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('HTTPS startup timeout')), 10000); child.stdout.on('data', data => { if (data.toString().includes('HTTPS:')) { clearTimeout(timer); resolve(); } }); child.once('error', reject); child.once('exit', code => { clearTimeout(timer); reject(new Error('server exited ' + code)); }); });
  const base = `https://127.0.0.1:${httpsPort}`;
  assert.equal((await https(base + '/api/health', caBytes)).status, 200);
  assert.equal((await fetch(`http://127.0.0.1:${httpPort}/api/health`)).status, 200);
  const download = await fetch(`http://127.0.0.1:${httpPort}/dev-ca.cer`);
  assert.equal(download.status, 200); assert.match(download.headers.get('content-type'), /pkix-cert/);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), ca.raw);
  assert.deepEqual((await https(base + '/dev-ca.cer', caBytes)).body, ca.raw);
  for (const path of ['/.local/tls/ca.key', '/.local/tls/server.key', '/dev-ca.cer/server.key', '/scripts/dev-cert.mjs']) assert.equal((await https(base + path, caBytes)).status, 404);
  const post = { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}' };
  assert.equal((await https(base + '/api/chat', caBytes, post)).status, 400);
  assert.equal((await https(base + '/api/transit/live', caBytes, { ...post, body: JSON.stringify({ origin: { latitude: 52.2, longitude: 21 }, destination: { latitude: 52.25, longitude: 21.02 } }) })).status, 200);
  for (const origin of [`http://127.0.0.1:${httpsPort}`, 'https://example.com']) assert.equal((await https(base + '/api/chat', caBytes, { ...post, headers: { ...post.headers, Origin: origin, 'X-Forwarded-Proto': 'https' } })).status, 403);
  assert.equal((await fetch(`http://127.0.0.1:${httpPort}/api/chat`, { ...post, headers: { ...post.headers, Origin: `https://127.0.0.1:${httpPort}`, 'X-Forwarded-Proto': 'https' } })).status, 403);
  const invalid = spawn(process.execPath, ['scripts/serve.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, HOST: '127.0.0.1', PORT: String(await port()), HTTPS_PORT: String(await port()), TLS_CERT_FILE: join(directory, 'missing.pem'), TLS_KEY_FILE: join(directory, 'server.key'), TLS_CA_FILE: join(directory, 'ca.cer'), DATA_API_KEY: '', CODEX_BRIDGE_URL: '' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let invalidOutput = ''; invalid.stdout.on('data', data => invalidOutput += data); invalid.stderr.on('data', data => invalidOutput += data);
  const invalidCode = await new Promise((resolve, reject) => { invalid.once('exit', resolve); invalid.once('error', reject); });
  assert.notEqual(invalidCode, 0); assert.match(invalidOutput, /Nie można uruchomić HTTPS/); assert.doesNotMatch(invalidOutput, /Local: http/);
  await writeFile(join(directory, 'ca.pem'), 'incomplete CA');
  await assert.rejects(generateDevCertificate({ directory, hosts }));
  assert.deepEqual(await readFile(join(directory, 'ca.key')), caKey);
});
