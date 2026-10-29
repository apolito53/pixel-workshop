import { env } from 'cloudflare:workers';
import { ProjectService, safeId, type Entry, type ProjectStore } from './project-service.ts';
import {requireWorkspaceId,type WorkspaceRecord,type WorkspaceRecordStore} from './workspace-session.ts';
import type {WorkspaceProviders} from './workspace-http.ts';
const bucket=()=>{const b=(env as unknown as {BUCKET:R2Bucket}).BUCKET;if(!b)throw new Error('Project storage is unavailable.');return b;};
function cloudStore(prefix:string):ProjectStore {
  return {
    async list(){
      const listed=await bucket().list({prefix,limit:100});
      const items=await Promise.all(listed.objects.map(o=>bucket().get(o.key)));
      return (await Promise.all(items.filter(Boolean).map(async o=>(await o!.json<Entry>()).doc)))
        .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    },
    async get(id){
      const item=await bucket().get(`${prefix}${safeId(id)}.json`);
      return item?{entry:await item.json<Entry>(),etag:item.etag}:null;
    },
    async put(id,entry,etag){
      const result=await bucket().put(`${prefix}${safeId(id)}.json`,JSON.stringify(entry),{
        httpMetadata:{contentType:'application/json'},
        onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'},
      });
      if(!result)throw new Error('This project changed. Reload it before applying your edit.');
    },
  };
}
const sessions:WorkspaceRecordStore={
  async get(id){
    const record=await bucket().get(`workspaces/${requireWorkspaceId(id)}/metadata.json`);
    return record?await record.json<WorkspaceRecord>():null;
  },
  async create(record){
    const result=await bucket().put(`workspaces/${requireWorkspaceId(record.id)}/metadata.json`,JSON.stringify(record),{
      httpMetadata:{contentType:'application/json'},onlyIf:{etagDoesNotMatch:'*'},
    });
    if(!result)throw new Error('Workspace ID collision; try again.');
  },
};
export const workspaceProviders:WorkspaceProviders={
  records:sessions,
  projects:(id)=>new ProjectService(cloudStore(`workspaces/${requireWorkspaceId(id)}/projects/`)),
};
// Preserve the legacy project namespace for explicit owner recovery; public
// browser and MCP handlers use workspaceProviders only.
export const projectService=new ProjectService(cloudStore('projects/'));
