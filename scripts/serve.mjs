import { createServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createSecureContext } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createAssistant, BridgeError } from '../server/assistant.mjs';
import { getEnvironment, EnvironmentError } from '../server/environment.mjs';
import { transitService } from '../server/transit.mjs';
import { TransitError } from '../transit-core.mjs';
import { createDemoService, createDemoHandler } from '../server/demo.mjs';
const demoRequest = createDemoHandler(createDemoService({ enabled: process.env.DEMO_REMOTE_ENABLED === '1', origins: (process.env.DEMO_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean) }));
const root = resolve(import.meta.dirname, '..');
const assistant = createAssistant({ environmentProvider: getEnvironment });
if (process.env.DATA_API_KEY) transitService.startTracking().catch(() => {});
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || '127.0.0.1';
const httpsPort = process.env.HTTPS_PORT ? Number(process.env.HTTPS_PORT) : null;
let tlsOptions, publicCA;
if (httpsPort !== null) {
  if (!Number.isInteger(httpsPort) || httpsPort < 1 || httpsPort > 65535 || httpsPort === port) throw new Error('HTTPS_PORT musi być wolnym portem innym niż PORT.');
  if (!process.env.TLS_CERT_FILE || !process.env.TLS_KEY_FILE) throw new Error('HTTPS wymaga TLS_CERT_FILE i TLS_KEY_FILE. Uruchom npm run cert:local -- <IP komputera>.');
  try {
    tlsOptions = { cert: await readFile(resolve(root, process.env.TLS_CERT_FILE)), key: await readFile(resolve(root, process.env.TLS_KEY_FILE)), minVersion: 'TLSv1.2' };
    createSecureContext(tlsOptions);
    // Parse and re-encode the public certificate; no key or arbitrary file is downloadable.
    const ca = new X509Certificate(await readFile(resolve(root, process.env.TLS_CA_FILE || '.local/tls/ca.cer')));
    const leaf = new X509Certificate(tlsOptions.cert);
    if (!ca.ca || !leaf.verify(ca.publicKey) || leaf.ca || Date.parse(leaf.validTo) <= Date.now() || Date.parse(leaf.validFrom) > Date.now()) throw new Error('Expected a valid server certificate signed by the downloadable CA.');
    publicCA = ca.raw;
  } catch { throw new Error('Nie można uruchomić HTTPS: sprawdź lokalny certyfikat, klucz oraz .local/tls/ca.cer. HTTP nie został uruchomiony.'); }
}
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const staticFiles = new Set(['/index.html', '/demo.html', '/demo-control.mjs', '/demo-receiver.mjs', '/app.css', '/map.js', '/app.js', '/environment.js', '/loading.js', '/loading.css', '/map-loading.jpg', '/transit-ui.mjs', '/transit-core.mjs', '/departure-board.mjs', '/favorites.mjs', '/sw.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png']);
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
const handleRequest = async (req, res) => {
  try {
    const requestPort = req.socket.localPort;
    const allowedHosts = new Set([`127.0.0.1:${requestPort}`, `localhost:${requestPort}`, `${host}:${requestPort}`]);
    if (!allowedHosts.has(req.headers.host)) return json(res, 403, { error: 'Niedozwolony host.' });
    const origin = `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
    const url = new URL(req.url, origin);
    if (await demoRequest(req, res, url, origin)) return;
    if (url.pathname === '/dev-ca.cer' && ['GET', 'HEAD'].includes(req.method) && publicCA) {
      res.writeHead(200, { 'Content-Type': 'application/pkix-cert', 'Content-Disposition': 'attachment; filename="warsaw-ai-local-ca.cer"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(req.method === 'HEAD' ? undefined : publicCA);
    }
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
    if (['/api/transit/plan','/api/transit/live','/api/transit/board'].includes(url.pathname) && req.method === 'POST') {
      if (req.headers.origin && req.headers.origin !== origin) return json(res, 403, { error: 'Niedozwolone źródło zapytania.' });
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Wymagany JSON.' });
      let size=0;const chunks=[];
      for await (const chunk of req) {size+=chunk.length;if(size>5000)return json(res,413,{error:'Zapytanie jest zbyt długie.'});chunks.push(chunk);}
      let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return json(res,400,{error:'Nieprawidłowy JSON.'});}
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),url.pathname==='/api/transit/plan'?140000:90000);
      res.on('close',()=>{if(!res.writableEnded)controller.abort();});
      try{return json(res,200,url.pathname==='/api/transit/live'?transitService.liveSnapshot(data):url.pathname==='/api/transit/board'?await transitService.board(data,{signal:controller.signal}):await transitService.plan(data,{signal:controller.signal}));}finally{clearTimeout(timer);}
    }
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      if (req.headers.origin && req.headers.origin !== origin) return json(res, 403, { error: 'Niedozwolone źródło zapytania.' });
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
    const path = url.pathname === '/' ? '/index.html' : url.pathname === '/demo' ? '/demo.html' : url.pathname;
    if (!staticFiles.has(path)) return json(res, 404, { error: 'Nie znaleziono.' });
    const data = await readFile(resolve(root, '.' + path));
    res.writeHead(200, { 'Content-Type': types[extname(path)], 'X-Content-Type-Options': 'nosniff', ...(path === '/demo.html' ? { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" } : {}) }); res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    if (error instanceof TransitError && !res.headersSent && !res.destroyed) return json(res, /SOURCE|GTFS_UNAVAILABLE/.test(error.code) ? 503 : 400, { error: error.message, code: error.code });
    if (!res.headersSent && !res.destroyed) json(res, error instanceof BridgeError || error instanceof EnvironmentError ? error.status : 500, { error: error instanceof BridgeError || error instanceof EnvironmentError ? error.message : 'Nie udało się obsłużyć zapytania.' });
  }
};
createServer(handleRequest).listen(port, host, () => console.log(`Local: http://${host}:${port}\nBridge: ${process.env.CODEX_BRIDGE_URL ? 'configured' : 'not configured'}`));
if (tlsOptions) createHttpsServer(tlsOptions, handleRequest).listen(httpsPort, host, () => console.log(`HTTPS: https://${host}:${httpsPort}\nInstall CA: http://${host}:${port}/dev-ca.cer`));
