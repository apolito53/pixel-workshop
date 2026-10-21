import type { ProjectService } from './project-service.ts';
import { lanternDemo } from './demo.ts';
import { encodePng } from './png.ts';
export async function pixelApi(request:Request,service:ProjectService) {
  const url=new URL(request.url),parts=url.pathname.replace(/^\/api\/pixel\/?/,'').split('/').filter(Boolean);
  try {
    if(request.method==='GET'&&parts[0]==='projects'){
      if(!parts[1])return Response.json((await service.store.list()).map(({id,name,width,height,revision,updatedAt})=>({id,name,width,height,revision,updatedAt})),{headers:{'cache-control':'no-store'}});
      const {entry}=await service.get(parts[1]);
      if(parts[2]==='png')return new Response(new Uint8Array(encodePng(entry.doc,Number(url.searchParams.get('scale')||1))),{headers:{'content-type':'image/png','content-disposition':`attachment; filename="${entry.doc.name.replace(/[^a-z0-9_-]/gi,'-')}.png"`,'cache-control':'no-store'}});
      return Response.json({doc:entry.doc,canUndo:entry.undo.length>0,canRedo:entry.redo.length>0},{headers:{'cache-control':'no-store'}});
    }
    if(request.method==='POST'&&parts[0]==='projects'){
      // Browser mutations are same-origin; remote agents use authenticated /mcp.
      const origin=request.headers.get('origin');if(origin&&origin!==url.origin)throw new Error('Cross-origin editing is not allowed.');
      const text=await request.text();if(text.length>12_000_000)throw new Error('Project is too large.');const body=JSON.parse(text);
      if(!parts[1]){
        const doc=await service.create(body.name,body.width,body.height,body.demo?lanternDemo():body.document);
        return Response.json({doc,canUndo:false,canRedo:false});
      }
      if(!['paint','undo','redo'].includes(body.action))throw new Error('Unknown edit action.');
      await service.edit(parts[1],body.revision,body.action,body.commands);
      const {entry}=await service.get(parts[1]);return Response.json({doc:entry.doc,canUndo:!!entry.undo.length,canRedo:!!entry.redo.length});
    }
    return Response.json({error:'Route not found'},{status:404});
  }catch(e){const message=e instanceof Error?e.message:'Request failed';return Response.json({error:message},{status:/changed/.test(message)?409:400});}
}
