import {composite,frameCount,frameView,DEFAULT_PALETTE,type PixelDocument} from './pixels.ts';

/** An ephemeral color is never written to the project's saved palette. */
export type ArtworkColor={hex:string;pixelCount:number};
export type ColorIdea={hex:string;label:string;source:'Selected color'|'Artwork'};
const HEX=/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i;
const clamp=(n:number,min:number,max:number)=>Math.min(max,Math.max(min,n));
const byte=(n:number)=>Math.round(clamp(n,0,255)).toString(16).padStart(2,'0');

/** Separate older automatically inserted swatches from deliberate project favorites.
 * This is a display interpretation only: original project metadata remains untouched.
 */
export function splitProjectPalette(palette:readonly string[]):{legacy:string[];saved:string[]}{
 const old=palette.length>=DEFAULT_PALETTE.length&&DEFAULT_PALETTE.every(
  (c,i)=>palette[i]?.toLowerCase()===c.toLowerCase());
 return old?{legacy:palette.slice(0,DEFAULT_PALETTE.length),saved:palette.slice(DEFAULT_PALETTE.length)}:
  {legacy:[],saved:[...palette]};
}
export function isHexInk(value:unknown):value is string{
 return typeof value==='string'&&HEX.test(value);
}
export function normalizeInk(value:string):string{
 if(!isHexInk(value))throw new Error('Enter a color as #RRGGBB or #RRGGBBAA.');
 const lower=value.toLowerCase();
 return lower.length===9&&lower.endsWith('ff')?lower.slice(0,7):lower;
}
export function rgbHex(value:string):string{
 return normalizeInk(value).slice(0,7);
}
/** The native RGB picker does not edit opacity; changing its color preserves any existing alpha. */
export function withRgb(oldInk:string,newRgb:string):string{
 const rgb=rgbHex(newRgb);
 const previous=normalizeInk(oldInk);
 return normalizeInk(rgb+(previous.length===9?previous.slice(7):''));
}
export function withOpacity(ink:string,alpha:number):string{
 const base=rgbHex(ink);
 if(!Number.isFinite(alpha))throw new Error('Opacity must be a number.');
 const a=byte(Math.round(clamp(alpha,0,100)*255/100));
 return normalizeInk(base+a);
}
export function opacityPercent(ink:string):number{
 const v=normalizeInk(ink);
 return v.length===9?Math.round(parseInt(v.slice(7),16)*100/255):100;
}
const rgb=(v:string):[number,number,number]=>{
 const h=rgbHex(v);return [1,3,5].map(i=>parseInt(h.slice(i,i+2),16)) as [number,number,number];
};
const distance=(a:string,b:string)=>{
 const x=rgb(a),y=rgb(b);
 return Math.hypot((x[0]-y[0])*.85,(x[1]-y[1]),(x[2]-y[2])*.82);
};
/** Visible composite only, so hidden layers and transparent cells cannot pollute suggestions.
 * Quantize neither the source pixels nor project metadata: results remain exact swatches.
 */
export function artworkColors(doc:PixelDocument,frame=0,limit=8):ArtworkColor[]{
 if(!Number.isInteger(frame)||frame<0||frame>=frameCount(doc))return [];
 const rgba=composite(frameView(doc,frame));
 // Pack RGB as an integer in this hot loop. Allocating a hex string for
 // every output pixel would noticeably slow down live suggestions on big cels.
 const counts=new Map<number,{pixelCount:number;weighted:number;maxAlpha:number}>();
 for(let i=0;i<rgba.length;i+=4){
  const a=rgba[i+3];
  if(a<24)continue;
  const key=(rgba[i]<<16)|(rgba[i+1]<<8)|rgba[i+2];
  const old=counts.get(key);
  if(old){old.pixelCount++;old.weighted+=a;old.maxAlpha=Math.max(old.maxAlpha,a);}
  else counts.set(key,{pixelCount:1,weighted:a,maxAlpha:a});
 }
 const ordered=[...counts].sort((a,b)=>b[1].weighted-a[1].weighted||a[0]-b[0]);
 const result:ArtworkColor[]=[];
 for(const [key,item] of ordered){
  const hex='#'+key.toString(16).padStart(6,'0');
  if(result.some(existing=>distance(existing.hex,hex)<23))continue;
  result.push({hex:normalizeInk(hex+(item.maxAlpha<255?byte(item.maxAlpha):'')),pixelCount:item.pixelCount});
  if(result.length>=Math.max(1,Math.min(12,limit)))break;
 }
 return result;
}

