const $ = selector => document.querySelector(selector);
const fragment = new URLSearchParams(location.hash.slice(1));
let config;
try { const raw = fragment.get('demo-control'); if (raw) config = JSON.parse(raw); } catch {}
history.replaceState(null, '', location.pathname + location.search);
const valid = data => /^[a-f0-9]{24}$/.test(data?.target) && /^[a-zA-Z0-9_-]{43}$/.test(data?.token);
let saved;
try { saved = JSON.parse(sessionStorage.getItem('warsaw-ai-demo-control') || 'null'); } catch {}
if (!config && valid(saved)) config = saved;
const validReceiver = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{43}$/.test(value);
let receiverToken = valid(config) && validReceiver(config.receiverToken) ? config.receiverToken : valid(config) && saved?.target === config.target && saved?.token === config.token && validReceiver(saved.receiverToken) ? saved.receiverToken : null;
const remember = () => sessionStorage.setItem('warsaw-ai-demo-control', JSON.stringify({ target: config.target, token: config.token, ...(receiverToken ? { receiverToken } : {}) }));
let statusTimer, commandTimer, generation = 0;
const api = async (suffix = '', method = 'GET', data) => {
  const response = await fetch(`/api/demo/targets/${config.target}${suffix}`, { method, headers: { Authorization: `Bearer ${config.token}`, ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}), cache: 'no-store' });
  const result = await response.json(); if (!response.ok) { const error = new Error(result.error || 'Nie udało się wysłać.'); error.status = response.status; throw error; } return result;
};
const link = (field, data, pathname = '/demo') => { const url = new URL(pathname, location.origin); url.hash = new URLSearchParams({ [field]: JSON.stringify(data) }).toString(); return url.href; };
const updateLink = () => {
  const prompt = $('#prompt').value.trim();
  $('#tile').value = prompt ? link('demo-control', { target: config.target, token: config.token, prompt }) : '';
  $('#example').textContent = `fetch(${JSON.stringify(`${location.origin}/api/demo/targets/${config.target}/prompts`)}, {\n  method: "POST",\n  headers: { "Content-Type": "application/json", Authorization: "Bearer YOUR_CONTROL_TOKEN" },\n  body: JSON.stringify({ requestId: crypto.randomUUID(), prompt: ${JSON.stringify(prompt)} })\n});`;
};
async function send() {
  const prompt = $('#prompt').value.trim(); if (!prompt) return;
  $('#send').disabled = true; $('#error').textContent = ''; clearTimeout(commandTimer);
  const requestId = crypto.randomUUID();
  const labels = { delivered: 'Dostarczono do aplikacji — czekam na potwierdzenie startu…', started: 'Aplikacja rozpoczęła odpowiedź.', rejected: 'Aplikacja odrzuciła pytanie: jest zajęta lub ma niewysłany tekst.', finished: 'Aplikacja zakończyła obsługę pytania. Odpowiedź zobaczysz w aplikacji.' };
  try {
    const result = await api('/prompts', 'POST', { requestId, prompt }); $('#result').textContent = labels[result.state];
    let attempts = 0;
    const watch = async () => {
      try { const state = await api(`/prompts/${requestId}`); $('#result').textContent = labels[state.state]; if (['delivered', 'started'].includes(state.state) && ++attempts < 120) commandTimer = setTimeout(watch, 1000); }
      catch (error) { $('#error').textContent = error.message; }
    }; commandTimer = setTimeout(watch, 500);
  } catch (error) { $('#error').textContent = error.message; } finally { $('#send').disabled = false; }
}
function activate() {
  const current = ++generation;
  try { remember(); } catch { $('#error').textContent = 'Włącz pamięć sesji przeglądarki, aby panel zachował dostęp po odświeżeniu.'; }
  $('#setup').hidden = true; $('#control').hidden = false;
  $('#receiver').hidden = !receiverToken;
  if (receiverToken) $('#receiver').href = link('demo-receiver', { target: config.target, token: receiverToken }, '/');
  $('#prompt').value = typeof config.prompt === 'string' ? config.prompt.slice(0, 2000) : ''; updateLink();
  const status = async () => {
    let retry = true;
    try { const value = await api(); if (current !== generation) return; $('#connection').textContent = value.ready ? 'Aplikacja gotowa.' : value.connected ? 'Aplikacja zajęta lub ma niewysłany tekst.' : 'Czekam na aplikację odbierającą…'; }
    catch (error) { if (current !== generation) return; $('#connection').textContent = error.message; retry = error.status !== 401; }
    finally { if (retry && current === generation) statusTimer = setTimeout(status, 2000); }
  };
  status(); if (config.prompt) send();
}
$('#create').addEventListener('click', async () => {
  $('#create').disabled = true;
  try { const response = await fetch('/api/demo/targets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const data = await response.json(); if (!response.ok) throw new Error(data.error); config = { target: data.target, token: data.controlToken }; receiverToken = data.receiverToken; activate(); }
  catch (error) { $('#error').textContent = error.message; } finally { $('#create').disabled = false; }
});
$('#prompt').addEventListener('input', updateLink);
$('#prompt-form').addEventListener('submit', event => { event.preventDefault(); send(); });
$('#revoke').addEventListener('click', async () => { try { await api('', 'DELETE'); generation++; clearTimeout(statusTimer); clearTimeout(commandTimer); try { sessionStorage.removeItem('warsaw-ai-demo-control'); } catch {} receiverToken = null; config = null; $('#control').hidden = true; $('#setup').hidden = false; $('#error').textContent = 'Demo zakończone. Linki tego celu już nie działają.'; } catch (error) { $('#error').textContent = error.message; } });
if (valid(config)) activate(); else if (config) $('#error').textContent = 'Nieprawidłowy link demo.';
