import type { ProjectService } from './project-service.ts';
import { createDocument,frameCount, frameView, type PaintCommand } from './pixels.ts';
import {MAX_CANVAS_SIDE} from './canvas-limits.ts';
import {buildCanvasPreview,type CanvasPreviewOptions} from './canvas-preview.ts';
import {referenceFromPng} from './reference-png.ts';
import type {ReferenceAlignment} from './reference.ts';
import { buildSpriteSheet } from './sprite-sheet.ts';
import { EFFECT_KINDS, generateEffectCommands, regenerateEffectCommands, type EffectKind } from './effects.ts';
import { encodePng, encodeRgbaPng } from './png.ts';
import { encodeSvg, encodeRgbaSvg } from './svg.ts';

const id={type:'string',description:'Project ID returned by create_canvas or list_canvases.'};
const rev={type:'integer',minimum:0,description:'Current document revision. Reload with get_canvas after a conflict.'};
const frame={type:'integer',minimum:0,maximum:31};
const schema=(properties:Record<string,unknown>,required:string[]=[])=>({type:'object',properties,required,additionalProperties:false});
export const toolDefinitions=[
  {name:'list_canvases',description:'List canvases, sizes, animation frame counts, layers, and revisions.',
    inputSchema:schema({}),annotations:{readOnlyHint:true}},
  {name:'create_canvas',description:'Create a transparent pixel canvas 1–512 pixels per side, within the document pixel budget.',
    inputSchema:schema({name:{type:'string'},width:{type:'integer',minimum:1,maximum:MAX_CANVAS_SIDE},height:{type:'integer',minimum:1,maximum:MAX_CANVAS_SIDE}},['name','width','height'])},
  {name:'import_reference',description:'Load a PNG tracing reference. Omit id/revision to create a matching blank canvas; supply both to attach to an existing canvas (dimensions must match exactly). Optional alignment explicitly resizes/crops once using nearest-neighbor cell-center sampling: output width/height, source-pixel offsetX/offsetY, source pixels per cell cellWidth/cellHeight. Without alignment, source pixels map 1:1. Reference is locked at canvas origin and excluded from artwork exports. Inspect get_canvas in reference/overlay/artwork views before drawing.',
    inputSchema:schema({id,revision:rev,name:{type:'string',maxLength:80},png_base64:{type:'string',maxLength:10666668},alignment:schema({
      width:{type:'integer',minimum:1,maximum:MAX_CANVAS_SIDE},height:{type:'integer',minimum:1,maximum:MAX_CANVAS_SIDE},
      offsetX:{type:'number'},offsetY:{type:'number'},cellWidth:{type:'number',minimum:.125,maximum:4096},cellHeight:{type:'number',minimum:.125,maximum:4096}
    },['width','height','offsetX','offsetY','cellWidth','cellHeight'])},['png_base64'])},
  {name:'get_canvas',description:'Inspect a frame (default 0). Preview defaults to overlay when a reference exists. view selects artwork, reference alone, or aligned overlay; opacities affect only overlay viewing. scale is integer nearest-neighbor; region is an exact native-coordinate crop for close inspection. include_pixels returns editable artwork and prepared reference pixels. Exports always contain artwork only.',
    inputSchema:schema({id,frame,include_pixels:{type:'boolean'},view:{type:'string',enum:['artwork','overlay','reference']},referenceOpacity:{type:'number',minimum:0,maximum:1},artworkOpacity:{type:'number',minimum:0,maximum:1},grid:{type:'boolean'},scale:{type:'integer',minimum:1,maximum:16},region:schema({x:{type:'integer',minimum:0},y:{type:'integer',minimum:0},width:{type:'integer',minimum:1},height:{type:'integer',minimum:1}},['x','y','width','height'])},['id']),annotations:{readOnlyHint:true}},
  {name:'paint',description:'Atomically apply pixel commands. pixel/fill: x,y; line: x,y,x2,y2; rect/ellipse: x,y,width,height,filled; transform: mode move|copy|flip_horizontal|flip_vertical with x,y,width,height,x2,y2; paste: x,y,width,height,pixels (row-major packed RGBA); stamp: same packed fields, but transparent source pixels preserve destination. Pixel commands accept frame:0..31 (default 0) and layer. Animation ops: frame_add {source_frame?,blank?}, frame_delete {frame:1..31}, set_fps {fps:1..30}, clip_set {name,from,to,fps,mode:loop|once|pingpong}, clip_delete {name}. FX layer metadata: effect_recipe {layer,recipe:{kind,seed,ink,speed,opacity,drift}} or effect_detach {layer}. Layer operations are shared across all frames: add_layer {id,name}, duplicate_layer {layer,id,name} (frozen hidden backup), visibility {layer,visible}, rename_layer {layer,name}, delete_layer {layer}, clear {layer,frame?}, rename {name}, palette {colors}. UI ops: ui_set {ui} sets or clears native slices and named state/icon frames; text_set {layer,text} draws an editable Tiny Caps text layer; text_detach {layer} retains pixels; palette_remap {fromColor,toColor} recolors all frames and layers while preserving opacity. All edits are one undoable batch and require the current revision.',
    inputSchema:schema({id,revision:rev,commands:{type:'array',minItems:1,maxItems:5000,items:{type:'object',
      properties:{op:{type:'string'},frame,source_frame:frame,fps:{type:'integer',minimum:1,maximum:30},blank:{type:'boolean'},
        layer:{type:'string'},color:{type:'string'},x:{type:'integer'},y:{type:'integer'},x2:{type:'integer'},y2:{type:'integer'},
        width:{type:'integer'},height:{type:'integer'},filled:{type:'boolean'},
        mode:{type:'string',enum:['move','copy','flip_horizontal','flip_vertical','loop','once','pingpong']},
        from:frame,to:frame,recipe:{type:'object'},ui:{type:['object','null']},text:{type:'object'},fromColor:{type:'string'},toColor:{type:'string'},
        reference:{type:['object','null'],description:'reference_set: prepared {name,width,height,pixels} matching canvas dimensions, or null to remove (undoable).'},
        pixels:{type:'array',maxItems:MAX_CANVAS_SIDE**2,items:{type:'integer',minimum:0,maximum:4294967295}},
        id:{type:'string'},name:{type:'string'},visible:{type:'boolean'},colors:{type:'array',items:{type:'string'}}},
      required:['op'],additionalProperties:false}}},['id','revision','commands'])},
  {name:'undo',description:'Undo one whole edit batch; revision remains monotonic.',
    inputSchema:schema({id,revision:rev},['id','revision'])},
  {name:'redo',description:'Redo one undone edit batch.',
    inputSchema:schema({id,revision:rev},['id','revision'])},
  {name:'export_png',description:'Export a RGBA PNG of an animation frame (default frame 0). Integer nearest-neighbor scale.',
    inputSchema:schema({id,frame,scale:{type:'integer',minimum:1,maximum:16}},['id']),annotations:{readOnlyHint:true}},
  {name:'export_svg',description:'Export one animation frame (default 0) as real vector pixel rectangles with transparency. Returns SVG text as an embedded resource. Scale sets display size; the native viewBox stays unchanged.',
    inputSchema:schema({id,frame,scale:{type:'integer',minimum:1,maximum:16}},['id']),annotations:{readOnlyHint:true}},
  {name:'export_sprite_sheet',description:'Export a composited PNG (default) or SVG sprite sheet and matching JSON atlas for all frames. SVG is a static sheet of vector pixels.',
    inputSchema:schema({id,columns:{type:'integer',minimum:1,maximum:32},format:{type:'string',enum:['png','svg']}},['id']),annotations:{readOnlyHint:true}},
  {name:'generate_effect',description:'Generate a seeded, editable procedural VFX layer and save a recipe so it can be regenerated.',
    inputSchema:schema({id,revision:rev,kind:{type:'string',enum:[...EFFECT_KINDS]},
      seed:{type:'integer',minimum:0,maximum:2147483647},ink:{type:'string'},
      speed:{type:'number',minimum:0.25,maximum:3},opacity:{type:'number',minimum:0.1,maximum:1},
      drift:{type:'number',minimum:-3,maximum:3}},['id','revision','kind','seed','ink'])},
  {name:'regenerate_effect',description:'Regenerate only a saved FX layer from the stored or supplied recipe, preserving other layers and named animation clips. Manually painted pixels inside the FX layer will be overwritten.',
    inputSchema:schema({id,revision:rev,layer:{type:'string'},kind:{type:'string',enum:[...EFFECT_KINDS]},
      seed:{type:'integer',minimum:0,maximum:2147483647},ink:{type:'string'},
      speed:{type:'number',minimum:0.25,maximum:3},opacity:{type:'number',minimum:0.1,maximum:1},
      drift:{type:'number',minimum:-3,maximum:3}},['id','revision','layer'])}
];
export async function callTool(service:ProjectService,name:string,args:Record<string,unknown>={}) {
  try {
    if(name==='list_canvases')return {content:[{type:'text' as const,
      text:JSON.stringify((await service.store.list()).map(d=>({id:d.id,name:d.name,width:d.width,height:d.height,
        revision:d.revision,layers:d.layers.map(({id,name,visible})=>({id,name,visible})),frames:frameCount(d)})))}]};
    let doc;
    if(name==='import_reference'){
      if((args.id===undefined)!==(args.revision===undefined))throw new Error('Supply both id and revision, or omit both to create a matching canvas.');
      const reference=referenceFromPng(args.png_base64,String(args.name??'Tracing reference'),args.alignment as ReferenceAlignment|undefined);
      doc=args.id===undefined
        ?await service.create(reference.name,reference.width,reference.height,{...createDocument(reference.name,reference.width,reference.height),reference})
        :await service.edit(args.id as string,args.revision as number,'paint',[{op:'reference_set',reference}]);
    }
    else if(name==='create_canvas')doc=await service.create(args.name as string,args.width as number,args.height as number);
    else if(['get_canvas','export_png','export_svg','export_sprite_sheet','generate_effect','regenerate_effect'].includes(name)) {
      const original=(await service.get(args.id as string)).entry.doc;
      if(name==='generate_effect'){
        doc=await service.edit(args.id as string,args.revision as number,'paint',
          generateEffectCommands(original,{kind:args.kind as EffectKind,seed:args.seed as number,ink:args.ink as string,
            speed:args.speed as number|undefined,opacity:args.opacity as number|undefined,drift:args.drift as number|undefined}));
      }else if(name==='regenerate_effect'){
        const layer=original.layers.find(l=>l.id===args.layer);
        if(!layer?.effect)throw new Error('Layer has no saved procedural effect.');
        doc=await service.edit(args.id as string,args.revision as number,'paint',
          regenerateEffectCommands(original,layer.id,{
            kind:(args.kind??layer.effect.kind) as EffectKind,seed:(args.seed??layer.effect.seed) as number,
            ink:(args.ink??layer.effect.ink) as string,
            speed:(args.speed??layer.effect.speed) as number,
            opacity:(args.opacity??layer.effect.opacity) as number,
            drift:(args.drift??layer.effect.drift) as number,
          }));
      }else doc=original;
    }
    else if(name==='paint'||name==='undo'||name==='redo')
      doc=await service.edit(args.id as string,args.revision as number,name,args.commands as PaintCommand[]);
    else throw new Error('Unknown tool.');

    if(name==='export_png'){
      const index=(args.frame as number)??0,scale=(args.scale as number)||1,view=frameView(doc,index);
      return {content:[{type:'text' as const,text:JSON.stringify({id:doc.id,width:doc.width,height:doc.height,
        frame:index,scale,download:`/api/pixel/projects/${doc.id}/png?scale=${scale}&frame=${index}`})},
        {type:'image' as const,mimeType:'image/png',data:encodePng(view,scale).toString('base64')}]};
    }
    if(name==='export_svg'){
      const index=(args.frame as number)??0,scale=(args.scale as number)??1;
      const svg=encodeSvg(frameView(doc,index),scale);
      return {content:[{type:'text' as const,text:JSON.stringify({id:doc.id,width:doc.width,height:doc.height,
        frame:index,scale,download:`/api/pixel/projects/${doc.id}/svg?scale=${scale}&frame=${index}`})},
        {type:'resource' as const,resource:{uri:`pixel-workshop://projects/${encodeURIComponent(doc.id)}/frame-${index}.svg`,mimeType:'image/svg+xml',text:svg}}]};
    }
    if(name==='export_sprite_sheet'){
      const sheet=buildSpriteSheet(doc,args.columns as number|undefined,(args.format??'png') as 'png'|'svg');
      if(args.format==='svg')return {content:[{type:'text' as const,text:JSON.stringify(sheet.atlas)},
        {type:'resource' as const,resource:{uri:`pixel-workshop://projects/${encodeURIComponent(doc.id)}/sheet.svg`,mimeType:'image/svg+xml',text:encodeRgbaSvg(sheet.bytes,sheet.width,sheet.height)}}]};
      return {content:[{type:'text' as const,text:JSON.stringify(sheet.atlas)},
        {type:'image' as const,mimeType:'image/png',data:encodeRgbaPng(sheet.bytes,sheet.width,sheet.height).toString('base64')}]};
    }
    const summary={...doc,reference:doc.reference?(args.include_pixels?doc.reference:{...doc.reference,pixels:undefined}):undefined,
      layers:doc.layers.map(l=>args.include_pixels?l:{id:l.id,name:l.name,visible:l.visible,...(l.effect?{effect:l.effect}:{}),...(l.text?{text:l.text}:{})}),
      animation:doc.animation?{fps:doc.animation.fps,
        frames:doc.animation.frames.map(f=>args.include_pixels?f:{id:f.id})}:undefined,
      frameCount:frameCount(doc)};
    const preview=frameView(doc,(args.frame as number)??0);
    const rendered=buildCanvasPreview(preview,{view:args.view,referenceOpacity:args.referenceOpacity,artworkOpacity:args.artworkOpacity,grid:args.grid,region:args.region,
      scale:args.scale??Math.max(1,Math.min(8,Math.floor(384/Math.max(doc.width,doc.height))))} as CanvasPreviewOptions);
    return {content:[{type:'text' as const,text:JSON.stringify({...summary,preview:{view:args.view??(doc.reference?'overlay':'artwork'),scale:rendered.scale,region:rendered.region,origin:{x:0,y:0},referenceScale:1}})},
      {type:'image' as const,mimeType:'image/png',
        data:encodeRgbaPng(rendered.bytes,rendered.width,rendered.height).toString('base64')}]};
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
  else if(msg.method==='initialize')result={protocolVersion:msg.params?.protocolVersion||'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'pixel-workshop',version:'0.2.0'}};
  else if(msg.method==='ping')result={};
  else if(msg.method==='tools/list')result={tools:toolDefinitions};
  else if(msg.method==='tools/call')result=await callTool(service,msg.params?.name,msg.params?.arguments);
  else return Response.json({jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Method not found'}});
  return Response.json({jsonrpc:'2.0',id:msg.id,result});
}
