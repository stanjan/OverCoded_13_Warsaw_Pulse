import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:net';import {spawn} from 'node:child_process';import {once} from 'node:events';
test('transit HTTP validates origin, JSON, host and credential-free errors without leaking implementation faults',async t=>{
 const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const child=spawn(process.execPath,['scripts/serve.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),DATA_API_KEY:'',CODEX_BRIDGE_URL:''},stdio:['ignore','pipe','pipe'],windowsHide:true});t.after(()=>child.kill());
 await new Promise((resolve,reject)=>{child.stdout.on('data',data=>{if(data.toString().includes('Local:'))resolve();});child.once('error',reject);child.once('exit',code=>reject(new Error('preview exited '+code)));});
 const base='http://127.0.0.1:'+port;
 const bad=await fetch(base+'/api/transit/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin:{latitude:91,longitude:21},destination:'Cel'})});assert.equal(bad.status,400);const error=await bad.json();assert.equal(error.code,'INVALID_LOCATION');assert.equal(JSON.stringify(error).includes('stack'),false);
 const noKey=await fetch(base+'/api/transit/stops?q=Centrum');assert.equal(noKey.status,503);assert.equal((await noKey.json()).code,'SOURCE_NOT_CONFIGURED');
 const cross=await fetch(base+'/api/transit/live',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:'{}'});assert.equal(cross.status,403);
 const json=await fetch(base+'/api/transit/plan',{method:'POST',headers:{'Content-Type':'application/json'},body:'not-json'});assert.equal(json.status,400);
 const live=await fetch(base+'/api/transit/live',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({origin:{latitude:52.2,longitude:21},destination:{latitude:52.25,longitude:21.02}})});assert.equal(live.status,200);const snapshot=await live.json();assert.equal(snapshot.liveModel.persistentGpsHistory,false);assert.equal(snapshot.liveModel.continuous,false);assert.deepEqual(snapshot.vehicles,[]);
 const module=await fetch(base+'/transit-core.mjs');assert.equal(module.status,200);assert.match(module.headers.get('content-type'),/javascript/);
});
