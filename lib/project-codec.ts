import {MAX_STACK_SLICES,validateStackSettings} from './stack-domain.ts';
import {MAX_ANIMATION_CELLS, MAX_ANIMATION_FRAMES, MAX_LAYERS, frameCount, validateDocument, type PixelDocument} from './pixels.ts';
import {MAX_CANVAS_SIDE} from './canvas-limits.ts';

import {CelInterner, cropCel, denseCel, type Cel, type CroppedCel} from './cel-storage.ts';

const LEGACY_PACKED_FORMAT = 'pixel-workshop/packed-1';
export const POOLED_PROJECT_FORMAT = 'pixel-workshop/packed-2';
export const PACKED_PROJECT_FORMAT = 'pixel-workshop/packed-3';
export const LEGACY_PACKED_MEDIA = 'application/vnd.pixel-workshop.packed+json';
export const POOLED_PROJECT_MEDIA = LEGACY_PACKED_MEDIA+';version=2';
export const PACKED_PROJECT_MEDIA = LEGACY_PACKED_MEDIA+';version=3';
const LEGACY_PIXEL_LIMIT = 4_194_304;
// Fits every budgeted RGBA word at the maximum PackBits cost, plus indices and metadata.
export const MAX_PROJECT_REQUEST_BYTES = 32_000_000;
// The file chooser can compact dense, older-format source locally before uploading.
export const MAX_PROJECT_FILE_BYTES = MAX_ANIMATION_CELLS * 12 + 1_000_000;
const PACK_AT = 300_000;
const invalid = () => new Error('Invalid packed Pixel Workshop project.');
type PackedCel = {data:string;delta?:true};
type ProjectWire<Slot,Format extends string> = Omit<PixelDocument,'format'|'layers'|'animation'|'reference'> & {
  format:Format;
  layers:(Omit<PixelDocument['layers'][number],'pixels'> & {pixels:Slot})[];
  animation?:Omit<NonNullable<PixelDocument['animation']>,'frames'> & {frames:{id:string;pixels:Record<string,Slot>}[]};
  reference?:Omit<NonNullable<PixelDocument['reference']>,'pixels'> & {pixels:PackedCel};
};
type LegacyProject = ProjectWire<PackedCel,typeof LEGACY_PACKED_FORMAT>;
type Packet = {data:string;base?:number};
type CropPacket = Omit<CroppedCel,'data'> & Packet & {local?:true};
type PooledProject = ProjectWire<number,typeof POOLED_PROJECT_FORMAT> & {cels:Packet[]};
type PackedProject = ProjectWire<number,typeof PACKED_PROJECT_FORMAT> & {cels:CropPacket[]};

export function isPackedProject(input:unknown):input is LegacyProject|PooledProject|PackedProject {
  const format=(input as {format?:unknown}|null)?.format;
  return format===PACKED_PROJECT_FORMAT || format===POOLED_PROJECT_FORMAT || format===LEGACY_PACKED_FORMAT;
}

/** Number of pixel words required by the original dense JSON representation. */
export function denseProjectCells(doc:PixelDocument) {
  return doc.width*doc.height*(doc.layers.length*frameCount(doc)+Number(Boolean(doc.reference)));
}

function toBase64(bytes:Uint8Array) {
  let binary='';
  for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary);
}

// PackBits-style packets of 1–128 RGBA words. Repeated zero words have their own
// one-byte tag. Delta cels describe the exact XOR against the preceding frame.
function encodeCel(pixels:number[],previous?:number[]):PackedCel {
  const n=pixels.length;
  if(previous && (pixels===previous || pixels.every((p,i)=>p===previous[i])))return {data:'',delta:true};
  const buf=new Uint8Array(5*n);
  let out=0, i=0;
  const word=(k:number)=>previous?(pixels[k]^previous[k])>>>0:pixels[k];
  const put=(p:number)=>{buf[out++]=p>>>24;buf[out++]=p>>>16;buf[out++]=p>>>8;buf[out++]=p;};
  while(i<n){
    const v=word(i);
    let count=1;
    while(count<64 && i+count<n && word(i+count)===v)count++;
    if(v===0 || count>=2){
      buf[out++]=(v===0?0x80:0xc0)|(count-1);
      if(v!==0)put(v);
      i+=count;
    }else{
      const start=i++;
      while(i<n && i-start<128 && word(i)!==0 && (i+1===n || word(i)!==word(i+1)))i++;
      buf[out++]=i-start-1;
      for(let j=start;j<i;j++)put(word(j));
    }
  }
  return previous?{data:toBase64(buf.subarray(0,out)),delta:true}:{data:toBase64(buf.subarray(0,out))};
}

