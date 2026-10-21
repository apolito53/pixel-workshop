import type { ProjectService } from './project-service.ts';
import type { PaintCommand } from './pixels.ts';
import { encodePng } from './png.ts';
const id={type:'string',description:'Project ID returned by create_canvas or list_canvases.'};
const rev={type:'integer',minimum:0,description:'Current document revision. Reload with get_canvas after a conflict.'};
const schema=(properties:Record<string,unknown>,required:string[]=[])=>({type:'object',properties,required,additionalProperties:false});
export const toolDefinitions=[
  {name:'list_canvases',description:'List saved pixel-art canvases, dimensions, layer names, and revisions.',inputSchema:schema({}),annotations:{readOnlyHint:true}},
  {name:'create_canvas',description:'Create an editable transparent pixel canvas, 1–256 pixels per side. Returns its ID, revision and layers.',inputSchema:schema({name:{type:'string'},width:{type:'integer',minimum:1,maximum:256},height:{type:'integer',minimum:1,maximum:256}},['name','width','height'])},
  {name:'get_canvas',description:'Inspect a canvas. Returns document metadata and a nearest-neighbor enlarged PNG preview. Set include_pixels to inspect editable pixel data.',inputSchema:schema({id,include_pixels:{type:'boolean'}},['id']),annotations:{readOnlyHint:true}},
  {name:'paint',description:'Atomically apply a batch of integer-grid commands. Every drawing command uses op, optional layer ID, and color (#rrggbb, #rrggbbaa, or transparent). pixel/fill: x,y; line: x,y,x2,y2; rect/ellipse: x,y,width,height, optional filled (default true). Administrative ops: add_layer {id,name}, visibility {layer,visible}, rename_layer {layer,name}, delete_layer {layer}, clear {layer}, rename {name}, palette {colors:[hex colors]}. Coordinates must be inside the canvas. Entire batch fails if any command is invalid. Layer order is bottom to top. Returns a visual preview and new revision.',inputSchema:schema({id,revision:rev,commands:{type:'array',minItems:1,maxItems:5000,items:{type:'object',properties:{op:{type:'string'},layer:{type:'string'},color:{type:'string'},x:{type:'integer'},y:{type:'integer'},x2:{type:'integer'},y2:{type:'integer'},width:{type:'integer'},height:{type:'integer'},filled:{type:'boolean'},id:{type:'string'},name:{type:'string'},visible:{type:'boolean'},colors:{type:'array',items:{type:'string'}}},required:['op'],additionalProperties:false}}},['id','revision','commands'])},
  {name:'undo',description:'Undo one whole drawing batch; revision remains monotonic.',inputSchema:schema({id,revision:rev},['id','revision'])},
  {name:'redo',description:'Redo an undone drawing batch.',inputSchema:schema({id,revision:rev},['id','revision'])},
  {name:'export_png',description:'Export a lossless RGBA PNG at native resolution (default scale 1). Integer scales use nearest-neighbor pixels. Returns the actual image and an editor download path.',inputSchema:schema({id,scale:{type:'integer',minimum:1,maximum:16}},['id']),annotations:{readOnlyHint:true}}
];
export async function callTool(service:ProjectService,name:string,args:Record<string,unknown>={}) {
  try {
    if(name==='list_canvases')return {content:[{type:'text' as const,text:JSON.stringify((await service.store.list()).map(({id,name,width,height,revision,layers})=>({id,name,width,height,revision,layers:layers.map(({id,name,visible})=>({id,name,visible}))})))}]};
    let doc;
    if(name==='create_canvas')doc=await service.create(args.name as string,args.width as number,args.height as number);
    else if(name==='get_canvas'||name==='export_png')doc=(await service.get(args.id as string)).entry.doc;
    else if(name==='paint'||name==='undo'||name==='redo')doc=await service.edit(args.id as string,args.revision as number,name,args.commands as PaintCommand[]);
    else throw new Error('Unknown tool.');
    if(name==='export_png')return {content:[{type:'text' as const,text:JSON.stringify({id:doc.id,width:doc.width,height:doc.height,scale:args.scale||1,download:`/api/pixel/projects/${doc.id}/png?scale=${args.scale||1}`})},{type:'image' as const,mimeType:'image/png',data:encodePng(doc,(args.scale as number)||1).toString('base64')}]};
    const summary={...doc,layers:doc.layers.map(l=>args.include_pixels?l:{id:l.id,name:l.name,visible:l.visible})};
    return {content:[{type:'text' as const,text:JSON.stringify(summary)},{type:'image' as const,mimeType:'image/png',data:encodePng(doc,Math.max(1,Math.min(8,Math.floor(384/Math.max(doc.width,doc.height))))).toString('base64')}]};
  }catch(e){return {isError:true,content:[{type:'text' as const,text:e instanceof Error?e.message:'Operation failed.'}]};}
}
export async function mcpResponse(request:Request,service:ProjectService) {
  if(request.method!=='POST')return new Response('Use POST for JSON-RPC.',{status:405});
  if(Number(request.headers.get('content-length'))>12_000_000)return new Response('Request too large.',{status:413});
  let msg;try{const text=await request.text();if(text.length>12_000_000)return new Response('Request too large.',{status:413});msg=JSON.parse(text);}catch{return Response.json({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}},{status:400});}
  if(!msg||typeof msg!=='object'||Array.isArray(msg))return Response.json({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request'}},{status:400});
  if(msg.id===undefined)return new Response(null,{status:202});
  let result;
  if(msg.method==='server/discover')result={supportedVersions:['2026-07-28','2025-11-25','2025-06-18'],capabilities:{tools:{}}};
  else if(msg.method==='initialize')result={protocolVersion:msg.params?.protocolVersion||'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'pixel-workshop',version:'0.1.0'}};
  else if(msg.method==='ping')result={};
  else if(msg.method==='tools/list')result={tools:toolDefinitions};
  else if(msg.method==='tools/call')result=await callTool(service,msg.params?.name,msg.params?.arguments);
  else return Response.json({jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Method not found'}});
  return Response.json({jsonrpc:'2.0',id:msg.id,result});
}
