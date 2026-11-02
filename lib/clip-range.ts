import type {AnimationClip} from './pixels.ts';
export type ClipRange={from:number;to:number};
export function clipRange(start:number,end:number,total:number):ClipRange{
 if(!Number.isInteger(start)||!Number.isInteger(end)||!Number.isInteger(total)||total<1)
  throw new Error('Invalid clip range.');
 const a=Math.max(0,Math.min(total-1,start)),b=Math.max(0,Math.min(total-1,end));
 return {from:Math.min(a,b),to:Math.max(a,b)};
}
export const CLIP_COLORS=['#e9bd8d','#b69dd4','#79b6c7','#d597b9','#a8c68b','#e3c475'] as const;
export function clipColor(index:number){return CLIP_COLORS[Math.abs(index)%CLIP_COLORS.length];}
export function clipsAtFrame(clips:readonly AnimationClip[]|undefined,frame:number){
 return (clips??[]).map((clip,index)=>({clip,index,color:clipColor(index)}))
  .filter(entry=>entry.clip.from<=frame&&entry.clip.to>=frame);
}
