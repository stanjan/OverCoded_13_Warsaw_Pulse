import {dateInWarsaw,distanceMeters,serviceInstant,TransitError} from '../transit-core.mjs';
import {nextDay} from './transit-gtfs.mjs';
import {validateGraph} from './transit-router.mjs';
import {planPedestrianGraph} from './walking-router.mjs';

// Request-local lookahead. Only one day's dated graph is held by this loop;
// it never attaches future schedules to the live fleet model.
export async function nextAvailableTransit(initial,options,{graphProvider,walking}={}){
 const requested=options.departureTime,firstDay=dateInWarsaw(requested),lastDay=initial.source.validTo;
 const check=()=>{options.signal?.throwIfAborted();walking.verification.signal.throwIfAborted();if(Date.now()>=walking.verification.deadlineAt)throw new TransitError('LOOKAHEAD_LIMIT','Nie zakończono sprawdzania późniejszych połączeń w dostępnym czasie.');};
 const search={attempted:true,from:firstDay,through:firstDay,feedValidTo:lastDay,daysChecked:0,exhausted:false};
 for(let day=firstDay;day<=lastDay;day=nextDay(day)){
  check();
  const graph=day===firstDay&&!(initial.nextDayHours<24)?initial:validateGraph(await graphProvider(serviceInstant(day,'12:00:00'),{signal:options.signal,nextDayHours:24}));
  const start=day===firstDay?requested:serviceInstant(day,'00:00:00'),end=serviceInstant(nextDay(day),'00:00:00');
  // The following day's services are available for transfers, but the
  // first boarding belongs to this calendar day. This avoids skipping an
  // earlier slow connection in favour of tomorrow's faster one.
  const params={...options,departureTime:start,horizonMs:serviceInstant(nextDay(day,2),'00:00:00')-start,firstBoardingDeadline:end-1};
  search.through=day;search.daysChecked++;
  let routes=await planPedestrianGraph(graph,params,walking);
  if(!routes.length)continue;
  const starts=new Set(graph.stops.map(stop=>({stop,distance:distanceMeters(options.origin,stop)})).filter(item=>item.distance<=900).sort((a,b)=>a.distance-b.distance).slice(0,8).map(item=>item.stop.id));
  const firstBoard=route=>route.steps.find(step=>step.mode==='TRANSIT').start;
  let highTime=Math.min(...routes.map(firstBoard));
  const times=new Set(routes.map(firstBoard));for(const trip of graph.trips){const delta=options.deltas?.get(trip.id),usable=delta&&Number.isFinite(delta.deltaMs)&&options.now-delta.observedAt<=180000&&options.now-delta.observedAt>=-60000&&delta.confidence==='brigade_route_progress';for(const[index,event]of trip.stopTimes.entries()){const departure=event.departure+(usable&&index>delta.stopIndex?Math.max(0,delta.deltaMs):0);if(starts.has(event.stopId)&&event.pickup===0&&departure>=start&&departure<=highTime)times.add(departure);}}
  const clocks=[...times].sort((a,b)=>a-b);
  // Feasibility is monotonic in this cutoff. Binary search the first possible
  // boarding, reusing verified walks; no artificial 4-hour departure buckets.
  let low=0,high=clocks.length-1;
  while(low<high){check();const mid=Math.floor((low+high)/2),earlier=await planPedestrianGraph(graph,{...params,firstBoardingDeadline:clocks[mid]},walking);if(earlier.length){routes=earlier;high=mid;}else low=mid+1;}
  const cutoff=clocks[low];
  if(Number.isFinite(cutoff)&&highTime!==cutoff)routes=await planPedestrianGraph(graph,{...params,firstBoardingDeadline:cutoff},walking);
  routes=routes.sort((a,b)=>firstBoard(a)-firstBoard(b)||a.arrival-b.arrival).map(route=>{
   const index=route.steps.findIndex(step=>step.mode==='TRANSIT'),ride=route.steps[index],access=route.steps.slice(0,index),duration=access.reduce((sum,step)=>sum+step.end-step.start,0),leave=ride.start-duration;
   let clock=leave;const steps=route.steps.map((step,i)=>{if(i>=index)return step;const span=step.end-step.start,shifted={...step,start:clock,end:clock+span};clock+=span;return shifted;});
   return{...route,steps,departure:leave,durationMillis:route.arrival-leave,nextAvailable:true,requestedDeparture:requested,waitingMillis:Math.max(0,leave-requested),firstBoarding:ride.start};
  });
  return{routes,search};
 }
 search.exhausted=true;return{routes:[],search};
}
