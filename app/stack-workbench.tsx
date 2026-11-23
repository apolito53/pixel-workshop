'use client';
import {useEffect,useRef,useState,type PointerEvent} from 'react';
import {ArrowDown,ArrowUp,Box,CopyPlus,Layers,Minus,Plus,RotateCcw,Save,Trash2} from 'lucide-react';
import {frameCount,MAX_ANIMATION_FRAMES,type PaintCommand,type PixelDocument,type StackSettings} from '../lib/pixels.ts';
import {createSpriteStackRenderer,DEFAULT_STACK_VIEW,type StackHit,type StackRenderFrame} from '../lib/sprite-stack-renderer.ts';

type Pose=NonNullable<StackSettings['view']>;
type Commit=(commands:PaintCommand[])=>Promise<boolean>;
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const wrap=(angle:number)=>(angle%360+360)%360;
const zLabel=(doc:PixelDocument,index:number)=>Number((doc.stack!.zMin+index*doc.stack!.sliceHeight).toFixed(4));

export function StackPreview({doc,busy,editing,commit,onPick}:{doc:PixelDocument;busy:boolean;editing:boolean;commit:Commit;onPick:(hit:StackHit)=>void}){
 const saved=doc.stack?.view??DEFAULT_STACK_VIEW;
 const [pose,setPose]=useState<Pose>(saved);
 const [size,setSize]=useState({width:192,height:192});
 const [problem,setProblem]=useState('');
 const [empty,setEmpty]=useState(false);
 const [orbiting,setOrbiting]=useState(false);
 const pending=useRef(0),paintedAt=useRef(0);
 const latest=useRef({doc,pose,size,editing,orbiting});
 const canvas=useRef<HTMLCanvasElement>(null);
 const stage=useRef<HTMLDivElement>(null);
 const last=useRef<{doc:PixelDocument;frame:StackRenderFrame}|null>(null);
 const renderer=useRef<ReturnType<typeof createSpriteStackRenderer>|null>(null);
 const pointer=useRef<{id:number;x:number;y:number;pose:Pose;moved:boolean;doc:PixelDocument}|null>(null);
 const savedKey=[saved.yaw,saved.pitch,saved.zoom,saved.spread].join('/');
 const previousSaved=useRef(savedKey);
 useEffect(()=>{
  if(previousSaved.current!==savedKey){
   previousSaved.current=savedKey;
   setPose(saved);
  }
 },[saved,savedKey]);
 useEffect(()=>{
  const el=stage.current;if(!el)return;
  const resize=()=>{
   // Fit the native preview buffer to its window without sampling an
   // entire high-DPI desktop-sized canvas on each brush or pointer event.
   const w=el.clientWidth,h=el.clientHeight;
   if(w<1||h<1)return;
   const factor=Math.min(1,300/Math.max(w,h));
   const width=Math.max(1,Math.round(w*factor)),height=Math.max(1,Math.round(h*factor));
   setSize(s=>s.width===width&&s.height===height?s:{width,height});
  };
  resize();
  const observer=new ResizeObserver(resize);
  observer.observe(el);
  return()=>observer.disconnect();
 },[]);
 useEffect(()=>()=>{cancelAnimationFrame(pending.current);pending.current=0;},[]);
 useEffect(()=>{
  latest.current={doc,pose,size,editing,orbiting};
  if(pending.current)return;
  const paint=(now:number)=>{
   const {doc,pose,size,editing,orbiting}=latest.current;
   if(editing&&now-paintedAt.current<65){
    pending.current=requestAnimationFrame(paint);
    return;
   }
   pending.current=0;
   const el=canvas.current;if(!el)return;
   try{
    // Keep pointer input on the 2D drawing surface responsive. Long strokes
    // share one queued repaint and use a smaller preview until release.
    const scale=(editing||orbiting)?Math.min(1,176/Math.max(size.width,size.height)):1;
    const width=Math.max(1,Math.round(size.width*scale)),height=Math.max(1,Math.round(size.height*scale));
    renderer.current??=createSpriteStackRenderer();
    const result=renderer.current.render(doc,{width,height,...pose});
    if(el.width!==result.width)el.width=result.width;
    if(el.height!==result.height)el.height=result.height;
    const ctx=el.getContext('2d');if(!ctx)throw new Error('Canvas preview unavailable.');
    ctx.putImageData(new ImageData(result.rgba,result.width,result.height),0,0);
    last.current={doc,frame:result};setProblem('');
    setEmpty(!new Uint32Array(result.rgba.buffer,result.rgba.byteOffset,result.rgba.byteLength/4).some(pixel=>pixel>>>24));
    paintedAt.current=now;
   }catch(err){
    last.current=null;
    el.getContext('2d')?.clearRect(0,0,el.width,el.height);
    setProblem((err as Error).message);
   }
  };
  pending.current=requestAnimationFrame(paint);
 },[doc,pose,size,editing,orbiting]);
 const setView=(change:Partial<Pose>)=>setPose(p=>({...p,...change}));
 const start=(e:PointerEvent<HTMLCanvasElement>)=>{
  if(busy||!e.isPrimary||e.button!==0)return;
  pointer.current={id:e.pointerId,x:e.clientX,y:e.clientY,pose,moved:false,doc};
  e.currentTarget.setPointerCapture(e.pointerId);
 };
 const move=(e:PointerEvent<HTMLCanvasElement>)=>{
  const p=pointer.current;
  if(!p||p.id!==e.pointerId)return;
  const dx=e.clientX-p.x,dy=e.clientY-p.y;
  if(!p.moved&&dx*dx+dy*dy<16)return;
  if(!p.moved)setOrbiting(true);
  p.moved=true;
  setPose({...p.pose,yaw:wrap(p.pose.yaw-dx*.6),pitch:clamp(p.pose.pitch+dy*.5,-90,90)});
 };
 const end=(e:PointerEvent<HTMLCanvasElement>)=>{
  const p=pointer.current;if(!p||p.id!==e.pointerId)return;
  pointer.current=null;setOrbiting(false);
  if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  const shown=last.current;
  // A remote reorder may arrive after pointerdown or before paint runs.
  // Picks belong to the exact source snapshot used for the displayed frame.
  if(p.moved||busy||!shown||p.doc!==doc||shown.doc!==doc)return;
  const bounds=e.currentTarget.getBoundingClientRect();
  const x=Math.floor((e.clientX-bounds.left)*shown.frame.width/bounds.width);
  const y=Math.floor((e.clientY-bounds.top)*shown.frame.height/bounds.height);
  const hit=shown.frame.pick(x,y);if(hit)onPick(hit);
 };
 const modified=Object.entries(pose).some(([key,value])=>Math.abs(saved[key as keyof Pose]-value)>.0001);
 return <section className="stack-preview" aria-label="Live sprite stack preview">
  <header><span><Box size={14}/> Orbit preview</span><span className="stack-angle">{Math.round(wrap(pose.yaw))%360}° / {Math.round(pose.pitch)}°</span></header>
  <div className="stack-stage" data-guide="stack-orbit" ref={stage}>
   <canvas ref={canvas} aria-label="Sprite stack orbit. Drag or use arrow keys to rotate. Click a pixel to edit its slice." tabIndex={0}
    onPointerDown={start} onPointerMove={move} onPointerUp={end}
    onPointerCancel={()=>{pointer.current=null;setOrbiting(false);}} onLostPointerCapture={()=>{pointer.current=null;setOrbiting(false);}}
    onKeyDown={e=>{
     const step=e.shiftKey?15:5;
     const turns:Record<string,Partial<Pose>>={ArrowLeft:{yaw:wrap(pose.yaw-step)},ArrowRight:{yaw:wrap(pose.yaw+step)},ArrowUp:{pitch:clamp(pose.pitch+step,-90,90)},ArrowDown:{pitch:clamp(pose.pitch-step,-90,90)},Home:saved};
     if(turns[e.key]){e.preventDefault();e.stopPropagation();setView(turns[e.key]);}
    }}/>
   {empty&&!problem&&<span className="stack-empty-hint">Paint the slice to see its volume here.</span>}
   {problem&&<p className="stack-preview-error" role="alert">{problem}</p>}
  </div>
  <div className="stack-preview-bar">
   <label className="stack-spread">Spread <input aria-label="Spread stack slices" type="range" min={0} max={100} value={Math.round(pose.spread*100)} onChange={e=>setView({spread:Number(e.target.value)/100})}/></label>
   <button type="button" title="Zoom out of stack" aria-label="Zoom out of stack" disabled={pose.zoom<=.1} onClick={()=>setView({zoom:Math.max(.1,pose.zoom/1.25)})}><Minus size={14}/></button>
   <button type="button" title="Zoom in on stack" aria-label="Zoom in on stack" disabled={pose.zoom>=8} onClick={()=>setView({zoom:Math.min(8,pose.zoom*1.25)})}><Plus size={14}/></button>
   <button type="button" title="Restore saved orbit view" aria-label="Restore saved orbit view" disabled={!modified} onClick={()=>setPose(saved)}><RotateCcw size={14}/></button>
   <button type="button" title="Save this orbit view in the project" aria-label="Save orbit view" disabled={!modified||busy} onClick={()=>void commit([{op:'stack_settings',view:pose}])}><Save size={14}/></button>
  </div>
  <p className="stack-gesture">Drag to orbit · Click a pixel to edit its slice</p>
 </section>;
}

