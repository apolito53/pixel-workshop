import type { ProjectService } from './project-service.ts';
import { applyCommands,createCompactDocument,createStackDocument,MAX_STACK_SLICES,frameCount,requireInt,type StackSettings, frameView, documentCells, MAX_ANIMATION_CELLS, MAX_ANIMATION_FRAMES, type PaintCommand, type PixelDocument } from './pixels.ts';
import {denseProject,denseProjectCells,packProject} from './project-codec.ts';
import {MAX_CANVAS_SIDE} from './canvas-limits.ts';
import {createSpriteStackRenderer,resolveStackView} from './sprite-stack-renderer.ts';
import {planStackPages,encodeStackPage,importStackPages,readStackPages,MAX_STACK_ZIP_BYTES} from './sprite-stack-pages.ts';
import {buildCanvasPreview,type CanvasPreviewOptions} from './canvas-preview.ts';
import {referenceFromPng} from './reference-png.ts';
import type {ReferenceAlignment} from './reference.ts';
import {referenceCopyCommands,compareReference,referencePreparation} from './reference-workflow.ts';
import { buildSpriteSheet } from './sprite-sheet.ts';
import { EFFECT_KINDS, generateEffectCommands, regenerateEffectCommands, type EffectKind } from './effects.ts';
import { encodePng, encodeRgbaPng } from './png.ts';
import { encodeSvg, encodeRgbaSvg } from './svg.ts';
import {FINISHING_CONTROLS,MAX_FINISHING_DIMENSION,normalizeFinishingSettings} from './image-finishing.ts';
import {prepareFinishingPng,renderFinishingPng,MAX_FINISHING_PNG_BASE64} from './finishing-png.ts';
import {FINISHING_PROJECT_FORMAT,FINISHING_RECIPE_FORMAT,readFinishingProject,type FinishingProject} from './finishing-project.ts';