function decodeCel(input:PackedCel,n:number,previous?:number[]):number[] {
  if(!input || typeof input.data!=='string' || (input.delta!==undefined && (input.delta!==true||!previous)))throw invalid();
  if(!input.data){
    if(input.delta && previous)return previous;
    throw invalid();
  }
  // Even a deliberately fragmented stream cannot exceed five bytes per pixel.
  if(input.data.length>4*Math.ceil(5*n/3)||input.data.length%4)throw invalid();
  let raw:string;
  try{raw=atob(input.data);}catch{throw invalid();}
  const pixels=new Array<number>(n);
  let at=0,pos=0;
  const get=()=>{
    if(pos+4>raw.length)throw invalid();
    const p=(raw.charCodeAt(pos)<<24)|(raw.charCodeAt(pos+1)<<16)|(raw.charCodeAt(pos+2)<<8)|raw.charCodeAt(pos+3);
    pos+=4;return p>>>0;
  };
  while(pos<raw.length){
    const tag=raw.charCodeAt(pos++), count=(tag<128?tag:tag&63)+1;
    if(at+count>n)throw invalid();
    if(tag<128)for(let k=0;k<count;k++)pixels[at++]=get();
    else{const value=tag<192?0:get();pixels.fill(value,at,at+count);at+=count;}
  }
  if(at!==n)throw invalid();
  if(input.delta && previous)for(let k=0;k<n;k++)pixels[k]=(pixels[k]^previous[k])>>>0;
  return pixels;
}

/** Dense JSON clients allocate a full image for every layer in every frame. */
export function denseProject(doc:PixelDocument):PixelDocument<number[]> {
  if(denseProjectCells(doc)>LEGACY_PIXEL_LIMIT)throw new Error('Project exceeds the dense JSON pixel budget.');
  const cache=new Map<Cel,number[]>();
  function expand(cel:Cel) {
    let pixels=cache.get(cel);
    if(!pixels){pixels=denseCel(cel,doc.width,doc.height);cache.set(cel,pixels);}
    return pixels;
  }
  const {layers,animation,...meta}=doc;
  return {...meta,layers:layers.map(layer=>({...layer,pixels:expand(layer.pixels)})),
    ...(animation?{animation:{...animation,frames:animation.frames.map(frame=>({...frame,
      pixels:Object.fromEntries(Object.entries(frame.pixels).map(([id,cel])=>[id,expand(cel)]))}))}}:{})};
}

export class UnsupportedProjectFormat extends Error {
  constructor(){super('This project exceeds the capacity of the requested format. Open it with a client that supports packed-3.');}
}

function checkLegacyDimensions(doc:PixelDocument) {
  if(doc.stack || doc.width>1024 || doc.height>1024 || doc.layers.length>64 || frameCount(doc)>96)throw new UnsupportedProjectFormat();
}

/** Preserve the wire protocol used by older clients for documents they can edit. */
export function packLegacyProject(doc:PixelDocument):PixelDocument|LegacyProject {
  checkLegacyDimensions(doc);
  const denseCells=denseProjectCells(doc);
  if(denseCells>LEGACY_PIXEL_LIMIT)throw new UnsupportedProjectFormat();
  if(denseCells<PACK_AT)return denseProject(doc);
  const {layers,animation,reference,...meta}=doc;
  const dense=(cel:Cel)=>denseCel(cel,doc.width,doc.height);
  const previous=new Map(layers.map(l=>[l.id,dense(l.pixels)]));
  return {...meta,format:LEGACY_PACKED_FORMAT,
    layers:layers.map(l=>({...l,pixels:encodeCel(previous.get(l.id)!)})),
    ...(reference?{reference:{...reference,pixels:encodeCel(reference.pixels)}}:{}),
    ...(animation?{animation:{...animation,frames:animation.frames.map(f=>{
      const pixels=Object.fromEntries(Object.entries(f.pixels).map(([id,cel])=>{
        const values=dense(cel),delta=encodeCel(values,previous.get(id));
        previous.set(id,values);
        return [id,delta];
      }));
      return {id:f.id,pixels};
    })}}:{})};
}

