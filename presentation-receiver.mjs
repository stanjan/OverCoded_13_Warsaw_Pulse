// Local presentation integration: commands stay between the slide and its own iframe.
export const PRESENTATION_CHANNEL = 'warsaw-pulse-presentation-v1';
const allowedOrigins = new Set(['http://localhost:3030', 'http://127.0.0.1:3030']);

export function installPresentationReceiver({ host = window, input, isReady, start }) {
  if (host.parent === host || new URLSearchParams(host.location.search).get('presentationDemo') !== '1') return null;
  const commands = new Map();
  let parentOrigin, stopped = false, executing = false;
  const post = data => { if (!stopped && parentOrigin) host.parent.postMessage({ channel: PRESENTATION_CHANNEL, ...data }, parentOrigin); };
  const status = () => post({ type: 'status', ready: !executing && isReady() });
  const receive = event => {
    if (stopped || event.source !== host.parent || !allowedOrigins.has(event.origin) || event.data?.channel !== PRESENTATION_CHANNEL) return;
    parentOrigin = event.origin;
    const data = event.data;
    if (data.type === 'hello') { status(); return; }
    if (data.type !== 'prompt' || typeof data.id !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(data.id)) return;
    if (commands.has(data.id)) { post(commands.get(data.id)); return; }
    const report = state => {
      const result = { type: 'command', id: data.id, state };
      commands.set(data.id, result);
      if (commands.size > 128) commands.delete(commands.keys().next().value);
      post(result); status();
    };
    if (typeof data.prompt !== 'string' || !data.prompt.trim() || data.prompt.length > 2000 || data.prompt.includes('\0') || executing || !isReady()) { report('rejected'); return; }
    let execution;
    try { execution = start(data.prompt.trim()); } catch { report('rejected'); return; }
    if (!execution) { report('rejected'); return; }
    executing = true;
    report('started');
    Promise.resolve(execution.completion).then(() => report('finished'), () => report('failed')).finally(() => { executing = false; status(); });
  };
  host.addEventListener('message', receive);
  input.addEventListener('input', status);
  host.addEventListener('city:query', status);
  const stop = () => { stopped = true; host.removeEventListener('message', receive); input.removeEventListener('input', status); host.removeEventListener('city:query', status); };
  host.addEventListener('pagehide', stop, { once: true });
  return { stop };
}