const id={type:'string',description:'Project ID returned by create_canvas or list_canvases.'};
const rev={type:'integer',minimum:0,description:'Current document revision. Reload with get_canvas after a conflict.'};
const frame={type:'integer',minimum:0,maximum:MAX_STACK_SLICES-1,description:'Zero-based frame index, or elevation index on a sprite stack.'};
const schema=(properties:Record<string,unknown>,required:string[]=[])=>({type:'object',properties,required,additionalProperties:false});
const slice={type:'integer',minimum:0,maximum:MAX_STACK_SLICES-1,description:'Elevation index, numbered from the lowest slice.'};
const camera={
  yaw:{type:'number',description:'Rotation about the vertical axis, in degrees.'},pitch:{type:'number',minimum:-90,maximum:90},
  zoom:{type:'number',minimum:0.1,maximum:8},spread:{type:'number',minimum:0,maximum:1},
};
const origin={type:'array',items:{type:'number'},minItems:2,maxItems:2};
const viewSettings={...schema(camera,['yaw','pitch','zoom','spread']),type:['object','null']};
const stackParameters={origin,zMin:{type:'number'},sliceHeight:{type:'number'},view:viewSettings};
const drawingOps=new Set(['pixel','line','rect','ellipse','fill','paste','stamp','transform','clear','replace_cel','hold_cel']);
const maxStackBase64=4*Math.ceil(MAX_STACK_ZIP_BYTES/3);
function decodeStackAsset(data:unknown,maxBytes:number){
  if(typeof data!=='string'||!data.length||data.length>4*Math.ceil(maxBytes/3)||
    data.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(data))
    throw new Error('Send stack files as plain base64 within the package byte limit.');
  const bytes=Buffer.from(data,'base64');
  if(bytes.length>maxBytes)throw new Error('Stack package exceeds the byte limit.');
  return bytes;
}
function importMcpStack(args:Record<string,unknown>){
  if(args.zip_base64!==undefined){
    if(args.manifest!==undefined||args.pages!==undefined)throw new Error('Supply either a ZIP or a manifest and its PNG pages.');
    return importStackPages(decodeStackAsset(args.zip_base64,MAX_STACK_ZIP_BYTES));
  }
  if(!args.manifest||!Array.isArray(args.pages)||!args.pages.length||args.pages.length>MAX_STACK_SLICES)
    throw new Error('Supply an exported stack ZIP or a manifest and its named PNG pages.');
  const files=new Map<string,Uint8Array>();
  let remaining=MAX_STACK_ZIP_BYTES;
  for(const page of args.pages){
    if(!page||typeof page.file!=='string'||!page.file.endsWith('.png')||files.has(page.file))
      throw new Error('Each page needs a unique PNG filename matching its manifest.');
    const bytes=decodeStackAsset(page.png_base64,remaining);
    files.set(page.file,bytes);
    remaining-=bytes.length;
  }
  return readStackPages(args.manifest,file=>files.get(file));
}
const finishingAdjustments=schema(Object.fromEntries(FINISHING_CONTROLS.map(control=>[control.key,{type:'number',minimum:control.min,maximum:control.max,description:`${control.label}; neutral ${control.defaultValue}.`}])));
const finishingCrop={...schema({x:{type:'integer',minimum:0,maximum:MAX_FINISHING_DIMENSION-1},y:{type:'integer',minimum:0,maximum:MAX_FINISHING_DIMENSION-1},width:{type:'integer',minimum:1,maximum:MAX_FINISHING_DIMENSION},height:{type:'integer',minimum:1,maximum:MAX_FINISHING_DIMENSION}},['x','y','width','height']),type:['object','null']};
const finishingProject=schema({format:{type:'string',enum:[FINISHING_PROJECT_FORMAT]},name:{type:'string',maxLength:160},
  source:schema({name:{type:'string',maxLength:160},dataUrl:{type:'string',maxLength:MAX_FINISHING_PNG_BASE64+22},width:{type:'integer',minimum:1,maximum:MAX_FINISHING_DIMENSION},height:{type:'integer',minimum:1,maximum:MAX_FINISHING_DIMENSION}},['dataUrl','width','height']),
  recipe:schema({format:{type:'string',enum:[FINISHING_RECIPE_FORMAT]},adjustments:finishingAdjustments,crop:finishingCrop},['format','adjustments','crop']),
},['format','source','recipe']);
export const toolDefinitions=[
  {name:'finish_image',description:'Apply deterministic color, light and detail edits at full resolution. Supply exactly one of png_base64 (original source) or project (a .finish.json object from Image Finishing). output defaults to image; project returns an editable .finish.json resource with the original PNG and cumulative recipe, and both returns both. Projects reopen in the browser and can be passed back to this tool. For project inputs, supplied adjustment keys replace those saved values and omitted keys retain them; crop:null clears a crop. Always rerender the immutable ORIGINAL with cumulative settings, never feed the previous flattened export back as the source. No saved canvas is created or changed. Accepts 24 megapixels, 16384 pixels per side and 8 MB compressed PNG; hosted JSON-RPC limit 12 MB including base64. Use 8-bit or indexed sRGB PNG without embedded ICC profiles. No silent resizing. Crop uses integer original-image coordinates. Defaults: exposure 0 stops; gamma 1; other controls 0. Browser Image Finishing accepts larger files and additional formats.',
    inputSchema:schema({png_base64:{type:'string',maxLength:MAX_FINISHING_PNG_BASE64},project:finishingProject,
      name:{type:'string',maxLength:160},adjustments:finishingAdjustments,crop:finishingCrop,
      output:{type:'string',enum:['image','project','both'],description:'Choose project to return an editable source-and-recipe file without also transferring a flattened PNG.'},
    }),annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
  {name:'list_canvases',description:'List canvases, sizes, animation frame counts, layers, and revisions.',
    inputSchema:schema({}),annotations:{readOnlyHint:true}},
  {name:'import_project',description:'Create a new editable canvas from a native Pixel Workshop JSON project. Accepts dense, cropped, and packed files, including sprite stacks. Omit any existing workspace ID or revision; importing always saves a new project at revision zero. The compact response contains metadata and a preview. For large sparse stacks, send the packed native file rather than expanded pixels.',
    inputSchema:schema({project:{type:'object',description:'The complete native .pixel.json object, preserving its format and cropped/pooled cels.'}},['project'])},
  {name:'import_stack_pages',description:'Create a new editable sprite stack from a Workshop slice pages ZIP (zip_base64), or the export_stack_pages manifest and all its named PNG pages. A PNG-only import places the composited slices on the base layer. An unmodified Workshop ZIP also restores its editable native layers. Send plain base64 without data URLs. Hosted JSON-RPC requests have a 12 MB body limit.',
    inputSchema:schema({zip_base64:{type:'string',maxLength:maxStackBase64},manifest:{type:'object'},
      pages:{type:'array',minItems:1,maxItems:MAX_STACK_SLICES,items:schema({file:{type:'string'},png_base64:{type:'string',maxLength:maxStackBase64}},['file','png_base64'])}})},
  {name:'preview_stack',description:'Render the assembled sprite stack as a transparent PNG with the same orthographic camera, slice ordering and pixel renderer as the browser. Defaults to the saved view. Override any camera value independently. Positive pitch looks down; negative pitch looks up. Optional pick inspects a pixel in output coordinates and reports the visible artwork slice, layer and source pixel.',
    inputSchema:schema({id,width:{type:'integer',minimum:1,maximum:1024},height:{type:'integer',minimum:1,maximum:1024},...camera,
      pick:schema({x:{type:'integer',minimum:0},y:{type:'integer',minimum:0}},['x','y'])},['id']),annotations:{readOnlyHint:true}},
  {name:'export_stack_pages',description:'Export game-ready bottom-to-top slice sheets. Omit page for a compact JSON atlas listing page filenames, dimensions, and slice ranges. Include zero-based page to return that lossless transparent PNG. Reuse the same page settings for subsequent calls; pass revision from the manifest response to ensure a consistent multi-call export. Guide and camera settings are excluded from page pixels.',
    inputSchema:schema({id,revision:rev,page:{type:'integer',minimum:0,maximum:MAX_STACK_SLICES-1},
      columns:{type:'integer',minimum:1},maxPageWidth:{type:'integer',minimum:1,maximum:4096},maxPageHeight:{type:'integer',minimum:1,maximum:4096}},['id']),annotations:{readOnlyHint:true}},
  {name:'create_canvas',description:`Create a transparent pixel canvas 1–${MAX_CANVAS_SIDE} pixels per side. Supply slices (1–${MAX_STACK_SLICES}) to create an editable sprite stack. The width and height specify each horizontal slice; origin defaults to the middle pixel, zMin to 0 and sliceHeight to 1. Existing canvas creation remains the default.`,
    inputSchema:schema({name:{type:'string'},width:{type:'integer',minimum:1,maximum:MAX_CANVAS_SIDE},height:{type:'integer',minimum:1,maximum:MAX_CANVAS_SIDE},slices:{type:'integer',minimum:1,maximum:MAX_STACK_SLICES},...stackParameters},['name','width','height'])},
  {name:'import_reference',description:`Upload a PNG into a matching canvas. Omit id/revision for a new project; supply both to attach to an existing canvas of exactly matching prepared dimensions. sizing defaults to fit: keep native pixels up to ${MAX_CANVAS_SIDE} per side, otherwise resize uniformly once with nearest-neighbor sampling. sizing:native rejects oversized sources. Optional alignment overrides default fitting; use cellWidth/cellHeight:1 and offsets to extract an exact source region. Do not combine explicit sizing and alignment. copy_to_layer:true also makes editable artwork immediately (base layer for a new project, a new layer for an existing one). Response reports source/prepared dimensions, resampling and copy verification without pixel arrays. Reference itself is excluded from exports.`,
    inputSchema:schema({id,revision:rev,name:{type:'string',maxLength:80},png_base64:{type:'string',maxLength:10666668},sizing:{type:'string',enum:['fit','native']},copy_to_layer:{type:'boolean'},alignment:schema({
      width:{type:'integer',minimum:1,maximum:MAX_CANVAS_SIDE},height:{type:'integer',minimum:1,maximum:MAX_CANVAS_SIDE},
      offsetX:{type:'number'},offsetY:{type:'number'},cellWidth:{type:'number',minimum:.125,maximum:4096},cellHeight:{type:'number',minimum:.125,maximum:4096}
    },['width','height','offsetX','offsetY','cellWidth','cellHeight'])},['png_base64'])},
  {name:'copy_reference',description:'Copy all prepared reference pixels exactly into editable artwork on the server, without sending pixel arrays. Defaults to a new layer, leaving existing layers intact. Specify layer to replace that entire layer cel, including transparent pixels; procedural recipe/text metadata for the target is detached as needed. frame defaults to 0. One revision-guarded, undoable edit. Returns target layer ID and exact/visible pixel comparison against the prepared reference, plus an artwork preview.',
    inputSchema:schema({id,revision:rev,layer:{type:'string'},name:{type:'string',maxLength:60,description:'Name for the new layer; omit when replacing an existing layer.'},frame},['id','revision'])},
  {name:'compare_reference',description:'Read-only pixel verification of artwork against its prepared reference, without returning pixel arrays. Specify layer to compare its raw RGBA pixels (even if hidden); omit it to compare visible composited artwork as exported. Reports exact matches, visible mismatches, first differing coordinates, and whether the source was resampled. RGB under zero alpha is ignored only by visibleMatch. frame defaults to 0.',
    inputSchema:schema({id,layer:{type:'string'},frame},['id']),annotations:{readOnlyHint:true}},
  {name:'get_canvas',description:'Inspect a frame or a top-down stack slice (default 0). Set slice to the zero-based elevation of a stack; frame also accepts this index. Preview defaults to overlay when a reference exists. view selects artwork, reference alone, or aligned overlay; opacities affect only overlay viewing. scale is integer nearest-neighbor; region is an exact native-coordinate crop for close inspection. include_pixels returns editable artwork and prepared reference pixels. When the expanded timeline exceeds 4,194,304 pixel cells, packedProject contains the lossless indexed project and the regular layer/frame lists contain metadata. Exports always contain artwork only.',
    inputSchema:schema({id,frame:slice,slice,include_pixels:{type:'boolean'},view:{type:'string',enum:['artwork','overlay','reference']},referenceOpacity:{type:'number',minimum:0,maximum:1},artworkOpacity:{type:'number',minimum:0,maximum:1},grid:{type:'boolean'},scale:{type:'integer',minimum:1,maximum:16},region:schema({x:{type:'integer',minimum:0},y:{type:'integer',minimum:0},width:{type:'integer',minimum:1},height:{type:'integer',minimum:1}},['x','y','width','height'])},['id']),annotations:{readOnlyHint:true}},
  {name:'paint',description:`Atomically apply pixel commands. pixel/fill: x,y; line: x,y,x2,y2; rect/ellipse: x,y,width,height,filled; transform: mode move|copy|flip_horizontal|flip_vertical with x,y,width,height,x2,y2; paste: x,y,width,height,pixels (row-major packed RGBA); replace_cel: replace the entire drawing with the given rectangle and clear everything outside it; stamp: same packed fields, but transparent source pixels preserve destination. Pixel commands accept frame:0..${MAX_ANIMATION_FRAMES-1} (default 0) and layer. Animation ops: frame_add {source_frame?,blank?}, hold_cel {layer,frame,source_frame} shares a pose until edited, frame_delete {frame:1..${MAX_ANIMATION_FRAMES-1}}, set_fps {fps:1..30}, clip_set {name,from,to,fps,mode:loop|once|pingpong}, clip_delete {name}. FX layer metadata: effect_recipe {layer,recipe:{kind,seed,ink,speed,opacity,drift}} or effect_detach {layer}. Layer operations are shared across all frames: add_layer {id,name}, duplicate_layer {layer,id,name} (frozen hidden backup), visibility {layer,visible}, rename_layer {layer,name}, move_layer {layer,index} (final bottom-to-top index), set_layer_group {layer,group} (empty string ungroups), delete_layer {layer}, clear {layer,frame?}, rename {name}, palette {colors}. UI ops: ui_set {ui} sets or clears native slices and named state/icon frames; text_set {layer,text} draws an editable Tiny Caps text layer; text_detach {layer} retains pixels; palette_remap {fromColor,toColor} recolors all frames and layers while preserving opacity. Send wind_bake as the only command in a batch: {op:"wind_bake",layer,pivot_x,pivot_y,degrees?,delay?,source_frame?,frames?}. It bakes a pinned rotation across the layer using the selected source pose. delay is in frames, degrees is >0 to 30, frames is 2–96 on a still and matches the timeline on an animation. Sprite stack commands: stack_settings {origin?,zMin?,sliceHeight?,view?} converts an existing compatible canvas or adjusts the stack. slice_insert {index,source_slice?} adds a blank or duplicated slice, slice_delete {index} removes it, slice_move {from,to} reorders elevations, and stack_disable returns to a conventional timeline if supported. On a stack, top-level slice selects the default target for drawing commands. Explicit command.frame targets another elevation, while layer IDs and layer visibility remain shared. All edits are one undoable batch and require the current revision.`,
    inputSchema:schema({id,revision:rev,slice,commands:{type:'array',minItems:1,maxItems:5000,items:{type:'object',
      properties:{op:{type:'string'},frame:slice,source_frame:slice,source_slice:slice,index:{type:'integer',minimum:0,maximum:MAX_STACK_SLICES-1},...stackParameters,fps:{type:'integer',minimum:1,maximum:30},blank:{type:'boolean'},
        layer:{type:'string'},color:{type:'string'},x:{type:'integer'},y:{type:'integer'},x2:{type:'integer'},y2:{type:'integer'},
        width:{type:'integer'},height:{type:'integer'},filled:{type:'boolean'},
        mode:{type:'string',enum:['move','copy','flip_horizontal','flip_vertical','loop','once','pingpong']},
        from:slice,to:slice,recipe:{type:'object'},ui:{type:['object','null']},text:{type:'object'},fromColor:{type:'string'},toColor:{type:'string'},
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
    inputSchema:schema({id,columns:{type:'integer',minimum:1,maximum:MAX_ANIMATION_FRAMES},format:{type:'string',enum:['png','svg']}},['id']),annotations:{readOnlyHint:true}},
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
    if(name==='finish_image'){
      if((args.png_base64===undefined)===(args.project===undefined))throw new Error('Supply exactly one of png_base64 or an editable finishing project.');
      const output=args.output??'image';if(!['image','project','both'].includes(output as string))throw new Error('Choose image, project, or both as the finishing output.');
      if(args.name!==undefined&&(typeof args.name!=='string'||!args.name.trim()||args.name.length>160))throw new Error('Use an image name from 1 to 160 characters.');
      const project=args.project===undefined?undefined:readFinishingProject(args.project);
      if(project&&!project.source.dataUrl.startsWith('data:image/png;base64,'))throw new Error('MCP finishing currently reads PNG-based projects. Convert this JPEG/WebP source to an sRGB PNG, or continue editing it in the browser.');
      if(args.adjustments!==undefined)normalizeFinishingSettings(args.adjustments);
      const original=project?project.source.dataUrl.slice(22):args.png_base64;
      const adjustments=project?{...project.recipe.adjustments,...(args.adjustments as Record<string,number>|undefined)}:args.adjustments;
      const crop=args.crop===undefined?project?.recipe.crop:args.crop;
      const prepared=prepareFinishingPng(original,adjustments,crop);
      if(project&&(project.source.width!==prepared.source.width||project.source.height!==prepared.source.height))throw new Error('The project dimensions do not match its original PNG.');
      const rendered=output==='project'?null:renderFinishingPng(prepared);
      const title=(args.name as string|undefined)??project?.name??'Finished image';
      const filename=(title.replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'').slice(0,100)||'finished-image');
      const editable:FinishingProject={format:FINISHING_PROJECT_FORMAT,name:title,
        source:{name:project?.source.name??title,...prepared.source,dataUrl:'data:image/png;base64,'+original},recipe:prepared.recipe};
      return {content:[{type:'text' as const,text:JSON.stringify({
        source:prepared.source,width:prepared.bounds.width,height:prepared.bounds.height,
        ...(rendered?{mimeType:'image/png',byteLength:rendered.bytes.byteLength}:{}),resampled:false,stored:false,recipe:prepared.recipe,
        ...(output!=='project'?{imageFile:filename+'.png'}:{}),...(output!=='image'?{projectFile:filename+'.finish.json'}:{}),
      })},...(rendered?[{type:'image' as const,mimeType:'image/png',data:rendered.bytes.toString('base64')}]:[]),
      ...(output!=='image'?[{type:'resource' as const,resource:{uri:`pixel-workshop://finishing/${filename}.finish.json`,mimeType:'application/json',text:JSON.stringify(editable)}}]:[])]};
    }
    if(name==='list_canvases')return {content:[{type:'text' as const,
      text:JSON.stringify((await service.listSummaries()).map(d=>({id:d.id,name:d.name,width:d.width,height:d.height,
        revision:d.revision,layers:d.layers,frames:d.frames,...(d.stack?{stack:d.stack,slices:d.frames}:{})})))}]};
    let doc;
    let copy:{layer:string;frame:number}|undefined;
    if(name==='import_project'){
      if(!args.project||typeof args.project!=='object'||Array.isArray(args.project))throw new Error('Supply a complete native .pixel.json project object.');
      if(args.id!==undefined||args.revision!==undefined)throw new Error('Import creates a new project. Omit id and revision.');
      doc=await service.create('',0,0,args.project);
    }
    else if(name==='import_stack_pages'){
      if(args.id!==undefined||args.revision!==undefined)throw new Error('Import creates a new project. Omit id and revision.');
      const imported=importMcpStack(args);
      doc=await service.create(imported.name,imported.width,imported.height,imported);
    }
    else if(name==='import_reference'){
      if((args.id===undefined)!==(args.revision===undefined))throw new Error('Supply both id and revision, or omit both to create a matching canvas.');
      if(args.sizing!==undefined&&args.alignment!==undefined)throw new Error('Choose sizing or explicit alignment, not both.');
      if(args.copy_to_layer!==undefined&&typeof args.copy_to_layer!=='boolean')throw new Error('copy_to_layer must be true or false.');
      const reference=referenceFromPng(args.png_base64,String(args.name??'Tracing reference'),args.alignment as ReferenceAlignment|undefined,(args.sizing??'fit') as 'fit'|'native');
      if(args.id===undefined){
        let imported:PixelDocument={...createCompactDocument(reference.name,reference.width,reference.height),reference};
        if(args.copy_to_layer===true){
          const planned=referenceCopyCommands(imported,{layer:imported.layers[0].id});
          imported={...applyCommands(imported,planned.commands),reference};copy=planned;
        }
        doc=await service.create(reference.name,reference.width,reference.height,imported);
      }else{
        const commands:PaintCommand[]=[{op:'reference_set',reference}];
        if(args.copy_to_layer===true){
          const original=(await service.get(args.id as string)).entry.doc;
          const planned=referenceCopyCommands({...original,reference});commands.push(...planned.commands);copy=planned;
        }
        doc=await service.edit(args.id as string,args.revision as number,'paint',commands);
      }
    }
    else if(name==='copy_reference'||name==='compare_reference'){
      const original=(await service.get(args.id as string)).entry.doc;
      if(name==='compare_reference')return {content:[{type:'text' as const,text:JSON.stringify({id:original.id,revision:original.revision,...compareReference(original,(args.frame??0) as number,args.layer as string|undefined)})}]};
      const planned=referenceCopyCommands(original,args);copy=planned;
      doc=await service.edit(args.id as string,args.revision as number,'paint',planned.commands);
    }
    else if(name==='create_canvas'){
      const width=args.width as number,height=args.height as number,title=args.name as string;
      const options:Partial<StackSettings>={};
      if(args.origin!==undefined)options.origin=args.origin as [number,number];
      if(args.zMin!==undefined)options.zMin=args.zMin as number;
      if(args.sliceHeight!==undefined)options.sliceHeight=args.sliceHeight as number;
      if(args.view!=null)options.view=args.view as StackSettings['view'];
      if(args.slices===undefined && Object.keys(options).length)throw new Error('Supply slices to create a stack with spatial settings.');
      const blank=args.slices===undefined?undefined:createStackDocument(title,width,height,args.slices as number,options);
      doc=await service.create(title,width,height,blank);
    }
    else if(name==='preview_stack'||name==='export_stack_pages'){
      const source=(await service.get(args.id as string)).entry.doc;
      if(!source.stack)throw new Error('This canvas is not a sprite stack. Use paint with stack_settings to convert compatible artwork.');
      if(name==='export_stack_pages'){
        if(args.revision!==undefined&&args.revision!==source.revision)throw new Error('This project changed. Request its current page manifest before exporting.');
        const manifest=planStackPages(source,{columns:args.columns as number|undefined,maxPageWidth:args.maxPageWidth as number|undefined,maxPageHeight:args.maxPageHeight as number|undefined});
        if(args.page===undefined)return {content:[{type:'text' as const,text:JSON.stringify({id:source.id,revision:source.revision,manifest})}]};
        const page=requireInt(args.page,0,manifest.pages.length-1,'page');
        const bytes=encodeStackPage(source,manifest,page);
        return {content:[{type:'text' as const,text:JSON.stringify({id:source.id,revision:source.revision,page,...manifest.pages[page]})},
          {type:'image' as const,mimeType:'image/png',data:Buffer.from(bytes).toString('base64')}]};
      }
      const width=requireInt(args.width??240,1,1024,'width'),height=requireInt(args.height??180,1,1024,'height');
      const cameraSettings=resolveStackView(source,{
        yaw:args.yaw as number|undefined,pitch:args.pitch as number|undefined,
        zoom:args.zoom as number|undefined,spread:args.spread as number|undefined,
      });
      const result=createSpriteStackRenderer().render(source,{width,height,...cameraSettings});
      const at=args.pick as {x:number;y:number}|undefined;
      const hit=at===undefined?undefined:result.pick(requireInt(at?.x,0,width-1,'pick.x'),requireInt(at?.y,0,height-1,'pick.y'));
      return {content:[{type:'text' as const,text:JSON.stringify({id:source.id,revision:source.revision,width,height,slices:frameCount(source),...cameraSettings,...(at===undefined?{}:{hit})})},
        {type:'image' as const,mimeType:'image/png',data:encodeRgbaPng(new Uint8Array(result.rgba.buffer,result.rgba.byteOffset,result.rgba.byteLength),width,height).toString('base64')}]};
    }
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
    else if(name==='paint'||name==='undo'||name==='redo'){
      let commands=args.commands as PaintCommand[];
      if(name==='paint'&&args.slice!==undefined){
        const original=(await service.get(args.id as string)).entry.doc;
        if(!original.stack)throw new Error('Only sprite stacks accept slice.');
        const index=requireInt(args.slice,0,frameCount(original)-1,'slice');
        if(!Array.isArray(commands))throw new Error('Supply a batch of drawing commands.');
        commands=commands.map(command=>drawingOps.has(command?.op)&&command.frame===undefined?{...command,frame:index}:command);
      }
      doc=await service.edit(args.id as string,args.revision as number,name,commands);
    }
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
    if(name==='get_canvas'&&args.slice!==undefined){
      if(!doc.stack)throw new Error('Only sprite stacks accept slice.');
      if(args.frame!==undefined&&args.frame!==args.slice)throw new Error('frame and slice select different elevations.');
    }
    const packedPixels=args.include_pixels===true && denseProjectCells(doc)>MAX_ANIMATION_CELLS;
    const densePixels=args.include_pixels===true && !packedPixels;
    const representation=densePixels?denseProject(doc):doc;
    const summary={...doc,...(packedPixels?{packedProject:packProject(doc)}:{}),
      pixelCells:{used:documentCells(doc),limit:MAX_ANIMATION_CELLS},reference:doc.reference?(densePixels?doc.reference:{...doc.reference,pixels:undefined}):undefined,
      ...(doc.reference?{referencePreparation:referencePreparation(doc.reference)}:{}),
      ...(copy?{copy:compareReference(doc,copy.frame,copy.layer)}:{}),
      layers:representation.layers.map(l=>densePixels?l:{id:l.id,name:l.name,visible:l.visible,...(l.group?{group:l.group}:{}),...(l.effect?{effect:l.effect}:{}),...(l.text?{text:l.text}:{})}),
      ...(doc.stack?{sliceCount:frameCount(doc)}:{}),
      animation:doc.stack&&!densePixels?undefined:representation.animation?{...representation.animation,
        frames:representation.animation.frames.map(f=>densePixels?f:{id:f.id})}:undefined,
      frameCount:frameCount(doc)};
    const selected=(name==='paint'||name==='get_canvas')?args.slice as number|undefined:undefined;
    const previewIndex=name==='paint'&&selected!==undefined?Math.min(selected,frameCount(doc)-1):selected??(args.frame as number)??0;
    const preview=frameView(doc,previewIndex);
    const view=(name==='get_canvas'?args.view:undefined)??(copy?'artwork':doc.reference?'overlay':'artwork');
    const rendered=buildCanvasPreview(preview,{view,referenceOpacity:args.referenceOpacity,artworkOpacity:args.artworkOpacity,grid:args.grid,region:args.region,
      scale:args.scale??Math.max(1,Math.min(8,Math.floor(384/Math.max(doc.width,doc.height))))} as CanvasPreviewOptions);
    return {content:[{type:'text' as const,text:JSON.stringify({...summary,preview:{view,...(doc.stack?{slice:previewIndex,elevation:doc.stack.zMin+previewIndex*doc.stack.sliceHeight}:{}),scale:rendered.scale,region:rendered.region,origin:{x:0,y:0},referenceScale:1}})},
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
  else if(msg.method==='initialize')result={protocolVersion:msg.params?.protocolVersion||'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'pixel-workshop',version:'0.3.0'}};
  else if(msg.method==='ping')result={};
  else if(msg.method==='tools/list')result={tools:toolDefinitions};
  else if(msg.method==='tools/call')result=await callTool(service,msg.params?.name,msg.params?.arguments);
  else return Response.json({jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Method not found'}});
  return Response.json({jsonrpc:'2.0',id:msg.id,result});
}