function indexProject(doc:PixelDocument) {
  const {layers,animation,reference,...meta}=doc;
  const interner=new CelInterner<CroppedCel>();
  const indexes=new Map<Cel,number>();
  const sources:CroppedCel[]=[];
  const bases:(number|undefined)[]=[];
  const previous=new Map<string,number>();
  const indexCel=(id:string,cel:Cel)=>{
    let index=indexes.get(cel);
    if(index===undefined){
      const source=interner.intern(cropCel(cel,doc.width,doc.height));
      index=indexes.get(source);
      if(index===undefined){
        index=sources.length;
        sources.push(source);
        indexes.set(source,index);
        bases.push(previous.get(id));
      }
      indexes.set(cel,index);
    }
    previous.set(id,index);
    return index;
  };
  const indexedLayers=layers.map(layer=>({...layer,pixels:indexCel(layer.id,layer.pixels)}));
  const indexedAnimation=animation?{...animation,frames:animation.frames.map(frame=>({
    id:frame.id,pixels:Object.fromEntries(Object.entries(frame.pixels).map(([id,pixels])=>[id,indexCel(id,pixels)]))
  }))}:undefined;
  return {sources,bases,project:{...meta,layers:indexedLayers,
    ...(indexedAnimation?{animation:indexedAnimation}:{}),
    ...(reference?{reference:{...reference,pixels:encodeCel(reference.pixels)}}:{})}};
}

/** The v2 pool deduplicated cels, but each unique cel needs a complete canvas. */
export function packPooledProject(doc:PixelDocument):PixelDocument|PooledProject {
  checkLegacyDimensions(doc);
  const {sources,bases,project}=indexProject(doc);
  if((sources.length+Number(Boolean(doc.reference)))*doc.width*doc.height>LEGACY_PIXEL_LIMIT)throw new UnsupportedProjectFormat();
  if(sources.length===doc.layers.length*frameCount(doc) && denseProjectCells(doc)<PACK_AT)return denseProject(doc);
  const full=sources.map(cel=>denseCel(cel,doc.width,doc.height));
  const cels=full.map((source,index)=>{
    const base=bases[index];
    const {data}=encodeCel(source,base===undefined?undefined:full[base]);
    return base===undefined?{data}:{data,base};
  });
  return {...project,format:POOLED_PROJECT_FORMAT,cels};
}

type Bounds=Omit<CroppedCel,'data'>;
/** Align local pixels on the canvas to predict the next crop from a previous one. */
function predictor(base:CroppedCel,target:Bounds) {
  if(base.x===target.x && base.y===target.y && base.width===target.width && base.height===target.height)return base.data;
  const pixels=new Array<number>(target.width*target.height).fill(0);
  const left=Math.max(base.x,target.x),right=Math.min(base.x+base.width,target.x+target.width);
  const top=Math.max(base.y,target.y),bottom=Math.min(base.y+base.height,target.y+target.height);
  for(let y=top;y<bottom;y++)for(let x=left;x<right;x++)
    pixels[(y-target.y)*target.width+x-target.x]=base.data[(y-base.y)*base.width+x-base.x];
  return pixels;
}

