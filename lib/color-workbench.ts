import {
 composite,frameCount,frameView,DEFAULT_PALETTE,
 type PixelDocument,
} from './pixels.ts';

export type ColorOption={hex:string;reason:string};
export type ArtColor={hex:string;pixels:number};
export type ColorContext={
 used:ArtColor[];
 suggested:ColorOption[];
 source:'artwork'|'current';
 pixelCount:number;
};
const hex2=(n:number)=>Math.max(0,Math.min(255,Math.round(n))).toString(16).padStart(2,'0');
const hexColor=(r:number,g:number,b:number)=>'#'+hex2(r)+hex2(g)+hex2(b);
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));

/** These are display-only defaults from old files, not a curated user palette. */
export function splitSavedPalette(palette:readonly string[]):{saved:string[];legacy:string[]}{
 const old=palette.length>=DEFAULT_PALETTE.length&&DEFAULT_PALETTE.every(
  (color,i)=>color.toLowerCase()===palette[i]?.toLowerCase());
 return old?{saved:palette.slice(DEFAULT_PALETTE.length),legacy:palette.slice(0,DEFAULT_PALETTE.length)}:
  {saved:[...palette],legacy:[]};
}
export function normalizeColor(input:string):string|null{
 if(!/^#[\da-f]{6}([\da-f]{2})?$/i.test(input.trim()))return null;
 const hex=input.trim().toLowerCase();
 return hex.length===9&&hex.endsWith('ff')?hex.slice(0,7):hex;
}
export function withRgb(current:string,rgb:string):string{
 const valid=normalizeColor(rgb);
 if(!valid)return current;
 const old=normalizeColor(current)??'#f6da92';
 return normalizeColor(valid.slice(0,7)+(old.length===9?old.slice(7):''))!;
}
export function withOpacity(current:string,percent:number):string{
 const valid=normalizeColor(current)??'#f6da92';
 const alpha=hex2(clamp(percent,0,100)*255/100);
 return normalizeColor(valid.slice(0,7)+alpha)!;
}
export function opacityPercent(hex:string):number{
 const valid=normalizeColor(hex);
 return valid&&valid.length===9?Math.round(parseInt(valid.slice(7),16)*100/255):100;
}
export function addRecentColor(colors:readonly string[],next:string,max=8):string[]{
 const normalized=normalizeColor(next);
 if(!normalized)return [...colors];
 const original=colors.map(c=>normalizeColor(c)).filter((c):c is string=>Boolean(c));
 return [normalized,...original.filter(c=>c!==normalized)].slice(0,max);
}
export function saveColor(palette:readonly string[],color:string):string[]{
 const hex=normalizeColor(color);
 if(!hex)throw new Error('Use a valid six- or eight-digit hex color.');
 const {saved}=splitSavedPalette(palette);
 if(saved.some(c=>normalizeColor(c)===hex))return [...palette];
 if(palette.length>=128)throw new Error('Palettes can contain at most 128 colors.');
 return [...palette,hex];
}
export function removeSavedColor(palette:readonly string[],color:string):string[]{
 const hex=normalizeColor(color),{saved,legacy}=splitSavedPalette(palette);
 return [...legacy,...saved.filter(c=>normalizeColor(c)!==hex)];
}
function mix(hex:string,target:[number,number,number],factor:number):string{
 const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
 return hexColor(r*(1-factor)+target[0]*factor,g*(1-factor)+target[1]*factor,b*(1-factor)+target[2]*factor);
}
function rgbToHsl(hex:string):[number,number,number]{
 const r=parseInt(hex.slice(1,3),16)/255,g=parseInt(hex.slice(3,5),16)/255,b=parseInt(hex.slice(5,7),16)/255;
 const hi=Math.max(r,g,b),lo=Math.min(r,g,b),delta=hi-lo;
 let hue=0;const light=(hi+lo)/2;let saturation=0;
 if(delta){
  saturation=delta/(1-Math.abs(2*light-1));
  switch(hi){
   case r:hue=((g-b)/delta)%6;break;
   case g:hue=(b-r)/delta+2;break;
   default:hue=(r-g)/delta+4;
  }
  hue=((hue*60)%360+360)%360;
 }
 return [hue,saturation,light];
}
function hslToHex(h:number,s:number,l:number):string{
 const hue=((h%360)+360)%360,sat=clamp(s,0,1),light=clamp(l,0,1);
 const c=(1-Math.abs(2*light-1))*sat,x=c*(1-Math.abs((hue/60)%2-1)),m=light-c/2;
 const [r,g,b]:[number,number,number]=
  hue<60?[c,x,0]:hue<120?[x,c,0]:hue<180?[0,c,x]:
  hue<240?[0,x,c]:hue<300?[x,0,c]:[c,0,x];
 return hexColor((r+m)*255,(g+m)*255,(b+m)*255);
}
/** Extract a few dominant visible colors from the selected composited frame.
 * 5-bit buckets merge near-identical anti-aliased/alpha variations while
 * output swatches are frequency-weighted averages of the original RGB values.
 */
export function artworkColors(doc:PixelDocument,frame=0):{colors:ArtColor[];pixelCount:number}{
 const rgba=composite(frameView(doc,clamp(frame,0,frameCount(doc)-1)));
 const bins=new Map<number,{count:number;r:number;g:number;b:number}>();
 let pixelCount=0;
 for(let i=0;i<rgba.length;i+=4){
  if(rgba[i+3]<64)continue;
  pixelCount++;
  const r=rgba[i],g=rgba[i+1],b=rgba[i+2],key=((r>>3)<<10)|((g>>3)<<5)|(b>>3);
  const bin=bins.get(key);
  if(bin){bin.count++;bin.r+=r;bin.g+=g;bin.b+=b;}
  else bins.set(key,{count:1,r,g,b});
 }
 const colors=[...bins.values()].sort((a,b)=>b.count-a.count).slice(0,8)
  .map(x=>({hex:hexColor(x.r/x.count,x.g/x.count,x.b/x.count),pixels:x.count}));
 return {colors,pixelCount};
}
/** Suggestions are deterministic, never mutations, and follow actual artwork.
 * Blank canvases derive harmonies from the selected ink instead.
 */
export function contextualColors(doc:PixelDocument|undefined,frame:number,ink:string):ColorContext{
 const analysis=doc?artworkColors(doc,frame):{colors:[],pixelCount:0};
 const fromArtwork=analysis.pixelCount>0;
 const base=(fromArtwork?analysis.colors[0]?.hex:normalizeColor(ink)?.slice(0,7))??'#f6da92';
 const [h,s,l]=rgbToHsl(base);
 const opposite=hslToHex(h+180,Math.max(.28,s*.83),clamp(l,.3,.7));
 const candidates:ColorOption[]=[
  {hex:mix(base,[255,255,255],.32),reason:'Highlight'},
  {hex:mix(base,[10,16,29],.32),reason:'Shadow'},
  {hex:hslToHex(h+28,s,clamp(l,.22,.78)),reason:'Warmer neighbor'},
  {hex:hslToHex(h-28,s,clamp(l,.22,.78)),reason:'Cooler neighbor'},
  {hex:opposite,reason:'Contrast accent'},
  {hex:hslToHex(h,Math.min(.3,s*.46),clamp(l+.09,.2,.82)),reason:'Muted tone'},
 ];
 if(fromArtwork&&analysis.colors[1]){
  const secondary=analysis.colors[1].hex;
  candidates.push({hex:mix(secondary,[255,255,255],.24),reason:'Secondary highlight'});
  candidates.push({hex:mix(secondary,[10,16,29],.26),reason:'Secondary shadow'});
 }
 const used=new Set<string>([base.toLowerCase(),...analysis.colors.map(c=>c.hex.toLowerCase())]);
 const suggested:ColorOption[]=[];
 for(const option of candidates){
  const normalized=normalizeColor(option.hex)!;
  if(used.has(normalized))continue;
  used.add(normalized);
  suggested.push({...option,hex:normalized});
 }
 return {used:analysis.colors,suggested:suggested.slice(0,8),
  source:fromArtwork?'artwork':'current',pixelCount:analysis.pixelCount};
}
