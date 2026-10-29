import type {ProjectService} from './project-service.ts';
import {pixelApi} from './http-api.ts';
import {mcpResponse} from './mcp-tools.ts';
import {requireWorkspace,resolveWorkspace,workspaceSessionApi,type WorkspaceRecordStore} from './workspace-session.ts';

export type WorkspaceProviders = {
  records: WorkspaceRecordStore;
  projects: (workspaceId:string)=>ProjectService;
};

export async function privatePixelApi(request:Request,providers:WorkspaceProviders):Promise<Response> {
  const parts=new URL(request.url).pathname.replace(/^\/api\/pixel\/?/,'').split('/').filter(Boolean);
  if(parts[0]==='session' && parts.length===1)return workspaceSessionApi(request,providers.records);
  const record=await requireWorkspace(request,providers.records);
  if(record instanceof Response)return record;
  return pixelApi(request,providers.projects(record.id));
}

/** Remote MCP must supply a workspace bearer token (not an implicit shared vault). */
export async function privateMcpApi(request:Request,providers:WorkspaceProviders):Promise<Response> {
  const record=await resolveWorkspace(request,providers.records);
  if(!record){
    return Response.json({jsonrpc:'2.0',id:null,error:{code:-32001,message:'Workspace authorization required. Supply an issued Bearer token.'}},
      {status:401,headers:{'cache-control':'no-store','www-authenticate':'Bearer realm="Pixel Workshop"'}});
  }
  return mcpResponse(request,providers.projects(record.id));
}
