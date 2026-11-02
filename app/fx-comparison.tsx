'use client';
import {useEffect,useRef} from 'react';
import type {FxComparison} from '../lib/fx-preview.ts';

function PreviewFrame({label,bytes,width,height}:{label:string;bytes:Uint8Array;width:number;height:number}){
 const ref=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
  const el=ref.current;if(!el)return;
  el.width=width;el.height=height;
  el.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(bytes),width,height),0,0);
 },[bytes,width,height]);
 return <div className="fx-compare-image">
  <span>{label}</span><canvas ref={ref} aria-label={label+' effect preview'} role="img"/>
 </div>;
}
export default function FxComparisonPanel({comparison}:{
 comparison:FxComparison
}){
 return <div className="fx-comparison-panel" aria-label="Effect before and after comparison">
  <div className="fx-comparison-images">
   <PreviewFrame label="BEFORE" bytes={comparison.before} width={comparison.width} height={comparison.height}/>
   <PreviewFrame label="AFTER" bytes={comparison.after} width={comparison.width} height={comparison.height}/>
  </div>
  <p>Frame {comparison.frame+1}: {comparison.changedPixels.toLocaleString()} visible pixels differ.
   This is a preview only. No artwork has changed.</p>
 </div>;
}
