import {PACKED_PROJECT_MEDIA,POOLED_PROJECT_MEDIA,LEGACY_PACKED_MEDIA,MAX_PROJECT_REQUEST_BYTES,denseProject,denseProjectCells,packLegacyProject,packPooledProject,packProject,UnsupportedProjectFormat} from './project-codec.ts';
import type {EditorSnapshot} from './edit-queue.ts';
import type { ProjectService } from './project-service.ts';
import { lanternDemo } from './demo.ts';
import { cottageDemo } from './cottage.ts';
import { encodePng } from './png.ts';
import { encodeSvg } from './svg.ts';
import { frameView, MAX_ANIMATION_CELLS, type PixelDocument } from './pixels.ts';
export async function pixelApi(request:Request,service:ProjectService) {
  const url=new URL(request.url),parts=url.pathname.replace(/^\/api\/pixel\/?/,'').split('/').filter(Boolean);
  const accept=request.headers.get('accept')??'';
  const native=accept.includes(PACKED_PROJECT_MEDIA);
  const legacyWriter=native?undefined:accept.includes(POOLED_PROJECT_MEDIA)?packPooledProject:
    accept.includes(LEGACY_PACKED_MEDIA)?packLegacyProject:undefined;
  let prepared:ReturnType<typeof packPooledProject>|ReturnType<typeof packLegacyProject>|undefined;
  const prepare=legacyWriter?(doc:PixelDocument)=>{prepared=legacyWriter(doc);}:undefined;
  const snapshotResponse=(snapshot:EditorSnapshot)=>{
    const doc=prepared??(legacyWriter?legacyWriter(snapshot.doc):
      native||denseProjectCells(snapshot.doc)>MAX_ANIMATION_CELLS?packProject(snapshot.doc):denseProject(snapshot.doc));
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
      const tooLarge=()=>Response.json({error:'Project exceeds the save request limit.'},{status:413});
      if(Number(request.headers.get('content-length'))>MAX_PROJECT_REQUEST_BYTES)return tooLarge();
      const bytes=await request.arrayBuffer();
      if(bytes.byteLength>MAX_PROJECT_REQUEST_BYTES)return tooLarge();
      const body=JSON.parse(new TextDecoder().decode(bytes));
      if(!parts[1]){
        const doc=await service.create(body.name,body.width,body.height,body.demo==='cottage'?cottageDemo():body.demo?lanternDemo():body.document,prepare);
        return snapshotResponse({doc,canUndo:false,canRedo:false});
      }
      const edits=body.edits??[{action:body.action,commands:body.commands}];
      return snapshotResponse(await service.editSnapshot(parts[1],body.revision,edits,body.requestId,body.expectedLastRequestId,prepare));
    }
    return Response.json({error:'Route not found'},{status:404});
  }catch(e){const message=e instanceof Error?e.message:'Request failed';return Response.json({error:message},{status:e instanceof UnsupportedProjectFormat?406:/changed/.test(message)?409:400});}
}
