export type GuideRect={left:number;top:number;right:number;bottom:number;width:number;height:number};
export type GuideSize={width:number;height:number};
export type GuidePosition={left:number;top:number;width:number};
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const overlap=(a:{left:number;right:number;top:number;bottom:number},b:GuideRect)=>
 Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*
 Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));

/** Place coach cards without clipping at the viewport edge and avoid target overlap
 * whenever there is room. Compact screens use a top/bottom dock. */
export function placeGuideCard(
 target:GuideRect|null,viewport:GuideSize,card:GuideSize,compact:boolean
):GuidePosition{
 const margin=12,gap=18;
 const w=Math.max(140,Math.min(card.width,viewport.width-2*margin));
 const h=Math.max(80,Math.min(card.height,viewport.height-2*margin));
 const maxLeft=Math.max(margin,viewport.width-w-margin);
 const maxTop=Math.max(margin,viewport.height-h-margin);
 if(!target)return {left:clamp(viewport.width-w-margin,margin,maxLeft),
  top:clamp(viewport.height-h-margin,margin,maxTop),width:w};
 const centerX=target.left+target.width/2,centerY=target.top+target.height/2;
 if(compact){
  const below=viewport.height-target.bottom,above=target.top;
  const top=below>above?maxTop:margin;
  return {left:clamp((viewport.width-w)/2,margin,maxLeft),top,width:w};
 }
 const positions=[
  {left:target.right+gap,top:centerY-h/2},
  {left:target.left-gap-w,top:centerY-h/2},
  {left:centerX-w/2,top:target.bottom+gap},
  {left:centerX-w/2,top:target.top-gap-h},
 ];
 let best:GuidePosition|null=null,bestScore=Infinity;
 for(let i=0;i<positions.length;i++){
  const p=positions[i];
  const left=clamp(p.left,margin,maxLeft),top=clamp(p.top,margin,maxTop);
  const rect={left,top,right:left+w,bottom:top+h};
  const penalty=overlap(rect,target)*100+
   Math.abs(left-p.left)*2+Math.abs(top-p.top)*2+i;
  if(penalty<bestScore){best={left,top,width:w};bestScore=penalty;}
 }
 return best!;
}
