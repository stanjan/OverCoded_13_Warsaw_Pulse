// Service worker: network-first for the app shell so updates show immediately, cached copy when offline.
// API calls (/api/*) and cross-origin requests (map tiles, CDNs) are never intercepted.
const CACHE = 'warszawa-pulse-v1';
const SHELL = ['/', '/index.html', '/app.css', '/map.js', '/app.js', '/environment.js', '/loading.js', '/loading.css', '/map-loading.jpg', '/transit-ui.mjs', '/transit-core.mjs', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const { request } = event, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)); }
    return response;
  }).catch(async () => (await caches.match(request)) || (request.mode === 'navigate' && await caches.match('/index.html')) || Response.error()));
});