export function packProject(doc:PixelDocument):PixelDocument|PackedProject {
  if(doc.layers.length===1 && !doc.animation?.frames.length && Array.isArray(doc.layers[0].pixels) && denseProjectCells(doc)<PACK_AT)return doc;
  const {sources,bases,project}=indexProject(doc);
  const cels=sources.map((source,index)=>{
    const {x,y,width,height}=source;
    const bounds={x,y,width,height};
    const direct=encodeCel(source.data);
    const base=bases[index];
    if(base===undefined || width===0)return {...bounds,data:direct.data};
    const prior=sources[base];
    const aligned=encodeCel(source.data,predictor(prior,bounds));
    let best:CropPacket=aligned.data.length<direct.data.length?{...bounds,data:aligned.data,base}:{...bounds,data:direct.data};
    if((prior.x!==x||prior.y!==y) && prior.width===width && prior.height===height){
      const shifted=encodeCel(source.data,prior.data);
      if(shifted.data.length+13<best.data.length)best={...bounds,data:shifted.data,base,local:true};
    }
    return best;
  });
  return {...project,format:PACKED_PROJECT_FORMAT,cels};
}

export function unpackProject(input:unknown):PixelDocument {
  if(!isPackedProject(input))return input as PixelDocument;
  const {width,height,layers,animation,reference}=input;
  const n=width*height;
  const stack=input.stack===undefined?undefined:validateStackSettings(input.stack);
  if(stack && input.format!==PACKED_PROJECT_FORMAT)throw invalid();
  const frameLimit=stack?MAX_STACK_SLICES:MAX_ANIMATION_FRAMES;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>MAX_CANVAS_SIDE||height>MAX_CANVAS_SIDE||
     !Array.isArray(layers)||!layers.length||layers.length>MAX_LAYERS ||
     (animation!==undefined&&(!animation||!Array.isArray(animation.frames)||animation.frames.length>=frameLimit))||
     (reference!==undefined&&(!reference||reference.width!==width||reference.height!==height)))throw invalid();
  const ids=new Set<string>();
  for(const layer of layers){
    if(!layer||typeof layer.id!=='string'||!/^[a-z0-9_-]{1,64}$/i.test(layer.id)||ids.has(layer.id))throw invalid();
    ids.add(layer.id);
  }
  for(const frame of animation?.frames??[]){
    if(!frame||!frame.pixels||typeof frame.pixels!=='object'||Array.isArray(frame.pixels)||
       Object.keys(frame.pixels).length!==ids.size||Object.keys(frame.pixels).some(id=>!ids.has(id)))throw invalid();
  }
  const slots=layers.length*(1+(animation?.frames.length??0));
  if(input.format===LEGACY_PACKED_FORMAT){
    // Every v1 writer enforced the original dense bound. Keep it before decoding
    // even for tiny compressed inputs with many full-size zero/delta packets.
    if(n*(slots+Number(Boolean(reference)))>LEGACY_PIXEL_LIMIT)throw invalid();
    const interner=new CelInterner<CroppedCel>();
    const previous=new Map<string,{full:number[];crop:CroppedCel}>();
    const read=(id:string,packet:PackedCel)=>{
      const prior=previous.get(id);
      const full=decodeCel(packet,n,prior?.full);
      if(prior?.full===full)return prior.crop;
      const crop=interner.intern(cropCel(full,width,height));
      previous.set(id,{full,crop});
      return crop;
    };
    const {layers:legacyLayers,animation:legacyAnimation,reference:legacyReference,...meta}=input;
    return {...meta,format:'pixel-workshop/1',layers:legacyLayers.map(layer=>({...layer,pixels:read(layer.id,layer.pixels)})),
      ...(legacyReference?{reference:{...legacyReference,pixels:decodeCel(legacyReference.pixels,n)}}:{}),
      ...(legacyAnimation?{animation:{...legacyAnimation,frames:legacyAnimation.frames.map(frame=>({
        id:frame.id,pixels:Object.fromEntries(Object.entries(frame.pixels).map(([id,packet])=>[id,read(id,packet)]))
      }))}}:{})};
  }

  const {cels,...doc}=input;
  if(!Array.isArray(cels)||!cels.length||cels.length>slots)throw invalid();
  const used=new Set<number>();
  const checkIndex=(index:number)=>{
    if(!Number.isInteger(index)||index<0||index>=cels.length)throw invalid();
    used.add(index);
  };
  for(const layer of doc.layers)checkIndex(layer.pixels);
  for(const frame of doc.animation?.frames??[])for(const index of Object.values(frame.pixels))checkIndex(index);
  if(used.size!==cels.length)throw invalid();
  for(let index=0;index<cels.length;index++){
    const cel=cels[index];
    if(!cel||typeof cel.data!=='string'||(cel.base!==undefined&&(!Number.isInteger(cel.base)||cel.base<0||cel.base>=index)))throw invalid();
  }
  let buffers:Cel[];
  if(input.format===POOLED_PROJECT_FORMAT){
    if(n*(cels.length+Number(Boolean(reference)))>LEGACY_PIXEL_LIMIT)throw invalid();
    const full:number[][]=[];
    for(const {base,data} of cels){
      if(!data)throw invalid();
      full.push(decodeCel(base===undefined?{data}:{data,delta:true},n,base===undefined?undefined:full[base]));
    }
    buffers=full.map(pixels=>cropCel(pixels,width,height));
  }else{
    // Check every declared allocation before reading even the first packet.
    let words=reference?n:0;
    for(const {x,y,width:w,height:h,data,base,local} of input.cels){
      if(![x,y,w,h].every(Number.isInteger)||x<0||y<0||w<0||h<0||x+w>width||y+h>height)throw invalid();
      if((w===0||h===0)&&(x!==0||y!==0||w!==0||h!==0||data!==''||base!==undefined))throw invalid();
      if(local!==undefined&&(local!==true||base===undefined||w!==input.cels[base].width||h!==input.cels[base].height))throw invalid();
      words+=w*h;
      if(words>MAX_ANIMATION_CELLS)throw invalid();
    }
    const crops:CroppedCel[]=[];
    for(const {x,y,width:w,height:h,base,data,local} of input.cels){
      const bounds={x,y,width:w,height:h};
      const previous=base===undefined?undefined:local?crops[base].data:predictor(crops[base],bounds);
      const pixels=w===0?[]:decodeCel(previous?{data,delta:true}:{data},w*h,previous);
      crops.push({...bounds,data:pixels});
    }
    buffers=crops;
  }
  const {layers:indexedLayers,animation:indexedAnimation,reference:packedReference,...meta}=doc;
  return {...meta,...(stack?{stack}:{}),format:'pixel-workshop/1',
    layers:indexedLayers.map(layer=>({...layer,pixels:buffers[layer.pixels]})),
    ...(packedReference?{reference:{...packedReference,pixels:decodeCel(packedReference.pixels,n)}}:{}),
    ...(indexedAnimation?{animation:{...indexedAnimation,frames:indexedAnimation.frames.map(frame=>({
      id:frame.id,pixels:Object.fromEntries(Object.entries(frame.pixels).map(([id,index])=>[id,buffers[index]]))
    }))}}:{})};
}

