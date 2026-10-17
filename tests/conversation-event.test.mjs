import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('// Event details opened from a map cloud:'),app.indexOf('const mapCanvas ='));
function element(){
 const classes=new Set();
 return {children:[],dataset:{},style:{},scrollTop:0,listeners:{},classList:{add:value=>classes.add(value),remove:value=>classes.delete(value),contains:value=>classes.has(value)},
  setAttribute(){},append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}},prepend(node){node.parent=this;this.children.unshift(node);},
  remove(){this.parent.children=this.parent.children.filter(node=>node!==this);},querySelector(){return this.children.find(node=>node.className==='conversation-event');},
  addEventListener(name,callback){this.listeners[name]=callback;},focus(){},getBoundingClientRect(){return{height:300};}};
}
for(const event of ['city:transit','city:query'])test('external event view releases the conversation synchronously for '+event,()=>{
 const content=element(),sheet=element(),drawer=element(),chat=element(),results=element(),transport=element(),events={};
 content.append(chat,results,transport);
 const window={addEventListener(name,callback){events[name]=callback;},matchMedia:()=>({matches:true})};
 runInNewContext(source,{window,document:{createElement:element,querySelector:()=>sheet,addEventListener(){}},content,drawer,expanded:true,setExpanded(){},setTimeout(){}});
 window.openEventInConversation(element(),{title:'Wydarzenie'});
 assert.equal(sheet.classList.contains('is-event-open'),true);
 assert.ok(content.querySelector('.conversation-event'));
 events[event]();
 assert.equal(content.querySelector('.conversation-event'),undefined);
 assert.equal(sheet.classList.contains('is-event-open'),false);
 assert.equal(drawer.classList.contains('is-event-open'),false);
 assert.deepEqual(content.children,[chat,results,transport]);
});
