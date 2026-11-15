import {validatePixelText,validateUi,type PixelTextRecipe,type UiMetadata} from './ui-metadata.ts';
import {renderPixelText} from './pixel-font.ts';
import {CelInterner} from './cel-storage.ts';
import {planWindBake} from './wind.ts';
import {MAX_CANVAS_SIDE} from './canvas-limits.ts';
import {validateReference,type ReferenceImage} from './reference.ts';
export const PIXEL_EFFECT_KINDS = ['embers','sparkles','bubbles','leaves','fire','smoke','explosion','shockwave','lightning','rain','snow','arcane'] as const;
export type PixelEffectKind=typeof PIXEL_EFFECT_KINDS[number];
export type StoredEffectRecipe={kind:PixelEffectKind;seed:number;ink:string;speed:number;opacity:number;drift:number};
export type Layer = { id: string; name: string; visible: boolean; pixels: number[]; group?: string; effect?: StoredEffectRecipe; text?:PixelTextRecipe };
export function validateEffectRecipe(value:unknown):StoredEffectRecipe{
 const recipe=value as StoredEffectRecipe;
 if(!recipe||typeof recipe!=='object'||!PIXEL_EFFECT_KINDS.includes(recipe.kind)||
  !Number.isInteger(recipe.seed)||recipe.seed<0||recipe.seed>2147483647||
  !Number.isFinite(recipe.speed)||recipe.speed<.25||recipe.speed>3||
  !Number.isFinite(recipe.opacity)||recipe.opacity<.1||recipe.opacity>1||
  !Number.isFinite(recipe.drift)||recipe.drift< -3||recipe.drift>3)
  throw new Error('Invalid procedural effect recipe.');
 color(recipe.ink);
 return {kind:recipe.kind,seed:recipe.seed,ink:recipe.ink,speed:recipe.speed,opacity:recipe.opacity,drift:recipe.drift};
}
export type AnimationFrame = { id: string; pixels: Record<string, number[]> };
export type AnimationClip = { name: string; from: number; to: number; fps: number; mode: 'loop'|'once'|'pingpong' };
export function clipFrameSequence(clip: AnimationClip): number[] {
  const frames = Array.from({length:clip.to-clip.from+1},(_,i)=>clip.from+i);
  return clip.mode==='pingpong'&&frames.length>2?[...frames,...frames.slice(1,-1).reverse()]:frames;
}
export type PixelDocument = { format: 'pixel-workshop/1'; id: string; name: string; width: number; height: number; revision: number; palette: string[]; layers: Layer[]; updatedAt: string; animation?: { fps: number; frames: AnimationFrame[]; clips?: AnimationClip[] }; ui?:UiMetadata; reference?:ReferenceImage };
export const MAX_LAYERS = 64;
export const MAX_ANIMATION_FRAMES = 96;
export const MAX_ANIMATION_CELLS = 4_194_304;
export function frameCount(d: PixelDocument) { return 1 + (d.animation?.frames.length ?? 0); }
export function celUses(d:PixelDocument) {
  const uses=new Map<number[],number>();
  const count=(pixels:number[])=>uses.set(pixels,(uses.get(pixels)??0)+1);
  for(const layer of d.layers)count(layer.pixels);
  for(const frame of d.animation?.frames??[])for(const pixels of Object.values(frame.pixels))count(pixels);
  return uses;
}
export function documentCells(d:PixelDocument) {
  return (celUses(d).size+Number(Boolean(d.reference)))*d.width*d.height;
}
/** Conservative capacity when every layer in every frame needs independent pixels. */
export function canvasCapacity(width:number,height:number,layers:number,frames:number,hasReference=false){
  const buffers = Math.floor(MAX_ANIMATION_CELLS / (width * height)) - Number(hasReference);
  return {
    maxFrames: Math.min(MAX_ANIMATION_FRAMES, Math.floor(buffers / layers)),
    maxLayers: Math.min(MAX_LAYERS, Math.floor(buffers / frames)),
  };
}
export function documentCapacity(d: PixelDocument) {
  const uses=celUses(d);
  const remainingCelBuffers=Math.floor(MAX_ANIMATION_CELLS/(d.width*d.height))-uses.size-Number(Boolean(d.reference));
  const blankAvailable=findBlankCel(uses)!==undefined;
  return {maxFrames:MAX_ANIMATION_FRAMES,maxLayers:remainingCelBuffers>0||blankAvailable?MAX_LAYERS:d.layers.length,
    remainingCelBuffers,blankAvailable};
}
function findBlankCel(uses:Map<number[],number>) {
  for(const pixels of uses.keys())if(pixels.every(p=>p===0))return pixels;
}
// An atomic palette remap must be possible even when the entire document is filled.
export const MAX_BATCH_PIXEL_WORK = MAX_ANIMATION_CELLS;
export function frameView(d: PixelDocument, frame = 0): PixelDocument {
  requireInt(frame, 0, frameCount(d) - 1, 'frame');
  if (frame === 0) return d;
  const pixels = d.animation!.frames[frame - 1].pixels;
  return { ...d, layers: d.layers.map(l => ({ ...l, pixels: pixels[l.id] })) };
}
export type PaintCommand = { op: string; layer?: string; [key: string]: unknown };
export type PixelRegion = { x:number; y:number; width:number; height:number };
export function readRegion(d:PixelDocument,layer:string,region:PixelRegion,frame=0):number[] {
  const x=requireInt(region.x,0,d.width-1,'x'),y=requireInt(region.y,0,d.height-1,'y');
  const w=requireInt(region.width,1,d.width-x,'width'),h=requireInt(region.height,1,d.height-y,'height');
  const l=frameView(d,frame).layers.find(l=>l.id===layer);if(!l)throw new Error('Layer not found.');
  return Array.from({length:w*h},(_,i)=>l.pixels[(y+Math.floor(i/w))*d.width+x+i%w]);
}
export const DEFAULT_PALETTE = ['#201d2b','#3b3048','#64506b','#99809f','#e4d8d5','#fff5df','#453e35','#75543d','#ac754b','#dbab69','#eed49a','#263e38','#41664a','#719554','#a5bd68','#486b78','#76a2ad','#b6d4cd','#604582','#9671ba','#ccb2e5','#b55066','#e2858a','#edb49b'];
export function requireInt(v: unknown, min: number, max: number, label: string): number {
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  return v as number;
}
export function color(value: unknown): number {
  if (value === 'transparent') return 0;
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) throw new Error('Use a color like #rrggbb, #rrggbbaa, or transparent.');
  return parseInt(value.slice(1) + (value.length === 7 ? 'ff' : ''), 16) >>> 0;
}
export function hex(value: number): string { return '#' + (value >>> 0).toString(16).padStart(8, '0'); }
export function createDocument(name: string, width: number, height: number, id = crypto.randomUUID()): PixelDocument {
  requireInt(width, 1, MAX_CANVAS_SIDE, 'Width'); requireInt(height, 1, MAX_CANVAS_SIDE, 'Height');
  return { format:'pixel-workshop/1', id, name: String(name || 'Untitled sprite').slice(0,80), width, height, revision:0, palette:[], layers:[{id:'base',name:'Base',visible:true,pixels:Array(width*height).fill(0)}], updatedAt:new Date().toISOString() };
}
export function validateDocument(input: unknown): PixelDocument {
  const d = input as PixelDocument;
  if (!d || d.format !== 'pixel-workshop/1') throw new Error('This is not a Pixel Workshop project.');
  requireInt(d.width,1,MAX_CANVAS_SIDE,'Width'); requireInt(d.height,1,MAX_CANVAS_SIDE,'Height');
  if (typeof d.name !== 'string' || d.name.length > 80) throw new Error('Invalid project name.');
  if (!Array.isArray(d.layers) || !d.layers.length || d.layers.length>MAX_LAYERS) throw new Error(`Projects need 1–${MAX_LAYERS} layers.`);
  if(d.animation!==undefined&&(!d.animation||!Array.isArray(d.animation.frames)||d.animation.frames.length>=MAX_ANIMATION_FRAMES))
    throw new Error('Invalid animation settings.');

  if(d.reference!==undefined)validateReference(d.reference,d.width,d.height);
  // Validate shared buffers once; older dense JSON may repeat the same drawing by value.
  const pool=new CelInterner(), checked=new WeakMap<number[],number[]>();
  const checkPixels=(pixels:number[],message:string)=>{
    if(!Array.isArray(pixels)||pixels.length!==d.width*d.height)throw new Error(message);
    const known=checked.get(pixels);
    if(known)return known;
    for(const p of pixels)if(!Number.isInteger(p)||p<0||p>0xffffffff)throw new Error(message);
    const shared=pool.intern(pixels);
    if((pool.size+Number(Boolean(d.reference)))*d.width*d.height>MAX_ANIMATION_CELLS)
      throw new Error('Animation or reference exceeds the pixel budget.');
    checked.set(pixels,shared);
    return shared;
  };
  const ids = new Set<string>();
  for (const l of d.layers) {
    if (!l || typeof l.id !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(l.id) || ids.has(l.id)) throw new Error('Invalid or duplicate layer ID.');
    ids.add(l.id);
    if (typeof l.name !== 'string' || l.name.length>60 || typeof l.visible !== 'boolean' || (l.group!==undefined && (typeof l.group!=='string'||!l.group.trim()||l.group.length>60))) throw new Error('Invalid layer pixels or metadata.');
    checkPixels(l.pixels,'Invalid layer pixels or metadata.');
    if(l.effect!==undefined)validateEffectRecipe(l.effect);
  }
  if (!Array.isArray(d.palette) || d.palette.length>128) throw new Error('Palette can contain at most 128 colors.');
  d.palette.forEach(color);
  if (d.animation !== undefined) {
    if (!d.animation || !Number.isInteger(d.animation.fps) || d.animation.fps < 1 || d.animation.fps > 30)
      throw new Error('Invalid animation settings.');
    const frameIds = new Set<string>();
    const layerIds = d.layers.map(l => l.id);
    for (const frame of d.animation.frames) {
      if (!frame || typeof frame.id !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(frame.id) ||
        frameIds.has(frame.id) || !frame.pixels || typeof frame.pixels !== 'object' ||
        Array.isArray(frame.pixels) || Object.keys(frame.pixels).length !== layerIds.length)
        throw new Error('Invalid animation frame.');
      frameIds.add(frame.id);
      for (const id of layerIds) {
        if(!Object.hasOwn(frame.pixels,id))throw new Error('Invalid animation frame.');
        const pixels = frame.pixels[id];
        checkPixels(pixels,'Invalid animation cel pixels.');
      }
    }
    if (d.animation.clips !== undefined) {
      if (!Array.isArray(d.animation.clips) || d.animation.clips.length>32)
        throw new Error('Animation allows at most 32 named clips.');
      const names=new Set<string>();
      for (const clip of d.animation.clips) {
        if (!clip || typeof clip.name!=='string' || !/^[a-z0-9][a-z0-9 _-]{0,31}$/i.test(clip.name) ||
          names.has(clip.name.toLowerCase()) ||
          !Number.isInteger(clip.from)||clip.from<0||clip.from>=frameCount(d) ||
          !Number.isInteger(clip.to)||clip.to<clip.from||clip.to>=frameCount(d) ||
          !Number.isInteger(clip.fps)||clip.fps<1||clip.fps>30||
          !['loop','once','pingpong'].includes(clip.mode))
          throw new Error('Invalid or duplicate animation clip.');
        names.add(clip.name.toLowerCase());
      }
    }
  }
  if(d.ui!==undefined)validateUi(d.ui,d.width,d.height,frameCount(d));
  for(const layer of d.layers)if(layer.text!==undefined)validatePixelText(layer.text,d.width,d.height,frameCount(d));
  return structuredClone({...d,layers:d.layers.map(layer=>({...layer,pixels:checked.get(layer.pixels)!})),
    ...(d.animation?{animation:{...d.animation,frames:d.animation.frames.map(frame=>({...frame,
      pixels:Object.fromEntries(Object.entries(frame.pixels).map(([id,pixels])=>[id,checked.get(pixels)!]))}))}}:{})});
}
export function composite(d: PixelDocument): Uint8Array {
  const rgba = new Uint8Array(d.width*d.height*4);
  const transparent=new Set<number[]>();
  for (const layer of d.layers) {
    if (!layer.visible || transparent.has(layer.pixels)) continue;
    let hasInk=false;
    for(let i=0;i<layer.pixels.length;i++) {
      const p=layer.pixels[i]>>>0, a=(p&255)/255; if (!a) continue;
      hasInk=true;
      const j=i*4, oldA=rgba[j+3]/255, outA=a+oldA*(1-a);
      rgba[j]=Math.round(((p>>>24)*a+rgba[j]*oldA*(1-a))/outA);
      rgba[j+1]=Math.round((((p>>>16)&255)*a+rgba[j+1]*oldA*(1-a))/outA);
      rgba[j+2]=Math.round((((p>>>8)&255)*a+rgba[j+2]*oldA*(1-a))/outA);
      rgba[j+3]=Math.round(outA*255);
    }
    if(!hasInk)transparent.add(layer.pixels);
  }
  return rgba;
}
export function historyLimit(d:PixelDocument){return Math.max(1,Math.min(12,Math.floor(400000/documentCells(d))));}
// An edit owns its metadata and only the pixel arrays it actually writes. Cels
// can be held across any frame or layer, including the first frame and backups.
class CelEdit {
  doc:PixelDocument;
  uses:Map<number[],number>;
  private writable=new WeakSet<number[]>();
  private blank:number[]|undefined;
  private searchedBlank=false;
  private mayHaveDuplicate=false;

