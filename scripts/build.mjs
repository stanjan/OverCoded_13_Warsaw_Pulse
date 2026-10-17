import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'app.css', 'map.js', 'app.js']) await copyFile(file, `dist/${file}`);
console.log('Built mobile web app in dist/');
