'use client';
import {useCallback,useEffect,useRef,useState,type PointerEvent as PE} from 'react';
import {Pencil,Eraser,PaintBucket,Pipette,Minus,Square,Circle,Grid2X2,Undo2,Redo2,FilePlus,Download,FolderOpen,Eye,EyeOff,Plus,ZoomIn,ZoomOut,ChevronDown,X,Layers,Scan,Copy,ClipboardPaste,FlipHorizontal2,FlipVertical2,Trash2,Maximize,Play,Pause,Film,CopyPlus,Sparkles,Palette,SlidersHorizontal} from 'lucide-react';
import {applyCommands,composite,frameCount,frameView,readRegion,type PixelDocument,type PaintCommand,type PixelRegion} from '../lib/pixels.ts';
import {buildSpriteSheet} from '../lib/sprite-sheet.ts';
import {generateEffectCommands,hasFreeEffectLayerSlot,type EffectKind,EFFECT_KINDS} from '../lib/effects.ts';
import {EditQueue,type EditorSnapshot,type QueueState} from '../lib/edit-queue.ts';
import {INSPECTOR_TABS,inspectorTabForKey,type InspectorTab} from '../lib/inspector-tabs.ts';
type Snapshot=EditorSnapshot;
type Tool='select'|'pencil'|'eraser'|'fill'|'picker'|'line'|'rect'|'ellipse';
const tools=[['pencil',Pencil,'Pencil','B'],['eraser',Eraser,'Eraser','E'],['fill',PaintBucket,'Fill','G'],['picker',Pipette,'Eyedropper','I'],['line',Minus,'Line','L'],['rect',Square,'Rectangle','R'],['ellipse',Circle,'Ellipse','O'],['select',Scan,'Select / move','V']] as const;
async function api<T>(path:string,body?:unknown):Promise<T>{const r=await fetch('/api/pixel/'+path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});const d=await r.json() as T & {error?:string};if(!r.ok)throw Object.assign(new Error(d.error||'Request failed'),{status:r.status});return d;}
function download(name:string,data:Blob){const url=URL.createObjectURL(data),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const pixelOps = new Set(['pixel','fill','line','rect','ellipse','transform','paste','clear']);
const targetFrame=(ops:PaintCommand[],frame:number):PaintCommand[]=>
  ops.map(op=>pixelOps.has(op.op)&&op.frame===undefined?{...op,frame}:op);
function render(c:HTMLCanvasElement|null,d:PixelDocument|null,z:number,grid=false,ghosts:PixelDocument[]=[]){
 if(!c||!d)return;
 c.width=d.width*z;c.height=d.height*z;
 const ctx=c.getContext('2d')!,temp=document.createElement('canvas');temp.width=d.width;temp.height=d.height;
 const t= temp.getContext('2d')!;
 ctx.imageSmoothingEnabled=false;
 const paint=(doc:PixelDocument,alpha:number)=>{
   t.putImageData(new ImageData(new Uint8ClampedArray(composite(doc)),doc.width,doc.height),0,0);
   ctx.globalAlpha=alpha;ctx.drawImage(temp,0,0,c.width,c.height);
 };
 ghosts.forEach((ghost,i)=>paint(ghost,i===0?.25:.15));paint(d,1);ctx.globalAlpha=1;
 if(grid&&z>=3){ctx.strokeStyle='#ffffff38';ctx.beginPath();for(let x=0;x<=d.width;x++){ctx.moveTo(x*z+.5,0);ctx.lineTo(x*z+.5,c.height);}for(let y=0;y<=d.height;y++){ctx.moveTo(0,y*z+.5);ctx.lineTo(c.width,y*z+.5);}ctx.stroke();}
}
function FrameThumbnail({doc,index}:{doc:PixelDocument;index:number}){
 const ref=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
  const c=ref.current;if(!c)return;
  const view=frameView(doc,index);c.width=doc.width;c.height=doc.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(composite(view)),doc.width,doc.height),0,0);
 },[doc,index]);
 return <canvas ref={ref} className="frame-thumbnail" aria-hidden="true"/>;
}
export default function Editor(){
 const [inspectorTab,setInspectorTab]=useState<InspectorTab>('draw');
 const [mobileLayout,setMobileLayout]=useState(false),[inspectorOpen,setInspectorOpen]=useState(false);
 const inspectorRef=useRef<HTMLElement>(null),drawerToggleRef=useRef<HTMLButtonElement>(null),drawerCloseRef=useRef<HTMLButtonElement>(null);
 const [frame,setFrame]=useState(0),[playing,setPlaying]=useState(false),[onion,setOnion]=useState(false),[effectKind,setEffectKind]=useState<EffectKind>('embers'),[effectSeed,setEffectSeed]=useState(53),[snap,setSnap]=useState<Snapshot|null>(null),[list,setList]=useState<PixelDocument[]>([]),[tool,setTool]=useState<Tool>('pencil'),[ink,setInk]=useState('#f6da92'),[layer,setLayer]=useState('base'),[zoom,setZoom]=useState(10),[grid,setGrid]=useState(true),[filled,setFilled]=useState(true),[busy,setBusy]=useState(false),[notice,setNotice]=useState('Opening workspace…'),[error,setError]=useState(''),[cursor,setCursor]=useState('X —   Y —'),[hover,setHover]=useState<{x:number;y:number}|null>(null),[modal,setModal]=useState(false),[name,setName]=useState('Untitled sprite'),[width,setWidth]=useState(64),[height,setHeight]=useState(64),[scale,setScale]=useState(1),[selection,setSelection]=useState<PixelRegion|null>(null),[clipboard,setClipboard]=useState<{width:number;height:number;pixels:number[]}|null>(null),[previewScale,setPreviewScale]=useState(1),[fitMode,setFitMode]=useState(true),[saveState,setSaveState]=useState<Pick<QueueState,'pending'|'saving'|'error'>>({pending:0,saving:false,error:null});
 const queue=useRef<EditQueue|null>(null),viewport=useRef<HTMLDivElement>(null),selectionDrag=useRef<{base:Snapshot;start:{x:number;y:number};source:PixelRegion|null;region:PixelRegion;layer:string;frame:number}|null>(null),canvas=useRef<HTMLCanvasElement>(null),preview=useRef<HTMLCanvasElement>(null),file=useRef<HTMLInputElement>(null),current=useRef(snap),locked=useRef(false),stroke=useRef<{base:Snapshot;start:{x:number;y:number};last:{x:number;y:number};ops:PaintCommand[];frame:number}|null>(null);
 const present=useCallback((s:Snapshot)=>{current.current=s;setSnap(s);setLayer(l=>s.doc.layers.some(x=>x.id===l)?l:s.doc.layers[0].id);},[]);
 const showQueue=useCallback((state:QueueState)=>{
  let visible=state.snapshot;
  const st=stroke.current,drag=selectionDrag.current;
  if(st){st.base=state.snapshot;visible={...state.snapshot,doc:applyCommands(state.snapshot.doc,targetFrame(st.ops,st.frame))};}
  else if(drag){drag.base=state.snapshot;if(drag.source)visible={...state.snapshot,doc:applyCommands(state.snapshot.doc,[{op:'transform',mode:'move',layer:drag.layer,frame:drag.frame,...drag.source,x2:drag.region.x,y2:drag.region.y}])};}
  present(visible);setSaveState({pending:state.pending,saving:state.saving,error:state.error});
  setNotice(state.error?`Save paused · ${state.pending} edits kept locally`:state.pending?`Saving ${state.pending} edit${state.pending===1?'':'s'}…`:'All changes saved');
  const d=state.snapshot.doc;setList(items=>items.map(p=>p.id===d.id?{...p,name:d.name,revision:d.revision,updatedAt:d.updatedAt}:p));
 },[present]);
 const adopt=useCallback((s:Snapshot)=>{
  if(current.current?.doc.id!==s.doc.id){setSelection(null);setFrame(0);setPlaying(false);setFitMode(true);}
  queue.current?.dispose();queue.current=new EditQueue(s,request=>api<Snapshot>('projects/'+s.doc.id,request),showQueue);
  setSaveState({pending:0,saving:false,error:null});present(s);
 },[present,showQueue]);
 const refresh=useCallback(async()=>setList(await api<PixelDocument[]>('projects')),[]);
 useEffect(()=>{let alive=true;(async()=>{try{const entries=await api<PixelDocument[]>('projects');if(!alive)return;setList(entries);const s=entries.length?await api<Snapshot>('projects/'+entries[0].id):await api<Snapshot>('projects',{demo:true});if(alive){adopt(s);setNotice('All changes saved');await refresh();}}catch(e){if(alive)setError((e as Error).message);}})();return()=>{alive=false;queue.current?.dispose();};},[adopt,refresh]);
 useEffect(()=>{
  const doc=snap?.doc;if(!doc)return;
  const index=Math.min(frame,frameCount(doc)-1),ghosts:PixelDocument[]=[];
  if(onion&&frameCount(doc)>1){
    if(index>0)ghosts.push(frameView(doc,index-1));
    if(index+1<frameCount(doc))ghosts.push(frameView(doc,index+1));
  }
  const view=frameView(doc,index);
  render(canvas.current,view,zoom,grid,ghosts);render(preview.current,view,previewScale);
 },[snap,frame,zoom,grid,previewScale,onion]);
 useEffect(()=>{if(snap)setFrame(i=>Math.min(i,frameCount(snap.doc)-1));},[snap?.doc.animation?.frames.length,snap?.doc.id]);
 useEffect(()=>{
   if(!playing||!snap||frameCount(snap.doc)<2)return;
   const timer=setInterval(()=>setFrame(i=>(i+1)%frameCount(current.current?.doc||snap.doc)),1000/(snap.doc.animation?.fps??8));
   return()=>clearInterval(timer);
 },[playing,snap?.doc.id,snap?.doc.animation?.fps,snap?.doc.animation?.frames.length]);
 useEffect(()=>{
  const media=window.matchMedia('(max-width: 800px)');
  const update=()=>{setMobileLayout(media.matches);if(!media.matches)setInspectorOpen(false);};
  update();media.addEventListener('change',update);
  return()=>media.removeEventListener('change',update);
 },[]);
 useEffect(()=>{
  const panel=inspectorRef.current?.querySelector<HTMLElement>('.inspector-panel:not([hidden])');
  if(panel)panel.scrollTop=0;
 },[inspectorTab]);
 useEffect(()=>{
  if(!mobileLayout||!inspectorOpen)return;
  drawerCloseRef.current?.focus();
  const handle=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){
    e.preventDefault();e.stopImmediatePropagation();
    setInspectorOpen(false);drawerToggleRef.current?.focus();return;
   }
   if(e.key==='Tab'){
    const focusable=Array.from(inspectorRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href],summary,[tabindex="0"]')??[])
      .filter(el=>el.getClientRects().length>0&&!el.closest('[hidden]'));
    if(!focusable.length)return;
    const first=focusable[0],last=focusable[focusable.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
   }
  };
  window.addEventListener('keydown',handle,true);
  return()=>window.removeEventListener('keydown',handle,true);
 },[mobileLayout,inspectorOpen]);
 useEffect(()=>{const element=viewport.current;if(!element||!snap||!fitMode)return;
  const fit=()=>{
   const narrow=window.matchMedia('(max-width: 800px)').matches;
   const horizontal=narrow?28:112,vertical=narrow?54:97;
   setZoom(Math.max(1,Math.min(24,Math.floor(Math.min((element.clientWidth-horizontal)/snap.doc.width,
    (element.clientHeight-vertical)/snap.doc.height)))));
  };
  fit();const observer=new ResizeObserver(fit);observer.observe(element);
  return()=>observer.disconnect();
 },[snap?.doc.id,snap?.doc.width,snap?.doc.height,fitMode,mobileLayout]);
 useEffect(()=>setSelection(null),[layer]);
 useEffect(()=>setHover(null),[zoom,snap?.doc.id]);
 useEffect(()=>{const t=setInterval(async()=>{
  const q=queue.current;if(!q||q.state.pending||locked.current||stroke.current||selectionDrag.current||document.hidden)return;
  const before=q.state;
  try{const s=await api<Snapshot>('projects/'+before.snapshot.doc.id);
   if(queue.current===q&&!q.state.pending&&q.state.version===before.version&&!locked.current&&!stroke.current&&!selectionDrag.current&&s.doc.revision!==before.snapshot.doc.revision){adopt(s);setNotice('Canvas updated');}
   if(queue.current===q&&!q.state.pending)await refresh();
  }catch{}
 },3000);return()=>clearInterval(t);},[adopt,refresh]);
 useEffect(()=>{const beforeUnload=(e:BeforeUnloadEvent)=>{if(queue.current?.state.pending||stroke.current||selectionDrag.current){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',beforeUnload);return()=>window.removeEventListener('beforeunload',beforeUnload);},[]);
 const commit=useCallback(async(ops:PaintCommand[],base?:Snapshot,action='paint')=>{
  const q=queue.current;if(!q||locked.current||base&&base.doc.id!==q.state.snapshot.doc.id)return false;
  if(action==='undo'&&!q.state.snapshot.canUndo||action==='redo'&&!q.state.snapshot.canRedo)return false;
  setError('');try{q.enqueue({action:action as 'paint'|'undo'|'redo',...(action==='paint'?{commands:targetFrame(ops,Math.min(frame,frameCount(q.state.snapshot.doc)-1))}:{})});return true;}
  catch(e){present(q.state.snapshot);setError((e as Error).message);return false;}
 },[present,frame]);
 const create=async(demo:boolean|'cottage'=false,document?:unknown,asCopy=false)=>{
  if(locked.current||stroke.current||selectionDrag.current)return;locked.current=true;setBusy(true);
  try{if(!asCopy)await queue.current?.flush();const s=await api<Snapshot>('projects',{name,width,height,demo,document});adopt(s);setFitMode(true);setModal(false);setError('');setNotice('All changes saved');await refresh();}
  catch(e){setError((e as Error).message);}finally{locked.current=false;setBusy(false);}
 };
 const open=async(id:string)=>{
  if(locked.current||stroke.current||selectionDrag.current)return;locked.current=true;setBusy(true);
  try{await queue.current?.flush();adopt(await api<Snapshot>('projects/'+id));setError('');setNotice('All changes saved');}
  catch(e){setError((e as Error).message);}finally{locked.current=false;setBusy(false);}
 };
 const point=(e:PE<HTMLCanvasElement>)=>{const d=current.current!.doc,b=e.currentTarget.getBoundingClientRect();return {x:Math.max(0,Math.min(d.width-1,Math.floor((e.clientX-b.left)/b.width*d.width))),y:Math.max(0,Math.min(d.height-1,Math.floor((e.clientY-b.top)/b.height*d.height)))};};
 const copySelection=()=>{const doc=current.current?.doc;if(!doc||!selection)return;setClipboard({width:selection.width,height:selection.height,pixels:readRegion(doc,layer,selection,Math.min(frame,frameCount(doc)-1))});setNotice(`Copied ${selection.width} × ${selection.height} pixels`);};
 const pasteSelection=()=>{const doc=current.current?.doc;if(!doc||!clipboard||locked.current)return;if(clipboard.width>doc.width||clipboard.height>doc.height){setError('The copied area is larger than this canvas.');return;}const region={x:Math.min(doc.width-clipboard.width,(selection?.x??-2)+2),y:Math.min(doc.height-clipboard.height,(selection?.y??-2)+2),width:clipboard.width,height:clipboard.height};setSelection(region);setTool('select');void commit([{op:'paste',layer,...region,pixels:clipboard.pixels}]);};
 const transformSelection=(mode:string,dx=0,dy=0)=>{const doc=current.current?.doc;if(!doc||!selection||locked.current)return;const region={...selection,x:Math.max(0,Math.min(doc.width-selection.width,selection.x+dx)),y:Math.max(0,Math.min(doc.height-selection.height,selection.y+dy))};if(mode==='move'&&region.x===selection.x&&region.y===selection.y)return;void commit([{op:'transform',layer,mode,...selection,x2:region.x,y2:region.y}]);setSelection(region);};
 const clearSelection=()=>{if(selection)void commit([{op:'rect',layer,...selection,color:'transparent'}]);};
 const shape=(a:{x:number;y:number},b:{x:number;y:number}):PaintCommand=>tool==='line'?{op:'line',layer,color:ink,...a,x2:b.x,y2:b.y}:{op:tool,layer,color:ink,x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x)+1,height:Math.abs(a.y-b.y)+1,filled};
 const down=(e:PE<HTMLCanvasElement>)=>{const s=current.current;if(e.button!==0||!s||locked.current||stroke.current||selectionDrag.current)return;e.preventDefault();const p=point(e);setHover(p);if(playing)return;if(tool==='select'){e.currentTarget.setPointerCapture(e.pointerId);const inside=selection&&p.x>=selection.x&&p.y>=selection.y&&p.x<selection.x+selection.width&&p.y<selection.y+selection.height;const region=inside?selection!:{...p,width:1,height:1};selectionDrag.current={base:s,start:p,source:inside?region:null,region,layer,frame:Math.min(frame,frameCount(s.doc)-1)};setSelection(region);return;}setSelection(null);if(tool==='picker'){const rgba=composite(frameView(s.doc,Math.min(frame,frameCount(s.doc)-1))),i=(p.y*s.doc.width+p.x)*4;if(rgba[i+3])setInk('#'+Array.from(rgba.slice(i,i+3)).map(v=>v.toString(16).padStart(2,'0')).join(''));return;}if(tool==='fill'){void commit([{op:'fill',layer,color:ink,...p}]);return;}if(!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(ink)){setError('Choose a valid hex color.');return;}e.currentTarget.setPointerCapture(e.pointerId);const ops:PaintCommand[]=['pencil','eraser'].includes(tool)?[{op:'pixel',layer,color:tool==='eraser'?'transparent':ink,...p}]:[shape(p,p)];stroke.current={base:s,start:p,last:p,ops,frame:Math.min(frame,frameCount(s.doc)-1)};present({...s,doc:applyCommands(s.doc,targetFrame(ops,Math.min(frame,frameCount(s.doc)-1)))});};
 const move=(e:PE<HTMLCanvasElement>)=>{if(!snap)return;const p=point(e);setHover(old=>old?.x===p.x&&old?.y===p.y?old:p);setCursor(`X ${String(p.x).padStart(3,'0')}   Y ${String(p.y).padStart(3,'0')}`);const drag=selectionDrag.current;if(drag){if(drag.source){const source=drag.source;drag.region={...source,x:Math.max(0,Math.min(drag.base.doc.width-source.width,source.x+p.x-drag.start.x)),y:Math.max(0,Math.min(drag.base.doc.height-source.height,source.y+p.y-drag.start.y))};present({...drag.base,doc:applyCommands(drag.base.doc,[{op:'transform',mode:'move',layer:drag.layer,frame:drag.frame,...source,x2:drag.region.x,y2:drag.region.y}])});}else drag.region={x:Math.min(drag.start.x,p.x),y:Math.min(drag.start.y,p.y),width:Math.abs(p.x-drag.start.x)+1,height:Math.abs(p.y-drag.start.y)+1};setSelection(drag.region);return;}const st=stroke.current;if(!st||(p.x===st.last.x&&p.y===st.last.y)||st.ops.length>4000)return;if(['pencil','eraser'].includes(tool))st.ops.push({op:'line',layer,color:tool==='eraser'?'transparent':ink,...st.last,x2:p.x,y2:p.y});else st.ops=[shape(st.start,p)];st.last=p;present({...st.base,doc:applyCommands(st.base.doc,targetFrame(st.ops,st.frame))});};
 const up=()=>{const drag=selectionDrag.current;if(drag){selectionDrag.current=null;if(drag.source&&(drag.source.x!==drag.region.x||drag.source.y!==drag.region.y))void commit([{op:'transform',mode:'move',layer:drag.layer,frame:drag.frame,...drag.source,x2:drag.region.x,y2:drag.region.y}],drag.base);else present(drag.base);return;}const st=stroke.current;if(st){stroke.current=null;void commit(targetFrame(st.ops,st.frame),st.base);}};
 const png=async()=>{const d=current.current?.doc;if(!d)return;try{const {encodeBrowserPng}=await import('../lib/browser-png.ts');download(d.name+'.png',new Blob([encodeBrowserPng(frameView(d,Math.min(frame,frameCount(d)-1)),scale)],{type:'image/png'}));if(!queue.current?.state.pending)setNotice(`Exported ${d.width*scale} × ${d.height*scale} PNG`);}catch(e){setError((e as Error).message);}};
 useEffect(()=>{const h=(e:KeyboardEvent)=>{if((e.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"],[role="tab"]')||stroke.current||selectionDrag.current)return;if(e.key==='Escape'){setModal(false);setSelection(null);return;}if(modal)return;const mod=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();if(mod&&key==='z'){e.preventDefault();void commit([],undefined,e.shiftKey?'redo':'undo');return;}if(mod&&key==='c'&&selection){e.preventDefault();copySelection();return;}if(mod&&key==='v'&&clipboard){e.preventDefault();pasteSelection();return;}if(mod&&key==='x'&&selection){e.preventDefault();copySelection();clearSelection();return;}if(selection&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const step=e.shiftKey?10:1;transformSelection('move',e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0);return;}if(selection&&['Delete','Backspace'].includes(e.key)){e.preventDefault();clearSelection();return;}if(mod)return;const t=tools.find(t=>t[3].toLowerCase()===key);if(t)setTool(t[0]);if(key==='h')setGrid(v=>!v);};window.addEventListener('keydown',h);return()=>window.removeEventListener('keydown',h);});
 const addFrame=async()=>{
  const doc=current.current?.doc;if(!doc||playing)return;
  const next=frameCount(doc);
  if(await commit([{op:'frame_add',source_frame:Math.min(frame,next-1)}])){
    setSelection(null);setFrame(next);
  }
 };
 const removeFrame=async()=>{
  const doc=current.current?.doc;if(!doc||frame===0||playing)return;
  if(await commit([{op:'frame_delete',frame}])){
    setSelection(null);setFrame(i=>Math.max(0,i-1));
  }
 };
 const exportSheet=async()=>{
  const doc=current.current?.doc;if(!doc)return;
  try{
   const sheet=buildSpriteSheet(doc),{encodeBrowserRgba}=await import('../lib/browser-png.ts');
   download(sheet.atlas.image,new Blob([encodeBrowserRgba(sheet.bytes,sheet.width,sheet.height)],{type:'image/png'}));
   setNotice(`Exported ${sheet.atlas.frames.length}-frame sprite sheet`);
  }catch(e){setError((e as Error).message);}
 };
 const exportAtlas=()=>{
  const doc=current.current?.doc;if(!doc)return;
  try{
   const sheet=buildSpriteSheet(doc),name=sheet.atlas.image.replace('-sheet.png','-atlas.json');
   download(name,new Blob([JSON.stringify(sheet.atlas,null,2)],{type:'application/json'}));
   setNotice('Exported animation atlas JSON');
  }catch(e){setError((e as Error).message);}
 };
 const addEffect=async()=>{
  const doc=current.current?.doc;if(!doc)return;
  try{
   const commands=generateEffectCommands(doc,{kind:effectKind,seed:effectSeed,ink});
   if(await commit(commands)){
    setLayer(String(commands[0].id));setFrame(0);setSelection(null);setPlaying(true);
   }
  }catch(e){setError((e as Error).message);}
 };
 const closeMobileInspector=()=>{setInspectorOpen(false);drawerToggleRef.current?.focus();};
 const activateInspectorTab=(tab:InspectorTab)=>{
  setInspectorTab(tab);
  if(inspectorRef.current)inspectorRef.current.scrollTop=0;
 };
 const d=snap?.doc,activeFrame=d?Math.min(frame,frameCount(d)-1):0,displayError=error||saveState.error?.message;
 return <main className="workshop"><header className="app-header"><a className="brand" href="/"><span className="brand-mark">{Array.from({length:9},(_,i)=><i key={i}/>)}</span><span>pixel<span className="brand-light">workshop</span><small>A LITTLE ROOM TO MAKE THINGS</small></span></a><div className="header-meta"><span className="version">WORKSPACE / 01</span><span className="connection"><i/> MCP enabled</span></div><button className="primary" disabled={!d||busy} onClick={()=>void png()}><Download size={15}/>Export PNG</button></header>
 <div className="document-bar"><div className="document-switch"><FolderOpen size={15}/><select aria-label="Open saved project" value={d?.id||''} disabled={busy} onChange={e=>void open(e.target.value)}>{!d&&<option>Opening workspace…</option>}{list.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><ChevronDown size={13}/></div><span className="document-size">{d?`${d.width} × ${d.height} px`:'—'}</span><span className="separator"/><button className="text-button" disabled={busy} onClick={()=>setModal(true)}><FilePlus size={15}/>New canvas</button><button className="text-button open-file" disabled={busy} onClick={()=>file.current?.click()}><FolderOpen size={15}/>Open project</button><span className="spacer"/><button className="icon-button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!snap?.canUndo||busy} onClick={()=>void commit([],undefined,'undo')}><Undo2 size={17}/></button><button className="icon-button" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!snap?.canRedo||busy} onClick={()=>void commit([],undefined,'redo')}><Redo2 size={17}/></button></div>
 <div className="work-area" data-tools-open={mobileLayout&&inspectorOpen}><aside className="tool-rail" aria-label="Drawing tools">{tools.map(([id,Icon,label,key])=><button key={id} className={'tool '+(tool===id?'active':'')} aria-label={label} aria-pressed={tool===id} title={`${label} (${key})`} onClick={()=>setTool(id)}><Icon size={19}/></button>)}<div className="rail-rule"/><button className={'tool '+(grid?'active':'')} aria-label="Toggle grid" aria-pressed={grid} onClick={()=>setGrid(v=>!v)}><Grid2X2 size={19}/></button><div className="rail-ink" style={{background:ink}}/></aside>
 <section className="canvas-area" aria-label="Canvas workspace"><div className="canvas-toolbar"><span className="eyebrow">{tools.find(t=>t[0]===tool)?.[2].toUpperCase()} <span className="muted">/ 1 PX</span></span>{['rect','ellipse'].includes(tool)&&<label className="fill-option"><input type="checkbox" checked={filled} onChange={e=>setFilled(e.target.checked)}/>Filled</label>}<span className="spacer"/><button type="button" ref={drawerToggleRef} className={'small-toggle mobile-inspector-toggle '+(inspectorOpen?'on':'')}
 aria-controls="pixel-inspector" aria-expanded={mobileLayout&&inspectorOpen} aria-haspopup="dialog"
 onClick={()=>setInspectorOpen(v=>!v)}><SlidersHorizontal size={17}/>Tools</button><span className="canvas-hint">ONE CELL = ONE PIXEL.</span></div><div className="canvas-scroll" ref={viewport}><div className="canvas-mat">{d?<div className="canvas-frame"><span className="canvas-coordinate top-left">0, 0</span><canvas ref={canvas} className="pixel-canvas" aria-label={`${d.name}, ${d.width} by ${d.height} pixel canvas`} style={{width:d.width*zoom,height:d.height*zoom,backgroundSize:`${zoom*2}px ${zoom*2}px`}} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>{if(selectionDrag.current){setSelection(selectionDrag.current.source);present(selectionDrag.current.base);selectionDrag.current=null;}if(stroke.current){present(stroke.current.base);stroke.current=null;}}} onPointerLeave={()=>{setHover(null);if(!stroke.current&&!selectionDrag.current)setCursor('X —   Y —');}}/>{hover&&zoom>=3&&tool!=='select'&&<div className="cell-cursor" aria-hidden="true" style={{left:hover.x*zoom,top:hover.y*zoom,width:zoom,height:zoom}}/>}{selection&&<div className="selection-marquee" style={{left:selection.x*zoom,top:selection.y*zoom,width:selection.width*zoom,height:selection.height*zoom}}/>}<span className="canvas-coordinate bottom-right">{d.width}, {d.height}</span></div>:<div className="loading-canvas"><Grid2X2 size={32}/><span>Opening your pixel workshop…</span>{error&&<button onClick={()=>location.reload()}>Try again</button>}</div>}</div></div>{d&&<div className="timeline" aria-label="Animation timeline">
  <div className="timeline-header"><span className="eyebrow"><Film size={13}/>ANIMATION <span className="muted">{frameCount(d)} FRAME{frameCount(d)===1?'':'S'}</span></span>
    <div className="timeline-controls">
     <button className="small-toggle" aria-label={playing?'Pause animation':'Play animation'} disabled={frameCount(d)<2||busy} onClick={()=>setPlaying(v=>!v)}>{playing?<Pause size={14}/>:<Play size={14}/>} {playing?'Pause':'Play'}</button>
     <label className="fps-control">FPS <select aria-label="Animation frames per second" value={d.animation?.fps??8} disabled={busy} onChange={e=>void commit([{op:'set_fps',fps:Number(e.target.value)}])}>{[4,6,8,10,12,15,20,24,30].map(f=><option key={f} value={f}>{f}</option>)}</select></label>
     <button className={'small-toggle '+(onion?'on':'')} aria-pressed={onion} onClick={()=>setOnion(v=>!v)}>Onion {onion?'on':'off'}</button>
     <button className="small-toggle" disabled={busy||playing||frameCount(d)>=32} onClick={()=>void addFrame()}><CopyPlus size={14}/>Duplicate</button>
     <button className="small-toggle" disabled={busy||playing||activeFrame===0} onClick={()=>void removeFrame()}><Trash2 size={14}/>Delete</button>
    </div>
  </div>
  <div className="timeline-track">{Array.from({length:frameCount(d)},(_,i)=>
   <button key={i} aria-label={`Select animation frame ${i+1}`} aria-pressed={activeFrame===i} className={'frame-tile '+(activeFrame===i?'active':'')}
    disabled={busy||playing} onClick={()=>{if(stroke.current||selectionDrag.current)return;setFrame(i);setSelection(null);}}>
     <FrameThumbnail doc={d} index={i}/><span>{String(i+1).padStart(2,'0')}</span>
   </button>)}</div>
 </div>}<div className="canvas-footer"><div className="zoom-control"><button aria-label="Zoom out" onClick={()=>{setFitMode(false);setZoom(z=>Math.max(1,z-1));}}><ZoomOut size={16}/></button><span>{zoom*100}%</span><button aria-label="Zoom in" onClick={()=>{setFitMode(false);setZoom(z=>Math.min(24,z+1));}}><ZoomIn size={16}/></button></div><button className={'small-toggle fit-button '+(fitMode?'on':'')} aria-label="Fit canvas to workspace" onClick={()=>setFitMode(true)}><Maximize size={14}/>Fit</button><span className="scale-caption">{zoom>=3?'1 cell = 1 output pixel':'Zoom in to see the cell grid'}</span><span className="spacer"/><button className={'small-toggle '+(grid?'on':'')} onClick={()=>setGrid(v=>!v)}><Grid2X2 size={14}/>Grid {grid?'on':'off'}</button></div></section>
  <button type="button" className="inspector-backdrop" aria-label="Close tools" onClick={closeMobileInspector}/>
  <aside id="pixel-inspector" className="inspector" ref={inspectorRef} aria-label="Editor inspector"
   role={mobileLayout&&inspectorOpen?'dialog':undefined}
   aria-modal={mobileLayout&&inspectorOpen?true:undefined}
   aria-hidden={mobileLayout&&!inspectorOpen}
   inert={mobileLayout&&!inspectorOpen}>
  <div className="inspector-drawer-header"><span><SlidersHorizontal size={16}/>Tools</span>
   <button type="button" ref={drawerCloseRef} aria-label="Close tools" onClick={closeMobileInspector}><X size={19}/></button>
  </div>
 <nav className="inspector-tabs" role="tablist" aria-label="Inspector panels">
  {INSPECTOR_TABS.map(tab=>{
   const Icon=tab.id==='draw'?Palette:tab.id==='layers'?Layers:tab.id==='effects'?Sparkles:Download;
   const active=inspectorTab===tab.id;
   return <button key={tab.id} type="button" id={`inspector-tab-${tab.id}`} data-inspector-tab={tab.id}
    className={'inspector-tab '+(active?'active':'')} role="tab"
    aria-label={`${tab.label} tools`} aria-controls={`inspector-panel-${tab.id}`}
    aria-selected={active} tabIndex={active?0:-1} title={tab.label}
    onClick={()=>activateInspectorTab(tab.id)}
    onKeyDown={e=>{
     const next=inspectorTabForKey(tab.id,e.key);
     if(next){
      e.preventDefault();activateInspectorTab(next);
      inspectorRef.current?.querySelector<HTMLButtonElement>(`[data-inspector-tab="${next}"]`)?.focus();
     }
    }}><Icon size={15}/><span>{tab.label}</span></button>;
  })}
 </nav>
 <div className="inspector-panel" id="inspector-panel-draw" role="tabpanel" aria-labelledby="inspector-tab-draw" tabIndex={0} hidden={inspectorTab!=='draw'}>
 <section className="inspector-section preview-section"><div className="section-heading"><span>PREVIEW</span><div className="preview-scales">{[1,2].map(s=><button key={s} aria-label={`Preview at ${s}×`} aria-pressed={previewScale===s} className={previewScale===s?'active':''} onClick={()=>setPreviewScale(s)}>{s}×</button>)}</div></div><div className="navigator"><canvas ref={preview} aria-label="Artwork preview"/></div><div className="preview-caption"><span>{d?.name||'Your artwork'}</span><span>{d?`${d.width} × ${d.height}`:''}</span></div></section>
 <section className="inspector-section"><div className="section-heading"><span>COLOR</span><span className="muted">RGBA</span></div><div className="color-controls"><label className="color-picker" style={{background:ink}}><input type="color" aria-label="Choose drawing color" value={ink.slice(0,7)} onChange={e=>setInk(e.target.value)}/></label><input className="hex-input" aria-label="Hex drawing color" value={ink} maxLength={9} onChange={e=>setInk(e.target.value)} onBlur={()=>{if(!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(ink))setInk('#f6da92');}}/><button className="icon-button" aria-label="Add current color to palette" disabled={busy||!d||d.palette.includes(ink)} onClick={()=>void commit([{op:'palette',colors:[...(d?.palette||[]),ink]}])}><Plus size={15}/></button></div><div className="section-heading palette-heading"><span>WORKSHOP PALETTE</span><span className="muted">{d?.palette.length||24}</span></div><div className="palette">{d?.palette.map((c,i)=><button key={c+i} aria-label={`Use color ${c}`} title={c} style={{background:c}} className={'swatch '+(c===ink?'selected':'')} onClick={()=>setInk(c)}/>)}</div></section>
 <details className="inspector-section selection-section inspector-disclosure">
 <summary className="section-heading inspector-summary"><span>SELECTION</span><span className="inspector-summary-end"><span className="muted">{selection?`${selection.width} × ${selection.height}`:'V'}</span><ChevronDown size={15}/></span></summary><div className="selection-actions"><button disabled={!selection||busy} onClick={copySelection} title="Copy (Ctrl+C)"><Copy size={14}/>Copy</button><button disabled={!clipboard||busy} onClick={pasteSelection} title="Paste (Ctrl+V)"><ClipboardPaste size={14}/>Paste</button><button disabled={!selection||busy} onClick={()=>transformSelection('flip_horizontal')} title="Flip horizontally"><FlipHorizontal2 size={14}/>Flip H</button><button disabled={!selection||busy} onClick={()=>transformSelection('flip_vertical')} title="Flip vertically"><FlipVertical2 size={14}/>Flip V</button><button disabled={!selection||busy} onClick={clearSelection} title="Clear selected pixels (Delete)"><Trash2 size={14}/>Clear</button><button disabled={!selection||busy} onClick={()=>setSelection(null)}><X size={14}/>Deselect</button></div><p className="selection-help">Select with V. Drag to move.<br/>Arrow keys nudge one pixel.</p></details>
 </div>
 <div className="inspector-panel" id="inspector-panel-layers" role="tabpanel" aria-labelledby="inspector-tab-layers" tabIndex={0} hidden={inspectorTab!=='layers'}>
 <section className="inspector-section layers-section"><div className="section-heading"><span>LAYERS</span><span className="muted" aria-label="Layer slots used">{d?.layers.length??0} / 8</span><button className="mini-button" aria-label="Add layer" disabled={busy||!d||d.layers.length>=8} onClick={()=>{const id='layer-'+Date.now().toString(36);void commit([{op:'add_layer',id,name:`Layer ${(d?.layers.length||0)+1}`}]).then(()=>setLayer(id));}}><Plus size={16}/></button></div>{d&&[...d.layers].reverse().map(l=><div key={l.id} className={'layer-row '+(layer===l.id?'selected':'')}><button className="layer-select" onClick={()=>setLayer(l.id)}><span className="layer-thumbnail"><Layers size={14}/></span><span>{l.name}</span></button><button className="mini-button" aria-label={`${l.visible?'Hide':'Show'} ${l.name} layer`} disabled={busy} onClick={()=>void commit([{op:'visibility',layer:l.id,visible:!l.visible}])}>{l.visible?<Eye size={15}/>:<EyeOff size={15}/>}</button><button className="mini-button layer-delete" aria-label={`Delete ${l.name} layer`} title={d.layers.length===1?'The last layer cannot be deleted':'Delete layer (Undo to restore)'} disabled={busy||d.layers.length<=1} onClick={()=>void commit([{op:'delete_layer',layer:l.id}])}><Trash2 size={15}/></button></div>)}<span className="layer-note">Drawing on <strong>{d?.layers.find(l=>l.id===layer)?.name||'Base'}</strong>. Hiding a layer does not free its slot; delete it to make room for another effect.</span></section>
 </div>
 <div className="inspector-panel" id="inspector-panel-effects" role="tabpanel" aria-labelledby="inspector-tab-effects" tabIndex={0} hidden={inspectorTab!=='effects'}>
 <section className="inspector-section effects-section"><div className="section-heading"><span>PROCEDURAL EFFECTS</span><Sparkles size={14}/></div>
   <p>Create a seeded, editable animation layer. Painting and undo work on every generated frame.</p>
   <label className="effect-field">Effect<select aria-label="Procedural effect type" value={effectKind} onChange={e=>setEffectKind(e.target.value as EffectKind)}>{EFFECT_KINDS.map(k=><option key={k} value={k}>{k==='shockwave'?'Shockwave':k==='embers'?'Embers':'Sparkles'}</option>)}</select></label>
   <label className="effect-field">Seed<input aria-label="Effect random seed" type="number" min={0} max={2147483647} value={effectSeed} onChange={e=>setEffectSeed(Number(e.target.value))}/></label>
   {d&&<p className="effect-capacity" aria-live="polite">{d.layers.length} / 8 layer slots used · {hasFreeEffectLayerSlot(d)?'Ready to generate':'Delete a layer to make room'}</p>}
   <button className="secondary full effect-generate" disabled={busy||!hasFreeEffectLayerSlot(d)} title={!hasFreeEffectLayerSlot(d)?'All eight layer slots are occupied. Use a layer trash icon to free one.':'Generate an effect without stopping playback'} onClick={()=>void addEffect()}><Sparkles size={14}/>Generate editable effect</button>
   {d&&!hasFreeEffectLayerSlot(d)&&<button type="button" className="text-button effects-manage-link" onClick={()=>activateInspectorTab('layers')}><Layers size={14}/>Manage layers to free a slot</button>}
  </section>
 </div>
 <div className="inspector-panel" id="inspector-panel-export" role="tabpanel" aria-labelledby="inspector-tab-export" tabIndex={0} hidden={inspectorTab!=='export'}>
 <section className="inspector-section export-section"><div className="section-heading"><span>EXPORT</span><span className="filetype">PNG</span></div><label className="scale-select">Output size<select aria-label="PNG export scale" value={scale} onChange={e=>setScale(Number(e.target.value))}>{[1,2,4,8].map(s=><option key={s} value={s}>{s}× {d?`· ${d.width*s} × ${d.height*s}`:''}</option>)}</select></label><p>Transparent background.<br/>Clean pixels, ready for your game.</p><button className="secondary full" disabled={!d||busy} onClick={()=>{if(d)download(d.name+'.pixel.json',new Blob([JSON.stringify(d)],{type:'application/json'}));}}>Save editable project <Download size={14}/></button>
  <button className="secondary full" disabled={!d||busy} onClick={()=>void exportSheet()}>Sprite sheet PNG <Download size={14}/></button>
  <button className="secondary full" disabled={!d||busy} onClick={exportAtlas}>Animation atlas JSON <Download size={14}/></button>
  </section>
 </div>
 </aside></div>
 <footer className="status-bar"><span className={'save-status '+(displayError?'error':'')}><i className={busy||saveState.pending?'saving':''}/>{displayError||notice}</span>{saveState.error&&<>{!saveState.error.conflict&&<button className="text-button save-retry" disabled={busy} onClick={()=>{setError('');queue.current?.retry();}}>Retry save</button>}<button className="text-button save-retry" disabled={busy} onClick={()=>void create(false,current.current?.doc,true)}>Save a copy</button></>}<span className="status-detail">{cursor}</span><span className="status-detail">{d?.layers.length||0} LAYERS</span><span className="status-shortcuts">B pencil<span>E eraser</span><span>G fill</span><span>H grid</span></span></footer>
 <input ref={file} type="file" accept=".json,.pixel.json" className="visually-hidden" aria-label="Import editable project" onChange={async e=>{const f=e.target.files?.[0];if(!f)return;try{if(f.size>12_000_000)throw new Error('Project file is too large.');await create(false,JSON.parse(await f.text()));}catch(err){setError((err as Error).message);}e.target.value='';}}/>
 {modal&&<div className="modal-backdrop" onClick={()=>setModal(false)}><section className="new-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onClick={e=>e.stopPropagation()}><button className="dialog-close icon-button" aria-label="Close new canvas dialog" onClick={()=>setModal(false)}><X size={18}/></button><span className="eyebrow">A FRESH LITTLE START</span><h2 id="dialog-title">Make room for an idea.</h2><label>Canvas name<input autoFocus value={name} maxLength={80} onChange={e=>setName(e.target.value)}/></label><div className="dimension-inputs"><label>Width<input type="number" min={1} max={256} value={width} onChange={e=>setWidth(Number(e.target.value))}/></label><span>×</span><label>Height<input type="number" min={1} max={256} value={height} onChange={e=>setHeight(Number(e.target.value))}/></label></div><div className="size-presets">{[16,32,48,64,128].map(s=><button key={s} className={width===s&&height===s?'selected':''} onClick={()=>{setWidth(s);setHeight(s);}}>{s}×{s}</button>)}</div>{error&&<p className="error-text">{error}</p>}<button className="primary full" disabled={busy} onClick={()=>void create()}><Plus size={16}/>Create canvas</button><button className="text-button example-button" disabled={busy} onClick={()=>void create('cottage')}>Open Moonkeeper’s cottage · 64 × 64</button><button className="text-button example-button" disabled={busy} onClick={()=>void create(true)}>Or open the little lantern</button></section></div>}
 </main>;
}
