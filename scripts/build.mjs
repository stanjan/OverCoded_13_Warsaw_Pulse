import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist/icons', { recursive: true });
for (const file of ['index.html', 'demo.html', 'demo-control.mjs', 'demo-receiver.mjs', 'app.css', 'map.js', 'app.js', 'environment.js', 'loading.js', 'loading.css', 'map-loading.jpg', 'transit-ui.mjs', 'transit-core.mjs', 'departure-board.mjs', 'favorites.mjs', 'sw.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png']) await copyFile(file, `dist/${file}`);
console.log('Built mobile web app in dist/');
