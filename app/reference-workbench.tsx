'use client';
import {useEffect,useId,useMemo,useRef,useState,type PointerEvent} from 'react';
import {createPortal} from 'react-dom';
import {X,ImagePlus,Eye,Trash2} from 'lucide-react';
import {MAX_CANVAS_SIDE,MAX_REFERENCE_PNG_BYTES} from '../lib/canvas-limits.ts';
import {prepareReference,referenceRgba,fitReferenceAlignment,type ReferenceAlignment,type ReferenceImage,type ReferenceSource} from '../lib/reference.ts';
import type {CanvasView} from '../lib/canvas-preview.ts';
import {createDocument,type PixelDocument} from '../lib/pixels.ts';

type Props={doc:PixelDocument|null;busy:boolean;view:CanvasView;referenceOpacity:number;artworkOpacity:number;
 onView:(view:CanvasView)=>void;onReferenceOpacity:(v:number)=>void;onArtworkOpacity:(v:number)=>void;
 onApply:(reference:ReferenceImage,newCanvas:boolean)=>Promise<boolean>;onCreatePixelified:(doc:PixelDocument)=>Promise<void>;onRemove:()=>void};
export default function ReferenceWorkbench(props:Props){
 const {doc,busy}=props,file=useRef<HTMLInputElement>(null);
 const [source,setSource]=useState<(ReferenceSource & {name:string})|null>(null),[showAlignment,setShowAlignment]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const load=async(f:File)=>{
  setError('');setLoading(true);
  try{
   if(f.size>MAX_REFERENCE_PNG_BYTES)throw new Error('Reference PNG must be at most 8 MB.');
   const {decodeBrowserReference}=await import('../lib/browser-png.ts');
   const pixels=decodeBrowserReference(new Uint8Array(await f.arrayBuffer()));
   const nextSource={...pixels,name:f.name.replace(/\.png$/i,'').slice(0,80)};
   // Default to literal source pixels. Oversized images get one predictable,
   // uniform nearest-neighbor resize to the editor's supported maximum.
   const reference=prepareReference(nextSource,nextSource.name,fitReferenceAlignment(pixels.width,pixels.height));
   const applied=await props.onApply(reference,true);
   setSource(nextSource);setShowAlignment(!applied);
   if(applied)setError('');
  }catch(e){setError((e as Error).message);}finally{setLoading(false);}
 };
 return <section className="inspector-section reference-workbench" aria-label="Tracing reference">
  <PixelifyPanel onCreate={props.onCreatePixelified} busy={busy}/>
  <div className="section-heading"><span>TRACING REFERENCE</span><span className="muted">1 CELL = 1 PIXEL</span></div>
  <p className="reference-help">The canvas matches the PNG automatically: one image pixel per drawing cell. Larger images are resized uniformly to fit.</p>
  <button className="secondary reference-load" disabled={busy||loading} onClick={()=>file.current?.click()}><ImagePlus size={14}/>{loading?'Reading PNG…':doc?.reference?'Replace reference PNG':'Load reference PNG'}</button>
  {source&&doc?.reference&&<button className="text-button" disabled={busy||loading} onClick={()=>setShowAlignment(true)}>Fine-tune pixel alignment</button>}
  <input ref={file} className="visually-hidden" type="file" accept="image/png,.png" aria-label="Load tracing reference PNG" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void load(f);}}/>
  {error&&<p className="error-text" role="alert">{error}</p>}
  {doc?.reference&&<>
   <p className="reference-name">{doc.reference.name} · {doc.width} × {doc.height}<br/><span className="muted">Locked at (0, 0) · saved with project</span></p>
   <label className="reference-field">Canvas view<select aria-label="Tracing canvas view" value={props.view} onChange={e=>props.onView(e.target.value as CanvasView)}><option value="overlay">Trace overlay</option><option value="artwork">Artwork only</option><option value="reference">Reference only</option></select></label>
   <label className="reference-field">Reference opacity · {Math.round(props.referenceOpacity*100)}%<input aria-label="Reference viewing opacity" type="range" min="0" max="1" step="0.05" value={props.referenceOpacity} onChange={e=>props.onReferenceOpacity(Number(e.target.value))}/></label>
   <label className="reference-field">Artwork opacity · {Math.round(props.artworkOpacity*100)}%<input aria-label="Artwork viewing opacity" type="range" min="0" max="1" step="0.05" value={props.artworkOpacity} onChange={e=>props.onArtworkOpacity(Number(e.target.value))}/></label>
   <p className="reference-help">Viewing opacity affects the overlay. Downloads use your artwork’s original opacity. Reference-only view pauses drawing.</p>
   <button className="text-button" disabled={busy} onClick={props.onRemove}><Trash2 size={13}/>Remove reference</button>
  </>}
  {source&&showAlignment&&createPortal(<AlignmentDialog source={source} doc={doc} busy={busy} onClose={()=>setShowAlignment(false)} onApply={async(r,newCanvas)=>{if(await props.onApply(r,newCanvas))setShowAlignment(false);}}/>,document.body)}
 </section>;
}