  constructor(doc:PixelDocument) {
    this.doc=doc;
    this.uses=celUses(doc);
  }
  add(pixels:number[]) {this.uses.set(pixels,(this.uses.get(pixels)??0)+1);}
  addToFrame(frame:AnimationFrame,id:string,pixels:number[]) {
    // The supported layer ID alphabet includes Object.prototype property names.
    Object.defineProperty(frame.pixels,id,{value:pixels,writable:true,configurable:true,enumerable:true});
    this.add(pixels);
  }
  remove(pixels:number[]) {
    const count=this.uses.get(pixels)!;
    if(count>1)this.uses.set(pixels,count-1);
    else this.uses.delete(pixels);
  }
  get(layer:Layer,frame:number) {return frame?this.doc.animation!.frames[frame-1].pixels[layer.id]:layer.pixels;}
  set(layer:Layer,frame:number,pixels:number[]) {
    const old=this.get(layer,frame);
    if(old===pixels)return;
    if(!this.uses.has(pixels))this.mayHaveDuplicate=true;
    this.remove(old);
    this.add(pixels);
    if(frame)this.doc.animation!.frames[frame-1].pixels[layer.id]=pixels;
    else layer.pixels=pixels;
  }
  empty() {
    if(!this.searchedBlank){this.blank=findBlankCel(this.uses);this.searchedBlank=true;}
    this.blank??=new Array<number>(this.doc.width*this.doc.height).fill(0);
    return this.blank;
  }
  write(layer:Layer,frame:number) {
    const old=this.get(layer,frame);
    if(this.writable.has(old)&&this.uses.get(old)===1 && old!==this.blank)return old;
    const next=old.slice();
    this.set(layer,frame,next);
    this.writable.add(next);
    return next;
  }
  // A drawing which exactly matches another cel can still be committed at capacity.
  // Only a full project pays for comparing independent drawings on the brush path.
  checkBudget(final=false) {
    const doc=this.doc, limit=Math.floor(MAX_ANIMATION_CELLS/(doc.width*doc.height))-Number(Boolean(doc.reference));
    if(this.uses.size<limit||(this.uses.size===limit&&(!final||!this.mayHaveDuplicate)))return;
    const pool=new CelInterner();
    for(const pixels of this.uses.keys()){
      pool.intern(pixels);
      if(pool.size>limit)throw new Error('Animation or reference exceeds the pixel budget. Reuse a cel or remove an independent drawing.');
    }
    if(pool.size===this.uses.size)return;
    for(const layer of doc.layers){
      this.set(layer,0,pool.intern(layer.pixels));
      for(let frame=1;frame<frameCount(doc);frame++)this.set(layer,frame,pool.intern(this.get(layer,frame)));
    }
  }
}

