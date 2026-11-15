'use client';
import {useEffect,useRef} from 'react';
import {celPixel,type Cel} from '../lib/cel-storage.ts';
import {composite,frameView,type PixelDocument} from '../lib/pixels.ts';

// The timeline displays 44px thumbnails. Cache nearest-neighbor samples by
// immutable cel identity so held frames share the resize work.
const samples=new WeakMap<Cel,{width:number;height:number;pixels:number[]}>();
function sample(pixels:Cel,width:number,height:number,w:number,h:number){
 if(w===width&&h===height)return pixels;
 const cached=samples.get(pixels);
 if(cached?.width===width&&cached.height===height)return cached.pixels;
 const result=new Array<number>(w*h);
 for(let y=0;y<h;y++){
  const sourceY=Math.floor((y+.5)*height/h);
  for(let x=0;x<w;x++)result[y*w+x]=celPixel(pixels,Math.floor((x+.5)*width/w),sourceY,width);
 }
 samples.set(pixels,{width,height,pixels:result});
 return result;
}

export default function FrameThumbnail({doc,index}:{doc:PixelDocument;index:number}){
 const ref=useRef<HTMLCanvasElement>(null);
 const previous=useRef<{width:number;height:number;cels:Cel[]}|null>(null);
 useEffect(()=>{
  const canvas=ref.current;if(!canvas)return;
  const {width,height}=doc;
  const visible=frameView(doc,index).layers.filter(l=>l.visible);
  const last=previous.current;
  if(last?.width===width&&last.height===height&&last.cels.length===visible.length&&
    visible.every((layer,i)=>layer.pixels===last.cels[i]))return;
  const scale=Math.min(1,44/Math.max(width,height));
  const w=Math.max(1,Math.round(scale*width)),h=Math.max(1,Math.round(scale*height));
  const layers=visible.map(layer=>({...layer,pixels:sample(layer.pixels,width,height,w,h)}));
  const rgba=composite({...doc,width:w,height:h,layers});
  canvas.width=w;canvas.height=h;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba),w,h),0,0);
  previous.current={width,height,cels:visible.map(layer=>layer.pixels)};
 },[doc,index]);
 return <canvas ref={ref} className="frame-thumbnail" aria-hidden="true"/>;
}
