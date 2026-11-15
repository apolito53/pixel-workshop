import {MAX_ANIMATION_CELLS, MAX_ANIMATION_FRAMES, MAX_LAYERS, frameCount, validateDocument, type PixelDocument} from './pixels.ts';
import {MAX_CANVAS_SIDE} from './canvas-limits.ts';

import {CelInterner} from './cel-storage.ts';

const LEGACY_PACKED_FORMAT = 'pixel-workshop/packed-1';
export const PACKED_PROJECT_FORMAT = 'pixel-workshop/packed-2';
export const LEGACY_PACKED_MEDIA = 'application/vnd.pixel-workshop.packed+json';
export const PACKED_PROJECT_MEDIA = LEGACY_PACKED_MEDIA+';version=2';
export const MAX_PROJECT_REQUEST_BYTES = 12_000_000;
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
type PackedProject = ProjectWire<number,typeof PACKED_PROJECT_FORMAT> & {cels:{data:string;base?:number}[]};

export function isPackedProject(input:unknown):input is LegacyProject|PackedProject {
  const format=(input as {format?:unknown}|null)?.format;
  return format===PACKED_PROJECT_FORMAT || format===LEGACY_PACKED_FORMAT;
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

/** Preserve the wire protocol used by older clients for documents they can edit. */
export function packLegacyProject(doc:PixelDocument):PixelDocument|LegacyProject {
  const denseCells=denseProjectCells(doc);
  if(denseCells>MAX_ANIMATION_CELLS)throw new Error('Project exceeds the legacy animation pixel budget.');
  if(denseCells<PACK_AT)return doc;
  const {layers,animation,reference,...meta}=doc;
  const previous=new Map(layers.map(l=>[l.id,l.pixels]));
  return {...meta,format:LEGACY_PACKED_FORMAT,
    layers:layers.map(l=>({...l,pixels:encodeCel(l.pixels)})),
    ...(reference?{reference:{...reference,pixels:encodeCel(reference.pixels)}}:{}),
    ...(animation?{animation:{...animation,frames:animation.frames.map(f=>{
      const pixels=Object.fromEntries(Object.entries(f.pixels).map(([id,values])=>{
        const delta=encodeCel(values,previous.get(id));
        previous.set(id,values);
        return [id,delta];
      }));
      return {id:f.id,pixels};
    })}}:{})};
}

/** A pool entry stores its pixels once. A delta may only refer to an earlier entry. */
export function packProject(doc:PixelDocument):PixelDocument|PackedProject {
  const {layers,animation,reference,...meta}=doc;
  if(layers.length===1 && !animation?.frames.length && denseProjectCells(doc)<PACK_AT)return doc;
  const interner=new CelInterner();
  const indexes=new Map<number[],number>();
  const sources:number[][]=[];
  const bases:(number|undefined)[]=[];
  const previous=new Map<string,number>();
  const indexCel=(id:string,pixels:number[])=>{
    const source=interner.intern(pixels);
    let index=indexes.get(source);
    if(index===undefined){
      index=sources.length;
      sources.push(source);
      indexes.set(source,index);
      bases.push(previous.get(id));
    }
    previous.set(id,index);
    return index;
  };
  const indexedLayers=layers.map(layer=>({...layer,pixels:indexCel(layer.id,layer.pixels)}));
  const indexedAnimation=animation?{...animation,frames:animation.frames.map(frame=>({
    id:frame.id,pixels:Object.fromEntries(Object.entries(frame.pixels).map(([id,pixels])=>[id,indexCel(id,pixels)]))
  }))}:undefined;
  if(sources.length===layers.length*frameCount(doc) && denseProjectCells(doc)<PACK_AT)return doc;
  const cels=sources.map((source,index)=>{
    const base=bases[index];
    const {data}=encodeCel(source,base===undefined?undefined:sources[base]);
    return base===undefined?{data}:{data,base};
  });
  return {...meta,format:PACKED_PROJECT_FORMAT,cels,layers:indexedLayers,
    ...(indexedAnimation?{animation:indexedAnimation}:{}),
    ...(reference?{reference:{...reference,pixels:encodeCel(reference.pixels)}}:{})};
}

export function unpackProject(input:unknown):PixelDocument {
  if(!isPackedProject(input))return input as PixelDocument;
  const {width,height,layers,animation,reference}=input;
  const n=width*height;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>MAX_CANVAS_SIDE||height>MAX_CANVAS_SIDE||
     !Array.isArray(layers)||!layers.length||layers.length>MAX_LAYERS ||
     (animation!==undefined&&(!animation||!Array.isArray(animation.frames)||animation.frames.length>=MAX_ANIMATION_FRAMES))||
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
    if(n*(slots+Number(Boolean(reference)))>MAX_ANIMATION_CELLS)throw invalid();
    const interner=new CelInterner();
    const initial=input.layers.map(layer=>({...layer,pixels:interner.intern(decodeCel(layer.pixels,n))}));
    const previous=new Map(initial.map(layer=>[layer.id,layer.pixels]));
    const {animation:legacyAnimation,reference:legacyReference,...meta}=input;
    return {...meta,format:'pixel-workshop/1',layers:initial,
      ...(legacyReference?{reference:{...legacyReference,pixels:decodeCel(legacyReference.pixels,n)}}:{}),
      ...(legacyAnimation?{animation:{...legacyAnimation,frames:legacyAnimation.frames.map(frame=>({
        id:frame.id,pixels:Object.fromEntries(Object.entries(frame.pixels).map(([id,packed])=>{
          const values=interner.intern(decodeCel(packed,n,previous.get(id)));
          previous.set(id,values);return [id,values];
        }))
      }))}}:{})};
  }

  const {cels,...doc}=input;
  if(!Array.isArray(cels)||!cels.length||cels.length>slots||n*(cels.length+Number(Boolean(reference)))>MAX_ANIMATION_CELLS)throw invalid();
  const used=new Set<number>();
  const checkIndex=(index:number)=>{
    if(!Number.isInteger(index)||index<0||index>=cels.length)throw invalid();
    used.add(index);
  };
  for(const layer of doc.layers)checkIndex(layer.pixels);
  for(const frame of doc.animation?.frames??[])for(const index of Object.values(frame.pixels))checkIndex(index);
  if(used.size!==cels.length)throw invalid();
  const buffers:number[][]=[];
  for(const cel of cels){
    if(!cel||typeof cel.data!=='string')throw invalid();
    const {base,data}=cel;
    if(base!==undefined&&(!Number.isInteger(base)||base<0||base>=buffers.length||!data))throw invalid();
    buffers.push(decodeCel(base===undefined?{data}:{data,delta:true},n,base===undefined?undefined:buffers[base]));
  }
  const {layers:indexedLayers,animation:indexedAnimation,reference:packedReference,...meta}=doc;
  return {...meta,format:'pixel-workshop/1',
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
  const stored=(value:unknown)=>isPackedProject(value)?unpackProject(value):validateDocument(value);
  return {...entry,doc:stored(entry.doc),undo:entry.undo.map(stored),redo:entry.redo.map(stored)};
}

export type ProjectSummary = Pick<PixelDocument,'id'|'name'|'width'|'height'|'revision'|'updatedAt'> & {
  layers:Pick<PixelDocument['layers'][number],'id'|'name'|'visible'>[];
  frames:number;
};
export function projectSummary(doc:DocWire):ProjectSummary {
  const {id,name,width,height,revision,updatedAt}=doc;
  return {id,name,width,height,revision,updatedAt,
    layers:doc.layers.map(layer=>({id:layer.id,name:layer.name,visible:layer.visible})),
    frames:1+(doc.animation?.frames.length??0)};
}
