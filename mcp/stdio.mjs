import {createInterface} from 'node:readline';
import {createDispatcher} from './protocol.mjs';
const dispatch=createDispatcher();
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
for await(const line of input) {
 let response;
 try{response=await dispatch(JSON.parse(line));}
 catch{response={jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}};}
 if(response)process.stdout.write(JSON.stringify(response)+'\n');
}
