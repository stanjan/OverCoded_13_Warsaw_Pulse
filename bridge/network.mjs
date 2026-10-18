import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';

export function isPrivateIPv4(value) {
  if (isIP(value) !== 4) return false;
  const [a, b] = value.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
export function isLoopback(value) {
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1';
}
function peerAddress(value) { return value?.startsWith('::ffff:') ? value.slice(7) : value; }
export function bridgeNetworkConfig(env = process.env) {
  const host = env.CODEX_BRIDGE_HOST?.trim() || '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '0.0.0.0' && !isPrivateIPv4(host)) throw new Error('CODEX_BRIDGE_HOST must be 127.0.0.1, 0.0.0.0 or a private IPv4 address.');
  const clients = (env.CODEX_BRIDGE_ALLOWED_CLIENTS || '').split(',').map(x => x.trim()).filter(Boolean);
  if (clients.some(x => x !== '127.0.0.1' && !isPrivateIPv4(x))) throw new Error('CODEX_BRIDGE_ALLOWED_CLIENTS must contain exact private IPv4 addresses.');
  const key = env.CODEX_BRIDGE_API_KEY || '';
  if (key && !/^[\x21-\x7e]{1,512}$/.test(key)) throw new Error('CODEX_BRIDGE_API_KEY must be a printable ASCII token without spaces.');
  return { host, lan: host !== '127.0.0.1', clients: new Set(clients), key };
}
// This check precedes body parsing, provider discovery and session creation.
export function bridgeRequestAccess(request, config) {
  const remote = peerAddress(request.socket.remoteAddress);
  const local = isLoopback(remote);
  if (!local && (!config.lan || !isPrivateIPv4(remote) || (config.clients.size && !config.clients.has(remote)))) return { status: 403, error: 'Bridge client address is not allowed.' };
  const hostHeader = request.headers.host;
  let host;
  if (typeof hostHeader === 'string' && /^(?:localhost|127\.0\.0\.1|\[::1\]|[0-9.]+)(?::[0-9]{1,5})?$/.test(hostHeader)) {
    try { host = new URL('http://' + hostHeader).hostname; } catch {}
  }
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(host);
  const privateHost = config.lan && isPrivateIPv4(host) && (config.host === '0.0.0.0' || host === config.host);
  if (!(local && localHost) && !privateHost) return { status: 403, error: 'Bridge Host header is not allowed.' };
  if (request.headers.origin !== undefined) return { status: 403, error: 'Use the application backend; browser-origin requests are disabled.' };
  if (config.key) {
    const supplied = request.headers.authorization;
    const expected = Buffer.from('Bearer ' + config.key);
    const actual = Buffer.from(typeof supplied === 'string' ? supplied : '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { status: 401, error: 'Bridge authentication required.' };
  }
  return null;
}
export function bridgeCompletionUrl(base) {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/', '/v1', '/v1/'].includes(url.pathname)) throw new Error('Invalid bridge URL.');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && !isPrivateIPv4(url.hostname)) throw new Error('Bridge URL must use loopback or a private IPv4 address.');
  url.pathname = url.pathname.replace(/\/$/, '') + '/chat/completions';
  return url.href;
}
