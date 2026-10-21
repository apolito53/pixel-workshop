import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ProjectService } from '../lib/project-service.ts';
import { callTool, toolDefinitions } from '../lib/mcp-tools.ts';
import { fileStore } from './file-store.ts';
const service=new ProjectService(fileStore()),server=new McpServer({name:'pixel-workshop',version:'0.1.0'});
for(const tool of toolDefinitions){
  const fields:Record<string,z.ZodTypeAny>={};
  for(const [key,raw] of Object.entries(tool.inputSchema.properties)){
    const p=raw as {type:string};let s:z.ZodTypeAny=p.type==='integer'?z.number().int():p.type==='boolean'?z.boolean():p.type==='array'?z.array(z.record(z.unknown())):z.string();
    if(!tool.inputSchema.required.includes(key))s=s.optional();fields[key]=s;
  }
  server.registerTool(tool.name,{description:tool.description,inputSchema:fields},async(args)=>callTool(service,tool.name,args));
}
await server.connect(new StdioServerTransport());
