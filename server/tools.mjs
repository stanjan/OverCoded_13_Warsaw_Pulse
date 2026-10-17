import {createDispatcher} from '../mcp/protocol.mjs';
import {createMcpClient} from '../mcp/client.mjs';
import {mcpTools} from '../mcp/tools.mjs';
export const toolDefinitions=mcpTools.map(({name,description,inputSchema})=>({type:'function',function:{name,description,parameters:inputSchema}}));
export async function executeTool(name,args,state,provider) {
  const dispatch=createDispatcher({state,provider});
  const client=createMcpClient(async message=>{
    const reply=await dispatch(JSON.parse(JSON.stringify(message)));
    return reply?JSON.parse(JSON.stringify(reply)):undefined;
  });
  const {action, ...reply} = await client.callTool(name,args);
  // The app already receives full actions through state. Avoid repeating every
  // selected record in the model prompt; external MCP clients still get action.
  return reply;
}