/** Returns another immutable snapshot; untouched cels can be shared with source. */
export function applySnapshotCommands(source:PixelDocument,commands:PaintCommand[],work={spent:0}):PixelDocument {
  return runCommands(source,commands,work,true);
}
/** The standalone engine API returns a fully independent document. */
export function applyCommands(source:PixelDocument,commands:PaintCommand[],work={spent:0}):PixelDocument {
  return runCommands(source,commands,work,false);
}
function runCommands(source:PixelDocument,commands:PaintCommand[],work:{spent:number},immutableSnapshot:boolean):PixelDocument {
  if (!Array.isArray(commands)||commands.length<1||commands.length>5000) throw new Error('Send 1–5000 drawing commands in one batch.');
  if(commands.length===1&&commands[0]?.op==='wind_bake')commands=planWindBake(source,commands[0]);
  const d:PixelDocument={...source,layers:source.layers.map(layer=>({...layer})),
    ...(source.ui?{ui:{...source.ui}}:{}),
    ...(source.animation?{animation:{...source.animation,
      ...(source.animation.clips?{clips:source.animation.clips.slice()}:{}),
      frames:source.animation.frames.map(frame=>({...frame,pixels:{...frame.pixels}}))}}:{})};
  let cels=new CelEdit(d);
  const spend=(n:number)=>{work.spent+=n;if(work.spent>MAX_BATCH_PIXEL_WORK)throw new Error('Drawing batch is too large; split it into smaller batches.');};
  for(const c of commands) {
    cels.checkBudget();
    if (!c || typeof c.op!=='string') throw new Error('Every command needs an op.');
    if(c.op==='rename'){if(typeof c.name!=='string'||!c.name.trim())throw new Error('Enter a project name.');d.name=c.name.slice(0,80);continue;}
    if(c.op==='palette'){if(!Array.isArray(c.colors)||c.colors.length>128)throw new Error('Choose up to 128 palette colors.');c.colors.forEach(color);d.palette=c.colors as string[];continue;}
    if(c.op==='wind_bake')throw new Error('Apply a wind bake as a separate paint edit.');
    if(c.op==='reference_set'){
      if(c.reference===null)delete d.reference;
      else d.reference=validateReference(c.reference,d.width,d.height);
      spend(d.reference?.pixels.length??0);continue;
    }
    if(c.op==='ui_set'){
      if(c.ui===null)delete d.ui;
      else d.ui=validateUi(c.ui,d.width,d.height,frameCount(d));
      continue;
    }
    if(c.op==='palette_remap'){
      const from=typeof c.fromColor==='string'&&/^#[0-9a-f]{6}$/i.test(c.fromColor)?parseInt(c.fromColor.slice(1),16):NaN;
      const to=typeof c.toColor==='string'&&/^#[0-9a-f]{6}$/i.test(c.toColor)?parseInt(c.toColor.slice(1),16):NaN;
      if(!Number.isFinite(from)||!Number.isFinite(to))throw new Error('Choose source and replacement colors in #rrggbb form.');
      const mapped=new Map<number[],number[]>(), pool=new CelInterner();
      for(const pixels of cels.uses.keys()){
        spend(pixels.length);
        let output=pixels;
        for(let i=0;i<pixels.length;i++){
          const pixel=pixels[i]>>>0;
          if((pixel&255)!==0&&(pixel>>>8)===from){
            if(output===pixels)output=pixels.slice();
            output[i]=((to<<8)|(pixel&255))>>>0;
          }
        }
        mapped.set(pixels,pool.intern(output));
      }
      for(const l of d.layers){
        l.pixels=mapped.get(l.pixels)!;
        if(l.text&&parseInt(l.text.color.slice(1,7),16)===from)l.text={...l.text,color:'#'+to.toString(16).padStart(6,'0')+(l.text.color.length===9?l.text.color.slice(7):'')};
        if(l.effect&&parseInt(l.effect.ink.slice(1,7),16)===from)l.effect={...l.effect,ink:'#'+to.toString(16).padStart(6,'0')+(l.effect.ink.length===9?l.effect.ink.slice(7):'')};
      }
      for(const cel of d.animation?.frames??[])for(const [id,pixels] of Object.entries(cel.pixels))cel.pixels[id]=mapped.get(pixels)!;
      cels=new CelEdit(d);
      d.palette=d.palette.map(v=>parseInt(v.slice(1,7),16)===from?'#'+to.toString(16).padStart(6,'0')+(v.length===9?v.slice(7):''):v);
      continue;
    }
    if(c.op==='set_fps'){
      const fps=requireInt(c.fps,1,30,'fps');
      d.animation ??= {fps,frames:[]};d.animation.fps=fps;continue;
    }
    if(c.op==='clip_set'){
      const name=typeof c.name==='string'?c.name.trim():'';
      if(!/^[a-z0-9][a-z0-9 _-]{0,31}$/i.test(name))throw new Error('Clip name needs 1–32 letters, numbers, spaces, hyphens or underscores.');
      const from=requireInt(c.from,0,frameCount(d)-1,'from');
      const to=requireInt(c.to,from,frameCount(d)-1,'to');
      const fps=requireInt(c.fps??d.animation?.fps??8,1,30,'clip fps');
      const mode=c.mode??'loop';
      if(!['loop','once','pingpong'].includes(String(mode)))throw new Error('Invalid clip playback mode.');
      d.animation??={fps:8,frames:[]};d.animation.clips??=[];
      const index=d.animation.clips.findIndex(clip=>clip.name.toLowerCase()===name.toLowerCase());
      if(index===-1&&d.animation.clips.length>=32)throw new Error('Animation allows at most 32 named clips.');
      const clip:AnimationClip={name,from,to,fps,mode:mode as AnimationClip['mode']};
      if(index===-1)d.animation.clips.push(clip);
      else d.animation.clips[index]=clip;
      continue;
    }
    if(c.op==='clip_delete'){
      const name=String(c.name??'');
      if(!d.animation?.clips?.some(clip=>clip.name.toLowerCase()===name.toLowerCase()))
        throw new Error('Animation clip not found.');
      d.animation.clips=d.animation.clips.filter(clip=>clip.name.toLowerCase()!==name.toLowerCase());
      continue;
    }
    if(c.op==='frame_add'){
      if(frameCount(d)>=MAX_ANIMATION_FRAMES)throw new Error(`Animation supports up to ${MAX_ANIMATION_FRAMES} frames.`);
      const from=requireInt(c.source_frame ?? 0,0,frameCount(d)-1,'source_frame');
      const sourceLayers=frameView(d,from).layers;
      const blank=c.blank === true;
      d.animation ??= {fps:8,frames:[]};
      const newFrameId=c.id===undefined?`frame-${source.revision+1}-${frameCount(d)}`:String(c.id);
      if(!/^[a-z0-9_-]{1,64}$/i.test(newFrameId)||d.animation.frames.some(f=>f.id===newFrameId))
        throw new Error('Animation frame IDs must be unique.');
      const pixels=Object.fromEntries(sourceLayers.map(l=>{
        const values=blank?cels.empty():l.pixels;
        cels.add(values);
        return [l.id,values];
      }));
      d.animation.frames.push({id:newFrameId,pixels});
      continue;
    }
    if(c.op==='frame_delete'){
      const index=requireInt(c.frame,1,frameCount(d)-1,'frame');
      const [removed]=d.animation!.frames.splice(index-1,1);
      for(const pixels of Object.values(removed.pixels))cels.remove(pixels);
      if(d.animation!.clips) d.animation!.clips=d.animation!.clips
        .filter(clip=>clip.from!==index||clip.to!==index)
        .map(clip=>({...clip,from:clip.from>index?clip.from-1:clip.from,to:clip.to>=index?clip.to-1:clip.to}));
      if(d.ui?.slots)d.ui.slots=d.ui.slots.filter(slot=>slot.frame!==index).map(slot=>({...slot,frame:slot.frame>index?slot.frame-1:slot.frame}));
      for(const l of d.layers)if(l.text){if(l.text.frame===index)delete l.text;else if(l.text.frame>index)l.text={...l.text,frame:l.text.frame-1};}
      continue;
    }
    if(c.op==='add_layer'){
      if(d.layers.length>=MAX_LAYERS)throw new Error(`A project can have up to ${MAX_LAYERS} layers.`);
      const id=String(c.id||'layer-'+d.layers.length);
      if(!/^[a-z0-9_-]{1,64}$/i.test(id)||d.layers.some(l=>l.id===id))throw new Error('Choose a unique layer ID.');
      const pixels=cels.empty();
      d.layers.push({id,name:String(c.name||'New layer').slice(0,60),visible:true,pixels});
      cels.add(pixels);
      for(const frame of d.animation?.frames ?? [])cels.addToFrame(frame,id,pixels);
      continue;
    }
    const targetLayer=c.layer||d.layers[0].id;
    const metadataLayer=d.layers.find(l=>l.id===targetLayer);if(!metadataLayer)throw new Error('Layer not found.');
    if(c.op==='text_set'){
      const recipe=validatePixelText(c.text,d.width,d.height,frameCount(d));
      const result=renderPixelText(recipe,d.width,d.height);spend(result.length);
      cels.set(metadataLayer,recipe.frame,result);
      metadataLayer.text=recipe;delete metadataLayer.effect;continue;
    }
    if(c.op==='text_detach'){delete metadataLayer.text;continue;}
    if(c.op==='effect_recipe'){metadataLayer.effect=validateEffectRecipe(c.recipe);continue;}
    if(c.op==='effect_detach'){delete metadataLayer.effect;continue;}
    if(c.op==='visibility'){if(typeof c.visible!=='boolean')throw new Error('visible must be true or false.');metadataLayer.visible=c.visible;continue;}
    if(c.op==='rename_layer'){metadataLayer.name=String(c.name||'Layer').slice(0,60);continue;}
    if(c.op==='move_layer'){
      const index=requireInt(c.index,0,d.layers.length-1,'layer index');
      d.layers.splice(d.layers.indexOf(metadataLayer),1);
      d.layers.splice(index,0,metadataLayer);
      continue;
    }
    if(c.op==='set_layer_group'){
      if(typeof c.group!=='string'||c.group.trim().length>60)throw new Error('Layer group names allow up to 60 characters.');
      const group=c.group.trim();
      if(group)metadataLayer.group=group;
      else delete metadataLayer.group;
      continue;
    }
    if(c.op==='hold_cel'){
      const frame=requireInt(c.frame,0,frameCount(d)-1,'frame');
      const from=requireInt(c.source_frame,0,frameCount(d)-1,'source_frame');
      cels.set(metadataLayer,frame,cels.get(metadataLayer,from));
      if(metadataLayer.text?.frame===frame && from!==frame)delete metadataLayer.text;
      continue;
    }
    if(c.op==='duplicate_layer'){
      if(d.layers.length>=MAX_LAYERS)throw new Error(`Cannot preserve a layer: all ${MAX_LAYERS} slots are used.`);
      const id=String(c.id||'backup-'+d.layers.length);
      if(!/^[a-z0-9_-]{1,64}$/i.test(id)||d.layers.some(l=>l.id===id))
        throw new Error('Choose a unique backup layer ID.');
      const backup:Layer={...metadataLayer,id,name:String(c.name||metadataLayer.name+' Backup').slice(0,60),
       visible:false,pixels:metadataLayer.pixels};
      delete backup.effect; // A backup is a frozen snapshot, not another live effect recipe.
      delete backup.text;
      d.layers.splice(d.layers.indexOf(metadataLayer)+1,0,backup);
      cels.add(backup.pixels);
      for(const frame of d.animation?.frames??[])cels.addToFrame(frame,id,frame.pixels[metadataLayer.id]);
      continue;
    }
    if(c.op==='delete_layer'){
      if(d.layers.length===1)throw new Error('Keep at least one layer.');
      d.layers=d.layers.filter(x=>x.id!==metadataLayer.id);
      cels.remove(metadataLayer.pixels);
      for(const frame of d.animation?.frames ?? []){cels.remove(frame.pixels[metadataLayer.id]);delete frame.pixels[metadataLayer.id];}
      continue;
    }
    const selectedFrame=c.frame===undefined?0:requireInt(c.frame,0,frameCount(d)-1,'frame');
    // Freehand edits turn a text layer into regular editable pixels, rather
    // than letting a later text edit silently overwrite a user's brushwork.
    if(metadataLayer.text?.frame===selectedFrame)delete metadataLayer.text;
    if(c.op==='clear'){cels.set(metadataLayer,selectedFrame,cels.empty());continue;}
    if(c.op==='paste'&&c.x===0&&c.y===0&&c.width===d.width&&c.height===d.height){
      const pixels=c.pixels,area=d.width*d.height;
      spend(area);
      if(!Array.isArray(pixels)||pixels.length!==area)throw new Error('Paste needs width × height packed RGBA pixels.');
      let blank=true;
      const previous=cels.get(metadataLayer,selectedFrame);
      let changed=false;
      for(let i=0;i<area;i++){
        const p=pixels[i];
        if(!Number.isInteger(p)||p<0||p>0xffffffff)throw new Error('Invalid paste pixels.');
        if(p!==0)blank=false;
        if(p!==previous[i])changed=true;
      }
      if(changed)cels.set(metadataLayer,selectedFrame,blank?cels.empty():pixels.slice());
      continue;
    }
    let pixels=cels.get(metadataLayer,selectedFrame), owned=false;
    const writePixel=(i:number,packed:number)=>{
      if(pixels[i]===packed)return;
      if(!owned){pixels=cels.write(metadataLayer,selectedFrame);owned=true;}
      pixels[i]=packed;
    };
    if(c.op==='transform'||c.op==='paste'||c.op==='stamp'){
      const x=requireInt(c.x,0,d.width-1,'x'),y=requireInt(c.y,0,d.height-1,'y');
      const w=requireInt(c.width,1,d.width-x,'width'),h=requireInt(c.height,1,d.height-y,'height');
      spend(w*h*3);
      let patch:number[],tx=x,ty=y;
      if(c.op==='paste'||c.op==='stamp'){
        if(c.op==='stamp'&&w*h>4096)throw new Error('Stamp exceeds the 4096-pixel brush budget.');
        if(!Array.isArray(c.pixels)||c.pixels.length!==w*h||c.pixels.some(p=>!Number.isInteger(p)||p<0||p>0xffffffff))throw new Error('Stamp or paste needs width × height packed RGBA pixels.');
        patch=c.pixels as number[];
      }else{
        if(!['move','copy','flip_horizontal','flip_vertical'].includes(String(c.mode)))throw new Error('Unknown transform mode.');
        patch=readRegion(d,metadataLayer.id,{x,y,width:w,height:h},selectedFrame);
        if(c.mode==='move'||c.mode==='copy'){
          tx=requireInt(c.x2,0,d.width-w,'x2');ty=requireInt(c.y2,0,d.height-h,'y2');
        }
        if(c.mode==='move')for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++)writePixel((y+yy)*d.width+x+xx,0);
      }
      for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
        const sx=c.op==='transform'&&c.mode==='flip_horizontal'?w-1-xx:xx,sy=c.op==='transform'&&c.mode==='flip_vertical'?h-1-yy:yy;
        const packed=patch[sy*w+sx];
        if(c.op!=='stamp'||(packed&255)>0)writePixel((ty+yy)*d.width+tx+xx,packed);
      }
      continue;
    }
    const ink=color(c.color), x=requireInt(c.x,0,d.width-1,'x'), y=requireInt(c.y,0,d.height-1,'y');
    const put=(px:number,py:number)=>{spend(1);if(px>=0&&py>=0&&px<d.width&&py<d.height)writePixel(py*d.width+px,ink);};
    if(c.op==='pixel'){put(x,y);continue;}
    if(c.op==='line'){
      const x2=requireInt(c.x2,0,d.width-1,'x2'), y2=requireInt(c.y2,0,d.height-1,'y2');
      let px=x,py=y;const dx=Math.abs(x2-x),dy=-Math.abs(y2-y),sx=x<x2?1:-1,sy=y<y2?1:-1;let err=dx+dy;
      while(true){put(px,py);if(px===x2&&py===y2)break;const e=err*2;if(e>=dy){err+=dy;px+=sx;}if(e<=dx){err+=dx;py+=sy;}}continue;
    }
    if(c.op==='rect'||c.op==='ellipse'){
      const w=requireInt(c.width,1,d.width-x,'width'),h=requireInt(c.height,1,d.height-y,'height');spend(w*h);
      for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
        if(c.op==='rect'){if(c.filled!==false||xx===0||yy===0||xx===w-1||yy===h-1)put(x+xx,y+yy);}
        else {const inside=(a:number,b:number)=>((a+.5-w/2)/(w/2))**2+((b+.5-h/2)/(h/2))**2<=1;
          if(inside(xx,yy)&&(c.filled!==false||!inside(xx-1,yy)||!inside(xx+1,yy)||!inside(xx,yy-1)||!inside(xx,yy+1)))put(x+xx,y+yy);}
      }continue;
    }
    if(c.op==='fill'){
      const target=pixels[y*d.width+x]; if(target===ink)continue;
      const stack=[y*d.width+x];pixels=cels.write(metadataLayer,selectedFrame);pixels[stack[0]]=ink;
      while(stack.length){const n=stack.pop()!;spend(1);const px=n%d.width,py=Math.floor(n/d.width);for(const k of [px>0?n-1:-1,px<d.width-1?n+1:-1,py>0?n-d.width:-1,py<d.height-1?n+d.width:-1])if(k>=0&&pixels[k]===target){pixels[k]=ink;stack.push(k);}}continue;
    }
    throw new Error(`Unknown drawing operation: ${c.op}`);
  }
  cels.checkBudget(true);
  d.revision=source.revision+1;d.updatedAt=new Date().toISOString();
  return immutableSnapshot?d:structuredClone(d);
}
