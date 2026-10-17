// Private supervisor evidence. Never expose the descriptor's authentication
// secret to a workflow, model prompt, child environment, log or health response.
import {createHmac,timingSafeEqual} from 'node:crypto';
import {openSync,writeFileSync,fsyncSync,closeSync,renameSync,readFileSync} from 'node:fs';
import path from 'node:path';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function validCleanupDescriptor(value){
 return !!value&&[value.id,value.ownerId,value.producerInstanceId].every(v=>typeof v==='string'&&uuid.test(v))&&
  typeof value.secret==='string'&&/^[a-f0-9]{64}$/.test(value.secret)&&typeof value.file==='string'&&path.isAbsolute(value.file)&&
  !value.file.includes('\0')&&path.basename(value.file)===value.id+'.json';
}
const signature=(body,secret)=>createHmac('sha256',secret).update(JSON.stringify(body)).digest('hex');
export function writeCleanupReceipt(descriptor,outcome){
 if(!validCleanupDescriptor(descriptor)||outcome.cleanupConfirmed!==true)throw new Error('Invalid private cleanup proof');
 const body={version:1,id:descriptor.id,ownerId:descriptor.ownerId,producerInstanceId:descriptor.producerInstanceId,
  cleanupConfirmed:true,processGroup:outcome.processGroup??null,code:outcome.code??null,signal:outcome.signal??null,reason:outcome.reason??null,finishedAt:Date.now()};
 const temporary=descriptor.file+'.tmp',fd=openSync(temporary,'wx',0o600);
 try{writeFileSync(fd,JSON.stringify({body,signature:signature(body,descriptor.secret)}));fsyncSync(fd);}finally{closeSync(fd);}
 renameSync(temporary,descriptor.file);return body;
}
export function readCleanupReceipt(descriptor){
 if(!validCleanupDescriptor(descriptor))return null;
 try{
  const receipt=JSON.parse(readFileSync(descriptor.file,'utf8')),body=receipt.body;
  if(body?.version!==1||body.id!==descriptor.id||body.ownerId!==descriptor.ownerId||body.producerInstanceId!==descriptor.producerInstanceId||
    body.cleanupConfirmed!==true||!Number.isSafeInteger(body.finishedAt)||body.finishedAt<=0||typeof receipt.signature!=='string'||!/^[a-f0-9]{64}$/.test(receipt.signature))return null;
  if(!timingSafeEqual(Buffer.from(receipt.signature,'hex'),Buffer.from(signature(body,descriptor.secret),'hex')))return null;
  return body;
 }catch{return null;}
}
