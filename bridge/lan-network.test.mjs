import test from 'node:test';
import assert from 'node:assert/strict';
import { bridgeNetworkConfig, bridgeRequestAccess, bridgeCompletionUrl, isPrivateIPv4 } from './network.mjs';
const request = (remote, host, headers = {}) => ({ socket: { remoteAddress: remote }, headers: { host, ...headers } });
test('LAN is explicit, supports private IPv4 only and validates configuration', () => {
  assert.equal(bridgeNetworkConfig({}).host, '127.0.0.1');
  for (const host of ['8.8.8.8', 'example.com', '::', '192.168.1.2:8780']) assert.throws(() => bridgeNetworkConfig({ CODEX_BRIDGE_HOST: host }));
  assert.throws(() => bridgeNetworkConfig({ CODEX_BRIDGE_ALLOWED_CLIENTS: '*' }));
  for (const ip of ['10.1.2.3', '172.16.1.2', '172.31.255.254', '192.168.1.2']) assert.ok(isPrivateIPv4(ip));
  for (const ip of ['172.32.1.2', '8.8.8.8', '169.254.1.2', '192.168.1.999', '::ffff:192.168.1.2']) assert.equal(isPrivateIPv4(ip), false);
  const local = bridgeNetworkConfig({});
  assert.equal(bridgeRequestAccess(request('127.0.0.1', 'localhost:8780'), local), null);
  assert.equal(bridgeRequestAccess(request('192.168.1.3', '192.168.1.2:8780'), local).status, 403);
});
test('LAN peers work without a key; exact client restrictions, Hosts, Origins and optional auth fail closed', () => {
  const lan = bridgeNetworkConfig({ CODEX_BRIDGE_HOST: '0.0.0.0' });
  assert.equal(bridgeRequestAccess(request('::ffff:192.168.1.3', '192.168.1.2:8780'), lan), null);
  for (const [remote, host, headers] of [
    ['8.8.8.8', '192.168.1.2'], ['192.168.1.3', 'evil.example'], ['192.168.1.3', '127.0.0.1'],
    ['127.0.0.1', '192.168.1.2.evil.example'], ['127.0.0.1', '127.0.0.1@evil.example'],
    ['192.168.1.3', '192.168.1.2/path'], ['192.168.1.3', '192.168.1.2', { origin: 'null' }],
  ]) assert.equal(bridgeRequestAccess(request(remote, host, headers), lan).status, 403);
  const strict = bridgeNetworkConfig({ CODEX_BRIDGE_HOST: '192.168.1.2', CODEX_BRIDGE_ALLOWED_CLIENTS: '192.168.1.3', CODEX_BRIDGE_API_KEY: 'test-only-key' });
  assert.equal(bridgeRequestAccess(request('192.168.1.4', '192.168.1.2'), strict).status, 403);
  assert.equal(bridgeRequestAccess(request('192.168.1.3', '192.168.1.4'), strict).status, 403);
  assert.equal(bridgeRequestAccess(request('192.168.1.3', '192.168.1.2'), strict).status, 401);
  assert.equal(bridgeRequestAccess(request('192.168.1.3', '192.168.1.2', { authorization: 'Bearer wrong-key' }), strict).status, 401);
  assert.equal(bridgeRequestAccess(request('192.168.1.3', '192.168.1.2', { authorization: 'Bearer test-only-key' }), strict), null);
});
test('outbound URL permits literal LAN and loopback without credentials or redirect destinations', () => {
  assert.equal(bridgeCompletionUrl('http://192.168.1.2:8780/v1/'), 'http://192.168.1.2:8780/v1/chat/completions');
  assert.equal(bridgeCompletionUrl('https://127.0.0.1:8780/v1'), 'https://127.0.0.1:8780/v1/chat/completions');
  for (const url of ['http://example.com/v1', 'http://8.8.8.8/v1', 'http://192.168.1.2/v1?token=x', 'http://192.168.1.2/v1#x', 'http://user:pass@192.168.1.2/v1', 'ftp://192.168.1.2/v1', 'http://192.168.1.2/wrong']) assert.throws(() => bridgeCompletionUrl(url));
});
