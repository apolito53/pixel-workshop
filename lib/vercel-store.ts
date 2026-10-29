import { get, list, put, BlobPreconditionFailedError } from '@vercel/blob';
import { ProjectService, safeId, type Entry, type ProjectStore } from './project-service.ts';
import { requireWorkspaceId, type WorkspaceRecord, type WorkspaceRecordStore } from './workspace-session.ts';
import type { WorkspaceProviders } from './workspace-http.ts';

function requireStorage() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('Connect a private Vercel Blob store to this project, then redeploy to enable saving.');
  }
}
function blobStore(prefix:string):ProjectStore {
  const key=(id:string)=>`${prefix}${safeId(id)}.json`;
  return {
    async list() {
      requireStorage();
      const result = await list({prefix,limit:100});
      const items = await Promise.all(result.blobs.map(async blob => {
        const item = await get(blob.pathname,{access:'private',useCache:false});
        return item?.statusCode===200?(await new Response(item.stream).json() as Entry).doc:null;
      }));
      return items.filter((doc):doc is NonNullable<typeof doc>=>!!doc)
        .sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    },
    async get(id) {
      requireStorage();
      const item=await get(key(id),{access:'private',useCache:false});
      if(!item||item.statusCode!==200)return null;
      return {entry:await new Response(item.stream).json() as Entry,etag:item.blob.etag.replace(/^W\//,'')};
    },
    async put(id,entry,etag) {
      requireStorage();
      try {
        await put(key(id),JSON.stringify(entry),{
          access:'private',addRandomSuffix:false,contentType:'application/json',
          allowOverwrite:!!etag,...(etag?{ifMatch:etag}:{}),
        });
      }catch(error){
        if(error instanceof BlobPreconditionFailedError)
          throw new Error('This project changed. Reload it before applying your edit.');
        throw error;
      }
    },
  };
}
const sessions:WorkspaceRecordStore={
  async get(id){
    requireStorage();
    const item=await get(`workspaces/${requireWorkspaceId(id)}/metadata.json`,{access:'private',useCache:false});
    return item?.statusCode===200?await new Response(item.stream).json() as WorkspaceRecord:null;
  },
  async create(record){
    requireStorage();
    await put(`workspaces/${requireWorkspaceId(record.id)}/metadata.json`,JSON.stringify(record),{
      access:'private',addRandomSuffix:false,contentType:'application/json',allowOverwrite:false,
    });
  },
};
export const workspaceProviders:WorkspaceProviders={
  records:sessions,
  projects:(id)=>new ProjectService(blobStore(`workspaces/${requireWorkspaceId(id)}/projects/`)),
};
// Existing projects/ objects stay intact but are never served by the public routes.
// Use the explicit owner-only legacy migration script for selected existing projects.
export const projectService = new ProjectService(blobStore('projects/'));
