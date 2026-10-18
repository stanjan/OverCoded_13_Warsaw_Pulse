import { randomBytes, timingSafeEqual } from 'node:crypto';

const token = () => randomBytes(32).toString('base64url');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
class DemoError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new DemoError(status, message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function createDemoService({ enabled = false, origins = [], now = Date.now, ttl = 3600000, pollMs = 25000 } = {}) {
  const targets = new Map();
  const allowedOrigins = new Set(origins);
  for (const origin of allowedOrigins) {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol)) throw new Error('DEMO_ALLOWED_ORIGINS musi zawierać dokładne źródła HTTP(S), bez ścieżek i wildcard.');
  }
  const prune = () => { for (const [id, target] of targets) if (target.expiresAt <= now()) { target.waiter?.finish(null); targets.delete(id); } };
  const auth = (id, bearer, role) => {
    prune(); const target = targets.get(id);
    if (!target || !same(bearer, target[role])) fail(401, 'Nieprawidłowy lub wygasły dostęp demo.');
    return target;
  };
  const checkBody = data => { if (!object(data)) fail(400, 'Wymagany obiekt JSON.'); };
  const publicCommand = command => ({ id: command.id, state: command.state, createdAt: command.createdAt, updatedAt: command.updatedAt, ...(command.reason ? { reason: command.reason } : {}) });
  return {
    enabled,
    originAllowed(origin, self, remote) { return !origin || origin === self || (remote && allowedOrigins.has(origin)); },
    create(data) {
      checkBody(data); prune();
      if (targets.size >= 8) fail(429, 'Za dużo aktywnych celów demo. Odłącz nieużywany cel lub poczekaj na jego wygaśnięcie.');
      const id = randomBytes(12).toString('hex'), target = { id, control: token(), receiver: token(), expiresAt: now() + ttl, commands: new Map(), waiter: null, client: null };
      targets.set(id, target);
      return { target: id, controlToken: target.control, receiverToken: target.receiver, expiresAt: target.expiresAt };
    },
    revoke(id, bearer) { const target = auth(id, bearer, 'control'); target.waiter?.finish(null); targets.delete(id); return { revoked: true }; },
    async poll(id, bearer, data, signal) {
      const target = auth(id, bearer, 'receiver'); checkBody(data);
      if (typeof data.client !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(data.client) || typeof data.ready !== 'boolean') fail(400, 'Nieprawidłowy odbiornik demo.');
      if (target.client && target.client !== data.client) fail(409, 'Ten cel jest już połączony z inną kartą. Utwórz nowy cel.');
      target.client = data.client;
      if (target.waiter) fail(409, 'Odbiornik już oczekuje na polecenie.');
      if (signal?.aborted) return { command: null };
      return new Promise(resolve => {
        let timer;
        const finish = command => { clearTimeout(timer); signal?.removeEventListener('abort', abort); if (target.waiter === waiter) target.waiter = null; resolve({ command }); };
        const abort = () => finish(null);
        const waiter = { ready: data.ready, finish };
        target.waiter = waiter;
        timer = setTimeout(() => finish(null), Math.min(pollMs, Math.max(1, target.expiresAt - now())));
        signal?.addEventListener('abort', abort, { once: true });
      });
    },
    prompt(id, bearer, data) {
      const target = auth(id, bearer, 'control'); checkBody(data);
      if (typeof data.prompt !== 'string' || !data.prompt.trim() || data.prompt.length > 2000 || /[\u0000]/.test(data.prompt)) fail(400, 'Prompt musi mieć od 1 do 2000 znaków.');
      if (typeof data.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(data.requestId)) fail(400, 'Podaj unikalny requestId (8–100 znaków: litery, cyfry, _ lub -).');
      const existing = target.commands.get(data.requestId);
      if (existing) {
        if (existing.prompt !== data.prompt.trim()) fail(409, 'requestId został już użyty z innym promptem.');
        return publicCommand(existing);
      }
      if (!target.waiter) fail(409, 'Brak połączonej aplikacji. Otwórz odbiornik i poczekaj na połączenie.');
      if (!target.waiter.ready) fail(409, 'Aplikacja jest zajęta lub ma niewysłany tekst.');
      if (target.commands.size >= 100) fail(429, 'Osiągnięto limit 100 poleceń tego celu. Utwórz nowy cel.');
      const command = { id: data.requestId, prompt: data.prompt.trim(), state: 'delivered', createdAt: now(), updatedAt: now() };
      target.commands.set(command.id, command);
      target.waiter.finish({ id: command.id, prompt: command.prompt });
      return publicCommand(command);
    },
    acknowledge(id, bearer, data) {
      const target = auth(id, bearer, 'receiver'); checkBody(data);
      if (target.client !== data.client) fail(401, 'Nieprawidłowy odbiornik.');
      const command = target.commands.get(data.id);
      if (!command || !['started', 'rejected', 'finished'].includes(data.state)) fail(400, 'Nieprawidłowe potwierdzenie.');
      if ((command.state === 'delivered' && ['started', 'rejected'].includes(data.state)) || (command.state === 'started' && data.state === 'finished')) {
        command.state = data.state; command.updatedAt = now();
        if (data.state === 'rejected') command.reason = 'Aplikacja zajęta lub ma niewysłany tekst.';
      }
      return publicCommand(command);
    },
    status(id, bearer, commandId) {
      const target = auth(id, bearer, 'control');
      if (commandId) { const command = target.commands.get(commandId); if (!command) fail(404, 'Nie znaleziono polecenia.'); return publicCommand(command); }
      return { target: id, expiresAt: target.expiresAt, connected: Boolean(target.waiter), ready: Boolean(target.waiter?.ready) };
    },
  };
}

