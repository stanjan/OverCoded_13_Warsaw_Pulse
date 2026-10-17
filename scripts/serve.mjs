import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createAssistant, BridgeError } from '../server/assistant.mjs';
import { getEnvironment, EnvironmentError } from '../server/environment.mjs';
import { transitService } from '../server/transit.mjs';
import { TransitError } from '../transit-core.mjs';
const root = resolve(import.meta.dirname, '..');
const assistant = createAssistant({ environmentProvider: getEnvironment });
if (process.env.DATA_API_KEY) transitService.startTracking().catch(() => {});
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '127.0.0.1';
const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `${host}:${port}`]);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const staticFiles = new Set(['/index.html', '/app.css', '/map.js', '/app.js', '/environment.js', '/loading.js', '/loading.css', '/map-loading.jpg', '/transit-ui.mjs', '/transit-core.mjs', '/sw.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png']);
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
createServer(async (req, res) => {
  try {
    if (!allowedHosts.has(req.headers.host)) return json(res, 403, { error: 'Niedozwolony host.' });
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { configured: Boolean(process.env.CODEX_BRIDGE_URL), dataMode: 'official', cityDataConfigured: Boolean(process.env.DATA_API_KEY) });
    // Browser map key: public by design, protected by its HTTP-referrer and API restrictions in Google Cloud.
    if (url.pathname === '/api/config' && req.method === 'GET') return json(res, 200, { googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || null, googleMapsMapId: process.env.GOOGLE_MAPS_MAP_ID || null });
    if (url.pathname === '/api/environment' && req.method === 'GET') {
      const latitude = url.searchParams.get('latitude'), longitude = url.searchParams.get('longitude');
      const explicit = latitude !== null || longitude !== null;
      if (explicit && (latitude === null || longitude === null || !latitude.trim() || !longitude.trim())) return json(res, 400, { error: 'Podaj obie współrzędne lokalizacji.' });
      const location = explicit ? { latitude: Number(latitude), longitude: Number(longitude) } : undefined;
      const controller = new AbortController();
      res.on('close', () => { if (!res.writableEnded) controller.abort(); });
      return json(res, 200, await getEnvironment(location, { signal: controller.signal }));
    }
    if (url.pathname === '/api/transit/stops' && req.method === 'GET') {
      const controller = new AbortController();
      res.on('close', () => { if (!res.writableEnded) controller.abort(); });
      return json(res, 200, await transitService.searchStops(url.searchParams.get('q'), { signal: controller.signal }));
    }
    if (['/api/transit/plan','/api/transit/live'].includes(url.pathname) && req.method === 'POST') {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Niedozwolone źródło zapytania.' });
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Wymagany JSON.' });
      let size=0;const chunks=[];
      for await (const chunk of req) {size+=chunk.length;if(size>5000)return json(res,413,{error:'Zapytanie jest zbyt długie.'});chunks.push(chunk);}
      let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return json(res,400,{error:'Nieprawidłowy JSON.'});}
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
      res.on('close',()=>{if(!res.writableEnded)controller.abort();});
      try{return json(res,200,url.pathname==='/api/transit/live'?transitService.liveSnapshot(data):await transitService.plan(data,{signal:controller.signal}));}finally{clearTimeout(timer);}
    }
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
      try {
        if (data?.stream !== true) return json(res, 200, await assistant.chat(data || {}, controller.signal));
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.flushHeaders();
        const write = event => { if (!res.destroyed && !res.writableEnded) res.write('data: ' + JSON.stringify(event) + '\n\n'); };
        const heartbeat = setInterval(() => { if (!res.destroyed) res.write(': keepalive\n\n'); }, 15000);
        try {
          const answer = await assistant.chat(data || {}, controller.signal, write);
          write({ type: 'done', ...answer });
        } catch (error) {
          write({ type: 'error', message: error instanceof BridgeError ? error.message : 'Nie udało się uzyskać odpowiedzi. Spróbuj ponownie.' });
        } finally { clearInterval(heartbeat); res.end(); }
        return;
      } finally { clearTimeout(timeout); }
    }
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Niedozwolona metoda.' });
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!staticFiles.has(path)) return json(res, 404, { error: 'Nie znaleziono.' });
    const data = await readFile(resolve(root, '.' + path));
    res.writeHead(200, { 'Content-Type': types[extname(path)], 'X-Content-Type-Options': 'nosniff' }); res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    if (error instanceof TransitError && !res.headersSent && !res.destroyed) return json(res, /SOURCE|GTFS_UNAVAILABLE/.test(error.code) ? 503 : 400, { error: error.message, code: error.code });
    if (!res.headersSent && !res.destroyed) json(res, error instanceof BridgeError || error instanceof EnvironmentError ? error.status : 500, { error: error instanceof BridgeError || error instanceof EnvironmentError ? error.message : 'Nie udało się obsłużyć zapytania.' });
  }
}).listen(port, host, () => console.log(`Local: http://${host}:${port}\nBridge: ${process.env.CODEX_BRIDGE_URL ? 'configured' : 'not configured'}`));
