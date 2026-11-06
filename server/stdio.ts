import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ProjectService } from '../lib/project-service.ts';
import { callTool, toolDefinitions } from '../lib/mcp-tools.ts';
import { fileStore } from './file-store.ts';
import {toolFieldSchema} from '../lib/tool-schema.ts';
const service=new ProjectService(fileStore()),server=new McpServer({name:'pixel-workshop',version:'0.3.0'});
for(const tool of toolDefinitions){
  const fields:Record<string,z.ZodTypeAny>={};
  for(const [key,raw] of Object.entries(tool.inputSchema.properties)){
    let s=toolFieldSchema(raw as Record<string,unknown>);
    if(!tool.inputSchema.required.includes(key))s=s.optional();fields[key]=s;
  }
  server.registerTool(tool.name,{description:tool.description,inputSchema:fields},async(args)=>callTool(service,tool.name,args));
}
await server.connect(new StdioServerTransport());
