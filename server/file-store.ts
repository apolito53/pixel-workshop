import { mkdir, readFile, writeFile, rename, readdir, rm } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { createHash } from 'node:crypto';
import { safeId,type Entry,type ProjectStore } from '../lib/project-service.ts';
export function fileStore(directory=process.env.PIXEL_DATA_DIR||'./pixel-data'):ProjectStore {
  const root=resolve(directory);const path=(id:string)=>join(root,`${safeId(id)}.json`);
  return {
    async list(){await mkdir(root,{recursive:true});const names=(await readdir(root)).filter(n=>n.endsWith('.json'));return Promise.all(names.map(async n=>JSON.parse(await readFile(join(root,n),'utf8')).doc));},
    async get(id){try{const raw=await readFile(path(id),'utf8');return {entry:JSON.parse(raw),etag:createHash('sha256').update(raw).digest('hex')};}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}},
    async put(id,entry,etag){await mkdir(root,{recursive:true});const target=path(id),lock=target+'.lock';let acquired=false;
      for(let attempt=0;attempt<100;attempt++){try{await mkdir(lock);acquired=true;break;}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;await new Promise(r=>setTimeout(r,20));}}
      if(!acquired)throw new Error('Project is busy; retry shortly.');
      try{let current:string|undefined;try{current=await readFile(target,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
        if(etag?(!current||createHash('sha256').update(current).digest('hex')!==etag):!!current)throw new Error('This project changed. Reload it before applying your edit.');
        const temp=target+'.'+crypto.randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(entry));await rename(temp,target);
      }finally{await rm(lock,{recursive:true,force:true});}
    }
  };
}
