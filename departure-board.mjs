import {distanceMeters,gpsOrigin,transitAppearance,dateInWarsaw} from './transit-core.mjs';

export function boardingStages(route){
 return(route?.steps||[]).filter(step=>step.mode==='TRANSIT'&&step.fromStopId&&step.toStopId).map(step=>{
  const stop=step.stopPositions?.find(point=>point.id===step.fromStopId&&(!Number.isInteger(step.fromStopIndex)||point.sequenceIndex===step.fromStopIndex))||step.stopPositions?.[0];
  return{...step,stop:stop||null};
 });
}
export function nearestBoarding(stages,location){
 try{gpsOrigin(location);}catch{return 0;}
 let best=0,distance=Infinity;stages.forEach((stage,index)=>{if(!Number.isFinite(stage.stop?.latitude)||!Number.isFinite(stage.stop?.longitude))return;const next=distanceMeters(location,stage.stop);if(next<distance){distance=next;best=index;}});return best;
}
export function boardTiming(row,now=Date.now(),failed=false){
 const live=!failed&&row.timing==='live_model_estimate'&&Number.isFinite(row.deltaMs)&&Number.isFinite(row.liveUntil)&&now<=row.liveUntil&&now-row.observedAt>=-60000;
 return{live,departure:live?row.departure:row.scheduledDeparture,tone:live?(row.deltaMs < -120000?'early':row.deltaMs > 120000?'late':'on-time'):'scheduled'};
}
export function boardVehicle(row,now=Date.now(),failed=false){
 const vehicle=row?.vehicle,age=now-Date.parse(vehicle?.observedAt);
 return boardTiming(row||{},now,failed).live&&vehicle&&typeof vehicle.id==='string'&&vehicle.id&&vehicle.line===row.line&&vehicle.directionSource==='confirmed_gtfs_trip'&&vehicle.directionTripId===row.tripId&&vehicle.freshness==='recent'&&Number.isFinite(age)&&age>=-60000&&age<=90000&&Number.isFinite(vehicle.latitude)&&Math.abs(vehicle.latitude)<=90&&Number.isFinite(vehicle.longitude)&&Math.abs(vehicle.longitude)<=180?vehicle:null;
}
export function departureDirection(row,fallback=''){
 const direction=String(row.headsign||fallback).trim();
 for(const separator of ['->','→','›']){const prefix=String(row.line)+' '+separator;if(direction.startsWith(prefix))return direction.slice(prefix.length).trim();}
 return direction;
}
export function mountDepartureBoard({doc=document,host=window,fetchImpl=fetch,now=()=>Date.now(),setIntervalImpl=setInterval,clearIntervalImpl=clearInterval}={}){
 const container=doc.getElementById('map-canvas-container');if(!container)return{show(){},hide(){},location(){}};
 const node=(tag,text,className)=>{const el=doc.createElement(tag);if(text)el.textContent=text;if(className)el.className=className;return el;};
 const panel=node('aside',null,'departure-board');panel.hidden=true;panel.setAttribute('aria-label','Odjazdy na wybranej trasie');
 const header=node('header'),title=node('strong'),subtitle=node('span',null,'departure-board__platform'),heading=node('div'),nav=node('nav'),previous=node('button','‹'),next=node('button','›');
 previous.type=next.type='button';previous.setAttribute('aria-label','Poprzedni przystanek wsiadania');next.setAttribute('aria-label','Następny przystanek wsiadania lub przesiadki');
 heading.append(title,subtitle);nav.append(previous,next);header.append(heading,nav);
 const message=node('p',null,'departure-board__status'),scroll=node('div',null,'departure-board__scroll'),table=node('table'),body=node('tbody'),caption=node('caption','Najbliższe odjazdy do celu tego etapu');
 table.append(caption,body);scroll.append(table);scroll.tabIndex=0;scroll.setAttribute('aria-label','Lista odjazdów. Przewiń, aby zobaczyć kolejne.');message.setAttribute('role','status');
 panel.append(header,message,scroll);container.append(panel);
 let route,stages=[],selected=0,manual=false,sequence=0,controller,timer,ageTimer,data,failed=false,selectedTrip=null,mappedVehicle=null;
 const rowEntries=new Map(),map=()=>host.getCityMap?.(),rowKey=row=>(row.tripId||row.line+'|'+row.scheduledDeparture)+'|'+row.fromStopIndex;
 function clearVehicle(){selectedTrip=null;if(mappedVehicle!==null)map()?.setBoardVehicle?.(null);mappedVehicle=null;}
 function highlightStop(focus=false){const stage=stages[selected];if(stage?.stop)map()?.setBoardStop?.({...stage.stop,id:stage.fromStopId,name:data?.stop?.name||stage.from,platform:data?.stop?.platform||stage.stop.platform},{focus});}
 function syncVehicle(row,focus=false){const vehicle=boardVehicle(row,now(),failed);if(!vehicle){clearVehicle();return;}const key=JSON.stringify(vehicle);if(focus||key!==mappedVehicle){map()?.setBoardVehicle?.(vehicle,{focus});mappedVehicle=key;}}
 const clock=value=>new Intl.DateTimeFormat('pl-PL',{timeZone:'Europe/Warsaw',hour:'2-digit',minute:'2-digit',hourCycle:'h23',...(dateInWarsaw(value)!==dateInWarsaw(now())?{day:'numeric',month:'short'}:{})}).format(value);
 function layout(){
  if(panel.hidden)return;const rect=container.getBoundingClientRect?.(),weather=doc.getElementById('environment-bar')?.getBoundingClientRect?.(),sheet=doc.getElementById('ai-sheet')?.getBoundingClientRect?.();
  if(!rect)return;const bottom=Math.min(rect.bottom,sheet?.top??rect.bottom)-30,top=Math.max(rect.top+8,(weather?.bottom||rect.top)+10),space=Math.max(0,bottom-top);
  panel.style.setProperty('--board-max-height',Math.min(200,space)+'px');panel.dataset.cramped=String(space<120);panel.dataset.noRoom=String(space<90);
 }
 function headingText(){const stage=stages[selected];title.textContent=data?.stop?.name||stage.from;subtitle.textContent=data?.stop?.platform||stage.stop?.platform||'';subtitle.hidden=!subtitle.textContent;subtitle.setAttribute('aria-label','Stanowisko '+subtitle.textContent);previous.hidden=stages.length<2;next.hidden=stages.length<2;previous.disabled=selected===0;next.disabled=selected===stages.length-1;}
 function renderRows(){
  if(panel.hidden||!data)return;const scrollTop=scroll.scrollTop,focused=doc.activeElement;
  const rows=data.departures.map(row=>({...row,display:boardTiming(row,now(),failed)})).filter(row=>row.display.departure>=now()).sort((a,b)=>a.display.departure-b.display.departure);
  const selectedRow=rows.find(row=>rowKey(row)===selectedTrip);if(selectedTrip){if(selectedRow)syncVehicle(selectedRow);else clearVehicle();}
  const nodes=[],keys=new Set();
  for(const row of rows){
   const key=rowKey(row);keys.add(key);let entry=rowEntries.get(key);
   if(!entry){
    const tr=node('tr'),line=node('td'),badge=node('span',null,'transit-line-badge'),direction=node('td'),button=node('button',null,'departure-board__choose'),time=node('td'),arrival=node('strong',null,'departure-board__time');button.type='button';
    line.append(badge);direction.append(button);time.append(arrival);tr.append(line,direction,time);
    entry={tr,badge,button,arrival,row};rowEntries.set(key,entry);
    const choose=()=>{if(panel.hidden||!data||!boardVehicle(entry.row,now(),failed))return;selectedTrip=key;syncVehicle(entry.row,true);renderRows();};
    button.addEventListener('click',event=>{event?.stopPropagation?.();choose();});tr.addEventListener('click',choose);
   }
   entry.row=row;const {tr,badge,button,arrival}=entry,remaining=row.display.departure-now(),minutes=Math.max(0,Math.ceil(remaining/60000)),vehicle=boardVehicle(row,now(),failed);
   badge.textContent=row.line;badge.style.backgroundColor=transitAppearance(row).transportColor;
   button.textContent=departureDirection(row,stages[selected].to);button.disabled=!vehicle;button.title=vehicle?'Pokaż pojazd na mapie':'Brak potwierdzonej bieżącej pozycji tego kursu';button.setAttribute('aria-label',button.textContent+' · '+button.title);button.setAttribute('aria-pressed',String(key===selectedTrip));tr.dataset.selected=String(key===selectedTrip);
   const label=remaining<1800000?minutes+' min':clock(row.display.departure),changed=arrival.textContent!==label||Boolean(arrival.children.length)!==row.display.live;
   if(changed){arrival.replaceChildren();arrival.textContent=label;}arrival.dataset.tone=row.display.tone;
   const detail=row.display.live?'Live ETA · '+(row.deltaMs>=0?'+':'')+Math.round(row.deltaMs/60000)+' min względem rozkładu':'Godzina rozkładowa';
   arrival.title=clock(row.display.departure)+' · '+detail;arrival.setAttribute('aria-label',arrival.textContent+' · '+detail);
   if(changed&&row.display.live){const indicator=node('span',null,'departure-board__signal');indicator.setAttribute('aria-hidden','true');arrival.append(indicator);}
   nodes.push(tr);
  }
  for(const key of rowEntries.keys())if(!keys.has(key))rowEntries.delete(key);
  if(nodes.length!==body.children.length||nodes.some((node,index)=>body.children[index]!==node)){body.replaceChildren(...nodes);if([...rowEntries.values()].some(entry=>entry.button===focused))focused.focus?.({preventScroll:true});scroll.scrollTop=scrollTop;}
  const end=clock(data.windowEnd);message.textContent=failed?'Brak odświeżenia · godziny rozkładowe':rows.length?(data.limited?'Najbliższe '+data.provided+' · do '+end:'Odjazdy do '+end):'Brak odjazdów do '+end;
  message.hidden=rows.length>0&&!failed;caption.textContent='Najbliższe odjazdy do celu tego etapu · '+message.textContent;
  table.hidden=!rows.length;layout();
 }
 async function refresh(){
  if(panel.hidden||!stages.length)return;const turn=++sequence;controller?.abort();controller=new AbortController();
  const stage=stages[selected],planned=route.departure>now();
  const future=planned&&Number.isFinite(stage.scheduledStart)&&stage.scheduledStart>now()?new Date(stage.scheduledStart).toISOString():undefined;
  try{
   const response=await fetchImpl('/api/transit/board',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]),body:JSON.stringify({fromStopId:stage.fromStopId,toStopId:stage.toStopId,departureTime:future})});
   if(!response.ok)throw new Error('Board unavailable');const result=await response.json();if(turn!==sequence||panel.hidden)return;
   if(!Array.isArray(result.departures)||!Number.isFinite(result.windowEnd)||result.stop?.id!==stage.fromStopId)throw new Error('Invalid board');data=result;failed=false;headingText();renderRows();
  }catch{if(turn!==sequence||panel.hidden)return;failed=true;if(data)renderRows();else{message.textContent='Nie można pobrać odjazdów. Ponowię za chwilę.';table.hidden=true;}}
 }
 function select(index,focus=false){clearVehicle();selected=index;data=null;rowEntries.clear();body.replaceChildren();highlightStop(focus);table.hidden=true;headingText();message.hidden=false;message.textContent='Sprawdzam odjazdy…';layout();void refresh();}
 function hide(){clearVehicle();map()?.setBoardStop?.(null);rowEntries.clear();sequence++;controller?.abort();clearIntervalImpl(timer);clearIntervalImpl(ageTimer);timer=ageTimer=null;panel.hidden=true;route=null;stages=[];data=null;}
 previous.addEventListener('click',()=>{if(selected>0){manual=true;select(selected-1,true);}});next.addEventListener('click',()=>{if(selected<stages.length-1){manual=true;select(selected+1,true);}});
 const observer=host.ResizeObserver?new host.ResizeObserver(layout):null;for(const el of [container,doc.getElementById('ai-sheet'),doc.getElementById('environment-bar')])if(el)observer?.observe(el);
 host.addEventListener?.('resize',layout);
 return{hide,refresh,show(value){if(route===value&&!panel.hidden){highlightStop();if(selectedTrip){const row=data?.departures.find(item=>rowKey(item)===selectedTrip);mappedVehicle=null;if(row)syncVehicle(row);}layout();return;}hide();stages=boardingStages(value);if(!stages.length)return;route=value;manual=false;panel.hidden=false;select(nearestBoarding(stages,host.getCityLocation?.()));timer=setIntervalImpl(refresh,15000);timer.unref?.();ageTimer=setIntervalImpl(renderRows,1000);ageTimer.unref?.();},location(location){if(!panel.hidden&&!manual){const index=nearestBoarding(stages,location);if(index!==selected)select(index);}},getState:()=>({visible:!panel.hidden,selected,manual,stages:stages.length}),destroy(){hide();observer?.disconnect();host.removeEventListener?.('resize',layout);panel.remove?.();}};
}