export function SliceControls({doc,active,busy,full,select,commit}:{doc:PixelDocument;active:number;busy:boolean;full:boolean;select:(slice:number)=>void;commit:Commit}){
 const count=frameCount(doc);
 const mutate=async(op:PaintCommand,next:number)=>{if(await commit([op]))select(next);};
 return <section className="slice-controls" data-guide="stack-slices" aria-label="Stack slices">
  <div className="slice-control-title"><Layers size={15}/> Slice <output>{active+1} / {count}</output><span>Z {zLabel(doc,active)}</span></div>
  <div className="slice-navigation">
   <button type="button" title="Previous slice" aria-label="Previous slice" disabled={busy||active<=0} onClick={()=>select(active-1)}><ArrowDown size={15}/></button>
   <input type="range" aria-label="Active stack slice" min={1} max={count} value={active+1} disabled={busy||count===1} onChange={e=>select(Number(e.target.value)-1)}/>
   <button type="button" title="Next slice" aria-label="Next slice" disabled={busy||active>=count-1} onClick={()=>select(active+1)}><ArrowUp size={15}/></button>
  </div>
  <div className="slice-actions">
   <button type="button" disabled={busy||full} aria-label="Insert blank slice above" onClick={()=>void mutate({op:'slice_insert',index:active+1},active+1)}><Plus size={13}/>Insert</button>
   <button type="button" disabled={busy||full} aria-label="Duplicate slice above" onClick={()=>void mutate({op:'slice_insert',index:active+1,source_slice:active},active+1)}><CopyPlus size={13}/>Duplicate</button>
   <button type="button" disabled={busy||count===1} aria-label="Delete selected slice" onClick={()=>void mutate({op:'slice_delete',index:active},Math.min(active,count-2))}><Trash2 size={13}/>Delete</button>
   <button type="button" disabled={busy||active===0} aria-label="Move selected slice down" title="Move slice down" onClick={()=>void mutate({op:'slice_move',from:active,to:active-1},active-1)}><ArrowDown size={13}/>Lower</button>
   <button type="button" disabled={busy||active===count-1} aria-label="Move selected slice up" title="Move slice up" onClick={()=>void mutate({op:'slice_move',from:active,to:active+1},active+1)}><ArrowUp size={13}/>Raise</button>
  </div>
 </section>;
}

