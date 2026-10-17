import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createAssistant, BridgeError } from '../server/assistant.mjs';
const root = resolve(import.meta.dirname, '..');
const assistant = createAssistant();
const port = Number(process.env.PORT || 5173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };
const staticFiles = new Set(['/index.html', '/app.css', '/app.js']);
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
createServer(async (req, res) => {
  try {
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) return json(res, 403, { error: 'Niedozwolony host.' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { configured: Boolean(process.env.CODEX_BRIDGE_URL), dataMode: 'demo' });
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Niedozwolone źródło zapytania.' });
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Wymagany JSON.' });
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 20000) return json(res, 413, { error: 'Zapytanie jest zbyt długie.' }); chunks.push(chunk); }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return json(res, 400, { error: 'Nieprawidłowy JSON.' }); }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);
      res.on('close', () => { if (!res.writableEnded) controller.abort(); });
      try { return json(res, 200, await assistant.chat(data || {}, controller.signal)); } finally { clearTimeout(timeout); }
    }
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Niedozwolona metoda.' });
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!staticFiles.has(path)) return json(res, 404, { error: 'Nie znaleziono.' });
    const data = await readFile(resolve(root, '.' + path));
    res.writeHead(200, { 'Content-Type': types[extname(path)], 'X-Content-Type-Options': 'nosniff' }); res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    if (!res.headersSent && !res.destroyed) json(res, error instanceof BridgeError ? error.status : 500, { error: error instanceof BridgeError ? error.message : 'Nie udało się obsłużyć zapytania.' });
  }
}).listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}\nBridge: ${process.env.CODEX_BRIDGE_URL ? 'configured' : 'not configured'}`));