type HSL={h:number;s:number;l:number};
function toHsl(value:string):HSL{
 const [red,green,blue]=rgb(value).map(n=>n/255);
 const max=Math.max(red,green,blue),min=Math.min(red,green,blue),delta=max-min;
 const l=(max+min)/2;
 if(delta===0)return {h:0,s:0,l};
 const s=delta/(1-Math.abs(2*l-1));
 let h=0;
 if(max===red)h=((green-blue)/delta)%6;
 else if(max===green)h=(blue-red)/delta+2;
 else h=(red-green)/delta+4;
 return {h:(h*60+360)%360,s,l};
}
function fromHsl({h,s,l}:HSL):string{
 h=((h%360)+360)%360;s=clamp(s,0,1);l=clamp(l,0,1);
 const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs(h/60%2-1)),m=l-c/2;
 let triplet:[number,number,number]=[0,0,0];
 if(h<60)triplet=[c,x,0];
 else if(h<120)triplet=[x,c,0];
 else if(h<180)triplet=[0,c,x];
 else if(h<240)triplet=[0,x,c];
 else if(h<300)triplet=[x,0,c];
 else triplet=[c,0,x];
 return '#'+triplet.map(v=>byte((v+m)*255)).join('');
}

/** Deterministic color harmony, not random swatches or auto-saved colors.
 * Five companions follow the currently selected ink; the sixth follows the
 * most prevalent visible artwork color when there is one.
 */
export function suggestColors(selected:string,artwork:ArtworkColor[]):ColorIdea[]{
 const base=toHsl(selected),h=base.h,s=base.s,l=base.l;
 const vibrant=Math.max(.3,s);
 const candidates:ColorIdea[]=[
  {hex:fromHsl({h,s,l:clamp(l+(1-l)*.34,.13,.96)}),label:'Highlight',source:'Selected color'},
  {hex:fromHsl({h,s,l:clamp(l*.62,.07,.85)}),label:'Shadow',source:'Selected color'},
  {hex:fromHsl({h:h-26,s:vibrant,l:clamp(l+.04,.25,.75)}),label:'Warmer',source:'Selected color'},
  {hex:fromHsl({h:h+26,s:vibrant,l:clamp(l+.04,.25,.75)}),label:'Cooler',source:'Selected color'},
  {hex:fromHsl({h:h+180,s:Math.max(.32,s*.8),l:clamp(l,.3,.68)}),label:'Complement',source:'Selected color'},
 ];
 if(artwork.length){
  const dominant=toHsl(artwork[0].hex);
  candidates.push({hex:fromHsl({h:dominant.h+150,s:Math.max(.34,dominant.s*.82),
    l:clamp(dominant.l+.08,.32,.7)}),label:'With your artwork',source:'Artwork'});
 }
 const distinct:ColorIdea[]=[];
 for(const candidate of candidates){
  if(distance(candidate.hex,selected)<17||distinct.some(prev=>distance(prev.hex,candidate.hex)<17))continue;
  distinct.push(candidate);
 }
 return distinct;
}
/** Helper used by the selection UI: recent ink is ordered, unique and session-local. */
export function rememberInk(previous:readonly string[],newInk:string,max=8):string[]{
 const key=normalizeInk(newInk);
 return [key,...previous.map(normalizeInk).filter(v=>v!==key)].slice(0,max);
}
