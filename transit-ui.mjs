import {waypoint,gpsOrigin,departure,warsawDeparture,createPlanner,durationLabel,timeLabel,TransitError,safeLink,transitAppearance} from './transit-core.mjs';
// Each symbol is local SVG geometry, independent of icon fonts and network access.
function glyph(doc,kind){
 const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('class','transit-glyph');
 const paths=kind==='walk'?['M13 4h.01','M9 20l2-7 3 3v5','M6 12l4-5 4 2 3 4h3','M10 7l1 6'] : kind==='tram'||kind==='skm'?['M7 4h10a2 2 0 0 1 2 2v11H5V6a2 2 0 0 1 2-2Z','M5 12h14M9 4l1-3h4l1 3M8 20l-2 2m10-2 2 2M8 15h.01M16 15h.01'] : ['M6 3h12a2 2 0 0 1 2 2v13H4V5a2 2 0 0 1 2-2Z','M4 12h16M7 18v3m10-3v3M7 15h.01M17 15h.01M8 6h8'];
 for(const d of paths){const path=doc.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);svg.append(path);}return svg;
}
// Decorative placeholder cards shown while a route is computed; the status line carries the accessible text.
export function loadingSkeleton(doc){
 const row=doc.createElement('div');row.className='transit-skeleton-row';row.setAttribute('aria-hidden','true');
 for(const kind of ['bus','tram']){
  const card=doc.createElement('div');card.className='transit-skeleton';
  for(const size of ['label','title','text']){const bar=doc.createElement('span');bar.className='transit-skeleton-bar transit-skeleton-'+size;card.append(bar);}
  const track=doc.createElement('span');track.className='transit-skeleton-track';
  for(let stop=0;stop<3;stop++){const dot=doc.createElement('span');dot.className='transit-skeleton-stop';track.append(dot);}
  const vehicle=doc.createElement('span');vehicle.className='transit-skeleton-vehicle';vehicle.append(glyph(doc,kind));track.append(vehicle);card.append(track);row.append(card);
 }return row;
}
export function routeChain(doc,route){
 const chain=doc.createElement('span');chain.className='route-chain';
 const legs=[];for(const step of route.steps||[]){const last=legs.at(-1);if(step.mode==='WALK'&&last?.mode==='WALK')last.end=step.end;else legs.push({...step});}
 for(const [index,leg]of legs.entries()){
  if(index){const arrow=doc.createElement('span');arrow.className='route-chevron';arrow.textContent='›';arrow.setAttribute('aria-hidden','true');chain.append(arrow);}
  const item=doc.createElement('span');item.className='route-leg';const appearance=transitAppearance(leg),walking=leg.mode==='WALK';
  const label=walking?'Pieszo '+durationLabel(Math.max(0,leg.end-leg.start)):appearance.transportLabel+' '+leg.line;item.title=label;item.setAttribute('aria-label',label);item.append(glyph(doc,walking?'walk':appearance.transportKind));
  const badge=doc.createElement('span');badge.textContent=walking?durationLabel(Math.max(0,leg.end-leg.start)):leg.line;badge.className=walking?'route-walk-time':'transit-line-badge';if(!walking)badge.style.backgroundColor=appearance.transportColor;item.append(badge);chain.append(item);
 }return chain;
}
export function compactTime(value,now=Date.now()){
 const day=date=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(date));
 return day(value)===day(now)?new Intl.DateTimeFormat('pl-PL',{timeZone:'Europe/Warsaw',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value)):timeLabel(value);
}
export function departureLabel(route){return route.nextAvailable?'Wyjście '+timeLabel(route.departure)+' · odjazd '+timeLabel(route.firstBoarding):'';}
export function timingLabel(route,{archived=false,computedAt=Date.now(),now=Date.now()}={}){
 const delays=(route.steps||[]).filter(step=>step.delay).map(step=>step.delay);
 if(archived||now-computedAt>180000||delays.some(delay=>!Number.isFinite(delay.observedAt)||now-delay.observedAt>180000||now-delay.observedAt< -60000))return 'zapisany plan · odśwież';
 if(delays.length){const delta=Math.round(delays.at(-1).deltaMs/60000);return 'szacunek GPS '+(delta>=0?'+':'')+delta+' min';}
 return 'wg rozkładu';
}
export function mountTransit({doc=document,host=window,compute,fetchImpl=fetch}={}){
 const template=doc.getElementById('transit-panel');if(!template)return;
 const pristine=template.cloneNode(true),chat=doc.getElementById('chat-messages'),sessions=[];let active,current,used=false,serial=0;
 const routeBar=(route,context={})=>{
  const bar=doc.getElementById('environment-bar'),chain=doc.getElementById('environment-route'),eta=doc.getElementById('environment-eta'),refresh=doc.getElementById('environment-route-refresh');if(!bar||!chain||!eta)return;
  const pending=Boolean(context.refreshing&&!route),shown=Boolean(route)||pending,summary=bar.querySelector?.('summary');
  summary?.setAttribute('aria-label',pending?'Pogoda. Odświeżam trasę.':route?'Pogoda i wybrana trasa '+route.origin+' → '+route.destination+'. Szacowany przyjazd '+compactTime(route.arrival)+' · '+timingLabel(route,context)+'. Rozwiń informacje o pogodzie.':'Pogoda, jakość powietrza, wschód i zachód słońca. Rozwiń informacje o źródłach.');
  bar.dataset.route=String(shown);chain.hidden=!shown;eta.hidden=!shown;if(!pending)chain.replaceChildren();eta.replaceChildren();
  if(refresh){refresh.hidden=!shown;refresh.disabled=Boolean(context.refreshing);refresh.setAttribute('aria-busy',String(Boolean(context.refreshing)));}
  eta.classList?.toggle('future-departure',Boolean(route?.nextAvailable));
  if(shown){if(route)chain.append(routeChain(doc,route));const time=doc.createElement('strong');time.textContent=pending?'Odświeżam…':'ok. '+compactTime(route.arrival);eta.append(time);if(route?.nextAvailable){const planned=doc.createElement('small');planned.textContent='Wyjście '+timeLabel(route.departure);eta.append(planned);}const label=pending?'Odświeżam trasę':'Szacowany przyjazd '+time.textContent+' · '+(route?.nextAvailable?departureLabel(route)+' · ':'')+timingLabel(route,context);eta.setAttribute('aria-label',label);eta.title=label;}
 };
 doc.getElementById('environment-route-refresh')?.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();active?.refreshRoute();});
 function create(panel){
  const elements={};for(const element of [panel,...panel.querySelectorAll('[id]')]){const name=element.id.replace('transit-','');elements[name]=element;element.dataset.transit=name;}
  // Labels and datalists remain unique even when multiple plans stay in chat history.
  const suffix='-'+(++serial);for(const element of Object.values(elements))element.id+=suffix;
  for(const element of [panel,...panel.querySelectorAll('*')])for(const key of ['for','list','aria-describedby','aria-labelledby']){const value=element.getAttribute(key);if(value)element.setAttribute(key,value.split(' ').map(id=>id+suffix).join(' '));}
  const session=mountSession({doc,host,compute,fetchImpl,panel,elements,routeBar,isActive:session=>active===session,activateSession(session){if(active!==session){active?.suspend();active=session;routeBar(null);host.getCityMap?.()?.clearRoute?.();host.getCityMap?.()?.showVehicles?.([]);}}});sessions.push(session);return session;
 }
 current=create(template);
 function open(detail={}){
  if(used){const panel=pristine.cloneNode(true);current=create(panel);const anchor=detail.anchor;if(anchor?.isConnected)anchor.insertAdjacentElement('afterend',panel);else appendConversation(panel,detail);}else{used=true;const anchor=detail.anchor;if(anchor?.isConnected)anchor.insertAdjacentElement('afterend',template);else appendConversation(template,detail);}
  current.open(detail);host.expandCitySheet?.();
  // Event details restore the old chat scroll before this panel is appended.
  // Reveal the new planner, including its missing-origin prompt, in that scrollport.
  const opened=current;host.requestAnimationFrame?.(()=>{if(active===opened)opened.reveal();});
 }
 function appendConversation(panel,detail){const welcome=doc.getElementById('welcome-prompts');if(welcome)welcome.hidden=true;const answer=doc.createElement('p');answer.className='message';answer.textContent=detail.destination?'Sprawdźmy połączenia komunikacją miejską.':'Dokąd jedziemy? Wybierz start i cel.';chat?.append(answer,panel);}
 host.addEventListener('city:query',()=>{sessions.splice(0).forEach(session=>session.close());if(!used)sessions.push(current);active=null;routeBar(null);});
 host.addEventListener('city:transit',event=>open(event.detail));host.addEventListener('city:pulse',()=>{active?.close();});host.addEventListener('city:map',()=>active?.replay());host.addEventListener('city:location',event=>active?.location(event.detail));
 return{open,search:(...args)=>current.search(...args),refreshLive:()=>active?.refreshLive(),refreshRoute:()=>active?.refreshRoute(),reset:()=>active?.reset(),getState:()=>current.getState()};
}
function mountSession({doc,host,compute,fetchImpl,panel,elements,activateSession,isActive,routeBar}={}) {
 const el=id=>elements[id];let api,computedAt=0,archived=false,refreshing=false;
 const origin=el('origin'),destination=el('destination'),time=el('time'),status=el('status'),alternatives=el('alternatives'),itinerary=el('itinerary'),observations=el('observations');
 let liveTimer=null,liveController=null,liveSequence=0;
 let gpsAttempt=0;
 let gpsMode=false,selectedDestination=null,selectedOrigin=null,state={status:'idle',routes:[]},selected=-1;
 const map=()=>host.getCityMap?.(),node=(tag,text,className)=>{const element=doc.createElement(tag);if(text)element.textContent=text;if(className)element.className=className;return element;};
 const link=(text,url)=>{const a=node('a',text);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;};
 const lineBadge=record=>{const appearance=transitAppearance(record),badge=node('span',record.line,'transit-line-badge');badge.style.backgroundColor=appearance.transportColor;badge.title=appearance.transportLabel+' '+record.line;badge.setAttribute('aria-label',badge.title);return badge;};
 function message(text,error=false){status.textContent=text;status.dataset.state=error?'error':'info';}
 function ageTiming(){
  if(state.status!=='ready')return;
  alternatives.querySelectorAll('small').forEach((label,index)=>label.textContent=timingLabel(state.routes[index],{computedAt,archived}));
  if(isActive(api)&&selected>=0){const route=state.routes[selected];routeBar(route,{computedAt,archived});if(status.dataset.compact==='true')message('Wybrano trasę · przyjazd ok. '+compactTime(route.arrival)+' · '+timingLabel(route,{computedAt,archived}));}
 }
 function clearView(){liveSequence++;liveController?.abort();if(isActive(api)){map()?.clearRoute?.();routeBar(null,{refreshing});}alternatives.replaceChildren();itinerary.replaceChildren();observations.replaceChildren();selected=-1;}
 function showObservations(){
  observations.replaceChildren();
  const fresh=(state.vehicles||[]).filter(vehicle=>{const age=Date.now()-Date.parse(vehicle.observedAt);return vehicle.freshness==='recent'&&Number.isFinite(age)&&age>=-60000&&age<=90000;});
  const lines=new Set((state.routes[selected]?.steps||[]).filter(step=>step.mode==='TRANSIT').map(step=>String(step.line)));if(isActive(api))map()?.showVehicles?.(archived?[]:fresh.filter(vehicle=>lines.has(String(vehicle.line))));if(archived)observations.append(node('p','Poniżej dane zapisane przy obliczaniu planu, a nie bieżące obserwacje. Odśwież połączenie przed wyjazdem.','transit-note'));
  if(state.liveRefreshUnavailable)observations.append(node('p','Nie można odświeżyć pozycji pojazdów. Wcześniejsze znaczniki zostały ukryte; połączenie pozostaje obliczonym wcześniej planem.','transit-note'));
  if(state.liveModel&&!state.liveRefreshUnavailable)observations.append(node('p','Model GPS: obserwowane pojazdy '+state.liveModel.trackedVehicles+' · potwierdzone kursy '+state.liveModel.confirmedTrips+'. Korekta powstaje po minięciu następnego przystanku na trasie dopasowanego kursu; czas próbki jest korygowany o przebyty odcinek według rozkładu. Bez dopasowania obowiązuje rozkład.','transit-note'));
  if(state.graphSource){const source=state.graphSource;observations.append(node('p','Rozkład ZTM: '+source.validFrom+' – '+source.validTo+' · pobrano '+timeLabel(Date.parse(source.fetchedAt))+' · dane przetworzone przez aplikację.','transit-note'));const url=safeLink(source.documentationUrl||source.url);if(url)observations.append(link('Źródło rozkładu ZTM ↗',url));}
  if(state.vehicles?.length){observations.append(node('p','Pozycje pojazdów w pobliżu startu/celu: '+state.vehicleProvided+' z '+state.vehicleCount+' · świeże pomiary: '+fresh.length+'. Na mapie pokazuję tylko świeże pozycje linii wybranego połączenia. Pomiary nieaktualne lub bez potwierdzonego czasu są ukryte. Sama zgodność linii nie oznacza dopasowania pojazdu do kursu ani ETA.','transit-note'));}
  if(state.departures?.length){const heading=node('h3','Odjazdy z miejskiego API');observations.append(heading,node('p','Godziny bez potwierdzonej daty obowiązywania — nie służą do łączenia kursów ani wyznaczania ETA. Sprawdzono do 2 przystanków przy każdym końcu i do 1 linii na przystanek.','transit-note'));
   for(const departure of state.departures){const card=node('details',null,'transit-departures'),summary=node('summary',departure.stopName+' · '+departure.stopId+' · linia '+departure.line+' ('+departure.records.length+' godzin)');card.append(summary);for(const record of departure.records)card.append(node('p',[record.clock,record.direction,record.brigade?'brygada '+record.brigade:'',record.variant?'wariant '+record.variant:''].filter(Boolean).join(' · ')));observations.append(card);}
  }
  if(state.errors?.length)observations.append(node('p','Część miejskich źródeł jest niedostępna. Widoczne wyniki są niepełne.','transit-note'));
  for(const source of state.sources||[]){const url=safeLink(source.url);if(url)observations.append(link(source.name+' ↗',url));}
 }
 function select(index){
  activateSession(api);selected=index;const route=state.routes[index];alternatives.querySelectorAll('button').forEach((button,i)=>button.setAttribute('aria-pressed',String(i===index)));itinerary.replaceChildren();
  routeBar(route,{computedAt,archived});
  const barBottom=doc.getElementById('environment-bar')?.getBoundingClientRect?.().bottom;
  const mapTop=doc.getElementById('city-map')?.getBoundingClientRect?.().top||0;
  const canvasRect=doc.getElementById('city-map')?.getBoundingClientRect?.(),sheetTop=doc.getElementById('ai-sheet')?.getBoundingClientRect?.().top;
  const visibleBottom=canvasRect?Math.min(canvasRect.bottom,Number.isFinite(sheetTop)?sheetTop:canvasRect.bottom):0;
  if(canvasRect&&visibleBottom-Math.max(canvasRect.top,barBottom||canvasRect.top)<172)host.collapseCitySheet?.();
  const rendered=map()?.showRoute?.(route,{top:Math.max(0,(barBottom||0)-mapTop+8)});status.dataset.compact=String(Boolean(rendered));el('details').hidden=false;ageTiming();
  message(!rendered?'Mapa jest niedostępna. Sprawdź wskazówki w szczegółach.':archived?'Zapisany plan z '+timeLabel(computedAt)+' · odśwież połączenie przed wyjazdem.':'Wybrano trasę · przyjazd ok. '+compactTime(route.arrival)+' · '+timingLabel(route,{archived,computedAt}));
  itinerary.append(node('h3',route.origin+' → '+route.destination),node('p','Wyjazd '+timeLabel(route.departure)+' · przyjazd ok. '+compactTime(route.arrival),'transit-note'));
  const list=node('ol');for(const step of route.steps){const item=node('li');const heading=node('strong');if(step.mode==='TRANSIT')heading.append(lineBadge(step),node('span',' → '+step.headsign));else heading.textContent=step.geometry==='osm_pedestrian'?'Pieszo · ścieżkami':'Pieszo · w przybliżeniu';item.append(heading);item.append(node('p',step.from+' → '+step.to));item.append(node('p',timeLabel(step.start)+' – '+timeLabel(step.end)+(step.mode==='TRANSIT'?' · przystanki: '+step.stops:'')));if(step.delay){const minutes=Math.round(step.delay.deltaMs/6000)/10;item.append(node('p','Korekta GPS: '+(minutes>=0?'+':'')+minutes+' min'));}if(step.geometry==='schematic'&&step.mode==='TRANSIT')item.append(node('p','Przebieg schematyczny między przystankami; brak potwierdzonego odcinka geometrii.'));list.append(item);}itinerary.append(list);if(route.walkingSource)itinerary.append(link('Ścieżki piesze: © OpenStreetMap · Valhalla ↗','https://www.openstreetmap.org/copyright'));showObservations();
 }
 function render(next){
  const scroller=doc.getElementById('sheet-content'),following=scroller&&scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<80;state=next;clearView();status.dataset.compact=String(next.status==='ready');el('details').hidden=true;el('search').disabled=next.status==='loading';el('search').setAttribute('aria-busy',String(next.status==='loading'));el('cancel').hidden=next.status!=='loading';el('clear').hidden=true;
  alternatives.setAttribute('aria-busy',String(next.status==='loading'));
  if(next.status==='loading'){message('Przygotowuję rozkład ZTM i sprawdzam połączenia…');status.dataset.state='loading';alternatives.append(loadingSkeleton(doc));}
  else if(next.status==='error'){el('editor').open=true;message(next.error.message,true);}
  else if(next.status==='cancelled')message('Przerwano planowanie.');
  else if(next.status==='idle')message('Wybierz start i cel, by sprawdzić miejski rozkład.');
  else if(next.status==='limited'){el('details').hidden=false;el('editor').open=true;
   message(String(next.reason||'').startsWith('WALK_')?'Nie udało się potwierdzić przejść pieszych. Odśwież trasę lub spróbuj później.':next.reason==='FEED_EXHAUSTED'?'Nie znaleziono potwierdzonego połączenia do końca dostępnego rozkładu ZTM ('+next.nextSearch?.feedValidTo+'). Sprawdź pobliski przystanek lub później zaktualizowany rozkład.':next.reason==='LOOKAHEAD_LIMIT'?'Nie zakończono sprawdzania późniejszych połączeń w dostępnym czasie. Odśwież wyszukiwanie.':next.reason==='NO_VERIFIED_ROUTE'?'Nie znaleziono potwierdzonego połączenia w dostępnym rozkładzie. Sprawdź pobliskie przystanki.':'Nie udało się potwierdzić trasy z datowanego rozkładu ZTM. Pokazuję dostępne dane przystanków i pojazdów; bez ETA.',true);
   if(next.stops?.length)map()?.fitTo?.(next.stops.map(stop=>[stop.latitude,stop.longitude]),{top:65,left:24,right:24,bottom:24});showObservations();
  }else if(next.status==='ready'){
   computedAt=Date.now();archived=false;el('editor').open=false;message('Wybierz połączenie, aby zobaczyć je na mapie.');
   next.routes.forEach((route,index)=>{const button=node('button',null,'transit-alternative');button.type='button';button.setAttribute('aria-pressed','false');button.append(node('span',index===0?(route.nextAvailable?'Najbliższe późniejsze połączenie':'Najwcześniejszy przyjazd'):'Alternatywa '+(index+1),'transit-card-label'),node('strong',durationLabel(route.durationMillis)),node('span','ok. '+compactTime(route.arrival)+' · '+(route.transfers===0?'bez przesiadek':route.transfers===1?'1 przesiadka':route.transfers+' przesiadki')));if(route.nextAvailable)button.append(node('span',departureLabel(route)),node('span','Oczekiwanie przed wyjściem: '+durationLabel(route.waitingMillis)));button.append(routeChain(doc,route),node('small',timingLabel(route,{}),'transit-card-timing'));button.addEventListener('click',()=>select(index));alternatives.append(button);});if(following&&!panel.nextElementSibling)host.requestAnimationFrame?.(()=>{if(isActive(api)&&state===next)alternatives.scrollIntoView?.({block:'nearest',behavior:'smooth'});});
  }
 }
 const planner=createPlanner({compute,onState:render});
 async function refreshLive(){
  // Presentation freshness must age even when the request hangs or fails.
  if(isActive(api)&&!panel.hidden){ageTiming();if(['ready','limited'].includes(state.status))showObservations();}
  if(!isActive(api)||panel.hidden||archived||!['ready','limited'].includes(state.status)||!state.origin||!state.destination)return;
  const sequence=++liveSequence;liveController?.abort();liveController=new AbortController();
  try{const response=await fetchImpl('/api/transit/live',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.any([liveController.signal,AbortSignal.timeout(10000)]),body:JSON.stringify({origin:state.origin,destination:state.destination})});if(!response.ok)throw new Error('Vehicle refresh unavailable');const data=await response.json();if(sequence!==liveSequence)return;if(!Array.isArray(data.vehicles))throw new Error('Invalid vehicle snapshot');Object.assign(state,{vehicles:data.vehicles,vehicleCount:data.vehicleCount,vehicleProvided:data.vehicleProvided,liveModel:data.liveModel,liveRefreshUnavailable:false});showObservations();ageTiming();}catch{if(sequence!==liveSequence)return;Object.assign(state,{vehicles:[],vehicleCount:0,vehicleProvided:0,liveRefreshUnavailable:true});showObservations();ageTiming();}
 }
 async function refreshRoute(){
  if(refreshing||state.status!=='ready'||selected<0)return;
  refreshing=true;
  // Keep a future departure chosen by the user; a passed time means leave now.
  try{if(warsawDeparture(time.value).getTime()<Date.now())time.value='';}catch{time.value='';}
  try{await search();if(isActive(api)&&state.status==='ready')select(0);}
  finally{refreshing=false;if(isActive(api)){if(state.status==='ready'&&selected>=0)ageTiming();else routeBar(null);}}
 }
 function activate(on){panel.hidden=!on;if(on){activateSession(api);host.expandCitySheet?.();}else{if(liveTimer)clearInterval(liveTimer);liveTimer=null;liveController?.abort();liveSequence++;if(isActive(api)){map()?.clearRoute?.();map()?.showVehicles?.([]);routeBar(null);}}  }
 function startRefresh(){if(liveTimer)clearInterval(liveTimer);liveTimer=setInterval(refreshLive,15000);liveTimer.unref?.();}
 function suspend(){gpsAttempt++;if(liveTimer)clearInterval(liveTimer);liveTimer=null;liveController?.abort();liveSequence++;archived=true;if(state.status==='ready')message('Zapisany plan z '+timeLabel(computedAt)+' · odśwież przed wyjazdem.');alternatives.querySelectorAll('small').forEach(label=>label.textContent='zapisany plan · odśwież');alternatives.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed','false'));if(state.status==='loading')planner.reset('cancelled');}
 async function search(event){gpsAttempt++;event?.preventDefault();activate(true);archived=false;startRefresh();planner.reset();try{if(!gpsMode&&!origin.value.trim())throw new TransitError('ORIGIN_REQUIRED','Podaj przystanek startowy lub użyj Mój GPS.');const request={origin:gpsMode?gpsOrigin(host.getCityLocation?.()):waypoint(selectedOrigin||origin.value,'punkt startowy'),destination:waypoint(selectedDestination||destination.value,'cel'),departureTime:warsawDeparture(time.value)};await planner.search(request);}catch(error){render({status:'error',routes:[],error:error instanceof TransitError?error:new TransitError('INVALID_REQUEST','Sprawdź punkt startowy, cel i czas.')});}}
 async function gps(options){const auto=options?.auto===true;
  const attempt=++gpsAttempt;planner.reset();activate(true);el('editor').open=true;
  try{
   let location=host.getCityLocation?.();
   try{gpsOrigin(location);}catch{message('Ustalam lokalizację…');location=await host.requestCityLocation?.();}
   if(attempt!==gpsAttempt||!isActive(api)||panel.hidden)return;
   const point=gpsOrigin(location);gpsMode=true;selectedOrigin=null;origin.value='Moja lokalizacja';el('origin-note').textContent=point.label;
   if(destination.value.trim())await search();else message('Start z Twojej lokalizacji. Wybierz cel.');
  }catch(error){if(attempt!==gpsAttempt||!isActive(api)||panel.hidden)return;gpsMode=false;if(auto){el('editor').open=true;message('Cel wybrany. Podaj skąd wyruszasz lub użyj Mój GPS.');}else message(error.message,true);origin.focus();}
 }
 function open(detail={}){activate(true);el('editor').open=!detail.destination;if(!detail.destination){origin.focus();return;}planner.reset();try{const point=waypoint(detail.destination,'cel');selectedDestination=detail.destination;destination.value=point.label;if(detail.origin){const start=waypoint(detail.origin,'punkt startowy');origin.value=start.label;selectedOrigin=detail.origin;gpsMode=false;}if(detail.departureTime){const date=departure(detail.departureTime);time.value=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Warsaw',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date).replace(' ','T');}else time.value='';if(!origin.value){try{gpsOrigin(host.getCityLocation?.());gpsMode=true;origin.value='Moja lokalizacja';}catch{}}// No start given: read the GPS automatically (asks for a fix if needed), then search.
if(origin.value)search();else if(host.requestCityLocation)gps({auto:true});else{el('editor').open=true;message('Cel wybrany. Podaj skąd wyruszasz lub użyj Mój GPS.');origin.focus();}}catch(error){message(error.message,true);}}
 function autocomplete(input,list){let timer,sequence=0,controller;input.addEventListener('input',()=>{clearTimeout(timer);controller?.abort();const turn=++sequence,query=input.value.trim();list.replaceChildren();if(query.length<2||query.length>200)return;timer=setTimeout(async()=>{controller=new AbortController();try{const response=await fetchImpl('/api/transit/stops?q='+encodeURIComponent(query),{signal:controller.signal});if(!response.ok)return;const data=await response.json();if(turn!==sequence||!Array.isArray(data.results))return;for(const stop of data.results){const option=node('option');option.value=stop.name+' · '+stop.id;list.append(option);}}catch{}},250);});}
 autocomplete(origin,el('origin-options'));autocomplete(destination,el('destination-options'));
 el('form').addEventListener('submit',search);el('gps').addEventListener('click',gps);el('cancel').addEventListener('click',()=>{gpsAttempt++;planner.reset('cancelled');});el('clear').addEventListener('click',()=>{gpsAttempt++;planner.reset();});el('close').addEventListener('click',()=>{planner.reset();activate(false);});
 origin.addEventListener('input',()=>{gpsAttempt++;gpsMode=false;selectedOrigin=null;el('origin-note').textContent='Wybierz przystanek z listy lub wpisz współrzędne.';planner.reset();});destination.addEventListener('input',()=>{selectedDestination=null;planner.reset();});time.addEventListener('input',()=>planner.reset());
 api={open,search,refreshLive,refreshRoute,suspend,reveal(){panel.scrollIntoView?.({block:'start',behavior:'smooth'});},replay(){if(state.status==='ready'&&selected>=0)select(selected);else if(state.status==='limited')showObservations();},location(detail){if(!gpsMode)return;try{gpsOrigin(detail);}catch{planner.reset();message('Brak lokalizacji. Podaj punkt startowy lub włącz GPS.',true);}},reset:()=>{gpsAttempt++;planner.reset();},close(){gpsAttempt++;planner.reset();activate(false);},getState:()=>({status:state.status,selected,routeCount:state.routes.length})};return api;
}
if(typeof document!=='undefined')mountTransit();
