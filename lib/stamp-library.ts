import {readRegion,type PixelDocument,type PixelRegion,type PaintCommand} from './pixels.ts';
export type StampAsset={id:string;name:string;width:number;height:number;pixels:number[]};
export const STAMP_LIBRARY_LIMIT=12,STAMP_MAX_PIXELS=4096;
export function validateStamp(input:unknown):StampAsset{
 const s=input as StampAsset;
 if(!s||typeof s!=='object'||typeof s.id!=='string'||!/^[a-z0-9_-]{1,64}$/i.test(s.id)||
  typeof s.name!=='string'||s.name.length>48||
  !Number.isInteger(s.width)||!Number.isInteger(s.height)||s.width<1||s.height<1||
  s.width*s.height>STAMP_MAX_PIXELS||!Array.isArray(s.pixels)||s.pixels.length!==s.width*s.height||
  s.pixels.some(p=>!Number.isInteger(p)||p<0||p>0xffffffff))
  throw new Error('Invalid stamp asset.');
 return {...s,pixels:[...s.pixels]};
}
export function loadStamps(input:unknown):StampAsset[]{
 if(!Array.isArray(input))return [];
 const seen=new Set<string>(),out:StampAsset[]=[];
 for(const candidate of input.slice(0,STAMP_LIBRARY_LIMIT)){
  try{const stamp=validateStamp(candidate);if(seen.has(stamp.id))continue;seen.add(stamp.id);out.push(stamp);}
  catch{/* Invalid browser data never blocks artwork loading. */}
 }
 return out;
}
export function captureStamp(doc:PixelDocument,layer:string,region:PixelRegion,frame:number,id:string):StampAsset{
 if(region.width*region.height>STAMP_MAX_PIXELS)throw new Error('Capture at most 4096 pixels (for example 64 × 64).');
 const pixels=readRegion(doc,layer,region,frame);
 if(!pixels.some(p=>(p&255)>0))throw new Error('No painted pixels on this layer in the selected area.');
 return validateStamp({id,name:'Stamp '+region.width+' × '+region.height,width:region.width,height:region.height,pixels});
}
export function positionStamp(doc:PixelDocument,stamp:StampAsset,x:number,y:number,snap:number){
 if(stamp.width>doc.width||stamp.height>doc.height)throw new Error('Stamp is larger than canvas.');
 if(![0,8,16,32].includes(snap))throw new Error('Unknown stamp grid size.');
 if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error('Invalid stamp position.');
 const px=snap?Math.floor(x/snap)*snap:Math.floor(x);
 const py=snap?Math.floor(y/snap)*snap:Math.floor(y);
 return {x:Math.max(0,Math.min(doc.width-stamp.width,px)),y:Math.max(0,Math.min(doc.height-stamp.height,py))};
}
export function stampCommand(doc:PixelDocument,stamp:StampAsset,x:number,y:number,layer:string,frame:number,snap:number):PaintCommand{
 const valid=validateStamp(stamp),at=positionStamp(doc,valid,x,y,snap);
 return {op:'stamp',layer,frame,...at,width:valid.width,height:valid.height,pixels:valid.pixels};
}
export function addSavedStamp(existing:StampAsset[],candidate:StampAsset,name:string):StampAsset[]{
 const item=validateStamp({...candidate,name:name.trim()||candidate.name});
 if(existing.some(s=>s.id===item.id))return existing.map(s=>s.id===item.id?item:s);
 if(existing.length>=STAMP_LIBRARY_LIMIT)throw new Error('Stamp library holds at most 12 reusable stamps.');
 return [...existing,item];
}
export function stampRgba(s:StampAsset):Uint8ClampedArray<ArrayBuffer>{
 const bytes=new Uint8ClampedArray(s.pixels.length*4);
 s.pixels.forEach((packed,i)=>{bytes[i*4]=packed>>>24;bytes[i*4+1]=(packed>>>16)&255;bytes[i*4+2]=(packed>>>8)&255;bytes[i*4+3]=packed&255;});
 return bytes;
}
