import {validateDocument,type PixelDocument} from './pixels.ts';
import {STARDROP_UI_ASSETS,type StardropUiArtName} from './stardrop-ui-art.ts';
import type {StardropArt} from './stardrop-art.ts';
/** Apply only explicit, recognized UI slots; game-world sprites remain untouched. */
export function applyStardropUiKit(base:StardropArt,documents:unknown[]):{art:StardropArt;count:number}{
 if(!Array.isArray(documents)||!documents.length||documents.length>30)throw new Error('A kit needs 1–30 editable projects.');
 const known=new Set(STARDROP_UI_ASSETS.map(a=>a.key)),seen=new Set<string>(),art={...base};let count=0;
 for(const input of documents){
  const doc=validateDocument(input),key=doc.ui?.assetKey as StardropUiArtName|undefined;
  if(!key||!known.has(key))continue;
  if(seen.has(key))throw new Error(`The kit contains more than one ${key} asset.`);
  seen.add(key);art[key]=doc;count++;
 }
 if(!count)throw new Error('This kit has no Stardrop UI assets. Use the Stardrop kit or assign a matching asset key.');
 return {art,count};
}
export function uiFrame(doc:PixelDocument,name:string,fallback:number):number{
 const match=doc.ui?.slots?.find(slot=>slot.name.toLowerCase()===name.toLowerCase())?.frame;
 const legacy=doc.animation?.clips?.find(clip=>clip.name.toLowerCase()===name.toLowerCase())?.from;
 return Math.max(0,Math.min(doc.animation?.frames.length??0,match??legacy??fallback));
}
