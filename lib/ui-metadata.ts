/** Portable, optional UI information attached to an ordinary Pixel Workshop project. */
export type UiSlice={left:number;top:number;right:number;bottom:number;content?:{left:number;top:number;right:number;bottom:number}};
export type UiSlot={name:string;frame:number};
export type UiMetadata={kind?:'panel'|'button'|'icons'|'other';assetKey?:string;kitId?:string;slice?:UiSlice;slots?:UiSlot[]};
export type PixelTextRecipe={text:string;x:number;y:number;scale:number;spacing:number;color:string;frame:number};
const idPattern=/^[a-z0-9][a-z0-9_-]{0,79}$/i;
const namePattern=/^[a-z0-9][a-z0-9 _-]{0,31}$/i;
function n(v:unknown,min:number,max:number,label:string):number{
 if(!Number.isInteger(v)||(v as number)<min||(v as number)>max)throw new Error(`${label} must be an integer from ${min} to ${max}.`);
 return v as number;
}
export function validateSlice(value:unknown,width:number,height:number):UiSlice{
 const s=value as UiSlice;
 if(!s||typeof s!=='object'||Array.isArray(s))throw new Error('Invalid panel guides.');
 const left=n(s.left,0,width-1,'Left guide'),right=n(s.right,0,width-1,'Right guide');
 const top=n(s.top,0,height-1,'Top guide'),bottom=n(s.bottom,0,height-1,'Bottom guide');
 if(left+right>=width||top+bottom>=height)throw new Error('Panel guides must leave at least one center pixel.');
 let content:UiSlice['content'];
 if(s.content!==undefined){
  const p=s.content;
  if(!p||typeof p!=='object'||Array.isArray(p))throw new Error('Invalid content insets.');
  content={left:n(p.left,0,width-1,'Content left'),right:n(p.right,0,width-1,'Content right'),top:n(p.top,0,height-1,'Content top'),bottom:n(p.bottom,0,height-1,'Content bottom')};
  if(content.left+content.right>=width||content.top+content.bottom>=height)throw new Error('Content insets must leave at least one pixel.');
 }
 return {left,top,right,bottom,...(content?{content}:{})};
}
export function validateUi(value:unknown,width:number,height:number,frames:number):UiMetadata{
 const ui=value as UiMetadata;
 if(!ui||typeof ui!=='object'||Array.isArray(ui))throw new Error('Invalid UI asset metadata.');
 if(ui.kind!==undefined&&!['panel','button','icons','other'].includes(ui.kind))throw new Error('Choose a valid UI asset type.');
 for(const [field,id] of [['assetKey',ui.assetKey],['kitId',ui.kitId]] as const)
  if(id!==undefined&&(typeof id!=='string'||!idPattern.test(id)))throw new Error(`Invalid ${field}.`);
 let slots:UiSlot[]|undefined;
 if(ui.slots!==undefined){
  if(!Array.isArray(ui.slots)||ui.slots.length>32)throw new Error('A UI set supports up to 32 named entries.');
  const names=new Set<string>();
  slots=ui.slots.map(slot=>{
   if(!slot||typeof slot.name!=='string'||!namePattern.test(slot.name)||names.has(slot.name.toLowerCase()))throw new Error('UI entry names must be unique and use letters, numbers, spaces, hyphens or underscores.');
   names.add(slot.name.toLowerCase());return {name:slot.name,frame:n(slot.frame,0,frames-1,'UI entry frame')};
  });
 }
 return {...(ui.kind?{kind:ui.kind}:{}),...(ui.assetKey?{assetKey:ui.assetKey}:{}),...(ui.kitId?{kitId:ui.kitId}:{}),
  ...(ui.slice!==undefined?{slice:validateSlice(ui.slice,width,height)}:{}),...(slots?{slots}:{})};
}
export function validatePixelText(value:unknown,width:number,height:number,frames:number):PixelTextRecipe{
 const t=value as PixelTextRecipe;
 if(!t||typeof t!=='object'||Array.isArray(t)||typeof t.text!=='string'||!t.text.length||t.text.length>100||! /^[\x20-\x7e\n]+$/.test(t.text))
  throw new Error('Text needs 1–100 basic Latin characters or line breaks.');
 if(typeof t.color!=='string'||!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(t.color))throw new Error('Choose a text color such as #f6da92.');
 return {text:t.text,x:n(t.x,0,width-1,'Text x'),y:n(t.y,0,height-1,'Text y'),scale:n(t.scale,1,8,'Text scale'),spacing:n(t.spacing,0,8,'Letter spacing'),color:t.color,frame:n(t.frame,0,frames-1,'Text frame')};
}
/** Nearest-neighbor nine-slice rendering, used by the live component preview. */
export function stretchNineSlice(source:Uint8Array,width:number,height:number,slice:UiSlice,targetWidth:number,targetHeight:number):Uint8Array{
 const s=validateSlice(slice,width,height);
 n(targetWidth,s.left+s.right+1,1024,'Preview width');n(targetHeight,s.top+s.bottom+1,1024,'Preview height');
 if(source.length!==width*height*4)throw new Error('Invalid panel pixels.');
 const out=new Uint8Array(targetWidth*targetHeight*4);
 const map=(v:number,target:number,original:number,start:number,end:number)=>v<start?v:v>=target-end?original-(target-v):start+Math.floor((v-start)*(original-start-end)/(target-start-end));
 for(let y=0;y<targetHeight;y++)for(let x=0;x<targetWidth;x++){
  const sx=map(x,targetWidth,width,s.left,s.right),sy=map(y,targetHeight,height,s.top,s.bottom);
  const from=(sy*width+sx)*4,to=(y*targetWidth+x)*4;
  out[to]=source[from];out[to+1]=source[from+1];out[to+2]=source[from+2];out[to+3]=source[from+3];
 }
 return out;
}
