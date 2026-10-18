const channel = 'warsaw-pulse-presentation-v1';
export const demoPrompts = [
  { id: 'events', icon: 'calendar', title: 'Dziś w mieście', prompt: 'Pokaż mi ciekawe wydarzenia na dziś w Śródmieściu Warszawy.' },
  { id: 'family', icon: 'family', title: 'Z dziećmi', prompt: 'Pokaż wydarzenia dla dzieci i rodzin w Warszawie na najbliższy weekend.' },
  { id: 'walk', icon: 'walk', title: 'Odkryj Warszawę', prompt: 'Poleć trasę spacerową po zabytkach Warszawy i pokaż ją na mapie.' },
  { id: 'sport', icon: 'ball', title: 'Czas na ruch', prompt: 'Pokaż otwarte boiska sportowe na Mokotowie w Warszawie.' },
  { id: 'toilet', icon: 'toilet', title: 'Toalety w pobliżu', prompt: 'Pokaż toalety miejskie w Śródmieściu Warszawy.' },
  { id: 'aed', icon: 'heart', title: 'Bezpieczne miasto', prompt: 'Pokaż defibrylatory AED w Śródmieściu Warszawy.' },
];

export function createSlideDemoController({ host = window, getFrame, appOrigin, onChange, uuid = () => crypto.randomUUID(), now = Date.now }) {
  let ready = false, pending = null, selected = null, error = '', lastSeen = 0, stopped = false;
  const publish = () => onChange({ ready, pending: pending?.tile || null, selected, error });
  const post = data => getFrame()?.postMessage({ channel, ...data }, appOrigin);
  const reset = () => { ready = false; pending = null; error = ''; lastSeen = 0; publish(); post({ type: 'hello' }); };
  const receive = event => {
    if (stopped || event.source !== getFrame() || event.origin !== appOrigin || event.data?.channel !== channel) return;
    const data = event.data;
    lastSeen = now();
    if (data.type === 'status') { ready = data.ready === true; if (ready && pending?.started) pending = null; publish(); return; }
    if (data.type !== 'command' || data.id !== pending?.id) return;
    if (data.state === 'started') { selected = pending.tile; pending.started = true; error = ''; }
    if (['finished', 'failed', 'rejected'].includes(data.state)) {
      if (data.state === 'rejected') error = 'Aplikacja jest zajęta lub ma wpisany tekst. Spróbuj ponownie.';
      if (data.state === 'failed') error = 'Sprawdź odpowiedź w telefonie i spróbuj ponownie.';
      pending = null;
    }
    publish();
  };
  host.addEventListener('message', receive);
  const tick = () => {
    if (stopped) return;
    if (lastSeen && now() - lastSeen > 4000) ready = false;
    if (pending && !pending.started && now() - pending.sentAt > 5000) { pending = null; error = 'Brak potwierdzenia. Sprawdź telefon przed ponownym kliknięciem.'; }
    post({ type: 'hello' }); publish();
  };
  const timer = host.setInterval(tick, 1000);
  reset();
  return {
    reset,
    send(tile) {
      if (!ready || pending || !demoPrompts.includes(tile)) return false;
      pending = { id: uuid(), tile: tile.id, sentAt: now(), started: false }; error = ''; ready = false;
      post({ type: 'prompt', id: pending.id, prompt: tile.prompt }); publish(); return true;
    },
    stop() { stopped = true; host.clearInterval(timer); host.removeEventListener('message', receive); },
  };
}