export function StackSettingsPanel({doc,busy,commit,onDisable}:{doc:PixelDocument;busy:boolean;commit:Commit;onDisable:()=>void}){
 const settings=doc.stack!;
 const [x,setX]=useState(String(settings.origin[0])),[y,setY]=useState(String(settings.origin[1]));
 const [base,setBase]=useState(String(settings.zMin)),[step,setStep]=useState(String(settings.sliceHeight));
 const fields=[
  ['Origin X',x,setX],['Origin Y',y,setY],['Base Z',base,setBase],['Slice height',step,setStep],
 ] as const;
 const valid=fields.every(([,value])=>value.trim()!==''&&Number.isFinite(Number(value)))&&Number(step)>0;
 const changed=Number(x)!==settings.origin[0]||Number(y)!==settings.origin[1]||Number(base)!==settings.zMin||Number(step)!==settings.sliceHeight;
 const canConvert=frameCount(doc)<=MAX_ANIMATION_FRAMES;
 return <section className="inspector-section stack-settings">
  <div className="section-heading"><span>STACK GEOMETRY</span><Layers size={14}/></div>
  <div className="stack-setting-grid">{fields.map(([label,value,change])=>
   <label key={label}>{label}<input type="number" step="any" value={value} onChange={e=>change(e.target.value)}/></label>)}</div>
  <button className="secondary full" type="button" disabled={busy||!valid||!changed}
   onClick={()=>void commit([{op:'stack_settings',origin:[Number(x),Number(y)],zMin:Number(base),sliceHeight:Number(step)}])}>Apply geometry</button>
  <button className="secondary full" type="button" disabled={busy||!canConvert} onClick={onDisable}>Use slices as animation frames</button>
  {!canConvert&&<p className="layer-note">Animation projects support up to {MAX_ANIMATION_FRAMES} frames.</p>}
 </section>;
}