export function createDemoHandler(service) {
  return async function demoRequest(req, res, url, selfOrigin) {
    if (!url.pathname.startsWith('/api/demo/')) return false;
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
    const reply = (status, data) => { if (!res.destroyed) { res.writeHead(status, headers); res.end(JSON.stringify(data)); } return true; };
    try {
      if (!service.enabled) return reply(503, { error: 'Demo zdalne jest wyłączone. Ustaw DEMO_REMOTE_ENABLED=1 i uruchom ponownie serwer.' });
      const match = /^\/api\/demo\/targets\/([a-f0-9]{24})(?:\/(prompts|poll|ack)(?:\/([a-zA-Z0-9_-]{8,100}))?)?$/.exec(url.pathname);
      const remote = match && (!match[2] || match[2] === 'prompts');
      if (!service.originAllowed(req.headers.origin, selfOrigin, remote)) return reply(403, { error: 'Niedozwolone źródło demo.' });
      if (req.headers.origin) headers['Access-Control-Allow-Origin'] = req.headers.origin;
      if (req.method === 'OPTIONS') {
        if (url.pathname === '/api/demo/targets' || !remote) return reply(403, { error: 'Operacja dostępna tylko z aplikacji.' });
        headers['Access-Control-Allow-Methods'] = 'POST, GET, DELETE, OPTIONS'; headers['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
        return reply(204, undefined);
      }
      let data = {};
      if (req.method === 'POST') {
        if (!req.headers['content-type']?.startsWith('application/json')) return reply(415, { error: 'Wymagany JSON.' });
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > 12000) return reply(413, { error: 'Zapytanie jest zbyt długie.' }); chunks.push(chunk); }
        try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(400, { error: 'Nieprawidłowy JSON.' }); }
      }
      if (url.pathname === '/api/demo/targets' && req.method === 'POST') {
        if (req.headers.origin !== selfOrigin) return reply(403, { error: 'Utwórz cel z lokalnej strony /demo.' });
        return reply(201, service.create(data));
      }
      if (!match) return reply(404, { error: 'Nie znaleziono API demo.' });
      const [, id, action, commandId] = match;
      const bearer = /^Bearer ([a-zA-Z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1];
      if (!action && req.method === 'GET') return reply(200, service.status(id, bearer));
      if (!action && req.method === 'DELETE') return reply(200, service.revoke(id, bearer));
      if (action === 'prompts' && !commandId && req.method === 'POST') return reply(202, service.prompt(id, bearer, data));
      if (action === 'prompts' && commandId && req.method === 'GET') return reply(200, service.status(id, bearer, commandId));
      if (action === 'ack' && req.method === 'POST' && !commandId) return reply(200, service.acknowledge(id, bearer, data));
      if (action === 'poll' && req.method === 'POST' && !commandId) {
        const controller = new AbortController();
        const close = () => controller.abort(); res.on('close', close);
        try { return reply(200, await service.poll(id, bearer, data, controller.signal)); } finally { res.removeListener('close', close); }
      }
      return reply(405, { error: 'Niedozwolona metoda demo.' });
    } catch (error) { return reply(error instanceof DemoError ? error.status : 500, { error: error instanceof DemoError ? error.message : 'Błąd demo.' }); }
  };
}
