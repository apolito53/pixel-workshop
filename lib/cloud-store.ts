import { env } from 'cloudflare:workers';
import { ProjectService, safeId, type Entry, type ProjectStore } from './project-service.ts';
const bucket=()=>{const b=(env as unknown as {BUCKET:R2Bucket}).BUCKET;if(!b)throw new Error('Project storage is unavailable.');return b;};
const cloudStore:ProjectStore={
  async list(){const listed=await bucket().list({prefix:'projects/',limit:100});const items=await Promise.all(listed.objects.map(o=>bucket().get(o.key)));return (await Promise.all(items.filter(Boolean).map(async o=>(await o!.json<Entry>()).doc))).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));},
  async get(id){const item=await bucket().get(`projects/${safeId(id)}.json`);return item?{entry:await item.json<Entry>(),etag:item.etag}:null;},
  async put(id,entry,etag){const result=await bucket().put(`projects/${safeId(id)}.json`,JSON.stringify(entry),{httpMetadata:{contentType:'application/json'},onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'}});if(!result)throw new Error('This project changed. Reload it before applying your edit.');}
};
export const cloudService=new ProjectService(cloudStore);
