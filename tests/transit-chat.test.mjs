import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
const send='const requestAnimationFrame = callback => callback();\n'+source.slice(source.indexOf('function animateMessageSize('),source.indexOf("\nsubmit.addEventListener('click'"));
function setup(stream){
 const nodes=[],actions=[],events=[],cleared=[];
 const node=()=>({textContent:'',children:[],classList:{add(){}},setAttribute(){},removeAttribute(){},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},remove(){},addEventListener(){},removeEventListener(){}});
 const context={window:{getCityLocation:()=>({status:'unavailable'}),dispatchEvent:event=>events.push(event.type)},CustomEvent:class{constructor(type){this.type=type;}},cityMap:{clearMarkers:()=>cleared.push(true)},lastDisplayedAction:{type:'display_results'},document:{createElement:node},input:{value:'Jak dojadę?'},pending:false,submit:node(),content:{...node(),scrollHeight:0,scrollTop:0,clientHeight:0},sessionId:null,resultPanel:node(),
  refreshLocation:async()=>{},hasKnownLocation:()=>false,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},Date,AbortController,
  addMessage(){const value=node();nodes.push(value);return value;},
  applyAction(action,anchor){actions.push({action,anchor,answer:anchor.children.find(child=>child.className==='assistant-answer')?.textContent});},
  fetch:async()=>({ok:true,headers:{get:()=> 'text/event-stream'},body:{}}),chatEvents:()=>stream(actions)};
 runInNewContext(send+'\nglobalThis.sendChat=send;',context);return{context,nodes,actions,events,cleared};
}

test('a new question clears previous results and signals transport cleanup before the response starts',async()=>{
 const fixture=setup(async function*(){assert.deepEqual(fixture.events,['city:query']);assert.equal(fixture.context.resultPanel.children.length,0);assert.equal(fixture.context.lastDisplayedAction,null);assert.equal(fixture.cleared.length,1);yield{type:'done',sessionId:'test',message:'Nowa odpowiedź'};});
 fixture.context.resultPanel.append({textContent:'Poprzedni wynik'});await fixture.context.sendChat();assert.equal(fixture.nodes.length,2);
});
test('an early transport tool action waits for completed answer and retains that answer as its anchor',async()=>{
 const action={type:'plan_transit',mode:'walk',destination:{latitude:52.25,longitude:21}};
 const fixture=setup(async function*(actions){yield{type:'action',action};assert.equal(actions.length,0);yield{type:'text',delta:'Sprawdzam'};assert.equal(actions.length,0);yield{type:'done',sessionId:'test',message:'Opcje znajdziesz pod odpowiedzią.'};});
 await fixture.context.sendChat();assert.equal(fixture.actions.length,1);assert.equal(fixture.actions[0].action.mode,'walk');assert.equal(fixture.actions[0].anchor,fixture.nodes[1]);assert.equal(fixture.actions[0].answer,'Opcje znajdziesz pod odpowiedzią.');
});
test('a failed or truncated assistant response never launches its queued transport plan',async()=>{
 for(const failed of [false,true]){const fixture=setup(async function*(){yield{type:'action',action:{type:'plan_transit'}};if(failed)yield{type:'error',message:'Źródło niedostępne'};});await fixture.context.sendChat();assert.equal(fixture.actions.length,0);}
});
