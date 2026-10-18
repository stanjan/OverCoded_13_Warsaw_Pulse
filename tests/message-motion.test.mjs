import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
const helper=app.slice(app.indexOf('function animateMessageSize('),app.indexOf('async function send()'));
function fixture(reduced=false){
 let resize,disconnected=false;const animations=[];
 const bubble={animate(frames){const animation={frames,playState:'running',effect:{getComputedTiming:()=>({progress:.5})},cancel(){this.playState='idle';}};animations.push(animation);return animation;}};
 const stop=runInNewContext(helper+'\nanimateMessageSize(bubble)',{bubble,window:{ResizeObserver:class{constructor(callback){resize=callback;}observe(){}disconnect(){disconnected=true;}},matchMedia:()=>({matches:reduced})}});
 return{animations,stop,get disconnected(){return disconnected;},size(width,height){resize([{borderBoxSize:[{inlineSize:width,blockSize:height}]}]);}};
}
test('streamed bubble resize continues from the visible size when interrupted, without resize feedback',()=>{
 const f=fixture();f.size(60,44);f.size(300,100);assert.equal(f.animations[0].frames[0].transform,'scale(0.2, 0.44)');
 f.size(360,120);assert.equal(f.animations[0].playState,'idle');assert.equal(f.animations[1].frames[0].transform,'scale(0.5, 0.6)');
 f.size(360,120);assert.equal(f.animations.length,2);f.stop();assert.equal(f.disconnected,true);
});
test('reduced motion keeps natural bubble sizing without animation',()=>{const f=fixture(true);f.size(60,44);f.size(300,100);assert.equal(f.animations.length,0);f.stop();});
