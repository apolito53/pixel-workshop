import {composite,frameCount,frameView,type PixelDocument} from './pixels.ts';

export type KitMember={id:string;name:string;assetKey:string|null;frames:number};
export type KitOverview={count:number;colors:string[];members:KitMember[]};
export type ColorImpact={id:string;name:string;revision:number;pixels:number;metadata:boolean;width:number;height:number;before:Uint8Array;after:Uint8Array};
export type KitColorReview={kitId:string;from:string;to:string;signature:string;impacts:ColorImpact[]};
export type KitUndo={kitId:string;from:string;to:string;entries:{id:string;name:string;revision:number;requestId:string}[]};

export function kitSignature(docs:PixelDocument[]):string{
 return docs.map(doc=>`${doc.id}:${doc.revision}`).sort().join('|');
}
export function overviewKit(docs:PixelDocument[]):KitOverview{
 const usage=new Map<string,number>();
 for(const doc of docs){
  const used=new Set<string>();
  for(const layers of [doc.layers.map(layer=>layer.pixels),...(doc.animation?.frames??[]).map(cel=>Object.values(cel.pixels))])
   for(const pixels of layers)for(const pixel of pixels)if((pixel&255)!==0)used.add('#'+(pixel>>>8).toString(16).padStart(6,'0'));
  for(const ink of doc.palette)if(/^#[0-9a-f]{6}/i.test(ink))used.add(ink.slice(0,7).toLowerCase());
  for(const color of used)usage.set(color,(usage.get(color)??0)+1);
 }
 return {count:docs.length,colors:[...usage.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,64).map(([color])=>color),
  members:docs.map(doc=>({id:doc.id,name:doc.name,assetKey:doc.ui?.assetKey??null,frames:frameCount(doc)})).sort((a,b)=>a.name.localeCompare(b.name))};
}
export function reviewKitColor(docs:PixelDocument[],kitId:string,from:string,to:string):KitColorReview{
 if(!/^#[0-9a-f]{6}$/i.test(from)||!/^#[0-9a-f]{6}$/i.test(to)||from.toLowerCase()===to.toLowerCase())throw new Error('Choose two different #rrggbb colors.');
 const source=parseInt(from.slice(1),16),replacement=parseInt(to.slice(1),16),impacts:ColorImpact[]=[];
 const matches=(pixel:number)=>(pixel&255)!==0&&(pixel>>>8)===source;
 const replace=(pixel:number)=>matches(pixel)?((replacement<<8)|(pixel&255))>>>0:pixel;
 const isSource=(ink:string|undefined)=>!!ink&&/^#[0-9a-f]{6}/i.test(ink)&&parseInt(ink.slice(1,7),16)===source;
 for(const doc of docs){
  let pixels=0;
  for(const layers of [doc.layers.map(layer=>layer.pixels),...(doc.animation?.frames??[]).map(cel=>Object.values(cel.pixels))])
   for(const values of layers)for(const value of values)if(matches(value))pixels++;
  const metadata=doc.palette.some(isSource)||doc.layers.some(layer=>isSource(layer.text?.color)||isSource(layer.effect?.ink));
  if(!pixels&&!metadata)continue;
  const view=frameView(doc,0),before=composite(view),after=composite({...view,layers:view.layers.map(layer=>({...layer,pixels:layer.pixels.map(replace)}))});
  impacts.push({id:doc.id,name:doc.name,revision:doc.revision,pixels,metadata,width:doc.width,height:doc.height,before,after});
 }
 return {kitId,from:from.toLowerCase(),to:to.toLowerCase(),signature:kitSignature(docs),impacts};
}
export function validateKitUndo(journal:KitUndo,docs:PixelDocument[]):string|null{
 const byId=new Map(docs.map(doc=>[doc.id,doc]));
 for(const entry of journal.entries){
  const doc=byId.get(entry.id);
  if(!doc||doc.revision!==entry.revision)return `${entry.name} changed after the recolor. Use that project’s Undo instead.`;
 }
 return null;
}
export function parseKitUndo(raw:string|null):KitUndo|null{
 if(!raw||raw.length>10_000)return null;
 try{
  const value=JSON.parse(raw) as KitUndo;
  if(!value||typeof value.kitId!=='string'||! /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(value.kitId)||typeof value.from!=='string'||typeof value.to!=='string'||!/^#[0-9a-f]{6}$/i.test(value.from)||!/^#[0-9a-f]{6}$/i.test(value.to)||
   !Array.isArray(value.entries)||!value.entries.length||value.entries.length>30)return null;
  const ids=new Set<string>();
  for(const entry of value.entries){
   if(!entry||typeof entry.id!=='string'||!/^[a-z0-9_-]{1,80}$/i.test(entry.id)||ids.has(entry.id)||typeof entry.name!=='string'||entry.name.length>80||!Number.isInteger(entry.revision)||entry.revision<0||typeof entry.requestId!=='string'||!/^[a-z0-9_-]{1,100}$/i.test(entry.requestId))return null;
   ids.add(entry.id);
  }
  return value;
 }catch{return null;}
}
