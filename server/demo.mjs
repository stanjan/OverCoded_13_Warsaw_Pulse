import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const token = () => randomBytes(32).toString('base64url');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
class DemoError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new DemoError(status, message); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fingerprint = prompt => createHash('sha256').update(prompt).digest('hex');
const validClient = client => typeof client === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(client);
export function createDemoService({ enabled = false, origins = [], now = Date.now, pollMs = 25000, storePath } = {}) {
  const targets = new Map();
  const allowedOrigins = new Set(origins);
  for (const origin of allowedOrigins) {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol)) throw new Error('DEMO_ALLOWED_ORIGINS musi zawierać dokładne źródła HTTP(S), bez ścieżek i wildcard.');
  }
  // Only access metadata and the last 100 command fingerprints/statuses are persisted.
  // No prompt text, conversation, position or pending delivery queue is written.
  const persist = (next = targets) => {
    if (!enabled || !storePath) return;
    try {
      mkdirSync(dirname(storePath), { recursive: true });
      const temporary = `${storePath}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify({ version: 1, targets: [...next.values()].map(({ id, control, receiver, client, commands }) => ({ id, control, receiver, client, commands: [...commands.values()] })) }), { mode: 0o600 });
      renameSync(temporary, storePath);
    } catch { fail(503, 'Nie można zapisać dostępu demo. Sprawdź uprawnienia do lokalnego pliku .local/demo-targets.json i wolne miejsce na dysku.'); }
  };
  if (enabled && storePath) {
    try {
      const raw = readFileSync(storePath, 'utf8');
      if (raw.length > 1024 * 1024) throw new Error('Oversized demo store');
      const saved = JSON.parse(raw);
      if (saved.version !== 1 || !Array.isArray(saved.targets) || saved.targets.length > 8) throw new Error('Invalid demo store');
      for (const target of saved.targets) {
        if (!object(target) || !/^[a-f0-9]{24}$/.test(target.id) || targets.has(target.id) || !/^[a-zA-Z0-9_-]{43}$/.test(target.control) || !/^[a-zA-Z0-9_-]{43}$/.test(target.receiver) || (target.client !== null && !validClient(target.client)) || !Array.isArray(target.commands) || target.commands.length > 100) throw new Error('Invalid demo target');
        const commands = new Map();
        for (const command of target.commands) {
          if (!object(command) || !/^[a-zA-Z0-9_-]{8,100}$/.test(command.id) || commands.has(command.id) || !/^[a-f0-9]{64}$/.test(command.fingerprint) || !['delivered', 'started', 'finished', 'rejected'].includes(command.state) || !Number.isFinite(command.createdAt) || !Number.isFinite(command.updatedAt)) throw new Error('Invalid demo command');
          // Pick only known metadata, even if the file was edited externally.
          commands.set(command.id, { id: command.id, fingerprint: command.fingerprint, state: command.state, createdAt: command.createdAt, updatedAt: command.updatedAt, ...(command.state === 'rejected' ? { reason: 'Aplikacja zajęta lub ma niewysłany tekst.' } : {}) });
        }
        targets.set(target.id, { id: target.id, control: target.control, receiver: target.receiver, client: target.client, commands, waiter: null });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Nie można odczytać zapisanych celów demo z .local/demo-targets.json. Przywróć poprawny plik lub przenieś go, aby świadomie utworzyć nowe linki.');
    }
    // Verify durable storage before accepting any targets; never silently use RAM instead.
    persist();
  }
  const replace = target => { const next = new Map(targets); next.set(target.id, target); persist(next); targets.set(target.id, target); };
  const auth = (id, bearer, role) => {
    const target = targets.get(id);
    if (!target || !same(bearer, target[role])) fail(401, 'Nieprawidłowy lub unieważniony dostęp demo.');
    return target;
  };
  const checkBody = data => { if (!object(data)) fail(400, 'Wymagany obiekt JSON.'); };
  const publicCommand = command => ({ id: command.id, state: command.state, createdAt: command.createdAt, updatedAt: command.updatedAt, ...(command.reason ? { reason: command.reason } : {}) });
  return {
    enabled,
    originAllowed(origin, self, remote) { return !origin || origin === self || (remote && allowedOrigins.has(origin)); },
    // Local migration helper only; intentionally not routed through the HTTP API.
    importTargets(entries) {
      if (!Array.isArray(entries) || !entries.length || entries.length > 8) fail(400, 'Import wymaga od 1 do 8 istniejących celów.');
      const next = new Map(targets);
      for (const data of entries) {
        if (!object(data) || !/^[a-f0-9]{24}$/.test(data.target) || !/^[a-zA-Z0-9_-]{43}$/.test(data.controlToken) || !/^[a-zA-Z0-9_-]{43}$/.test(data.receiverToken)) fail(400, 'Nieprawidłowe dane importowanego celu.');
        const existing = next.get(data.target);
        if (existing && (!same(existing.control, data.controlToken) || !same(existing.receiver, data.receiverToken))) fail(409, 'Zapisany cel ma inne klucze. Import niczego nie nadpisze.');
        if (!existing) next.set(data.target, { id: data.target, control: data.controlToken, receiver: data.receiverToken, client: null, commands: new Map(), waiter: null });
      }
      if (next.size > 8) fail(429, 'Import przekroczyłby limit 8 aktywnych celów.');
      persist(next);
      for (const [id, target] of next) targets.set(id, target);
      return { imported: entries.length };
    },
    create(data) {
      checkBody(data);
      if (targets.size >= 8) fail(429, 'Za dużo aktywnych celów demo. Zakończ nieużywany cel przyciskiem Zakończ demo.');
      const id = randomBytes(12).toString('hex'), target = { id, control: token(), receiver: token(), commands: new Map(), waiter: null, client: null };
      replace(target);
      return { target: id, controlToken: target.control, receiverToken: target.receiver, expiresAt: null };
    },
    revoke(id, bearer) { const target = auth(id, bearer, 'control'); const next = new Map(targets); next.delete(id); persist(next); target.waiter?.finish(null); targets.delete(id); return { revoked: true }; },
    async poll(id, bearer, data, signal) {
      const target = auth(id, bearer, 'receiver'); checkBody(data);
      if (!validClient(data.client) || typeof data.ready !== 'boolean') fail(400, 'Nieprawidłowy odbiornik demo.');
      if (target.client && target.client !== data.client) fail(409, 'Ten cel jest już połączony z inną kartą. Utwórz nowy cel.');
      if (!target.client) { persist(new Map([...targets].map(([key, value]) => [key, key === id ? { ...target, client: data.client } : value]))); target.client = data.client; }
      if (target.waiter) fail(409, 'Odbiornik już oczekuje na polecenie.');
      if (signal?.aborted) return { command: null };
      return new Promise(resolve => {
        let timer;
        const finish = command => { clearTimeout(timer); signal?.removeEventListener('abort', abort); if (target.waiter === waiter) target.waiter = null; resolve({ command }); };
        const abort = () => finish(null);
        const waiter = { ready: data.ready, finish };
        target.waiter = waiter;
        timer = setTimeout(() => finish(null), pollMs);
        signal?.addEventListener('abort', abort, { once: true });
      });
    },
    prompt(id, bearer, data) {
      const target = auth(id, bearer, 'control'); checkBody(data);
      if (typeof data.prompt !== 'string' || !data.prompt.trim() || data.prompt.length > 2000 || /[\u0000]/.test(data.prompt)) fail(400, 'Prompt musi mieć od 1 do 2000 znaków.');
      if (typeof data.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(data.requestId)) fail(400, 'Podaj unikalny requestId (8–100 znaków: litery, cyfry, _ lub -).');
      const existing = target.commands.get(data.requestId);
      if (existing) {
        if (existing.fingerprint !== fingerprint(data.prompt.trim())) fail(409, 'requestId został już użyty z innym promptem.');
        return publicCommand(existing);
      }
      if (!target.waiter) fail(409, 'Brak połączonej aplikacji. Otwórz odbiornik i poczekaj na połączenie.');
      if (!target.waiter.ready) fail(409, 'Aplikacja jest zajęta lub ma niewysłany tekst.');
      const command = { id: data.requestId, fingerprint: fingerprint(data.prompt.trim()), state: 'delivered', createdAt: now(), updatedAt: now() };
      const commands = new Map(target.commands);
      if (commands.size >= 100) commands.delete(commands.keys().next().value);
      commands.set(command.id, command);
      // Persist before delivery: a lost HTTP response or server restart cannot replay it.
      persist(new Map([...targets].map(([key, value]) => [key, key === id ? { ...target, commands } : value])));
      target.commands = commands;
      target.waiter.finish({ id: command.id, prompt: data.prompt.trim() });
      return publicCommand(command);
    },
    acknowledge(id, bearer, data) {
      const target = auth(id, bearer, 'receiver'); checkBody(data);
      if (target.client !== data.client) fail(401, 'Nieprawidłowy odbiornik.');
      const command = target.commands.get(data.id);
      if (!command || !['started', 'rejected', 'finished'].includes(data.state)) fail(400, 'Nieprawidłowe potwierdzenie.');
      if ((command.state === 'delivered' && ['started', 'rejected'].includes(data.state)) || (command.state === 'started' && data.state === 'finished')) {
        const updated = { ...command, state: data.state, updatedAt: now(), ...(data.state === 'rejected' ? { reason: 'Aplikacja zajęta lub ma niewysłany tekst.' } : {}) };
        const commands = new Map(target.commands); commands.set(command.id, updated);
        persist(new Map([...targets].map(([key, value]) => [key, key === id ? { ...target, commands } : value])));
        target.commands = commands;
        return publicCommand(updated);
      }
      return publicCommand(command);
    },
    status(id, bearer, commandId) {
      const target = auth(id, bearer, 'control');
      if (commandId) { const command = target.commands.get(commandId); if (!command) fail(404, 'Nie znaleziono polecenia.'); return publicCommand(command); }
      return { target: id, expiresAt: null, connected: Boolean(target.waiter), ready: Boolean(target.waiter?.ready) };
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
