// Downloads a Stitch screen (HTML + screenshot) into design/.
// Usage: node --env-file=.env scripts/stitch-fetch.mjs <projectId> <screenId> [name]
import { writeFile, mkdir } from 'node:fs/promises';

const [projectId, screenId, name = 'stitch-' + screenId.slice(0, 8)] = process.argv.slice(2);
const key = process.env.STITCH_API_KEY;
if (!projectId || !screenId) throw new Error('Podaj projectId i screenId.');
if (!key) throw new Error('Brak STITCH_API_KEY w .env.');

const ENDPOINT = 'https://stitch.googleapis.com/mcp';
let id = 0;
async function rpc(method, params = {}) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'X-Goog-Api-Key': key },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Stitch ${res.status}: ${text.slice(0, 300)}`);
  // Plain JSON or a server-sent-events stream with a "data:" line.
  const json = text.trim().startsWith('{') ? JSON.parse(text) : JSON.parse(text.split('\n').filter(l => l.startsWith('data:')).pop().slice(5));
  if (json.error) throw new Error(`Stitch error: ${JSON.stringify(json.error).slice(0, 300)}`);
  return json.result;
}

const { tools } = await rpc('tools/list');
const tool = tools.find(t => t.name === 'get_screen');
if (!tool) throw new Error('Brak narzędzia get_screen. Dostępne: ' + tools.map(t => t.name).join(', '));
const props = Object.keys(tool.inputSchema?.properties || {});
console.log('get_screen params:', props.join(', '));
const args = {};
for (const p of props) {
  if (/^name$/i.test(p)) args[p] = `projects/${projectId}/screens/${screenId}`;
  else if (/project/i.test(p)) args[p] = projectId;
  else if (/screen/i.test(p)) args[p] = screenId;
}
const result = await rpc('tools/call', { name: 'get_screen', arguments: args });
await mkdir('design', { recursive: true });
await writeFile(`design/${name}.json`, JSON.stringify(result, null, 2));

const raw = JSON.stringify(result);
const urls = [...new Set(raw.match(/https:\/\/[^"\\\s]+/g) || [])];
let saved = 0;
for (const url of urls) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) continue;
  const type = res.headers.get('content-type') || '';
  const ext = type.includes('html') ? 'html' : type.includes('png') ? 'png' : type.includes('jpeg') ? 'jpg' : type.includes('webp') ? 'webp' : null;
  if (!ext) continue;
  const file = `design/${name}${saved ? '-' + saved : ''}.${ext}`;
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  console.log('saved', file);
  saved++;
}
console.log(saved ? 'Gotowe.' : 'Nie znaleziono plików do pobrania — zobacz design/' + name + '.json');
