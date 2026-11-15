import {PACKED_PROJECT_MEDIA,MAX_PROJECT_REQUEST_BYTES,packProject} from './project-codec.ts';
import type {EditorSnapshot} from './edit-queue.ts';
import type { ProjectService } from './project-service.ts';
import { lanternDemo } from './demo.ts';
import { cottageDemo } from './cottage.ts';
import { encodePng } from './png.ts';
import { encodeSvg } from './svg.ts';
import { frameView } from './pixels.ts';
export async function pixelApi(request:Request,service:ProjectService) {
  const url=new URL(request.url),parts=url.pathname.replace(/^\/api\/pixel\/?/,'').split('/').filter(Boolean);
  const snapshotResponse=(snapshot:EditorSnapshot)=>{
    const doc=request.headers.get('accept')?.includes(PACKED_PROJECT_MEDIA)?packProject(snapshot.doc):snapshot.doc;
    return Response.json({...snapshot,doc},{headers:{'cache-control':'no-store',vary:'Accept'}});
  };
  try {
    if(request.method==='GET'&&parts[0]==='projects'){
      if(!parts[1])return Response.json((await service.listSummaries()).map(({id,name,width,height,revision,updatedAt})=>({id,name,width,height,revision,updatedAt})),{headers:{'cache-control':'no-store'}});
      const {entry}=await service.get(parts[1]);
      if(parts[2]==='png')return new Response(new Uint8Array(encodePng(frameView(entry.doc,Number(url.searchParams.get('frame')||0)),Number(url.searchParams.get('scale')||1))),{headers:{'content-type':'image/png','content-disposition':`attachment; filename="${entry.doc.name.replace(/[^a-z0-9_-]/gi,'-')}.png"`,'cache-control':'no-store'}});
      if(parts[2]==='svg')return new Response(encodeSvg(frameView(entry.doc,Number(url.searchParams.get('frame')||0)),Number(url.searchParams.get('scale')||1)),{headers:{'content-type':'image/svg+xml; charset=utf-8','content-disposition':`attachment; filename="${entry.doc.name.replace(/[^a-z0-9_-]/gi,'-')}.svg"`,'cache-control':'no-store','x-content-type-options':'nosniff'}});
      return snapshotResponse({doc:entry.doc,canUndo:entry.undo.length>0,canRedo:entry.redo.length>0});
    }
    if(request.method==='POST'&&parts[0]==='projects'){
      // Browser mutations are same-origin; remote agents use authenticated /mcp.
      const origin=request.headers.get('origin');if(origin&&origin!==url.origin)throw new Error('Cross-origin editing is not allowed.');
      const text=await request.text();if(text.length>MAX_PROJECT_REQUEST_BYTES)throw new Error('Project is too large.');const body=JSON.parse(text);
      if(!parts[1]){
        const doc=await service.create(body.name,body.width,body.height,body.demo==='cottage'?cottageDemo():body.demo?lanternDemo():body.document);
        return snapshotResponse({doc,canUndo:false,canRedo:false});
      }
      const edits=body.edits??[{action:body.action,commands:body.commands}];
      return snapshotResponse(await service.editSnapshot(parts[1],body.revision,edits,body.requestId,body.expectedLastRequestId));
    }
    return Response.json({error:'Route not found'},{status:404});
  }catch(e){const message=e instanceof Error?e.message:'Request failed';return Response.json({error:message},{status:/changed/.test(message)?409:400});}
}
