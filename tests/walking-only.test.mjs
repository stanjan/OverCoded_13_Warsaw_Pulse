import test from 'node:test';import assert from 'node:assert/strict';
import {planDirectWalk,mergeRouteOptions} from '../server/walking-router.mjs';
import {computeMunicipal,waypoint,routeMode} from '../transit-core.mjs';
import {executeTool,mcpTools} from '../mcp/tools.mjs';
const origin={latitude:52.2,longitude:21,label:'Start'},destination={latitude:52.202,longitude:21.003,label:'Cel'},departureTime=Date.parse('2026-10-18T10:00:00Z');
const edge={geometry:'osm_pedestrian',durationMillis:300000,distanceMeters:400,path:[origin,{latitude:52.201,longitude:21.003},destination]};
const options={origin,destination,departureTime};
const provider={route:async()=>edge};
test('direct walk constructs one genuine pedestrian leg without any transit identifiers or live claims',async()=>{
 const route=await planDirectWalk(options,{provider});assert.equal(route.mode,'walk');assert.equal(route.timing,'walking_estimate');assert.equal(route.arrival,departureTime+300000);assert.deepEqual(route.steps[0].path,edge.path);assert.equal(route.steps[0].tripId,undefined);assert.equal(route.steps[0].line,undefined);assert.equal(route.modelAdjusted,false);assert.deepEqual(route.destinationPoint,{latitude:destination.latitude,longitude:destination.longitude});
});
test('direct walk keeps bounded range and never fabricates paths on failure or cancellation',async()=>{
 await assert.rejects(planDirectWalk({...options,destination:{latitude:53,longitude:21}},{provider:{route:()=>assert.fail('range must be checked before provider')}}),{code:'WALK_RANGE'});
 await assert.rejects(planDirectWalk(options,{provider:{route:async()=>({...edge,geometry:'schematic'})}}),{code:'WALK_SCHEMA'});
 await assert.rejects(planDirectWalk(options,{provider:{route:async()=>{throw Object.assign(new Error('unreachable'),{code:'WALK_UNREACHABLE'});}}}),{code:'WALK_UNREACHABLE'});
 const controller=new AbortController();controller.abort();await assert.rejects(planDirectWalk({...options,signal:controller.signal},{provider}),{name:'AbortError'});
});
test('automatic comparison retains a faster walk among three cards and counts future transit waiting by arrival',async()=>{
 const walking=await planDirectWalk(options,{provider});const rides=[10,12,15].map(minutes=>({arrival:departureTime+minutes*60000,steps:[{mode:'TRANSIT'}]}));
 const routes=mergeRouteOptions(rides,walking);assert.equal(routes.length,3);assert.equal(routes[0].mode,'walk');assert.ok(routes[0].recommended);assert.equal(routes.filter(route=>route.recommended).length,1);assert.match(routes[0].recommendationReason,/wcześniej/);
 const future={departure:departureTime+86400000,arrival:departureTime+87000000,durationMillis:600000,nextAvailable:true,steps:[{mode:'TRANSIT'}]};assert.equal(mergeRouteOptions([future],walking)[0].mode,'walk');
 const faster={arrival:departureTime+120000,steps:[{mode:'TRANSIT'}]};assert.equal(mergeRouteOptions([faster],walking)[0].steps[0].mode,'TRANSIT');assert.equal(mergeRouteOptions([faster],walking)[1].mode,'walk');
});
test('walking mode survives client HTTP serialization and MCP action while invalid modes are rejected',async()=>{
 let body;await computeMunicipal({origin:waypoint(origin),destination:waypoint(destination),departureTime:new Date(departureTime),mode:'walk'},{fetchImpl:async(_url,init)=>{body=JSON.parse(init.body);return{ok:true,json:async()=>({routes:[],stops:[],departures:[],vehicles:[]})};}});assert.equal(body.mode,'walk');assert.equal(routeMode(), 'auto');assert.throws(()=>routeMode('drive'),{code:'INVALID_MODE'});
 const state={results:[],actions:[]};const planned=await executeTool('plan_transit',{destinationCoordinates:destination,originCoordinates:origin,mode:'walk'},state);assert.equal(planned.action.mode,'walk');assert.equal(state.actions[0].mode,'walk');assert.deepEqual(mcpTools.find(tool=>tool.name==='plan_transit').inputSchema.properties.mode.enum,['auto','walk','transit']);await assert.rejects(executeTool('plan_transit',{destinationCoordinates:destination,mode:'drive'},state),{code:'INVALID_MODE'});
});
