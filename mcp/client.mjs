import {PROTOCOL_VERSION} from './protocol.mjs';
// A transport receives a JSON-RPC object and resolves its response. Both the app's
// in-process paired transport and stdio CLI preserve the same lifecycle/tool wire.
export function createMcpClient(transport) {
 let sequence=0,started;
 async function request(method,params){
   const id=++sequence,result=await transport({jsonrpc:'2.0',id,method,params});
   if(!result||result.jsonrpc!=='2.0'||result.id!==id)throw new Error('Nieprawidłowa odpowiedź MCP.');
   if(result.error)throw new Error('MCP: '+result.error.message);
   return result.result;
 }
 function start(){return started??=(async()=>{const info=await request('initialize',{protocolVersion:PROTOCOL_VERSION,capabilities:{},clientInfo:{name:'warsaw-app',version:'1.0.0'}});if(info.protocolVersion!==PROTOCOL_VERSION)throw new Error('Nieobsługiwana wersja MCP.');await transport({jsonrpc:'2.0',method:'notifications/initialized'});})();}
 return {async listTools(){await start();return(await request('tools/list',{})).tools;},
 async callTool(name,args){await start();const result=await request('tools/call',{name,arguments:args});let data;try{data=JSON.parse(result.content?.find(c=>c.type==='text')?.text);}catch{throw new Error('Nieprawidłowa treść MCP.');}if(result.isError)throw new Error(data.error||'Błąd narzędzia MCP.');return data;}};
}
