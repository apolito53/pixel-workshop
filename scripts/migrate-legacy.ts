/**
 * Owner-only recovery tool for the old shared Vercel Blob namespace.
 * Explicit project IDs are required: no automatic transfer of potentially
 * unrelated visitors' art into a single private workspace.
 *
 * Example:
 *   BLOB_READ_WRITE_TOKEN=... node --experimental-strip-types scripts/migrate-legacy.ts --list
 *   BLOB_READ_WRITE_TOKEN=... node --experimental-strip-types scripts/migrate-legacy.ts --workspace pw_... --ids project-id-1,project-id-2
 */
import {get,list,put} from '@vercel/blob';
import {safeId,type Entry} from '../lib/project-service.ts';
import {requireWorkspaceId} from '../lib/workspace-session.ts';

if(!process.env.BLOB_READ_WRITE_TOKEN){
  console.error('BLOB_READ_WRITE_TOKEN is required. Run only from your trusted local environment.');
  process.exitCode=1;
}else{
  const args=process.argv.slice(2);
  const option=(flag:string)=>{const index=args.indexOf(flag);return index===-1?null:args[index+1]??null;};
  const listOnly=args.includes('--list');
  const chosen=option('--ids');
  const workspace=option('--workspace');
  if(listOnly&&(!chosen&&!workspace)){
    let cursor:string|undefined;
    do{
      const page=await list({prefix:'projects/',limit:100,...(cursor?{cursor}:{})});
      for(const blob of page.blobs){
        if(!/^projects\/[^/]+\.json$/.test(blob.pathname))continue;
        const source=await get(blob.pathname,{access:'private',useCache:false});
        if(source?.statusCode!==200)continue;
        const entry=await new Response(source.stream).json() as Entry;
        const doc=entry.doc;
        console.log(JSON.stringify({id:doc.id,name:doc.name,width:doc.width,height:doc.height,revision:doc.revision}));
      }
      cursor=page.hasMore?page.cursor:undefined;
    }while(cursor);
  }else if(workspace&&chosen){
    const id=requireWorkspaceId(workspace);
    const marker=await get(`workspaces/${id}/metadata.json`,{access:'private',useCache:false});
    if(marker?.statusCode!==200)throw new Error('Target workspace does not exist. Create it through the editor first.');
    const sourceIds=[...new Set(chosen.split(',').map(x=>safeId(x.trim())))];
    for(const sourceId of sourceIds){
      const from=await get(`projects/${sourceId}.json`,{access:'private',useCache:false});
      if(from?.statusCode!==200)throw new Error(`Legacy project not found: ${sourceId}`);
      const entry=await new Response(from.stream).json() as Entry;
      if(entry.doc.id!==sourceId)throw new Error(`Legacy project ID mismatch: ${sourceId}`);
      await put(`workspaces/${id}/projects/${sourceId}.json`,JSON.stringify(entry),{
        access:'private',contentType:'application/json',allowOverwrite:false,addRandomSuffix:false,
      });
      console.log(`Copied project ${sourceId}. Original remains untouched.`);
    }
  }else{
    console.error('Usage: --list OR --workspace pw_ID --ids project-id-1,project-id-2');
    process.exitCode=1;
  }
}