function AlignmentDialog({source,doc,busy,onClose,onApply}:{source:ReferenceSource & {name:string};doc:PixelDocument|null;busy:boolean;onClose:()=>void;onApply:(r:ReferenceImage,newCanvas:boolean)=>Promise<void>}){
 const patternId=useId().replace(/:/g,''),dialog=useRef<HTMLElement>(null),sourceCanvas=useRef<HTMLCanvasElement>(null),preparedCanvas=useRef<HTMLCanvasElement>(null);
 const [alignment,setAlignment]=useState<ReferenceAlignment>(()=>fitReferenceAlignment(source.width,source.height));
 const [square,setSquare]=useState(true),[displayScale,setDisplayScale]=useState(Math.min(2,560/source.width,360/source.height)),[grid,setGrid]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const drag=useRef<{x:number;y:number;offsetX:number;offsetY:number}|null>(null);
 const result=useMemo(()=>{try{return {reference:prepareReference(source,source.name,alignment),error:''};}catch(e){return {reference:null,error:(e as Error).message};}},[source,alignment]);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;
  dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
  return()=>previous?.focus();
 },[]);
 useEffect(()=>{
  const c=sourceCanvas.current;if(!c)return;c.width=source.width;c.height=source.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(referenceRgba(source)),source.width,source.height),0,0);
 },[source]);
 useEffect(()=>{
  const c=preparedCanvas.current,r=result.reference;if(!c||!r)return;c.width=r.width;c.height=r.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(referenceRgba(r)),r.width,r.height),0,0);
 },[result.reference]);
 const update=(key:keyof ReferenceAlignment,value:number)=>setAlignment(old=>({...old,[key]:value,...(square&&key==='cellWidth'?{cellHeight:value}:square&&key==='cellHeight'?{cellWidth:value}:{})}));
 const fit=(width=alignment.width,height=alignment.height)=>{
  const x=source.width/width,y=source.height/height;
  setAlignment({width,height,offsetX:0,offsetY:0,cellWidth:square?Math.max(x,y):x,cellHeight:square?Math.max(x,y):y});
 };
 const start=(e:PointerEvent<SVGSVGElement>)=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,offsetX:alignment.offsetX,offsetY:alignment.offsetY};};
 const move=(e:PointerEvent<SVGSVGElement>)=>{const d=drag.current;if(!d)return;setAlignment(old=>({...old,offsetX:Math.max(-source.width,Math.min(source.width,Math.round((d.offsetX+(e.clientX-d.x)/displayScale)*1000)/1000)),offsetY:Math.max(-source.height,Math.min(source.height,Math.round((d.offsetY+(e.clientY-d.y)/displayScale)*1000)/1000))}));};
 const matching=doc?.width===alignment.width&&doc?.height===alignment.height;
 const apply=async(newCanvas:boolean)=>{if(!result.reference)return;setSaving(true);setError('');try{await onApply(result.reference,newCanvas);}catch(e){setError((e as Error).message);}finally{setSaving(false);}};
 const fields:[keyof ReferenceAlignment,string,number,number,number][]=[['width','Output width',1,MAX_CANVAS_SIDE,1],['height','Output height',1,MAX_CANVAS_SIDE,1],['cellWidth','Cell width (source px)',.125,4096,.25],['cellHeight','Cell height (source px)',.125,4096,.25],['offsetX','Grid offset X',-source.width,source.width,.25],['offsetY','Grid offset Y',-source.height,source.height,.25]];
 const previewScale=result.reference?Math.max(1,Math.min(12,Math.floor(320/Math.max(result.reference.width,result.reference.height)))):1;
 return <div className="modal-backdrop reference-backdrop" onClick={()=>{if(!saving)onClose();}}><section className="reference-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="reference-dialog-title" onClick={e=>e.stopPropagation()} onKeyDown={e=>{
  e.stopPropagation();
  if(e.key==='Escape'&&!saving){e.preventDefault();e.stopPropagation();onClose();}
  if(e.key==='Tab'){const items=dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select');if(!items?.length)return;const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
 }}>
  <button className="dialog-close icon-button" aria-label="Close reference alignment" disabled={saving} onClick={onClose}><X size={18}/></button>
  <span className="eyebrow">PREPARE A TRACING REFERENCE</span><h2 id="reference-dialog-title">Line up the pixels.</h2>
  <p className="reference-intro">Drag the green grid over the source. Adjust its spacing until cells follow the apparent art pixels, then inspect the prepared image. The source may have an uneven pixel pattern; choose the alignment that preserves the shapes you need.</p>
  <div className="reference-alignment-layout"><div className="reference-alignment-images">
   <div className="reference-preview-heading"><strong>Source + alignment grid</strong><span>{source.width} × {source.height} px</span></div>
   <div className="reference-source-viewport"><div className="reference-source-image" style={{width:source.width*displayScale,height:source.height*displayScale}}>
    <canvas ref={sourceCanvas} aria-label="Original reference image"/>
    <svg viewBox={`0 0 ${source.width} ${source.height}`} role="img" aria-label="Drag to position the reference grid" onPointerDown={start} onPointerMove={move} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}>
     {result.reference&&<><defs><pattern id={patternId} width={alignment.cellWidth} height={alignment.cellHeight} patternUnits="userSpaceOnUse" x={alignment.offsetX} y={alignment.offsetY}><path d={`M ${alignment.cellWidth} 0 H 0 V ${alignment.cellHeight}`} fill="none" stroke="#83ffc5" strokeOpacity="0.6" strokeWidth={.75/displayScale}/></pattern></defs>
     <rect x={alignment.offsetX} y={alignment.offsetY} width={alignment.width*alignment.cellWidth} height={alignment.height*alignment.cellHeight} fill={grid&&Math.min(alignment.cellWidth,alignment.cellHeight)*displayScale>=3?`url(#${patternId})`:'none'} stroke="#83ffc5" strokeWidth={2/displayScale}/></>}
    </svg>
   </div></div>
   <div className="reference-preview-controls"><label>Source zoom<input aria-label="Reference source zoom" type="range" min="0.05" max="8" step="0.05" value={displayScale} onChange={e=>setDisplayScale(Number(e.target.value))}/></label><button className="text-button" aria-pressed={grid} onClick={()=>setGrid(v=>!v)}><Eye size={14}/>Grid {grid?'on':'off'}</button></div>
   <div className="reference-preview-heading"><strong>Prepared reference</strong><span>{alignment.width} × {alignment.height} cells · nearest neighbor</span></div>
   <div className="reference-prepared-viewport">{result.reference&&<canvas ref={preparedCanvas} style={{width:alignment.width*previewScale,height:alignment.height*previewScale}} aria-label="Prepared native reference preview"/>}</div>
  </div><div className="reference-alignment-settings">
   <div className="reference-number-fields">{fields.map(([key,label,min,max,step])=><label className="reference-field" key={key}>{label}<input aria-label={label} type="number" min={min} max={max} step={step} value={alignment[key]} onChange={e=>update(key,Number(e.target.value))}/></label>)}</div>
   <label className="reference-check"><input type="checkbox" checked={square} onChange={e=>{setSquare(e.target.checked);if(e.target.checked)setAlignment(a=>({...a,cellHeight:a.cellWidth}));}}/>Keep cells square</label>
   <button className="secondary" onClick={()=>fit()}>Fit full image into output</button>
   {doc&&<button className="secondary" onClick={()=>fit(doc.width,doc.height)}>Fit to current canvas · {doc.width} × {doc.height}</button>}
   <button className="text-button" disabled={source.width>MAX_CANVAS_SIDE||source.height>MAX_CANVAS_SIDE} onClick={()=>setAlignment({width:source.width,height:source.height,offsetX:0,offsetY:0,cellWidth:1,cellHeight:1})}>Reset to native file pixels</button>
   <p className="reference-help">Grid spacing and offsets use source-file pixels. Each cell samples its center once; areas outside the source become transparent. Output supports up to 512 × 512 pixels.</p>
   <p className="reference-help">After applying, one prepared pixel equals one drawing cell at (0, 0). Reupload the original PNG to change the alignment later.</p>
   {(result.error||error)&&<p className="error-text" role="alert">{result.error||error}</p>}
   <button className="primary full" disabled={!result.reference||busy||saving} onClick={()=>void apply(true)}>Create matching tracing canvas</button>
   <button className="secondary" disabled={!result.reference||!matching||busy||saving} onClick={()=>void apply(false)}>Use on current canvas{!matching?' · size differs':''}</button>
   {!matching&&doc&&<p className="reference-help">Current canvas: {doc.width} × {doc.height}. Match that output size to attach here.</p>}
  </div></div>
 </section></div>;
}


