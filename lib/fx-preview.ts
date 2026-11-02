import {composite,frameCount,frameView,type PixelDocument} from './pixels.ts';
import {effectPixels,normalizeEffectRecipe,type EffectRecipe} from './effects.ts';

export type FxComparison={width:number;height:number;frame:number;before:Uint8Array;after:Uint8Array;changedPixels:number};
export function compareEffectFrame(doc:PixelDocument,layer:string,frame:number,recipe:EffectRecipe):FxComparison{
 const target=doc.layers.find(l=>l.id===layer);
 if(!target?.effect)throw new Error('Choose a generated effect layer.');
 if(!Number.isInteger(frame)||frame<0||frame>=frameCount(doc))throw new Error('Invalid effect preview frame.');
 const view=frameView(doc,frame),before=composite(view);
 const updated=effectPixels(doc.width,doc.height,frame,frameCount(doc),normalizeEffectRecipe(recipe));
 const next={...view,layers:view.layers.map(l=>l.id===layer?{...l,pixels:updated}:l)};
 const after=composite(next);
 let changedPixels=0;
 for(let i=0;i<before.length;i+=4){
  if(before[i]!==after[i]||before[i+1]!==after[i+1]||before[i+2]!==after[i+2]||before[i+3]!==after[i+3])
   changedPixels++;
 }
 return {width:doc.width,height:doc.height,frame,before,after,changedPixels};
}
