'use client';
import {useEffect,useRef} from 'react';
import {Check,Copy,Plus,Trash2} from 'lucide-react';
import {STAMP_LIBRARY_LIMIT,stampRgba,type StampAsset} from '../lib/stamp-library.ts';

export function StampPreview({stamp}:{stamp:StampAsset}){
 const ref=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
  const canvas=ref.current;if(!canvas)return;
  canvas.width=stamp.width;canvas.height=stamp.height;
  canvas.getContext('2d')?.putImageData(new ImageData(stampRgba(stamp),stamp.width,stamp.height),0,0);
 },[stamp]);
 return <canvas ref={ref} className="stamp-thumb" aria-hidden="true"/>;
}
export default function StampWorkbench({active,library,name,onName,onSelect,onCapture,onSave,onDelete,canSave,busy}:{
 active:StampAsset|null;library:StampAsset[];name:string;onName:(name:string)=>void;
 onSelect:(stamp:StampAsset)=>void;onCapture:()=>void;onSave:()=>void;onDelete:(id:string)=>void;
 canSave:boolean;busy:boolean;
}){
 return <section className="inspector-section stamp-workbench" data-guide="stamp-workbench">
  <div className="section-heading"><span>STAMP WORKBENCH</span><Copy size={14}/></div>
  <p>Choose <strong>Stamp (S)</strong>, drag across the canvas to capture artwork, then click to place copies. Transparent parts leave underlying pixels untouched.</p>
  <button type="button" className="secondary full stamp-capture-button" onClick={onCapture} disabled={busy}>
   <Plus size={14}/>Capture a new stamp</button>
  {active&&<div className="stamp-active">
    <StampPreview stamp={active}/><div><b>Ready to place</b><small>{active.width} × {active.height} pixels</small></div>
   </div>}
  {active&&<div className="stamp-save-controls">
    <input aria-label="Reusable stamp name" value={name} maxLength={48} onChange={e=>onName(e.target.value)} placeholder="Name your stamp"/>
    <button type="button" className="secondary" onClick={onSave} disabled={busy||!canSave}><Check size={14}/>Save</button>
   </div>}
  <div className="stamp-library-heading">YOUR STAMPS <span>{library.length} / {STAMP_LIBRARY_LIMIT}</span></div>
  {library.length?<div className="stamp-library-list">{library.map(stamp=><div key={stamp.id} className="stamp-library-entry">
    <button type="button" onClick={()=>onSelect(stamp)} aria-label={'Use '+stamp.name+' stamp'} title={'Use '+stamp.name} disabled={busy}>
     <StampPreview stamp={stamp}/><span>{stamp.name}</span>
    </button>
    <button type="button" className="stamp-library-delete" aria-label={'Delete '+stamp.name+' from stamp library'}
     title="Delete saved stamp" onClick={()=>onDelete(stamp.id)} disabled={busy}><Trash2 size={14}/></button>
   </div>)}</div>:
   <p className="stamp-empty">No saved stamps yet. Capture a tree, rock, window, or tile and name it. Your stamps stay available across projects in this browser's workspace.</p>}
 </section>;
}