function PixelifyPanel({onCreate,busy}:{onCreate:(doc:PixelDocument)=>Promise<void>;busy:boolean}){
 const [fileName,setFileName]=useState(''),[width,setWidth]=useState(64),[height,setHeight]=useState(64),[colors,setColors]=useState(24),[dither,setDither]=useState(true),[preview,setPreview]=useState<PixelDocument|null>(null),[error,setError]=useState(''),[working,setWorking]=useState(false);
 const input=useRef<HTMLInputElement>(null);
 const convert=async(file:File)=>{
  setError('');setWorking(true);setPreview(null);
  try{
   if(file.size>12*1024*1024)throw new Error('Choose an image smaller than 12 MB.');
   const bitmap=await createImageBitmap(file);
   try{
    if(bitmap.width>4096||bitmap.height>4096||bitmap.width*bitmap.height>4_000_000)throw new Error('Source images are limited to 4096 px per side and 4 million pixels.');
    const c=document.createElement('canvas');c.width=width;c.height=height;
    const ctx=c.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Could not prepare image pixels.');
    ctx.clearRect(0,0,width,height);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(bitmap,0,0,width,height);
    const data=ctx.getImageData(0,0,width,height).data, work=new Float32Array(width*height*4);
    for(let i=0;i<width*height;i++){work[i*4]=data[i*4];work[i*4+1]=data[i*4+1];work[i*4+2]=data[i*4+2];work[i*4+3]=data[i*4+3];}
    const levels=Math.max(2,Math.min(8,Math.round(Math.cbrt(colors))));
    const step=255/(levels-1),palette=new Set<string>(),pixels:number[]=[];
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
     const i=y*width+x,o=i*4,a=Math.round(work[o+3]);if(a<12){pixels.push(0);continue;}
     const quant=(v:number)=>Math.max(0,Math.min(255,Math.round(v/step)*step));
     const r=quant(work[o]),g=quant(work[o+1]),b=quant(work[o+2]),hex='#'+[r,g,b].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
     palette.add(hex);pixels.push((((Math.round(r)&255)<<24)|((Math.round(g)&255)<<16)|((Math.round(b)&255)<<8)|a)>>>0);
     if(dither){
      const er=work[o]-r,eg=work[o+1]-g,eb=work[o+2]-b;
      const spread=(xx:number,yy:number,f:number)=>{if(xx<0||xx>=width||yy>=height)return;const p=(yy*width+xx)*4;if(work[p+3]<12)return;work[p]+=er*f;work[p+1]+=eg*f;work[p+2]+=eb*f;};
      spread(x+1,y,7/16);spread(x-1,y+1,3/16);spread(x,y+1,5/16);spread(x+1,y+1,1/16);
     }
    }
    const doc=createDocument(file.name.replace(/\.[^.]+$/,'').slice(0,72)||'Pixelified image',width,height,'pixelified-image');
    doc.layers[0].pixels=pixels;doc.palette=[...palette].slice(0,128);setPreview(doc);setFileName(file.name);
   }finally{bitmap.close();}
  }catch(e){setError((e as Error).message);}finally{setWorking(false);}
 };
 const choose=async(f:File)=>{await convert(f);};
 return <section className="inspector-section" aria-label="Pixel-ify image">
  <div className="section-heading"><span>PIXEL-IFY</span><span className="muted">IMAGE → PIXELS</span></div>
  <p className="reference-help">Turn a photo, illustration, or screenshot into editable pixel art. Choose a small output size and color depth, then open it as a new canvas.</p>
  <input ref={input} className="visually-hidden" type="file" accept="image/*" aria-label="Choose image to pixel-ify" onChange={e=>{const f=e.target.files?.[0];e.target.value='';if(f)void choose(f);}}/>
  <button className="secondary reference-load" disabled={busy||working} onClick={()=>input.current?.click()}><ImagePlus size={14}/>{working?'Converting…':fileName?'Choose another image':'Upload image'}</button>
  <div className="reference-number-fields">
   <label className="reference-field">Pixel width · {width}<input type="range" min="8" max="256" step="1" value={width} onChange={e=>setWidth(Number(e.target.value))}/></label>
   <label className="reference-field">Pixel height · {height}<input type="range" min="8" max="256" step="1" value={height} onChange={e=>setHeight(Number(e.target.value))}/></label>
   <label className="reference-field">Color count · {colors}<input type="range" min="8" max="64" step="1" value={colors} onChange={e=>setColors(Number(e.target.value))}/></label>
  </div>
  <label className="reference-check"><input type="checkbox" checked={dither} onChange={e=>setDither(e.target.checked)}/>Use dithering for smoother gradients</label>
  {error&&<p className="error-text" role="alert">{error}</p>}
  {preview&&<><p className="reference-name">{preview.width} × {preview.height} · {preview.palette.length} palette colors<br/><span className="muted">Preview is the exact editable pixel data.</span></p>
   <div style={{background:'var(--panel)',padding:8,display:'grid',placeItems:'center',maxHeight:240,overflow:'auto'}}><canvas ref={el=>{if(!el)return;el.width=preview.width;el.height=preview.height;const c=el.getContext('2d');if(!c)return;const img=c.createImageData(preview.width,preview.height);preview.layers[0].pixels.forEach((p,i)=>{img.data[i*4]=p>>>24;img.data[i*4+1]=(p>>>16)&255;img.data[i*4+2]=(p>>>8)&255;img.data[i*4+3]=p&255;});c.putImageData(img,0,0);el.style.width=Math.min(220,preview.width*4)+'px';el.style.height='auto';el.style.imageRendering='pixelated';}}/></div>
   <button className="primary full" disabled={busy||working} onClick={()=>void onCreate(preview)}>Open as editable canvas</button>
  </>}
 </section>;
}
