import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,randomBytes} from 'node:crypto';
import {validCleanupDescriptor,writeCleanupReceipt,readCleanupReceipt} from './process-cleanup-receipt.mjs';
test('private process proof binds exact owner, producer and signed outcome and never writes its secret',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'cleanup-proof-')),id=randomUUID(),descriptor={id,ownerId:randomUUID(),producerInstanceId:randomUUID(),secret:randomBytes(32).toString('hex'),file:path.join(folder,id+'.json')};
 assert.equal(validCleanupDescriptor(descriptor),true);assert.equal(readCleanupReceipt(descriptor),null);
 assert.throws(()=>writeCleanupReceipt(descriptor,{cleanupConfirmed:false}));
 writeCleanupReceipt(descriptor,{cleanupConfirmed:true,processGroup:1234,reason:'parent_disconnected'});
 assert.equal(readCleanupReceipt(descriptor).processGroup,1234);assert.equal(readCleanupReceipt({...descriptor,ownerId:randomUUID()}),null);
 assert.equal(readCleanupReceipt({...descriptor,producerInstanceId:randomUUID()}),null);assert.equal(readCleanupReceipt({...descriptor,secret:randomBytes(32).toString('hex')}),null);
 assert.equal(fs.readFileSync(descriptor.file,'utf8').includes(descriptor.secret),false);
 assert.equal(validCleanupDescriptor({...descriptor,file:path.join(folder,'other.json')}),false);
 assert.equal(validCleanupDescriptor({...descriptor,file:descriptor.id+'.json'}),false);
});