type DocWire = ReturnType<typeof packProject>;
type HistoryEntry<T> = {doc:T;undo:T[];redo:T[];lastRequest?:{id:string;revision:number}};
export function packEntry(entry:HistoryEntry<PixelDocument>):HistoryEntry<DocWire> {
  return {...entry,doc:packProject(entry.doc),undo:entry.undo.map(packProject),redo:entry.redo.map(packProject)};
}
export function unpackEntry(entry:HistoryEntry<unknown>):HistoryEntry<PixelDocument> {
  // Dense historical saves predate shared buffers; normalize them once on read.
  const stored=(value:unknown)=>{
    if(!isPackedProject(value))return validateDocument(value);
    const doc=unpackProject(value);
    return doc.stack?validateDocument(doc):doc;
  };
  return {...entry,doc:stored(entry.doc),undo:entry.undo.map(stored),redo:entry.redo.map(stored)};
}

export type ProjectSummary = Pick<PixelDocument,'id'|'name'|'width'|'height'|'revision'|'updatedAt'> & {
  layers:Pick<PixelDocument['layers'][number],'id'|'name'|'visible'>[];
  frames:number;
  stack?:PixelDocument['stack'];
};
export function projectSummary(doc:DocWire):ProjectSummary {
  const {id,name,width,height,revision,updatedAt}=doc;
  return {id,name,width,height,revision,updatedAt,...(doc.stack?{stack:doc.stack}:{}),
    layers:doc.layers.map(layer=>({id:layer.id,name:layer.name,visible:layer.visible})),
    frames:1+(doc.animation?.frames.length??0)};
}
