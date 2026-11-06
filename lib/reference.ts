import {MAX_CANVAS_SIDE,MAX_SOURCE_SIDE,MAX_SOURCE_PIXELS,MAX_REFERENCE_PNG_BYTES} from './canvas-limits.ts';

export type ReferenceAlignment={width:number;height:number;offsetX:number;offsetY:number;cellWidth:number;cellHeight:number};
export type ReferenceImage={name:string;width:number;height:number;pixels:number[];source?:ReferenceAlignment & {widthPixels:number;heightPixels:number}};
export type ReferenceSource={width:number;height:number;pixels:number[]};

const integer=(v:unknown,max:number)=>Number.isInteger(v)&&(v as number)>0&&(v as number)<=max;
export function validateAlignment(input:unknown,sourceWidth:number,sourceHeight:number):ReferenceAlignment{
 const a=input as ReferenceAlignment;
 if(!a||!integer(a.width,MAX_CANVAS_SIDE)||!integer(a.height,MAX_CANVAS_SIDE)||
  !Number.isFinite(a.cellWidth)||a.cellWidth<.125||a.cellWidth>MAX_SOURCE_SIDE||
  !Number.isFinite(a.cellHeight)||a.cellHeight<.125||a.cellHeight>MAX_SOURCE_SIDE||
  !Number.isFinite(a.offsetX)||Math.abs(a.offsetX)>sourceWidth||
  !Number.isFinite(a.offsetY)||Math.abs(a.offsetY)>sourceHeight)
  throw new Error('Choose a 1–512 pixel output, positive grid spacing (at least 0.125 source pixels), and an offset within the source image.');
 return {width:a.width,height:a.height,offsetX:a.offsetX,offsetY:a.offsetY,cellWidth:a.cellWidth,cellHeight:a.cellHeight};
}
export function validateReference(input:unknown,width:number,height:number):ReferenceImage{
 const r=input as ReferenceImage;
 if(!r||!integer(r.width,MAX_CANVAS_SIDE)||!integer(r.height,MAX_CANVAS_SIDE)||r.width!==width||r.height!==height)
  throw new Error('Reference dimensions must exactly match the canvas. Create a matching canvas or explicitly resize the reference first.');
 if(typeof r.name!=='string'||r.name.length>80||!Array.isArray(r.pixels)||r.pixels.length!==width*height||
  r.pixels.some(p=>!Number.isInteger(p)||p<0||p>0xffffffff))throw new Error('Invalid reference pixels.');
 const result:ReferenceImage={name:r.name,width,height,pixels:[...r.pixels]};
 if(r.source!==undefined){
  if(!integer(r.source.widthPixels,MAX_SOURCE_SIDE)||!integer(r.source.heightPixels,MAX_SOURCE_SIDE)||r.source.widthPixels*r.source.heightPixels>MAX_SOURCE_PIXELS)
   throw new Error('Invalid reference source dimensions.');
  const alignment=validateAlignment(r.source,r.source.widthPixels,r.source.heightPixels);
  if(alignment.width!==width||alignment.height!==height)throw new Error('Reference alignment must match its prepared dimensions.');
  result.source={...alignment,widthPixels:r.source.widthPixels,heightPixels:r.source.heightPixels};
 }
 return result;
}
/** One explicit nearest-neighbor conversion; the prepared result is the locked native reference. */
export function prepareReference(source:ReferenceSource,name:string,alignment?:ReferenceAlignment):ReferenceImage{
 if(!integer(source.width,MAX_SOURCE_SIDE)||!integer(source.height,MAX_SOURCE_SIDE)||source.width*source.height>MAX_SOURCE_PIXELS||source.pixels.length!==source.width*source.height)
  throw new Error('Reference source is too large or invalid (maximum 4096 per side and 4 million pixels).');
 const a=validateAlignment(alignment??{width:source.width,height:source.height,offsetX:0,offsetY:0,cellWidth:1,cellHeight:1},source.width,source.height);
 const pixels=Array.from({length:a.width*a.height},(_,i)=>{
  const sx=Math.floor(a.offsetX+(i%a.width+.5)*a.cellWidth),sy=Math.floor(a.offsetY+(Math.floor(i/a.width)+.5)*a.cellHeight);
  return sx>=0&&sy>=0&&sx<source.width&&sy<source.height?source.pixels[sy*source.width+sx]:0;
 });
 return validateReference({name:name.slice(0,80),width:a.width,height:a.height,pixels,
  source:{...a,widthPixels:source.width,heightPixels:source.height}},a.width,a.height);
}
export function packRgba(bytes:Uint8Array):number[]{
 return Array.from({length:bytes.length/4},(_,i)=>((bytes[i*4]<<24)|(bytes[i*4+1]<<16)|(bytes[i*4+2]<<8)|bytes[i*4+3])>>>0);
}
export function referenceRgba(r:ReferenceSource):Uint8Array{
 const bytes=new Uint8Array(r.pixels.length*4);
 r.pixels.forEach((p,i)=>{bytes[i*4]=p>>>24;bytes[i*4+1]=(p>>>16)&255;bytes[i*4+2]=(p>>>8)&255;bytes[i*4+3]=p&255;});
 return bytes;
}
/** Check IHDR before decoding so compressed uploads cannot allocate an unbounded image. */
export function checkReferencePng(bytes:Uint8Array):void{
 const signature=[137,80,78,71,13,10,26,10];
 if(bytes.length>MAX_REFERENCE_PNG_BYTES)throw new Error('Reference PNG must be at most 8 MB.');
 if(bytes.length<33||signature.some((b,i)=>bytes[i]!==b)||String.fromCharCode(...bytes.slice(12,16))!=='IHDR')throw new Error('Choose a PNG reference image.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),w=view.getUint32(16),h=view.getUint32(20);
 if(!integer(w,MAX_SOURCE_SIDE)||!integer(h,MAX_SOURCE_SIDE)||w*h>MAX_SOURCE_PIXELS)throw new Error('Reference PNG must be at most 4096 per side and 4 million pixels.');
}
