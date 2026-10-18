// Opt-in receiver. Access enters via a private fragment and survives reloads only in this tab.
const storageKey = 'warsaw-ai-demo-receiver';
export function receiverCredentials(hash) {
  try {
    const raw = new URLSearchParams(hash.replace(/^#/, '')).get('demo-receiver');
    if (!raw) return null;
    const data = JSON.parse(raw);
    return /^[a-f0-9]{24}$/.test(data.target) && /^[a-zA-Z0-9_-]{43}$/.test(data.token) ? data : null;
  } catch { return null; }
}
export function receiverSession(hash, storage) {
  const incoming = receiverCredentials(hash);
  let saved;
  try { saved = JSON.parse(storage.getItem(storageKey) || 'null'); } catch {}
  const validSaved = receiverCredentials('#' + new URLSearchParams({ 'demo-receiver': JSON.stringify(saved) }));
  const credentials = incoming || validSaved;
  if (!credentials) return null;
  const sameTarget = validSaved && saved.target === credentials.target && saved.token === credentials.token;
  const client = sameTarget && /^[a-zA-Z0-9_-]{16,100}$/.test(saved.client) ? saved.client : crypto.randomUUID().replaceAll('-', '');
  const session = { target: credentials.target, token: credentials.token, client };
  // Failure is explicit: never promise reload continuity while silently keeping access in RAM.
  storage.setItem(storageKey, JSON.stringify(session));
  return session;
}
export function createDemoReceiver({ credentials, isReady, start, fetcher = fetch, onState = () => {}, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const client = credentials.client || crypto.randomUUID().replaceAll('-', '');
  let stopped = false, controller;
  const path = `/api/demo/targets/${credentials.target}`;
  const post = async (action, data, signal) => {
    const boundedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(8000);
    const response = await fetcher(`${path}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credentials.token}` }, body: JSON.stringify({ ...data, client }), signal: boundedSignal, cache: 'no-store' });
    if (!response.ok) { const error = new Error((await response.json()).error || 'Błąd połączenia demo.'); error.status = response.status; throw error; }
    return response.json();
  };
  const report = async (id, state) => {
    for (let attempt = 0; attempt < 3 && !stopped; attempt++) {
      try { await post('ack', { id, state }); return; } catch (error) { if ([401, 503].includes(error.status)) throw error; if (attempt < 2) await delay(500); }
    }
  };
  const run = async () => {
    while (!stopped) {
      controller = new AbortController();
      try {
        const ready = isReady(); onState(ready ? 'Demo: gotowe' : 'Demo: aplikacja zajęta');
        const { command } = await post('poll', { ready }, controller.signal);
        if (stopped || !command) continue;
        // Re-check synchronously at delivery. A manually typed draft wins any race.
        const execution = isReady() ? start(command.prompt) : null;
        if (!execution) { await report(command.id, 'rejected'); continue; }
        onState('Demo: odpowiadam');
        const completion = Promise.resolve(execution.completion).catch(() => {});
        await report(command.id, 'started');
        await completion;
        await report(command.id, 'finished');
      } catch (error) {
        if (stopped) break;
        if ([401, 503].includes(error.status)) { stopped = true; onState(error.message); break; }
        if (error.name !== 'AbortError') { onState('Demo: łączę ponownie…'); await delay(750); }
      }
    }
  };
  run();
  return { changed() { controller?.abort(); }, stop() { stopped = true; controller?.abort(); onState('Demo rozłączone'); } };
}
export function installDemoReceiver({ input, isReady, start, location = window.location, history = window.history, storage }) {
  let credentials;
  try { credentials = receiverSession(location.hash, storage || window.sessionStorage); }
  catch { console.error('Nie można zachować połączenia demo. Włącz pamięć sesji przeglądarki (sessionStorage) i otwórz ponownie link odbiornika.'); return null; }
  if (!credentials) return null;
  history.replaceState(null, '', location.pathname + location.search);
  const receiver = createDemoReceiver({ credentials, isReady, start });
  const changed = () => receiver.changed();
  input.addEventListener('input', changed);
  window.addEventListener('city:query', changed);
  const stop = () => { receiver.stop(); input.removeEventListener('input', changed); window.removeEventListener('city:query', changed); };
  window.addEventListener('pagehide', stop, { once: true });
  return receiver;
}
