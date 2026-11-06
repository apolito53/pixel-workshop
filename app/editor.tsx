'use client';
import {useCallback,useEffect,useRef,useState,type PointerEvent as PE} from 'react';
import {Pencil,Eraser,PaintBucket,Pipette,Minus,Square,Circle,Grid2X2,Undo2,Redo2,FilePlus,Download,FolderOpen,Eye,EyeOff,Plus,ZoomIn,ZoomOut,ChevronDown,X,Layers,Scan,Copy,ClipboardPaste,FlipHorizontal2,FlipVertical2,Trash2,Maximize,Play,Pause,Film,CopyPlus,Sparkles,Palette,SlidersHorizontal,KeyRound,Stamp,BookOpen,PanelsTopLeft} from 'lucide-react';
import {applyCommands,clipFrameSequence,composite,createDocument,documentCells,frameCount,frameView,readRegion,validateDocument,type AnimationClip,type PixelDocument,type PaintCommand,type PixelRegion} from '../lib/pixels.ts';
import {MAX_CANVAS_SIDE} from '../lib/canvas-limits.ts';
import {buildCanvasPreview,maxPreviewZoom,type CanvasPreviewOptions,type CanvasView} from '../lib/canvas-preview.ts';
import type {ReferenceImage} from '../lib/reference.ts';
import ReferenceWorkbench from './reference-workbench.tsx';
import {buildSpriteSheet} from '../lib/sprite-sheet.ts';
import {encodeSvg,encodeRgbaSvg} from '../lib/svg.ts';
import {MAX_ANIMATION_CELLS} from '../lib/pixels.ts';
import {compareEffectFrame,type FxComparison} from '../lib/fx-preview.ts';
import FxComparisonPanel from './fx-comparison.tsx';
import {generateEffectCommands,regenerateEffectCommands,hasFreeEffectLayerSlot,type EffectKind,EFFECT_KINDS,EFFECT_GROUPS,EFFECT_PRESETS} from '../lib/effects.ts';
import {EditQueue,type EditorSnapshot,type QueueState} from '../lib/edit-queue.ts';
import {beginPinch,movePinch,finishPinch,touchMidpoint,type GesturePoint,type PinchStart,type PinchView,type GestureViewport} from '../lib/touch-gestures.ts';
import {INSPECTOR_TABS,inspectorTabForKey,type InspectorTab} from '../lib/inspector-tabs.ts';
import UiKitPanel from './ui-kit-panel.tsx';
import {hasUiDraft,parseUiDrafts,setProjectDraft,type UiDraft,type UiDraftMap} from '../lib/ui-drafts.ts';
import {matchUiReturn,parseUiReturn,UI_RETURN_KEY,type UiReturn,type UiSection} from '../lib/ui-return.ts';
import {kitSignature,overviewKit,parseKitUndo,reviewKitColor,validateKitUndo,type KitColorReview,type KitUndo} from '../lib/kit-review.ts';
import {guideSteps,type GuideScope} from '../lib/workshop-guide.ts';
import {clipRange,clipsAtFrame,type ClipRange} from '../lib/clip-range.ts';
import WorkshopGuide from './workshop-tour.tsx';
import ColorWorkbench from './color-workbench.tsx';
import QuickColorGrid from './quick-color-grid.tsx';
import StampWorkbench from './stamp-workbench.tsx';
import {STAMP_LIBRARY_LIMIT,loadStamps,captureStamp,stampCommand,positionStamp,stampRgba,addSavedStamp,type StampAsset} from '../lib/stamp-library.ts';
import {isHexInk,normalizeInk,rememberInk,rgbHex,splitProjectPalette,withOpacity,withRgb} from '../lib/color-workflow.ts';
type Snapshot=EditorSnapshot;
type Tool='select'|'pencil'|'eraser'|'fill'|'picker'|'line'|'rect'|'ellipse'|'stamp';
const tools=[['pencil',Pencil,'Pencil','B'],['eraser',Eraser,'Eraser','E'],['fill',PaintBucket,'Fill','G'],['picker',Pipette,'Eyedropper','I'],['line',Minus,'Line','L'],['rect',Square,'Rectangle','R'],['ellipse',Circle,'Ellipse','O'],['select',Scan,'Select / move','V'],['stamp',Stamp,'Stamp copied pixels','S']] as const;
// Keep precise explanations in tooltips/ARIA, but make drawer tile names concise.
const drawerToolLabels:Partial<Record<Tool,string>>={stamp:'Stamp'};
async function api<T>(path:string,body?:unknown):Promise<T>{const r=await fetch('/api/pixel/'+path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});const d=await r.json() as T & {error?:string};if(!r.ok)throw Object.assign(new Error(d.error||'Request failed'),{status:r.status});return d;}
const PENDING_UI_KIT='pixel-workshop-pending-ui-kit-v1';
const NO_UI_DRAFT:UiDraft={};
let pendingUiImport:Promise<string|null>|null=null;
/** Import copies into the active workspace, keeping progress if a request fails. */
async function importPendingKit():Promise<string|null>{
 if(pendingUiImport)return pendingUiImport;
 let raw:string|null;try{raw=sessionStorage.getItem(PENDING_UI_KIT);}catch{return null;}if(!raw)return null;
 pendingUiImport=(async()=>{
  const pending=JSON.parse(raw) as {format:string;kitId:string;documents:unknown[];firstId?:string};
  if(pending.format!=='pixel-workshop-ui-kit-import/1'||!Array.isArray(pending.documents)||pending.documents.length>30||!/^kit-[a-z0-9-]{1,70}$/i.test(pending.kitId))throw new Error('The requested UI kit is invalid.');
  while(pending.documents.length){
   const doc=validateDocument(pending.documents[0]);doc.ui={...doc.ui,kitId:pending.kitId};
   const made=await api<Snapshot>('projects',{document:doc});pending.firstId??=made.doc.id;pending.documents.shift();
   sessionStorage.setItem(PENDING_UI_KIT,JSON.stringify(pending));
  }
  sessionStorage.removeItem(PENDING_UI_KIT);return pending.firstId??null;
 })();
 try{return await pendingUiImport;}finally{pendingUiImport=null;}
}
function download(name:string,data:Blob){const url=URL.createObjectURL(data),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const pixelOps = new Set(['pixel','fill','line','rect','ellipse','transform','paste','clear']);
const targetFrame=(ops:PaintCommand[],frame:number):PaintCommand[]=>
  ops.map(op=>pixelOps.has(op.op)&&op.frame===undefined?{...op,frame}:op);
function render(c:HTMLCanvasElement|null,d:PixelDocument|null,z:number,grid=false,ghosts:PixelDocument[]=[],options:CanvasPreviewOptions={view:'artwork'}){
 if(!c||!d)return;
 z=Math.min(z,maxPreviewZoom(d.width,d.height));
 c.width=d.width*z;c.height=d.height*z;
 const ctx=c.getContext('2d')!,temp=document.createElement('canvas');temp.width=d.width;temp.height=d.height;
 const t= temp.getContext('2d')!;
 ctx.imageSmoothingEnabled=false;
 if(d.reference&&options.view!=='artwork'){
  const image=buildCanvasPreview(d,{...options,scale:Math.min(z,maxPreviewZoom(d.width,d.height)),grid});
  c.width=image.width;c.height=image.height;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(image.bytes),image.width,image.height),0,0);return;
 }
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
export default function Editor({onManageWorkspace,workspaceId}:{onManageWorkspace?:()=>void;workspaceId?:string}={}){
 const [guide,setGuide]=useState<{mode:'off'|'menu'|'tour';scope:GuideScope;index:number}>({mode:'off',scope:'all',index:0});
 const guideToggleRef=useRef<HTMLButtonElement>(null);
 const guidePreviousRef=useRef<{tab:InspectorTab;inspectorOpen:boolean;drawOpen:boolean}|null>(null);
 const [inspectorTab,setInspectorTab]=useState<InspectorTab>('draw');
 const [uiSections,setUiSections]=useState<UiSection[]>(['panel']);
 const [uiDrafts,setUiDrafts]=useState<UiDraftMap>({}),[uiDraftStorageError,setUiDraftStorageError]=useState(false);
 const [kitUndo,setKitUndo]=useState<KitUndo|null>(null),[kitUndoStorageError,setKitUndoStorageError]=useState(false);
 const uiDraftsRef=useRef<UiDraftMap>({}),uiDraftStorageErrorRef=useRef(false);
 const uiDraftStoreKey='pixel-workshop-ui-drafts-v1-'+(workspaceId||'local');
 const kitUndoStoreKey='pixel-workshop-kit-undo-v1-'+(workspaceId||'local');
 useEffect(()=>{
  try{const saved=parseUiDrafts(localStorage.getItem(uiDraftStoreKey));uiDraftsRef.current=saved;setUiDrafts(saved);uiDraftStorageErrorRef.current=false;setUiDraftStorageError(false);}
  catch{uiDraftsRef.current={};setUiDrafts({});uiDraftStorageErrorRef.current=true;setUiDraftStorageError(true);}
 },[uiDraftStoreKey]);
 useEffect(()=>{try{setKitUndo(parseKitUndo(localStorage.getItem(kitUndoStoreKey)));setKitUndoStorageError(false);}catch{setKitUndo(null);setKitUndoStorageError(true);}},[kitUndoStoreKey]);
 const keepKitUndo=useCallback((journal:KitUndo|null)=>{
  setKitUndo(journal);
  try{if(journal?.entries.length)localStorage.setItem(kitUndoStoreKey,JSON.stringify(journal));else localStorage.removeItem(kitUndoStoreKey);setKitUndoStorageError(false);}
  catch{setKitUndoStorageError(true);}
 },[kitUndoStoreKey]);
 const updateUiDraft=useCallback((id:string,change:(old:UiDraft)=>UiDraft)=>{
  // Preserve drafts made in other projects by another tab. A single project
  // should still be edited in one tab at a time so its fields do not race.
  let otherDrafts:UiDraftMap={};
  try{otherDrafts=parseUiDrafts(localStorage.getItem(uiDraftStoreKey));}catch{}
  const combined=uiDraftStorageErrorRef.current?{...otherDrafts,...uiDraftsRef.current}:{...uiDraftsRef.current,...otherDrafts};
  const next=setProjectDraft(combined,id,change(uiDraftsRef.current[id]??otherDrafts[id]??NO_UI_DRAFT));
  uiDraftsRef.current=next;setUiDrafts(next);
  try{
   const serialized=JSON.stringify(next);
   if(serialized.length>300_000||Object.keys(next).length>100)throw new Error('Too many local drafts.');
   if(Object.keys(next).length)localStorage.setItem(uiDraftStoreKey,serialized);else localStorage.removeItem(uiDraftStoreKey);
   uiDraftStorageErrorRef.current=false;setUiDraftStorageError(false);
  }catch{uiDraftStorageErrorRef.current=true;setUiDraftStorageError(true);}
 },[uiDraftStoreKey]);
 const toggleUiSection=useCallback((section:UiSection,open:boolean)=>setUiSections(old=>{
  if(old.includes(section)===open)return old;
  return open?[...old,section]:old.filter(item=>item!==section);
 }),[]);
 const [canvasPan,setCanvasPan]=useState<GesturePoint>({x:0,y:0});
 const [pinchScale,setPinchScale]=useState(1);
 const panRef=useRef<GesturePoint>({x:0,y:0});
 const touchPoints=useRef(new Map<number,GesturePoint>());
 const touchGesture=useRef<{ids:[number,number];start:PinchStart;last:PinchView}|null>(null);
 const gestureFrame=useRef<number|null>(null);
 const suppressTouchDrawing=useRef(false);
 const [mobileLayout,setMobileLayout]=useState(false),[touchCapable,setTouchCapable]=useState(false),[inspectorOpen,setInspectorOpen]=useState(false);
 const [compactDrawTools,setCompactDrawTools]=useState(false),[drawToolsOpen,setDrawToolsOpen]=useState(false);
 const inspectorRef=useRef<HTMLElement>(null),drawerToggleRef=useRef<HTMLButtonElement>(null),drawerCloseRef=useRef<HTMLButtonElement>(null);
 const drawToolsRef=useRef<HTMLElement>(null),drawToolsToggleRef=useRef<HTMLButtonElement>(null),drawToolsCloseRef=useRef<HTMLButtonElement>(null);
 const [frame,setFrame]=useState(0),[playing,setPlaying]=useState(false),[onion,setOnion]=useState(false),[effectKind,setEffectKind]=useState<EffectKind>('embers'),[effectSeed,setEffectSeed]=useState(53),[snap,setSnap]=useState<Snapshot|null>(null),[list,setList]=useState<PixelDocument[]>([]),[tool,setTool]=useState<Tool>('pencil'),[ink,setInk]=useState('#f6da92'),[hexDraft,setHexDraft]=useState('#f6da92'),[recentColors,setRecentColors]=useState<string[]>([]),[layer,setLayer]=useState('base'),[zoom,setZoom]=useState(10),[grid,setGrid]=useState(true),[filled,setFilled]=useState(true),[busy,setBusy]=useState(false),[notice,setNotice]=useState('Opening workspace…'),[error,setError]=useState(''),[cursor,setCursor]=useState('X —   Y —'),[hover,setHover]=useState<{x:number;y:number}|null>(null),[modal,setModal]=useState(false),[name,setName]=useState('Untitled sprite'),[width,setWidth]=useState(64),[height,setHeight]=useState(64),[scale,setScale]=useState(1),[selection,setSelection]=useState<PixelRegion|null>(null),[clipboard,setClipboard]=useState<{width:number;height:number;pixels:number[]}|null>(null),[previewScale,setPreviewScale]=useState(1),[fitMode,setFitMode]=useState(true),[saveState,setSaveState]=useState<Pick<QueueState,'pending'|'saving'|'error'>>({pending:0,saving:false,error:null});
 const [quickColorsOpen,setQuickColorsOpen]=useState(false);
 const [referenceView,setReferenceView]=useState<CanvasView>('overlay'),[referenceOpacity,setReferenceOpacity]=useState(.5),[artworkOpacity,setArtworkOpacity]=useState(1);
 const [exportFormat,setExportFormat]=useState<'png'|'svg'>('png');
 useEffect(()=>{const d=snap?.doc;if(d&&exportFormat==='png')setScale(s=>[8,4,2,1].find(n=>n<=s&&d.width*d.height*n*n<=4_194_304)??1);},[snap?.doc.width,snap?.doc.height,exportFormat]);
 const quickColorsRef=useRef<HTMLDivElement>(null),quickColorsButtonRef=useRef<HTMLButtonElement>(null);
 const [stampSnap,setStampSnap]=useState(0),[tileSize,setTileSize]=useState(16);
 const [activeStamp,setActiveStamp]=useState<StampAsset|null>(null),[stampCapture,setStampCapture]=useState(false);
 const [stampName,setStampName]=useState(''),[stampLibrary,setStampLibrary]=useState<StampAsset[]>([]);
 const stampCaptureDrag=useRef<{start:{x:number;y:number};region:PixelRegion;layer:string;frame:number}|null>(null);
 const stampPreviewRef=useRef<HTMLCanvasElement>(null);
 const [effectSpeed,setEffectSpeed]=useState(1),[effectOpacity,setEffectOpacity]=useState(1),[effectDrift,setEffectDrift]=useState(0),[effectTarget,setEffectTarget]=useState<string|null>(null);
 const [fxPreview,setFxPreview]=useState<{key:string;comparison:FxComparison}|null>(null);
 const [preserveFx,setPreserveFx]=useState(true),[confirmFxOverwrite,setConfirmFxOverwrite]=useState(false);
 const [packModal,setPackModal]=useState(false),[packIds,setPackIds]=useState<string[]>([]);
 const [clipRangeSelection,setClipRangeSelection]=useState<ClipRange|null>(null);
 const [rangeSelectMode,setRangeSelectMode]=useState(false);
 const clipDragRef=useRef<number|null>(null);
 const [clipOriginal,setClipOriginal]=useState<string|null>(null);
 const [clipName,setClipName]=useState('idle'),[clipFrom,setClipFrom]=useState(0),[clipTo,setClipTo]=useState(0),[clipFps,setClipFps]=useState(8),[clipMode,setClipMode]=useState<AnimationClip['mode']>('loop');
 const [previewClip,setPreviewClip]=useState<string|null>(null);
 const previewPosition=useRef(0);
 const guideStep=guide.mode==='tour'?guideSteps(guide.scope)[guide.index]:undefined;
 const queue=useRef<EditQueue|null>(null),viewport=useRef<HTMLDivElement>(null),selectionDrag=useRef<{base:Snapshot;start:{x:number;y:number};source:PixelRegion|null;region:PixelRegion;layer:string;frame:number}|null>(null),canvas=useRef<HTMLCanvasElement>(null),preview=useRef<HTMLCanvasElement>(null),file=useRef<HTMLInputElement>(null),current=useRef(snap),locked=useRef(false),stroke=useRef<{base:Snapshot;start:{x:number;y:number};last:{x:number;y:number};ops:PaintCommand[];frame:number}|null>(null);
 useEffect(()=>{
  const receive=(event:StorageEvent)=>{
   if(event.key!==uiDraftStoreKey)return;
   try{
    const saved=parseUiDrafts(localStorage.getItem(uiDraftStoreKey)),previous=uiDraftsRef.current,active=current.current?.doc.id;
    // Never replace the draft currently being edited in this tab.
    const next=uiDraftStorageErrorRef.current?{...saved,...previous}:{...saved};
    if(active&&previous[active])next[active]=previous[active];
    uiDraftsRef.current=next;setUiDrafts(next);
   }catch{}
  };
  window.addEventListener('storage',receive);return()=>window.removeEventListener('storage',receive);
 },[uiDraftStoreKey]);
 const stampStoreKey='pixel-workshop-stamps-v1-'+(workspaceId||'local');
 useEffect(()=>{
  try{const saved=localStorage.getItem(stampStoreKey);setStampLibrary(saved?loadStamps(JSON.parse(saved)):[]);}
  catch{setStampLibrary([]);}
  setActiveStamp(null);setStampCapture(false);
 },[stampStoreKey]);
 const persistStampLibrary=(items:StampAsset[])=>{
  setStampLibrary(items);
  try{localStorage.setItem(stampStoreKey,JSON.stringify(items));}
  catch{setNotice('Stamp available for this session; browser storage is unavailable.');}
 };
 const selectStamp=(stamp:StampAsset)=>{
  setActiveStamp(stamp);setStampName(stamp.name);setStampCapture(false);setSelection(null);setTool('stamp');if(mobileLayout)setInspectorOpen(false);
 };
 const chooseTool=(next:Tool)=>{setTool(next);if(next==='stamp'&&!activeStamp)setStampCapture(true);};
 const beginStampCapture=()=>{
  setTool('stamp');setStampCapture(true);setSelection(null);setPlaying(false);
  if(mobileLayout)setInspectorOpen(false);
 };
 const saveStampToLibrary=()=>{
  if(!activeStamp)return;
  try{
   const updated=addSavedStamp(stampLibrary,activeStamp,stampName);
   persistStampLibrary(updated);setActiveStamp(updated.find(stamp=>stamp.id===activeStamp.id)!);
   setNotice('Reusable stamp saved to this browser workspace.');
  }catch(e){setError((e as Error).message);}
 };
 const deleteSavedStamp=(id:string)=>persistStampLibrary(stampLibrary.filter(s=>s.id!==id));
 const selectInk=useCallback((nextInk:string,track=true)=>{
  if(!isHexInk(nextInk))return;
  const next=normalizeInk(nextInk);
  setInk(next);setHexDraft(next);
  if(track)setRecentColors(colors=>rememberInk(colors,next));
 },[]);
 const onHexDraft=(value:string)=>{
  setHexDraft(value);
  if(isHexInk(value))selectInk(value);
 };
 const finishHexDraft=()=>{
  if(isHexInk(hexDraft))selectInk(hexDraft);
  else setHexDraft(ink);
 };
 // The toolbar palette is intentionally nonmodal; a click outside or Escape
 // closes it, while keyboard users can Tab through real swatch buttons.
 useEffect(()=>{
  if(!quickColorsOpen)return;
  const outside=(e:PointerEvent)=>{
   if(!quickColorsRef.current?.contains(e.target as Node))setQuickColorsOpen(false);
  };
  const escape=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){
    e.preventDefault();e.stopImmediatePropagation();
    setQuickColorsOpen(false);quickColorsButtonRef.current?.focus();
   }
  };
  document.addEventListener('pointerdown',outside,true);
  window.addEventListener('keydown',escape,true);
  return()=>{
   document.removeEventListener('pointerdown',outside,true);
   window.removeEventListener('keydown',escape,true);
  };
 },[quickColorsOpen]);
 useEffect(()=>{if(guide.mode!=='off')setQuickColorsOpen(false);},[guide.mode]);
 useEffect(()=>{
  const canvas=stampPreviewRef.current;
  if(!canvas||!activeStamp||tool!=='stamp'||stampCapture)return;
  canvas.width=activeStamp.width;canvas.height=activeStamp.height;
  canvas.getContext('2d')?.putImageData(new ImageData(stampRgba(activeStamp),activeStamp.width,activeStamp.height),0,0);
 },[activeStamp,tool,stampCapture,hover]);
 const resetPan=useCallback(()=>{
  if(gestureFrame.current!==null)cancelAnimationFrame(gestureFrame.current);
  gestureFrame.current=null;
  panRef.current={x:0,y:0};setCanvasPan({x:0,y:0});setPinchScale(1);
  touchPoints.current.clear();touchGesture.current=null;suppressTouchDrawing.current=false;
 },[]);
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
  if(current.current?.doc.id!==s.doc.id){setSelection(null);setFrame(0);setPlaying(false);setPreviewClip(null);setEffectTarget(null);setFxPreview(null);setConfirmFxOverwrite(false);setClipOriginal(null);setClipName('idle');setClipFrom(0);setClipTo(0);setClipRangeSelection(null);setRangeSelectMode(false);setUiSections(['panel']);clipDragRef.current=null;resetPan();setFitMode(true);}
  queue.current?.dispose();queue.current=new EditQueue(s,request=>api<Snapshot>('projects/'+s.doc.id,request),showQueue);
  setSaveState({pending:0,saving:false,error:null});present(s);
 },[present,showQueue,resetPan]);
 const refresh=useCallback(async()=>setList(await api<PixelDocument[]>('projects')),[]);
 // Offer a one-time, dismissible learning hub after a workspace loads.
 useEffect(()=>{
  if(!snap?.doc)return;
  try{
   if(localStorage.getItem('pixel-workshop-guide-seen-v1'))return;
   localStorage.setItem('pixel-workshop-guide-seen-v1','1');
  }catch{return;}
  guidePreviousRef.current={tab:inspectorTab,inspectorOpen,drawOpen:drawToolsOpen};
  setGuide(old=>old.mode==='off'?{mode:'menu',scope:'all',index:0}:old);
 // Showing the welcome once is keyed by the first loaded project, not live editor state.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[snap?.doc.id]);
 useEffect(()=>{let alive=true;(async()=>{try{
  const imported=await importPendingKit();const entries=await api<PixelDocument[]>('projects');if(!alive)return;setList(entries);
  const wantsReturn=new URLSearchParams(window.location.search).get('resumeUiKit')==='1';
  let resume:UiReturn|null=null;
  if(wantsReturn)try{resume=parseUiReturn(sessionStorage.getItem(UI_RETURN_KEY));}catch{}
  resume=matchUiReturn(resume,workspaceId||'local',entries.map(item=>item.id));
  const s=imported?await api<Snapshot>('projects/'+imported):resume?await api<Snapshot>('projects/'+resume.projectId):entries.length?await api<Snapshot>('projects/'+entries[0].id):await api<Snapshot>('projects',{demo:true});
  if(alive){adopt(s);
   if(imported){setInspectorTab('ui');setNotice('Stardrop UI kit added to your workspace');}
   else if(resume){setInspectorTab('ui');setInspectorOpen(true);setFrame(Math.min(resume.frame,frameCount(s.doc)-1));
    if(s.doc.layers.some(item=>item.id===resume!.layer))setLayer(resume.layer);
    setUiSections(resume.sections);setNotice('Returned to your UI kit');}
   else setNotice(wantsReturn?'Could not restore that project in this workspace.':'All changes saved');
   if(wantsReturn){try{sessionStorage.removeItem(UI_RETURN_KEY);window.history.replaceState(null,'','/');}catch{}}
   await refresh();}
 }catch(e){if(alive)setError((e as Error).message);}})();return()=>{alive=false;queue.current?.dispose();};},[adopt,refresh,workspaceId]);
 useEffect(()=>{
  const doc=snap?.doc;if(!doc)return;
  const index=Math.min(frame,frameCount(doc)-1),ghosts:PixelDocument[]=[];
  if(onion&&frameCount(doc)>1){
    if(index>0)ghosts.push(frameView(doc,index-1));
    if(index+1<frameCount(doc))ghosts.push(frameView(doc,index+1));
  }
  const view=frameView(doc,index);
  render(canvas.current,view,zoom,grid,ghosts,{view:referenceView,referenceOpacity,artworkOpacity});render(preview.current,view,previewScale);
 },[snap,frame,zoom,grid,previewScale,onion,referenceView,referenceOpacity,artworkOpacity]);
 useEffect(()=>{const d=snap?.doc;if(d)setZoom(z=>Math.min(z,maxPreviewZoom(d.width,d.height)));},[snap?.doc.id,snap?.doc.width,snap?.doc.height]);
 useEffect(()=>{if(snap)setFrame(i=>Math.min(i,frameCount(snap.doc)-1));},[snap?.doc.animation?.frames.length,snap?.doc.id]);
 useEffect(()=>{
   if(!playing||!snap)return;
   const doc=snap.doc,clip=doc.animation?.clips?.find(clip=>clip.name===previewClip);
   const sequence=clip?clipFrameSequence(clip):null;
   if(clip?.mode==='once'&&sequence?.length===1){setPlaying(false);return;}
   if(!clip&&frameCount(doc)<2)return;
   const timer=setInterval(()=>{
     if(!clip||!sequence){setFrame(i=>(i+1)%frameCount(current.current?.doc||doc));return;}
     const next=previewPosition.current+1;
     if(next>=sequence.length){
       if(clip.mode==='once'){setPlaying(false);return;}
       previewPosition.current=0;
     }else previewPosition.current=next;
     setFrame(sequence[previewPosition.current]);
   },1000/(clip?.fps??doc.animation?.fps??8));
   return()=>clearInterval(timer);
 },[playing,previewClip,snap?.doc.id,snap?.doc.revision]);
 // Guide stops reveal controls without creating projects or altering pixel data.
 useEffect(()=>{
  if(!guideStep)return;
  if(guideStep.panel==='drawing'){
   setInspectorOpen(false);setDrawToolsOpen(compactDrawTools);
  }else if(guideStep.panel==='none'){
   setInspectorOpen(false);setDrawToolsOpen(false);
  }else{
   setDrawToolsOpen(false);setInspectorTab(guideStep.panel);
   setInspectorOpen(mobileLayout);
  }
 },[guideStep?.id,compactDrawTools,mobileLayout]);
 const touchNavigationActive=mobileLayout||touchCapable;
 useEffect(()=>{
  resetPan();
  if(viewport.current){viewport.current.scrollLeft=0;viewport.current.scrollTop=0;}
 },[mobileLayout,touchCapable,resetPan]);
 useEffect(()=>()=>{if(gestureFrame.current!==null)cancelAnimationFrame(gestureFrame.current);},[]);
 useEffect(()=>{
  const media=window.matchMedia('(pointer: coarse)');
  const update=()=>setTouchCapable(media.matches);
  update();media.addEventListener('change',update);
  return()=>media.removeEventListener('change',update);
 },[]);
 useEffect(()=>{
  const media=window.matchMedia('(max-width: 800px)');
  const update=()=>{setMobileLayout(media.matches);if(!media.matches)setInspectorOpen(false);};
  update();media.addEventListener('change',update);
  return()=>media.removeEventListener('change',update);
 },[]);
 // A narrow viewport OR a short desktop window needs the same drawer.
 // The separate height condition fixes the hidden/partially clipped Stamp tool.
 useEffect(()=>{
  const media=window.matchMedia('(max-width: 800px), (max-height: 860px)');
  const update=()=>{
   setCompactDrawTools(media.matches);
   if(!media.matches)setDrawToolsOpen(false);
  };
  update();media.addEventListener('change',update);
  return()=>media.removeEventListener('change',update);
 },[]);
 useEffect(()=>{
  if(!compactDrawTools||!drawToolsOpen||guide.mode!=='off')return;
  drawToolsCloseRef.current?.focus();
  const handle=(e:KeyboardEvent)=>{
   if((e.target as HTMLElement).closest('.reference-dialog'))return;
   if(e.key==='Escape'){
    e.preventDefault();e.stopImmediatePropagation();
    setDrawToolsOpen(false);drawToolsToggleRef.current?.focus();return;
   }
   if(e.key==='Tab'){
    const focusable=Array.from(drawToolsRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href],[tabindex="0"]')??[])
      .filter(el=>el.getClientRects().length>0);
    if(!focusable.length)return;
    const first=focusable[0],last=focusable[focusable.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
   }
  };
  window.addEventListener('keydown',handle,true);
  return()=>window.removeEventListener('keydown',handle,true);
 },[compactDrawTools,drawToolsOpen,guide.mode]);
 useEffect(()=>{
  const panel=inspectorRef.current?.querySelector<HTMLElement>('.inspector-panel:not([hidden])');
  if(panel)panel.scrollTop=0;
 },[inspectorTab]);
 useEffect(()=>{
  if(!mobileLayout||!inspectorOpen||guide.mode!=='off')return;
  drawerCloseRef.current?.focus();
  const handle=(e:KeyboardEvent)=>{
   if((e.target as HTMLElement).closest('.reference-dialog'))return;
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
 },[mobileLayout,inspectorOpen,guide.mode]);
 useEffect(()=>{const element=viewport.current;if(!element||!snap||!fitMode)return;
  const fit=()=>{
   const narrow=window.matchMedia('(max-width: 800px)').matches;
   const horizontal=narrow?28:112,vertical=narrow?54:97;
   setZoom(Math.max(1,Math.min(maxPreviewZoom(snap.doc.width,snap.doc.height),Math.floor(Math.min((element.clientWidth-horizontal)/snap.doc.width,
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
 useEffect(()=>{const beforeUnload=(e:BeforeUnloadEvent)=>{if(queue.current?.state.pending||stroke.current||selectionDrag.current||(uiDraftStorageErrorRef.current&&Object.keys(uiDraftsRef.current).length)){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',beforeUnload);return()=>window.removeEventListener('beforeunload',beforeUnload);},[]);
 const commit=useCallback(async(ops:PaintCommand[],base?:Snapshot,action='paint')=>{
  const q=queue.current;if(!q||locked.current||base&&base.doc.id!==q.state.snapshot.doc.id)return false;
  if(action==='undo'&&!q.state.snapshot.canUndo||action==='redo'&&!q.state.snapshot.canRedo)return false;
  setError('');try{q.enqueue({action:action as 'paint'|'undo'|'redo',...(action==='paint'?{commands:targetFrame(ops,Math.min(frame,frameCount(q.state.snapshot.doc)-1))}:{})});return true;}
  catch(e){present(q.state.snapshot);setError((e as Error).message);return false;}
 },[present,frame]);
 const saveUiDraft=useCallback(async(ops:PaintCommand[])=>{
  const q=queue.current;if(!q||!await commit(ops))return false;
  try{await q.flush();return true;}catch(e){setError((e as Error).message);return false;}
 },[commit]);
 const create=async(demo:boolean|'cottage'=false,document?:unknown,asCopy=false)=>{
  if(locked.current||stroke.current||selectionDrag.current)return;locked.current=true;setBusy(true);
  try{if(!asCopy)await queue.current?.flush();const s=await api<Snapshot>('projects',{name,width,height,demo,document});adopt(s);setFitMode(true);setModal(false);setError('');setNotice('All changes saved');await refresh();}
  catch(e){setError((e as Error).message);}finally{locked.current=false;setBusy(false);}
 };
 const open=async(id:string)=>{
  if(locked.current||stroke.current||selectionDrag.current)return false;locked.current=true;setBusy(true);
  try{await queue.current?.flush();adopt(await api<Snapshot>('projects/'+id));setError('');setNotice('All changes saved');return true;}
  catch(e){setError((e as Error).message);return false;}finally{locked.current=false;setBusy(false);}
 };
 const applyReference=async(reference:ReferenceImage,newCanvas:boolean)=>{
  if(locked.current||stroke.current||selectionDrag.current)return false;
  if(!newCanvas){
   const success=await commit([{op:'reference_set',reference}]);
   if(!success)throw new Error('Could not attach the reference. Check the canvas pixel budget and save status.');
   setReferenceView('overlay');return true;
  }
  locked.current=true;setBusy(true);
  try{
   await queue.current?.flush();
   const document={...createDocument(reference.name,reference.width,reference.height,'prepared-reference'),reference};
   adopt(await api<Snapshot>('projects',{document}));setFitMode(true);setReferenceView('overlay');setError('');setNotice('Tracing canvas saved');await refresh();return true;
  }finally{locked.current=false;setBusy(false);}
 };
 const openKitMember=async(id:string)=>{if(await open(id)){setInspectorTab('ui');setUiSections(['kit']);if(mobileLayout)setInspectorOpen(true);}};
 const getKitDocuments=async(kitId:string)=>{
  const items=await api<PixelDocument[]>('projects');const found:PixelDocument[]=[];
  for(let i=0;i<items.length;i+=4){
   const snapshots=await Promise.all(items.slice(i,i+4).map(item=>api<Snapshot>('projects/'+item.id)));
   found.push(...snapshots.map(item=>item.doc).filter(item=>item.ui?.kitId===kitId));
  }
  if(!found.length)throw new Error('No projects found in this kit.');
  if(found.length>30)throw new Error('A kit can contain at most 30 projects.');
  return found;
 };
 const requireAppliedKit=(docs:PixelDocument[])=>{
  let otherDrafts:UiDraftMap={};try{otherDrafts=parseUiDrafts(localStorage.getItem(uiDraftStoreKey));}catch{}
  const pending=docs.filter(doc=>hasUiDraft(uiDraftsRef.current[doc.id])||hasUiDraft(otherDrafts[doc.id]));
  if(pending.length)throw new Error(`Save or discard UI drafts in ${pending.map(doc=>doc.name).join(', ')} before using the kit.`);
 };
 const sendKitEdit=async(id:string,body:Record<string,unknown>)=>{
  try{return await api<Snapshot>('projects/'+id,body);}
  catch(e){if((e as Error&{status?:number}).status!==undefined)throw e;return await api<Snapshot>('projects/'+id,body);}
 };
 const remapKitColors=async(review:KitColorReview)=>{
  if(locked.current||stroke.current||selectionDrag.current)return false;
  locked.current=true;setBusy(true);setError('');let done=0,total=review.impacts.length,uncertain=false;
  let journal:KitUndo={kitId:review.kitId,from:review.from,to:review.to,entries:[]};
  try{
   await queue.current?.flush();const docs=await getKitDocuments(review.kitId);requireAppliedKit(docs);
   if(kitSignature(docs)!==review.signature)throw new Error('The kit changed since this review. Review the colors again.');
   if(!total)throw new Error('This color is not used in the kit.');
   const affected=new Set(review.impacts.map(item=>item.id));
   for(const doc of docs.filter(item=>affected.has(item.id))){
    let s:Snapshot;const requestId='kit-color-'+crypto.randomUUID();
    try{s=await sendKitEdit(doc.id,{revision:doc.revision,action:'paint',commands:[{op:'palette_remap',fromColor:review.from,toColor:review.to}],requestId});}
    catch(e){uncertain=(e as Error&{status?:number}).status===undefined;throw e;}
    journal={...journal,entries:[...journal.entries,{id:doc.id,name:doc.name,revision:s.doc.revision,requestId}]};keepKitUndo(journal);
    done++;if(doc.id===current.current?.doc.id)adopt(s);
   }
   await refresh();setNotice(`Recolored ${done} kit project${done===1?'':'s'}`);return true;
  }catch(e){setError(`${done} of ${total||'?'} projects updated. ${(e as Error).message}${uncertain?' The last project may also have changed; inspect it before retrying.':''}`);try{await refresh();}catch{}return false;}
  finally{locked.current=false;setBusy(false);}
 };
 const inspectKitColors=async(kitId:string)=>{
  await queue.current?.flush();const docs=await getKitDocuments(kitId);
  return overviewKit(docs);
 };
 const reviewKitColors=async(from:string,to:string,kitId:string)=>{
  await queue.current?.flush();const docs=await getKitDocuments(kitId);requireAppliedKit(docs);return reviewKitColor(docs,kitId,from,to);
 };
 const undoKitColors=async()=>{
  const saved=kitUndo;if(!saved||locked.current||stroke.current||selectionDrag.current)return;
  locked.current=true;setBusy(true);setError('');let done=0,remaining=saved,uncertain=false;
  try{
   await queue.current?.flush();const docs=await getKitDocuments(saved.kitId);
   const affected=new Set(saved.entries.map(entry=>entry.id));requireAppliedKit(docs.filter(doc=>affected.has(doc.id)));
   const conflict=validateKitUndo(saved,docs);if(conflict)throw new Error(conflict);
   for(const entry of saved.entries){
    let s:Snapshot;
    try{s=await sendKitEdit(entry.id,{revision:entry.revision,action:'undo',requestId:'kit-undo-'+crypto.randomUUID(),expectedLastRequestId:entry.requestId});}
    catch(e){uncertain=(e as Error&{status?:number}).status===undefined;throw e;}
    done++;remaining={...remaining,entries:remaining.entries.filter(item=>item.id!==entry.id)};keepKitUndo(remaining.entries.length?remaining:null);
    if(entry.id===current.current?.doc.id)adopt(s);
   }
   await refresh();setNotice(`Undid recolor in ${done} kit project${done===1?'':'s'}`);
  }catch(e){setError(`${done} of ${saved.entries.length} projects restored. ${(e as Error).message}${uncertain?' The last project may also have changed; inspect it before retrying.':''}`);try{await refresh();}catch{}}
  finally{locked.current=false;setBusy(false);}
 };
 const exportCurrentKit=async()=>{
  const kitId=current.current?.doc.ui?.kitId;if(!kitId||locked.current)return;
  locked.current=true;setBusy(true);setError('');
  try{await queue.current?.flush();const docs=await getKitDocuments(kitId);requireAppliedKit(docs);const {buildGamePack}=await import('../lib/game-pack.ts');
   const {bytes}=buildGamePack(docs);download(kitId+'.zip',new Blob([bytes],{type:'application/zip'}));setNotice(`Exported ${docs.length} kit projects`);
  }catch(e){setError((e as Error).message);}finally{locked.current=false;setBusy(false);}
 };
 const previewCurrentKit=async()=>{
  const kitId=current.current?.doc.ui?.kitId;if(!kitId||locked.current)return;
  locked.current=true;setBusy(true);setError('');
  try{await queue.current?.flush();const docs=await getKitDocuments(kitId);requireAppliedKit(docs);
   if(!docs.some(doc=>doc.ui?.assetKey?.startsWith('ui')))throw new Error('Assign at least one Stardrop asset key before previewing.');
   const currentDoc=current.current!.doc;
   const returnPoint:UiReturn={format:'pixel-workshop-ui-return/1',workspaceId:workspaceId||'local',projectId:currentDoc.id,
    frame:Math.min(frame,frameCount(currentDoc)-1),layer,sections:uiSections};
   sessionStorage.setItem(UI_RETURN_KEY,JSON.stringify(returnPoint));
   sessionStorage.setItem('pixel-workshop-ui-preview-v1',JSON.stringify({format:'pixel-workshop-ui-preview/1',documents:docs}));
   window.location.assign('/play/moonkeeper?uiPreview=1');
  }catch(e){setError((e as Error).message);locked.current=false;setBusy(false);}
 };
 const gestureViewport=(element:HTMLDivElement):GestureViewport=>{
  const rect=element.getBoundingClientRect();
  return {width:rect.width,height:rect.height,center:{x:rect.left+rect.width/2,y:rect.top+rect.height/2}};
 };
 const cancelActiveStroke=()=>{
  if(stampCaptureDrag.current){stampCaptureDrag.current=null;setSelection(null);}
  const st=stroke.current,drag=selectionDrag.current;
  if(!st&&!drag)return;
  stroke.current=null;selectionDrag.current=null;
  if(drag)setSelection(drag.source);
  present(queue.current?.state.snapshot ?? st?.base ?? drag!.base);
 };
 const touchDown=(e:PE<HTMLDivElement>)=>{
  if(e.pointerType!=='touch'||!touchNavigationActive)return;
  touchPoints.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(touchGesture.current||suppressTouchDrawing.current||touchPoints.current.size!==2)return;
  const doc=current.current?.doc,el=e.currentTarget;
  if(!doc)return;
  const [first,second]=Array.from(touchPoints.current.entries());
  const viewport=gestureViewport(el);
  const start=beginPinch(first[1],second[1],viewport,{width:doc.width,height:doc.height},zoom,panRef.current);
  cancelActiveStroke();
  setHover(null);setCursor('X —   Y —');setSelection(null);setFitMode(false);
  suppressTouchDrawing.current=true;
  touchGesture.current={ids:[first[0],second[0]],start,last:{
   scale:1,midpoint:touchMidpoint(first[1],second[1]),pan:panRef.current
  }};
  // The first finger may have been captured by the drawing canvas.
  // Retarget both pointers to the scroll viewport for the rest of this gesture.
  for(const id of [first[0],second[0]]){
    try{el.setPointerCapture(id);}catch{/* A cancelled pointer will be cleaned up on release. */}
  }
  e.preventDefault();
 };
 const updateGesture=()=>{
  const gesture=touchGesture.current,doc=current.current?.doc,el=viewport.current;
  if(!gesture||!doc||!el)return;
  const a=touchPoints.current.get(gesture.ids[0]),b=touchPoints.current.get(gesture.ids[1]);
  if(!a||!b)return;
  const result=movePinch(gesture.start,a,b,gestureViewport(el),{width:doc.width,height:doc.height},maxPreviewZoom(doc.width,doc.height));
  gesture.last=result;panRef.current=result.pan;
  setCanvasPan(result.pan);setPinchScale(result.scale);
 };
 const touchMove=(e:PE<HTMLDivElement>)=>{
  if(e.pointerType!=='touch'||!touchNavigationActive||!touchPoints.current.has(e.pointerId))return;
  touchPoints.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(!touchGesture.current)return;
  // Pointer events arrive per finger. Coalesce them to one frame so parallel
  // two-finger drags do not flicker between brief false pinch distances.
  if(gestureFrame.current===null){
   gestureFrame.current=requestAnimationFrame(()=>{
    gestureFrame.current=null;updateGesture();
   });
  }
  e.preventDefault();
 };
 const touchEnd=(e:PE<HTMLDivElement>)=>{
  if(e.pointerType!=='touch'||!touchNavigationActive||!touchPoints.current.has(e.pointerId))return;
  if(e.type==='pointerup')touchPoints.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(gestureFrame.current!==null){
   cancelAnimationFrame(gestureFrame.current);gestureFrame.current=null;
  }
  updateGesture();
  const gesture=touchGesture.current,doc=current.current?.doc;
  if(gesture&&gesture.ids.includes(e.pointerId)&&doc){
   const finished=finishPinch(gesture.start,gesture.last,gestureViewport(e.currentTarget),{width:doc.width,height:doc.height},maxPreviewZoom(doc.width,doc.height));
   panRef.current=finished.pan;setCanvasPan(finished.pan);
   setZoom(Math.min(finished.zoom,maxPreviewZoom(doc.width,doc.height)));setPinchScale(1);touchGesture.current=null;setFitMode(false);
   e.preventDefault();
  }
  touchPoints.current.delete(e.pointerId);
  if(touchPoints.current.size===0)suppressTouchDrawing.current=false;
 };
 const point=(e:PE<HTMLCanvasElement>)=>{const d=current.current!.doc,b=e.currentTarget.getBoundingClientRect();return {x:Math.max(0,Math.min(d.width-1,Math.floor((e.clientX-b.left)/b.width*d.width))),y:Math.max(0,Math.min(d.height-1,Math.floor((e.clientY-b.top)/b.height*d.height)))};};
 const copySelection=()=>{
  const doc=current.current?.doc;if(!doc||!selection)return;
  setClipboard({width:selection.width,height:selection.height,pixels:readRegion(doc,layer,selection,Math.min(frame,frameCount(doc)-1))});
  try{const stamp=captureStamp(doc,layer,selection,Math.min(frame,frameCount(doc)-1),'stamp-'+crypto.randomUUID());
   setActiveStamp(stamp);setStampName(stamp.name);
  }catch{/* Copying an empty region still works. */}
  setNotice(`Copied ${selection.width} × ${selection.height} pixels`);
 };
 const pasteSelection=()=>{const doc=current.current?.doc;if(!doc||!clipboard||locked.current)return;if(clipboard.width>doc.width||clipboard.height>doc.height){setError('The copied area is larger than this canvas.');return;}const region={x:Math.min(doc.width-clipboard.width,(selection?.x??-2)+2),y:Math.min(doc.height-clipboard.height,(selection?.y??-2)+2),width:clipboard.width,height:clipboard.height};setSelection(region);setTool('select');void commit([{op:'paste',layer,...region,pixels:clipboard.pixels}]);};
 const transformSelection=(mode:string,dx=0,dy=0)=>{const doc=current.current?.doc;if(!doc||!selection||locked.current)return;const region={...selection,x:Math.max(0,Math.min(doc.width-selection.width,selection.x+dx)),y:Math.max(0,Math.min(doc.height-selection.height,selection.y+dy))};if(mode==='move'&&region.x===selection.x&&region.y===selection.y)return;void commit([{op:'transform',layer,mode,...selection,x2:region.x,y2:region.y}]);setSelection(region);};
 const clearSelection=()=>{if(selection)void commit([{op:'rect',layer,...selection,color:'transparent'}]);};
 const shape=(a:{x:number;y:number},b:{x:number;y:number}):PaintCommand=>tool==='line'?{op:'line',layer,color:ink,...a,x2:b.x,y2:b.y}:{op:tool,layer,color:ink,x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x)+1,height:Math.abs(a.y-b.y)+1,filled};
 const down=(e:PE<HTMLCanvasElement>)=>{const s=current.current;if(e.button!==0||!s||locked.current||stroke.current||selectionDrag.current||s.doc.reference&&referenceView==='reference'||e.pointerType==='touch'&&(touchGesture.current!==null||suppressTouchDrawing.current))return;e.preventDefault();const p=point(e);setHover(p);if(playing)return;
 if(tool==='stamp'&&(stampCapture||!activeStamp)){
  e.currentTarget.setPointerCapture(e.pointerId);
  const region={x:p.x,y:p.y,width:1,height:1};
  stampCaptureDrag.current={start:p,region,layer,frame:Math.min(frame,frameCount(s.doc)-1)};
  setSelection(region);return;
 }
 if(tool==='select'){e.currentTarget.setPointerCapture(e.pointerId);const inside=selection&&p.x>=selection.x&&p.y>=selection.y&&p.x<selection.x+selection.width&&p.y<selection.y+selection.height;const region=inside?selection!:{...p,width:1,height:1};selectionDrag.current={base:s,start:p,source:inside?region:null,region,layer,frame:Math.min(frame,frameCount(s.doc)-1)};setSelection(region);return;}setSelection(null);if(tool==='stamp'&&activeStamp){
  try{
   const ops:PaintCommand[]=[stampCommand(s.doc,activeStamp,p.x,p.y,layer,Math.min(frame,frameCount(s.doc)-1),stampSnap)];
   if(e.pointerType==='touch'){
    const target=Math.min(frame,frameCount(s.doc)-1);
    e.currentTarget.setPointerCapture(e.pointerId);
    stroke.current={base:s,start:p,last:p,ops,frame:target};
    present({...s,doc:applyCommands(s.doc,targetFrame(ops,target))});
   }else void commit(ops);
  }catch(e){setError((e as Error).message);}
  return;
 }if(tool==='picker'){const rgba=composite(frameView(s.doc,Math.min(frame,frameCount(s.doc)-1))),i=(p.y*s.doc.width+p.x)*4;if(rgba[i+3])selectInk('#'+Array.from(rgba.slice(i,i+3)).map(v=>v.toString(16).padStart(2,'0')).join('')+(rgba[i+3]<255?rgba[i+3].toString(16).padStart(2,'0'):''));return;}if(tool==='fill'){
  const ops:PaintCommand[]=[{op:'fill',layer,color:ink,...p}];
  if(e.pointerType==='touch'){
   // Defer the save until release so a second finger can cancel a tentative fill.
   const target=Math.min(frame,frameCount(s.doc)-1);
   e.currentTarget.setPointerCapture(e.pointerId);
   stroke.current={base:s,start:p,last:p,ops,frame:target};
   present({...s,doc:applyCommands(s.doc,targetFrame(ops,target))});
  }else void commit(ops);
  return;
 }if(!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(ink)){setError('Choose a valid hex color.');return;}e.currentTarget.setPointerCapture(e.pointerId);const ops:PaintCommand[]=['pencil','eraser'].includes(tool)?[{op:'pixel',layer,color:tool==='eraser'?'transparent':ink,...p}]:[shape(p,p)];stroke.current={base:s,start:p,last:p,ops,frame:Math.min(frame,frameCount(s.doc)-1)};present({...s,doc:applyCommands(s.doc,targetFrame(ops,Math.min(frame,frameCount(s.doc)-1)))});};
 const move=(e:PE<HTMLCanvasElement>)=>{if(!snap||e.pointerType==='touch'&&(touchGesture.current!==null||suppressTouchDrawing.current))return;const p=point(e);setHover(old=>old?.x===p.x&&old?.y===p.y?old:p);setCursor(`X ${String(p.x).padStart(3,'0')}   Y ${String(p.y).padStart(3,'0')}`);const cap=stampCaptureDrag.current;
 if(cap){
  cap.region={x:Math.min(cap.start.x,p.x),y:Math.min(cap.start.y,p.y),
   width:Math.abs(cap.start.x-p.x)+1,height:Math.abs(cap.start.y-p.y)+1};
  setSelection(cap.region);return;
 }
 const drag=selectionDrag.current;if(drag){if(drag.source){const source=drag.source;drag.region={...source,x:Math.max(0,Math.min(drag.base.doc.width-source.width,source.x+p.x-drag.start.x)),y:Math.max(0,Math.min(drag.base.doc.height-source.height,source.y+p.y-drag.start.y))};present({...drag.base,doc:applyCommands(drag.base.doc,[{op:'transform',mode:'move',layer:drag.layer,frame:drag.frame,...source,x2:drag.region.x,y2:drag.region.y}])});}else drag.region={x:Math.min(drag.start.x,p.x),y:Math.min(drag.start.y,p.y),width:Math.abs(p.x-drag.start.x)+1,height:Math.abs(p.y-drag.start.y)+1};setSelection(drag.region);return;}const st=stroke.current;if(!st||tool==='fill'||tool==='stamp'||(p.x===st.last.x&&p.y===st.last.y)||st.ops.length>4000)return;if(['pencil','eraser'].includes(tool))st.ops.push({op:'line',layer,color:tool==='eraser'?'transparent':ink,...st.last,x2:p.x,y2:p.y});else st.ops=[shape(st.start,p)];st.last=p;present({...st.base,doc:applyCommands(st.base.doc,targetFrame(st.ops,st.frame))});};
 const up=()=>{
  const cap=stampCaptureDrag.current;
  if(cap){
   stampCaptureDrag.current=null;
   try{
    const doc=current.current?.doc;if(!doc)throw new Error('No canvas open.');
    const stamp=captureStamp(doc,cap.layer,cap.region,cap.frame,'stamp-'+crypto.randomUUID());
    setActiveStamp(stamp);setStampName(stamp.name);setStampCapture(false);
    setNotice('Captured! Click to place copies, or save this stamp in Draw.');
   }catch(e){setError((e as Error).message);setStampCapture(true);}
   setSelection(null);return;
  }
  const drag=selectionDrag.current;if(drag){selectionDrag.current=null;if(drag.source&&(drag.source.x!==drag.region.x||drag.source.y!==drag.region.y))void commit([{op:'transform',mode:'move',layer:drag.layer,frame:drag.frame,...drag.source,x2:drag.region.x,y2:drag.region.y}],drag.base);else present(drag.base);return;}const st=stroke.current;if(st){stroke.current=null;void commit(targetFrame(st.ops,st.frame),st.base);}};
 const exportFrame=async()=>{
  const doc=current.current?.doc;if(!doc)return;
  try{
   const view=frameView(doc,Math.min(frame,frameCount(doc)-1));
   const blob=exportFormat==='svg'
    ?new Blob([encodeSvg(view,scale)],{type:'image/svg+xml;charset=utf-8'})
    :new Blob([(await import('../lib/browser-png.ts')).encodeBrowserPng(view,scale)],{type:'image/png'});
   download(doc.name+'.'+exportFormat,blob);
   if(!queue.current?.state.pending)setNotice(`Exported ${doc.width*scale} × ${doc.height*scale} ${exportFormat.toUpperCase()}`);
  }catch(e){setError((e as Error).message);}
 };
 useEffect(()=>{const h=(e:KeyboardEvent)=>{if(e.key==='Escape'&&(modal||packModal)){if(!busy){setModal(false);setPackModal(false);}return;}if(guide.mode==='menu'||e.defaultPrevented||(e.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"],[role="tab"]')||stroke.current||selectionDrag.current)return;if(e.key==='Escape'){setModal(false);setPackModal(false);setSelection(null);return;}if(modal||packModal)return;const mod=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();if(mod&&key==='z'){e.preventDefault();void commit([],undefined,e.shiftKey?'redo':'undo');return;}if(mod&&key==='c'&&selection){e.preventDefault();copySelection();return;}if(mod&&key==='v'&&clipboard){e.preventDefault();pasteSelection();return;}if(mod&&key==='x'&&selection){e.preventDefault();copySelection();clearSelection();return;}if(selection&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const step=e.shiftKey?10:1;transformSelection('move',e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0,e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0);return;}if(selection&&['Delete','Backspace'].includes(e.key)){e.preventDefault();clearSelection();return;}if(mod)return;const t=tools.find(t=>t[3].toLowerCase()===key);if(t)chooseTool(t[0]);if(key==='h')setGrid(v=>!v);};window.addEventListener('keydown',h);return()=>window.removeEventListener('keydown',h);});
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
    setClipRangeSelection(null);setSelection(null);setFrame(i=>Math.max(0,i-1));
  }
 };
 const beginClipRange=(index:number,e:PE<HTMLButtonElement>)=>{
  if(!rangeSelectMode||playing||e.button!==0)return;
  e.preventDefault();
  clipDragRef.current=index;setClipRangeSelection({from:index,to:index});
  if(clipOriginal){setClipFrom(index);setClipTo(index);}
  e.currentTarget.parentElement?.setPointerCapture(e.pointerId);
 };
 const dragClipRange=(e:PE<HTMLDivElement>)=>{
  if(clipDragRef.current===null||!rangeSelectMode||!current.current)return;
  const track=e.currentTarget;
  const frames=track.querySelectorAll<HTMLElement>('[data-frame-index]');
  if(!frames.length)return;
  let hovered=frames.length-1;
  for(let i=0;i<frames.length;i++){
   if(e.clientX<=frames[i].getBoundingClientRect().right){hovered=i;break;}
  }
  const range=clipRange(clipDragRef.current,hovered,frameCount(current.current.doc));
  setClipRangeSelection(range);
  if(clipOriginal){setClipFrom(range.from);setClipTo(range.to);}
 };
 const finishClipRange=(e:PE<HTMLDivElement>)=>{
  if(clipDragRef.current===null)return;
  clipDragRef.current=null;
  if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
 };
 const openClipFromRange=()=>{
  const doc=current.current?.doc;if(!doc||!clipRangeSelection)return;
  setPlaying(false);setRangeSelectMode(false);
  setClipOriginal(null);setClipName('new-clip');
  setClipFrom(clipRangeSelection.from);setClipTo(clipRangeSelection.to);
  setClipFps(doc.animation?.fps??8);setClipMode('loop');
  setInspectorTab('animation');setInspectorOpen(mobileLayout);
 };
 const saveClip=async()=>{
  const doc=current.current?.doc;if(!doc)return;
  const proposed=clipName.trim();
  const changingName=clipOriginal&&clipOriginal.toLowerCase()!==proposed.toLowerCase();
  if(changingName&&doc.animation?.clips?.some(clip=>clip.name.toLowerCase()===proposed.toLowerCase())){
   setError('Another clip already uses that name.');return;
  }
  const commands:PaintCommand[]=changingName?[{op:'clip_delete',name:clipOriginal!}]:[];
  commands.push({op:'clip_set',name:proposed,from:clipFrom,to:clipTo,fps:clipFps,mode:clipMode});
  if(await commit(commands)){setClipOriginal(null);setClipRangeSelection({from:clipFrom,to:clipTo});setNotice('Saved animation clip');}
 };
 const editClip=(clip:AnimationClip)=>{
  setClipOriginal(clip.name);setClipName(clip.name);setClipFrom(clip.from);setClipTo(clip.to);setClipFps(clip.fps);setClipMode(clip.mode);setClipRangeSelection({from:clip.from,to:clip.to});setRangeSelectMode(false);setInspectorTab('animation');setInspectorOpen(mobileLayout);
 };
 const playClip=(clip:AnimationClip)=>{
  previewPosition.current=0;setPreviewClip(clip.name);setFrame(clip.from);setPlaying(true);
 };
 const exportSheet=async()=>{
  const doc=current.current?.doc;if(!doc)return;
  try{
   const sheet=buildSpriteSheet(doc,undefined,exportFormat);
   const blob=exportFormat==='svg'
    ?new Blob([encodeRgbaSvg(sheet.bytes,sheet.width,sheet.height)],{type:'image/svg+xml;charset=utf-8'})
    :new Blob([(await import('../lib/browser-png.ts')).encodeBrowserRgba(sheet.bytes,sheet.width,sheet.height)],{type:'image/png'});
   download(sheet.atlas.image,blob);
   setNotice(`Exported ${sheet.atlas.frames.length}-frame ${exportFormat.toUpperCase()} sprite sheet`);
  }catch(e){setError((e as Error).message);}
 };
 const exportAtlas=()=>{
  const doc=current.current?.doc;if(!doc)return;
  try{
   const sheet=buildSpriteSheet(doc,undefined,exportFormat),name=sheet.atlas.image.replace(/-sheet\.(png|svg)$/,'-atlas.json');
   download(name,new Blob([JSON.stringify(sheet.atlas,null,2)],{type:'application/json'}));
   setNotice('Exported animation atlas JSON');
  }catch(e){setError((e as Error).message);}
 };
 const saveProjectInk=async()=>{
  const doc=current.current?.doc;
  if(!doc||!isHexInk(ink)||doc.palette.length>=128)return;
  const {saved}=splitProjectPalette(doc.palette);
  if(saved.some(c=>normalizeInk(c)===normalizeInk(ink)))return;
  // A legacy starter may be intentionally pinned, without deleting the original swatches.
  await commit([{op:'palette',colors:[...doc.palette,normalizeInk(ink)]}]);
 };
 const removeProjectInk=async(color:string)=>{
  const doc=current.current?.doc;if(!doc||!isHexInk(color))return;
  const {legacy,saved}=splitProjectPalette(doc.palette);
  const favorites=saved.filter(c=>normalizeInk(c)!==normalizeInk(color));
  await commit([{op:'palette',colors:[...legacy,...favorites]}]);
 };
 const removeLegacySwatches=async()=>{
  const doc=current.current?.doc;if(!doc)return;
  const {legacy,saved}=splitProjectPalette(doc.palette);
  if(!legacy.length)return;
  await commit([{op:'palette',colors:saved}]);
 };
 const exportTiles=async()=>{
  const doc=current.current?.doc;if(!doc)return;
  try{
   const {buildTilesetPack}=await import('../lib/tileset.ts');
   const {atlas,bytes}=buildTilesetPack(doc,tileSize,tileSize,Math.min(frame,frameCount(doc)-1));
   download(atlas.image.replace('-tiles.png','-tileset.zip'),new Blob([bytes],{type:'application/zip'}));
   setNotice('Exported '+atlas.tiles.length+' tiles with editable source');
  }catch(e){setError((e as Error).message);}
 };
 const openPack=()=>{
  setPackIds(list.slice(0,30).map(p=>p.id));
  setPackModal(true);setError('');
 };
 const exportGamePack=async()=>{
  if(locked.current||!packIds.length)return;
  locked.current=true;setBusy(true);setError('');
  try{
   if(stroke.current||selectionDrag.current)throw new Error('Finish the active brush stroke before exporting a game pack.');
   await queue.current?.flush();
   const docs:PixelDocument[]=[];
   for(let i=0;i<packIds.length;i+=4){
    const batch=await Promise.all(packIds.slice(i,i+4).map(id=>api<Snapshot>('projects/'+id)));
    docs.push(...batch.map(item=>item.doc));
   }
   const {buildGamePack}=await import('../lib/game-pack.ts');
   const {bytes}=buildGamePack(docs);
   download('pixel-workshop-game-pack.zip',new Blob([bytes],{type:'application/zip'}));
   setPackModal(false);setNotice('Exported '+docs.length+' editable game assets');
  }catch(e){setError((e as Error).message);}
  finally{setBusy(false);locked.current=false;}
 };
 const addEffect=async()=>{
  const doc=current.current?.doc;if(!doc)return;
  try{
   const commands=generateEffectCommands(doc,{kind:effectKind,seed:effectSeed,ink,speed:effectSpeed,opacity:effectOpacity,drift:effectDrift});
   if(await commit(commands)){
    setLayer(String(commands[0].id));setEffectTarget(String(commands[0].id));setFrame(0);setSelection(null);setPlaying(true);
   }
  }catch(e){setError((e as Error).message);}
 };
 const chooseEffectLayer=(id:string)=>{
  const recipe=current.current?.doc.layers.find(l=>l.id===id)?.effect;
  setEffectTarget(id||null);
  if(recipe){
   setEffectKind(recipe.kind);setEffectSeed(recipe.seed);selectInk(recipe.ink);
   setEffectSpeed(recipe.speed);setEffectOpacity(recipe.opacity);setEffectDrift(recipe.drift);
  }
 };
 const previewEffectChanges=()=>{
  const doc=current.current?.doc;if(!doc||!effectTarget)return;
  try{
   const selected=Math.min(frame,frameCount(doc)-1);
   const comparison=compareEffectFrame(doc,effectTarget,selected,{
    kind:effectKind,seed:effectSeed,ink,speed:effectSpeed,opacity:effectOpacity,drift:effectDrift
   });
   setFxPreview({key:JSON.stringify([doc.id,doc.revision,effectTarget,selected,effectKind,effectSeed,ink,effectSpeed,effectOpacity,effectDrift]),comparison});
   setNotice('Preview ready. Artwork has not changed.');
  }catch(e){setError((e as Error).message);}
 };
 const regenerateEffect=async()=>{
  const doc=current.current?.doc;if(!doc||!effectTarget)return;
  try{
   const selected=Math.min(frame,frameCount(doc)-1);
   const key=JSON.stringify([doc.id,doc.revision,effectTarget,selected,effectKind,effectSeed,ink,effectSpeed,effectOpacity,effectDrift]);
   if(fxPreview?.key!==key)throw new Error('Preview your changes before regenerating.');
   const preserve=preserveFx&&canBackUpFx;
   if(!preserve&&!confirmFxOverwrite)throw new Error('Confirm regeneration without a backup before continuing.');
   const commands:PaintCommand[]=[
    ...(preserve?[{op:'duplicate_layer',layer:effectTarget,id:'fx-backup-'+crypto.randomUUID().slice(0,8),name:'Original FX Backup'}]:[]),
    ...regenerateEffectCommands(doc,effectTarget,{
     kind:effectKind,seed:effectSeed,ink,speed:effectSpeed,opacity:effectOpacity,drift:effectDrift,
    })
   ];
   if(await commit(commands)){
    setFxPreview(null);setConfirmFxOverwrite(false);setFrame(0);setSelection(null);setPlaying(true);
    setNotice(preserve?'Regenerated effect; original preserved in a hidden backup layer.':'Regenerated effect without a backup.');
   }
  }catch(e){setError((e as Error).message);}
 };
 const openGuide=useCallback(()=>{
  if(guide.mode==='off')guidePreviousRef.current={tab:inspectorTab,inspectorOpen,drawOpen:drawToolsOpen};
  try{localStorage.setItem('pixel-workshop-guide-seen-v1','1');}catch{}
  setInspectorOpen(false);setDrawToolsOpen(false);
  setGuide({mode:'menu',scope:'all',index:0});
 },[guide.mode,inspectorTab,inspectorOpen,drawToolsOpen]);
 const closeGuide=useCallback(()=>{
  const previous=guidePreviousRef.current;
  setGuide({mode:'off',scope:'all',index:0});
  if(previous){
   setInspectorTab(previous.tab);setInspectorOpen(previous.inspectorOpen&&mobileLayout);
   setDrawToolsOpen(previous.drawOpen&&compactDrawTools);
  }else{setInspectorOpen(false);setDrawToolsOpen(false);}
  guidePreviousRef.current=null;
  requestAnimationFrame(()=>{if(previous?.drawOpen&&compactDrawTools)drawToolsCloseRef.current?.focus();else if(previous?.inspectorOpen&&mobileLayout)drawerCloseRef.current?.focus();else guideToggleRef.current?.focus();});
 },[mobileLayout,compactDrawTools]);
 const startGuide=useCallback((scope:GuideScope)=>setGuide({mode:'tour',scope,index:0}),[]);
 const moveGuide=useCallback((direction:-1|1)=>{
  setGuide(old=>old.mode!=='tour'?old:{...old,index:Math.max(0,Math.min(guideSteps(old.scope).length-1,old.index+direction))});
 },[]);
 const guideMenu=useCallback(()=>{
  setInspectorOpen(false);setDrawToolsOpen(false);
  setGuide(old=>({...old,mode:'menu'}));
 },[]);
 const closeDrawTools=()=>{setDrawToolsOpen(false);drawToolsToggleRef.current?.focus();};
 const closeMobileInspector=()=>{setInspectorOpen(false);drawerToggleRef.current?.focus();};
 const manageWorkspace=async()=>{
  if(guide.mode!=='off')closeGuide();
  try{
   await queue.current?.flush();
   if(stroke.current||selectionDrag.current||stampCaptureDrag.current)throw new Error('Finish your current stroke before switching workspaces.');
   onManageWorkspace?.();
  }catch(error){setError(error instanceof Error?error.message:'Unable to save before switching.');}
 };
 const activateInspectorTab=(tab:InspectorTab)=>{
  setInspectorTab(tab);
  if(inspectorRef.current)inspectorRef.current.scrollTop=0;
 };
 const d=snap?.doc,activeFrame=d?Math.min(frame,frameCount(d)-1):0,displayError=error||saveState.error?.message;
 const uiDraftCount=Object.values(uiDrafts).filter(hasUiDraft).length;
 const displayStatus=displayError||(uiDraftCount?`${saveState.pending?notice+' · ':''}${uiDraftCount===1?'UI draft':'UI drafts in '+uiDraftCount+' projects'} not applied · ${uiDraftStorageError?'temporary only':'kept on this device'}`:notice);
 const canBackUpFx=!!(d&&d.layers.length<8&&documentCells(d,d.layers.length+1)<=MAX_ANIMATION_CELLS&&
  4*d.width*d.height*frameCount(d)<=2_000_000);
 const previewKey=JSON.stringify([d?.id,d?.revision,effectTarget,activeFrame,effectKind,effectSeed,ink,effectSpeed,effectOpacity,effectDrift]);
 const validFxPreview=fxPreview?.key===previewKey?fxPreview.comparison:null;
 const stampCanFit=!!(d&&activeStamp&&activeStamp.width<=d.width&&activeStamp.height<=d.height);
 const stampHover=stampCanFit&&hover&&tool==='stamp'&&!stampCapture?
  positionStamp(d!,activeStamp!,hover.x,hover.y,stampSnap):null;
 return <main className="workshop"><header className="app-header"><a className="brand" href="/"><span className="brand-mark">{Array.from({length:9},(_,i)=><i key={i}/>)}</span><span>pixel<span className="brand-light">workshop</span><small>A LITTLE ROOM TO MAKE THINGS</small></span></a>{onManageWorkspace&&<button type="button" data-guide="workspace" className="text-button workspace-header-button" aria-label="Manage workspace" title="Workspace and agent connection" onClick={()=>void manageWorkspace()}><KeyRound size={16}/><span>Workspace</span></button>}<button type="button" ref={guideToggleRef} className="guide-header-button"
 title="Guided tour and interactive help" aria-label="Open Pixel Workshop guide" onClick={openGuide}>
 <BookOpen size={17}/><span>Guide</span></button><div className="header-meta"><span className="version">WORKSPACE / 01</span><span className="connection"><i/> MCP enabled</span></div><button className="primary" data-guide="quick-export" aria-label={`Export current frame as ${exportFormat.toUpperCase()}`} disabled={!d||busy} onClick={()=>void exportFrame()}><Download size={15}/>Export {exportFormat.toUpperCase()}</button></header>
 <div className="document-bar"><div className="document-switch" data-guide="project-list"><FolderOpen size={15}/><select aria-label="Open saved project" value={d?.id||''} disabled={busy} onChange={e=>void open(e.target.value)}>{!d&&<option>Opening workspace…</option>}{list.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><ChevronDown size={13}/></div><span className="document-size">{d?`${d.width} × ${d.height} px`:'—'}</span><span className="separator"/><button className="text-button" data-guide="new-canvas" disabled={busy} onClick={()=>setModal(true)}><FilePlus size={15}/>New canvas</button><button className="text-button open-file" disabled={busy} onClick={()=>file.current?.click()}><FolderOpen size={15}/>Open project</button><a className="text-button stardrop-editor-link" data-guide="stardrop" href="/play/moonkeeper" title="Play Stardrop, a game made with Pixel Workshop">✧ <span>Play Stardrop</span></a></div>
 <div className="work-area" data-tools-open={mobileLayout&&inspectorOpen} data-draw-open={compactDrawTools&&drawToolsOpen}>
 <button type="button" className="draw-tools-backdrop" tabIndex={-1} aria-label="Dismiss drawing tools" onClick={closeDrawTools}/>
 <aside id="pixel-drawing-tools" className="tool-rail" ref={drawToolsRef} aria-label="Drawing tools"
  role={compactDrawTools&&drawToolsOpen&&guide.mode==='off'?'dialog':undefined}
  aria-modal={compactDrawTools&&drawToolsOpen&&guide.mode==='off'?true:undefined}
  aria-hidden={compactDrawTools&&!drawToolsOpen}
  inert={compactDrawTools&&!drawToolsOpen}>
  <div className="draw-tools-header"><span><Pencil size={16}/>Drawing tools</span>
    <button type="button" ref={drawToolsCloseRef} aria-label="Close drawing tools" onClick={closeDrawTools}><X size={19}/></button>
  </div>
  <div className="rail-paint-tools">
    {tools.map(([id,Icon,label,key])=><button key={id} data-guide={id==='pencil'?'drawing-pencil':undefined} className={'tool '+(tool===id?'active':'')} aria-label={label} aria-pressed={tool===id} title={`${label} (${key})`} onClick={()=>{chooseTool(id);if(compactDrawTools)closeDrawTools();}}><Icon size={19}/><span className="rail-tool-label">{drawerToolLabels[id]??label}</span></button>)}
    <div className="rail-rule"/>
    <button type="button" className={'tool '+(grid?'active':'')} aria-label="Toggle grid" aria-pressed={grid} onClick={()=>setGrid(v=>!v)}><Grid2X2 size={19}/><span className="rail-tool-label">Grid</span></button>
  </div>
  <div className="rail-history" data-guide="drawing-history" role="group" aria-label="Edit history">
    <button type="button" className="tool history-tool" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!snap?.canUndo||busy} onClick={()=>void commit([],undefined,'undo')}><Undo2 size={19}/><span className="rail-history-label">Undo</span></button>
    <button type="button" className="tool history-tool" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!snap?.canRedo||busy} onClick={()=>void commit([],undefined,'redo')}><Redo2 size={19}/><span className="rail-history-label">Redo</span></button>
  </div>
  <label className="rail-color-picker" title="Change drawing color"><span className="rail-ink" style={{background:ink}} aria-hidden="true"/><span className="rail-color-label">Color · {ink.toUpperCase()}</span><input type="color" aria-label="Choose quick drawing color" value={rgbHex(ink)} onChange={e=>selectInk(withRgb(ink,e.target.value))}/></label>
 </aside>
 <section className="canvas-area" aria-label="Canvas workspace"><div className="canvas-toolbar"><button type="button" ref={drawToolsToggleRef}
 className={'small-toggle draw-tools-toggle '+(drawToolsOpen?'on':'')}
 aria-controls="pixel-drawing-tools" aria-expanded={compactDrawTools&&drawToolsOpen} aria-haspopup="dialog"
 aria-label="Open drawing tools" onClick={()=>{setInspectorOpen(false);setDrawToolsOpen(v=>!v);}}>
 <Pencil size={17}/><span>Draw tools</span></button><span className="eyebrow">{(drawerToolLabels[tool]??tools.find(t=>t[0]===tool)?.[2]??'Draw').toUpperCase()} <span className="muted">/ 1 PX</span></span>
 <label className="toolbar-ink-picker" data-guide="current-color" title="Choose your drawing color">
  <span className="toolbar-color-label">COLOR</span>
  <span className="toolbar-ink-chip" aria-hidden="true"><i style={{backgroundColor:ink}}/></span>
  <input type="color" aria-label="Choose current drawing color" value={rgbHex(ink)}
   onChange={e=>selectInk(withRgb(ink,e.target.value))}/>
  <span className="toolbar-ink-code">{ink.toUpperCase()}</span>
 </label>
 <div className="toolbar-quick-anchor" ref={quickColorsRef}>
  <button type="button" ref={quickColorsButtonRef}
   className={'small-toggle toolbar-quick-toggle'+(quickColorsOpen?' on':'')}
   aria-label="Open standard quick colors" title="24 standard quick colors"
   aria-expanded={quickColorsOpen} aria-haspopup="dialog" aria-controls="quick-colors-popover"
   onClick={()=>setQuickColorsOpen(open=>!open)}>
   <Palette size={17}/><span>Quick</span>
  </button>
  {quickColorsOpen&&<div id="quick-colors-popover" className="toolbar-quick-popover"
   role="dialog" aria-label="Standard quick colors" aria-modal="false">
   <div className="toolbar-quick-header">
    <strong>Quick Colors</strong><button type="button" aria-label="Close quick colors"
     onClick={()=>{setQuickColorsOpen(false);quickColorsButtonRef.current?.focus();}}><X size={16}/></button>
   </div>
   <p>Familiar, fixed swatches. Choose one instantly; your saved palette stays untouched.</p>
   <QuickColorGrid ink={ink} onPick={hex=>{
    selectInk(hex);setQuickColorsOpen(false);quickColorsButtonRef.current?.focus();
   }}/>
  </div>}
 </div>{tool==='stamp'&&<div className="stamp-context" data-guide="stamp-context">
  <span className="stamp-context-hint">{stampCapture||!activeStamp?'Drag area to capture':activeStamp.name}</span>
  <button type="button" onClick={beginStampCapture}><Stamp size={13}/>Capture</button>
  <label>Snap<select aria-label="Stamp grid snapping" value={stampSnap}
   onChange={e=>setStampSnap(Number(e.target.value))}>
   <option value={0}>Off</option><option value={8}>8px</option><option value={16}>16px</option><option value={32}>32px</option>
  </select></label>
 </div>}{['rect','ellipse'].includes(tool)&&<label className="fill-option"><input type="checkbox" checked={filled} onChange={e=>setFilled(e.target.checked)}/>Filled</label>}<span className="spacer"/><button type="button" ref={drawerToggleRef} className={'small-toggle mobile-inspector-toggle '+(inspectorOpen?'on':'')}
 aria-controls="pixel-inspector" aria-expanded={mobileLayout&&inspectorOpen} aria-haspopup="dialog" aria-label={inspectorOpen?'Close inspector panels':'Open inspector panels'}
 onClick={()=>{setDrawToolsOpen(false);setInspectorOpen(v=>!v);}}><SlidersHorizontal size={17}/><span>Panels</span></button><span className="canvas-hint">ONE CELL = ONE PIXEL.</span></div><div className="canvas-scroll" ref={viewport} onPointerDownCapture={touchDown}
 onPointerMoveCapture={touchMove} onPointerUpCapture={touchEnd} onPointerCancelCapture={touchEnd}><div className="canvas-mat">{d?<div className="canvas-frame" data-guide="canvas" style={touchNavigationActive?{
 transform:`translate3d(${canvasPan.x}px,${canvasPan.y}px,0) scale(${pinchScale})`
}:undefined}><span className="canvas-coordinate top-left">0, 0</span><canvas ref={canvas} className="pixel-canvas" aria-label={`${d.name}, ${d.width} by ${d.height} pixel canvas`} style={{width:d.width*zoom,height:d.height*zoom,backgroundSize:`${zoom*2}px ${zoom*2}px`}} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={()=>{if(stampCaptureDrag.current){stampCaptureDrag.current=null;setSelection(null);}if(selectionDrag.current){setSelection(selectionDrag.current.source);present(selectionDrag.current.base);selectionDrag.current=null;}if(stroke.current){present(stroke.current.base);stroke.current=null;}}} onPointerLeave={()=>{setHover(null);if(!stroke.current&&!selectionDrag.current)setCursor('X —   Y —');}}/>{hover&&zoom>=3&&tool!=='select'&&<div className="cell-cursor" aria-hidden="true" style={{left:hover.x*zoom,top:hover.y*zoom,width:zoom,height:zoom}}/>}{stampHover&&activeStamp&&<canvas ref={stampPreviewRef} className="stamp-cursor-preview"
  aria-hidden="true" style={{left:stampHover.x*zoom,top:stampHover.y*zoom,
   width:activeStamp.width*zoom,height:activeStamp.height*zoom}}/>}
 {selection&&<div className="selection-marquee" style={{left:selection.x*zoom,top:selection.y*zoom,width:selection.width*zoom,height:selection.height*zoom}}/>}<span className="canvas-coordinate bottom-right">{d.width}, {d.height}</span></div>:<div className="loading-canvas"><Grid2X2 size={32}/><span>Opening your pixel workshop…</span>{error&&<button onClick={()=>location.reload()}>Try again</button>}</div>}</div></div>{d&&<div className="timeline" aria-label="Animation timeline">
  <div className="timeline-header"><span className="eyebrow"><Film size={13}/>ANIMATION <span className="muted">{frameCount(d)} FRAME{frameCount(d)===1?'':'S'}</span></span>
    <div className="timeline-controls" data-guide="timeline-actions">
     <button className="small-toggle" aria-label={playing?'Pause animation':'Play animation'} disabled={frameCount(d)<2||busy} onClick={()=>setPlaying(v=>!v)}>{playing?<Pause size={14}/>:<Play size={14}/>} {playing?'Pause':'Play'}</button>
     <label className="fps-control">FPS <select aria-label="Animation frames per second" value={d.animation?.fps??8} disabled={busy} onChange={e=>void commit([{op:'set_fps',fps:Number(e.target.value)}])}>{[4,6,8,10,12,15,20,24,30].map(f=><option key={f} value={f}>{f}</option>)}</select></label>
     <button className={'small-toggle '+(onion?'on':'')} aria-pressed={onion} onClick={()=>setOnion(v=>!v)}>Onion {onion?'on':'off'}</button>
     <button className="small-toggle" disabled={busy||playing||frameCount(d)>=32} onClick={()=>void addFrame()}><CopyPlus size={14}/>Duplicate</button>
     <button className="small-toggle" disabled={busy||playing||activeFrame===0} onClick={()=>void removeFrame()}><Trash2 size={14}/>Delete</button>
   <button type="button" className={'small-toggle timeline-range-toggle'+(rangeSelectMode?' on':'')}
    data-guide="clip-range" disabled={busy||playing} aria-pressed={rangeSelectMode}
    onClick={()=>{setRangeSelectMode(active=>!active);clipDragRef.current=null;}}>
    <Scan size={14}/>{rangeSelectMode?'Drag across frames':'Select clip range'}</button>
   {clipRangeSelection&&<button type="button" className="small-toggle timeline-create-clip"
    disabled={busy||playing} onClick={clipOriginal?()=>{
      setClipFrom(clipRangeSelection.from);setClipTo(clipRangeSelection.to);setInspectorTab('animation');setInspectorOpen(mobileLayout);
     }:openClipFromRange}>
    <Plus size={14}/>{clipOriginal?'Use selected range':'Create clip'} ({clipRangeSelection.from+1}–{clipRangeSelection.to+1})</button>}
    </div>
  </div>
  <div className="timeline-track" data-guide="timeline-track"
   onPointerMove={dragClipRange} onPointerUp={finishClipRange} onPointerCancel={finishClipRange}>
   {Array.from({length:frameCount(d)},(_,i)=>
    <button key={i} data-frame-index={i}
     aria-label={`Select animation frame ${i+1}`} aria-pressed={activeFrame===i}
     className={'frame-tile '+(activeFrame===i?'active ':'')+(clipRangeSelection&&i>=clipRangeSelection.from&&i<=clipRangeSelection.to?'range-selected':'')}
     disabled={busy||playing} onPointerDown={e=>beginClipRange(i,e)}
     onContextMenu={e=>{e.preventDefault();
      const selected=clipRangeSelection&&i>=clipRangeSelection.from&&i<=clipRangeSelection.to?
       clipRangeSelection:{from:i,to:i};
      setClipRangeSelection(selected);setClipFrom(selected.from);setClipTo(selected.to);
      setClipOriginal(null);setClipName('new-clip');setRangeSelectMode(false);
      setInspectorTab('animation');setInspectorOpen(mobileLayout);
     }}
     onClick={e=>{
      if(stroke.current||selectionDrag.current||rangeSelectMode)return;
      if(e.shiftKey){const range=clipRange(clipRangeSelection?.from??activeFrame,i,frameCount(d));
       setClipRangeSelection(range);
       if(clipOriginal){setClipFrom(range.from);setClipTo(range.to);}
       return;}
      setFrame(i);setPreviewClip(null);setSelection(null);
     }}>
      <FrameThumbnail doc={d} index={i}/><span>{String(i+1).padStart(2,'0')}</span>
      <span className="frame-clip-indicators" aria-hidden="true">
       {clipsAtFrame(d.animation?.clips,i).slice(0,3).map(entry=>
        <i key={entry.clip.name} style={{backgroundColor:entry.color}}
         title={entry.clip.name} className="frame-clip-indicator"/>)}
      </span>
    </button>)}</div>
 </div>}<div className="canvas-footer" data-guide="zoom"><div className="zoom-control"><button aria-label="Zoom out" onClick={()=>{setFitMode(false);setZoom(z=>Math.max(1,z-1));}}><ZoomOut size={16}/></button><span>{Math.round(zoom*pinchScale*100)}%</span><button aria-label="Zoom in" onClick={()=>{setFitMode(false);setZoom(z=>Math.min(d?maxPreviewZoom(d.width,d.height):24,z+1));}}><ZoomIn size={16}/></button></div><button className={'small-toggle fit-button '+(fitMode?'on':'')} aria-label="Fit canvas to workspace" onClick={()=>{resetPan();setFitMode(true);}}><Maximize size={14}/>Fit</button><span className="scale-caption">{zoom>=3?'1 cell = 1 output pixel':'Zoom in to see the cell grid'}</span><span className="spacer"/>{d?.reference&&<button className={'small-toggle '+(referenceView!=='artwork'?'on':'')} aria-label="Toggle tracing reference" aria-pressed={referenceView!=='artwork'} onClick={()=>setReferenceView(v=>v==='artwork'?'overlay':'artwork')}><Eye size={14}/>Trace {referenceView==='artwork'?'off':'on'}</button>}<button className={'small-toggle '+(grid?'on':'')} onClick={()=>setGrid(v=>!v)}><Grid2X2 size={14}/>Grid {grid?'on':'off'}</button></div></section>
  <button type="button" className="inspector-backdrop" aria-label="Close tools" onClick={closeMobileInspector}/>
  <aside id="pixel-inspector" className="inspector" ref={inspectorRef} aria-label="Editor inspector"
   role={mobileLayout&&inspectorOpen&&guide.mode==='off'?'dialog':undefined}
   aria-modal={mobileLayout&&inspectorOpen&&guide.mode==='off'?true:undefined}
   aria-hidden={mobileLayout&&!inspectorOpen}
   inert={mobileLayout&&!inspectorOpen}>
  <div className="inspector-drawer-header"><span><SlidersHorizontal size={16}/>Tools</span>
   <button type="button" ref={drawerCloseRef} aria-label="Close tools" onClick={closeMobileInspector}><X size={19}/></button>
  </div>
 <nav className="inspector-tabs" role="tablist" aria-label="Inspector panels">
  {INSPECTOR_TABS.map(tab=>{
   const Icon=tab.id==='draw'?Palette:tab.id==='layers'?Layers:tab.id==='effects'?Sparkles:tab.id==='animation'?Film:tab.id==='ui'?PanelsTopLeft:Download;
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
 <div data-guide="tracing-reference"><ReferenceWorkbench doc={d??null} busy={busy} view={referenceView} referenceOpacity={referenceOpacity} artworkOpacity={artworkOpacity}
  onView={setReferenceView} onReferenceOpacity={setReferenceOpacity} onArtworkOpacity={setArtworkOpacity}
  onApply={applyReference} onCreatePixelified={async(doc)=>{if(locked.current||stroke.current||selectionDrag.current)return;locked.current=true;setBusy(true);try{await queue.current?.flush();adopt(await api<Snapshot>('projects',{document:doc}));setFitMode(true);setError('');setNotice('Pixelified image saved as a new canvas');await refresh();}finally{locked.current=false;setBusy(false);}}} onRemove={()=>void commit([{op:'reference_set',reference:null}])}/></div>
 <section className="inspector-section preview-section"><div className="section-heading"><span>PREVIEW</span><div className="preview-scales">{[1,2].map(s=><button key={s} aria-label={`Preview at ${s}×`} aria-pressed={previewScale===s} className={previewScale===s?'active':''} onClick={()=>setPreviewScale(s)}>{s}×</button>)}</div></div><div className="navigator"><canvas ref={preview} aria-label="Artwork preview"/></div><div className="preview-caption"><span>{d?.name||'Your artwork'}</span><span>{d?`${d.width} × ${d.height}`:''}</span></div></section>
 <ColorWorkbench doc={d??null} frame={activeFrame} ink={ink} hexDraft={hexDraft} recent={recentColors} busy={busy}
  onPick={selectInk} onDraft={onHexDraft} onCommitHex={finishHexDraft}
  onOpacity={percent=>selectInk(withOpacity(ink,percent),false)}
  onSave={()=>void saveProjectInk()} onRemove={hex=>void removeProjectInk(hex)}
  onRemoveStarters={()=>void removeLegacySwatches()}/>
 <details className="inspector-section selection-section inspector-disclosure">
 <summary className="section-heading inspector-summary" data-guide="selection"><span>SELECTION</span><span className="inspector-summary-end"><span className="muted">{selection?`${selection.width} × ${selection.height}`:'V'}</span><ChevronDown size={15}/></span></summary><div className="selection-actions"><button disabled={!selection||busy} onClick={copySelection} title="Copy (Ctrl+C)"><Copy size={14}/>Copy</button><button disabled={!clipboard||busy} onClick={()=>chooseTool('stamp')} title="Use copied pixels as a stamp"><Stamp size={14}/>Stamp</button><button disabled={!clipboard||busy} onClick={pasteSelection} title="Paste (Ctrl+V)"><ClipboardPaste size={14}/>Paste</button><button disabled={!selection||busy} onClick={()=>transformSelection('flip_horizontal')} title="Flip horizontally"><FlipHorizontal2 size={14}/>Flip H</button><button disabled={!selection||busy} onClick={()=>transformSelection('flip_vertical')} title="Flip vertically"><FlipVertical2 size={14}/>Flip V</button><button disabled={!selection||busy} onClick={clearSelection} title="Clear selected pixels (Delete)"><Trash2 size={14}/>Clear</button><button disabled={!selection||busy} onClick={()=>setSelection(null)}><X size={14}/>Deselect</button></div><p className="selection-help">Select with V, drag to move, or copy and paste. Stamp (S) can now capture artwork directly; its snap controls live beside the canvas, and saved stamps are below.</p></details>
 <StampWorkbench active={activeStamp} library={stampLibrary} name={stampName} onName={setStampName}
  onSelect={selectStamp} onCapture={beginStampCapture} onSave={saveStampToLibrary}
  onDelete={deleteSavedStamp} canSave={!!activeStamp&&(stampLibrary.length<STAMP_LIBRARY_LIMIT||
   stampLibrary.some(s=>s.id===activeStamp.id))} busy={busy}/>
 </div>
 <div className="inspector-panel" id="inspector-panel-layers" role="tabpanel" aria-labelledby="inspector-tab-layers" tabIndex={0} hidden={inspectorTab!=='layers'}>
 <section className="inspector-section layers-section"><div className="section-heading" data-guide="layers"><span>LAYERS</span><span className="muted" aria-label="Layer slots used">{d?.layers.length??0} / 8</span><button className="mini-button" aria-label="Add layer" disabled={busy||!d||d.layers.length>=8} onClick={()=>{const id='layer-'+Date.now().toString(36);void commit([{op:'add_layer',id,name:`Layer ${(d?.layers.length||0)+1}`}]).then(()=>setLayer(id));}}><Plus size={16}/></button></div>{d&&[...d.layers].reverse().map(l=><div key={l.id} className={'layer-row '+(layer===l.id?'selected':'')}><button className="layer-select" onClick={()=>setLayer(l.id)}><span className="layer-thumbnail"><Layers size={14}/></span><span>{l.name}</span></button><button className="mini-button" aria-label={`${l.visible?'Hide':'Show'} ${l.name} layer`} disabled={busy} onClick={()=>void commit([{op:'visibility',layer:l.id,visible:!l.visible}])}>{l.visible?<Eye size={15}/>:<EyeOff size={15}/>}</button><button className="mini-button layer-delete" aria-label={`Delete ${l.name} layer`} title={d.layers.length===1?'The last layer cannot be deleted':'Delete layer (Undo to restore)'} disabled={busy||d.layers.length<=1} onClick={()=>void commit([{op:'delete_layer',layer:l.id}])}><Trash2 size={15}/></button></div>)}<span className="layer-note">Drawing on <strong>{d?.layers.find(l=>l.id===layer)?.name||'Base'}</strong>. Hiding a layer does not free its slot; delete it to make room for another effect.</span></section>
 </div>
 <div className="inspector-panel" id="inspector-panel-effects" role="tabpanel" aria-labelledby="inspector-tab-effects" tabIndex={0} hidden={inspectorTab!=='effects'}>
 <section className="inspector-section effects-section"><div className="section-heading" data-guide="effects"><span>PROCEDURAL EFFECTS</span><Sparkles size={14}/></div>
   <p>Create a seeded, editable animation layer. Painting and undo work on every generated frame.</p>
   <label className="effect-field">Effect
     <select aria-label="Procedural effect type" value={effectKind} onChange={e=>setEffectKind(e.target.value as EffectKind)}>
       {EFFECT_GROUPS.map(group=><optgroup key={group} label={group}>
         {EFFECT_KINDS.filter(k=>EFFECT_PRESETS[k].group===group).map(k=><option key={k} value={k}>{EFFECT_PRESETS[k].label}</option>)}
       </optgroup>)}
     </select>
   </label>
   <p className="effect-description" aria-live="polite">{EFFECT_PRESETS[effectKind].description}</p>
   <div className="effect-color-row"><span>Suggested color</span><button type="button" className="effect-color-button"
     aria-label={'Use suggested '+EFFECT_PRESETS[effectKind].label+' color '+EFFECT_PRESETS[effectKind].suggestedInk}
     onClick={()=>selectInk(EFFECT_PRESETS[effectKind].suggestedInk)}
     title="Set drawing color to this effect’s suggested tint">
     <i style={{background:EFFECT_PRESETS[effectKind].suggestedInk}} aria-hidden="true"/>{EFFECT_PRESETS[effectKind].suggestedInk.toUpperCase()}
   </button></div>
   <label className="effect-field">Seed<input aria-label="Effect random seed" type="number" min={0} max={2147483647} value={effectSeed} onChange={e=>setEffectSeed(Number(e.target.value))}/></label>
   <label className="effect-field">Speed<input aria-label="Effect speed" type="number" min={0.25} max={3} step={0.25} value={effectSpeed} onChange={e=>setEffectSpeed(Number(e.target.value))}/></label>
   <label className="effect-field">Opacity<input aria-label="Effect opacity" type="number" min={0.1} max={1} step={0.1} value={effectOpacity} onChange={e=>setEffectOpacity(Number(e.target.value))}/></label>
   <label className="effect-field">Drift<input aria-label="Effect horizontal drift" type="number" min={-3} max={3} step={0.25} value={effectDrift} onChange={e=>setEffectDrift(Number(e.target.value))}/></label>
   {d&&<p className="effect-capacity" aria-live="polite">{d.layers.length} / 8 layer slots used · {hasFreeEffectLayerSlot(d)?'Ready to generate':'Delete a layer to make room'}</p>}
   <button className="secondary full effect-generate" disabled={busy||!hasFreeEffectLayerSlot(d)} title={!hasFreeEffectLayerSlot(d)?'All eight layer slots are occupied. Use a layer trash icon to free one.':'Generate an effect without stopping playback'} onClick={()=>void addEffect()}><Sparkles size={14}/>Generate editable effect</button>
   {d&&!hasFreeEffectLayerSlot(d)&&<button type="button" className="text-button effects-manage-link" onClick={()=>activateInspectorTab('layers')}><Layers size={14}/>Manage layers to free a slot</button>}
   {d?.layers.some(l=>l.effect)&&<div className="effect-recipe-panel">
    <div className="section-heading" data-guide="effects-recipe"><span>RE-EDIT AN EFFECT</span></div>
    <label className="effect-field">FX layer<select aria-label="Choose effect layer to regenerate" value={d.layers.some(l=>l.id===effectTarget&&l.effect)?effectTarget??'':''} onChange={e=>chooseEffectLayer(e.target.value)}>
     <option value="">Choose a layer</option>
     {d.layers.filter(l=>l.effect).map(l=><option key={l.id} value={l.id}>{l.name}</option>)}
    </select></label>
    <p>Choose a stored FX recipe, tweak its settings above, and compare before changing the artwork. Regeneration replaces hand-edited pixels inside this FX layer.</p>
    <button type="button" className="secondary full effect-preview-button"
     disabled={busy||!d.layers.some(l=>l.id===effectTarget&&l.effect)}
     onClick={previewEffectChanges}><Eye size={14}/>Preview before &amp; after</button>
    {validFxPreview&&<FxComparisonPanel comparison={validFxPreview}/>}
    {fxPreview&&!validFxPreview&&<p className="fx-preview-stale">Settings or artwork changed. Preview again to continue.</p>}
    <label className="fx-backup-choice">
     <input type="checkbox" checked={preserveFx&&canBackUpFx} disabled={!canBackUpFx||busy}
      onChange={e=>{setPreserveFx(e.target.checked);setConfirmFxOverwrite(false);}}/>
     <span>Preserve original as a hidden backup layer</span>
    </label>
    {!canBackUpFx&&<p className="fx-backup-warning">No room for a backup layer or pixel budget. You can still regenerate, but must explicitly confirm replacing the original.</p>}
    {(!canBackUpFx||!preserveFx)&&<label className="fx-overwrite-confirm">
     <input type="checkbox" checked={confirmFxOverwrite} onChange={e=>setConfirmFxOverwrite(e.target.checked)}/>
     <span>I understand the original FX pixels will be replaced without a backup.</span>
    </label>}
    <button type="button" className="secondary full effect-regenerate"
     disabled={busy||!validFxPreview||!d.layers.some(l=>l.id===effectTarget&&l.effect)||((!canBackUpFx||!preserveFx)&&!confirmFxOverwrite)}
     onClick={()=>void regenerateEffect()}><Sparkles size={14}/>Apply previewed effect</button>
   </div>}
  </section>
 </div>
 <div className="inspector-panel" id="inspector-panel-animation" role="tabpanel" aria-labelledby="inspector-tab-animation" tabIndex={0} hidden={inspectorTab!=='animation'}>
  <section className="inspector-section clip-section">
   <div className="section-heading" data-guide="clips"><span>ANIMATION CLIPS</span><Film size={15}/></div>
   <p>Select a clip range visually in the timeline, or Shift-click two frames, then give it a name. Drag its range again to adjust it. Clips export with the atlas.</p>
   {d?.animation?.clips?.length?<div className="clip-list">
    {d.animation.clips.map(clip=><div className="clip-row" key={clip.name}>
     <div className="clip-row-heading"><b>{clip.name}</b><small>{clip.from+1}–{clip.to+1} · {clip.fps} FPS · {clip.mode}</small></div>
     <div className="clip-row-actions">
      <button type="button" title={'Preview '+clip.name} onClick={()=>playClip(clip)} disabled={busy}>▶</button>
      <button type="button" title={'Edit '+clip.name} onClick={()=>editClip(clip)} disabled={busy}>Edit range</button>
      <button type="button" title={'Delete '+clip.name} onClick={()=>void commit([{op:'clip_delete',name:clip.name}])} disabled={busy}>×</button>
     </div>
    </div>)}
   </div>:<p className="clip-empty">No clips yet. Define one using the frame numbers below.</p>}
   <button type="button" className="text-button clip-all-frames" onClick={()=>{setPreviewClip(null);setPlaying(false);}} disabled={!previewClip}>Stop clip preview · play all frames</button>
   <div className="section-heading clip-create-heading"><span>{clipOriginal?'EDIT CLIP':'DEFINE A CLIP'}</span><button type="button" className="text-button" disabled={!d} onClick={()=>{if(!d)return;setClipOriginal(null);setClipName('new-clip');const range=clipRangeSelection??{from:Math.min(frame,frameCount(d)-1),to:Math.min(frame,frameCount(d)-1)};setClipFrom(range.from);setClipTo(range.to);}}>New</button></div>
   <label className="effect-field">Name<input aria-label="Animation clip name" value={clipName} onChange={e=>setClipName(e.target.value)} maxLength={32}/></label>
   <label className="effect-field">First frame<input aria-label="Clip start frame" type="number" min={1} max={d?frameCount(d):1} value={clipFrom+1} onChange={e=>setClipFrom(Number(e.target.value)-1)}/></label>
   <label className="effect-field">Last frame<input aria-label="Clip end frame" type="number" min={1} max={d?frameCount(d):1} value={clipTo+1} onChange={e=>setClipTo(Number(e.target.value)-1)}/></label>
   <label className="effect-field">Speed<input aria-label="Clip frames per second" type="number" min={1} max={30} value={clipFps} onChange={e=>setClipFps(Number(e.target.value))}/></label>
   <label className="effect-field">Playback<select aria-label="Clip playback mode" value={clipMode} onChange={e=>setClipMode(e.target.value as AnimationClip['mode'])}>
    <option value="loop">Loop</option><option value="once">Once</option><option value="pingpong">Ping-pong</option>
   </select></label>
   <button type="button" className="secondary full" disabled={!d||busy||!clipName.trim()||clipFrom<0||clipTo<clipFrom||clipTo>=frameCount(d)||clipFps<1||clipFps>30} onClick={()=>void saveClip()}><Plus size={14}/>Save clip</button>
  </section>
 </div>
 <div className="inspector-panel" id="inspector-panel-ui" role="tabpanel" aria-labelledby="inspector-tab-ui" tabIndex={0} hidden={inspectorTab!=='ui'}>
  {d&&inspectorTab==='ui'&&<UiKitPanel key={d.id} doc={d} frame={activeFrame} layer={layer} ink={ink} busy={busy} onCommit={commit} onSaveDraft={saveUiDraft} onFrame={setFrame} onLayer={setLayer}
   draft={uiDrafts[d.id]??NO_UI_DRAFT} draftStorageError={uiDraftStorageError} onDraftChange={change=>updateUiDraft(d.id,change)} sections={uiSections} onSectionToggle={toggleUiSection}
   onRemap={remapKitColors} onInspectKit={inspectKitColors} onReviewKit={reviewKitColors} onOpenProject={openKitMember}
   kitUndo={kitUndo?.kitId===d.ui?.kitId?kitUndo:null} kitUndoStorageError={kitUndoStorageError} onUndoKit={undoKitColors} onExportKit={exportCurrentKit} onPreviewKit={previewCurrentKit}/>}
 </div>
 <div className="inspector-panel" id="inspector-panel-export" role="tabpanel" aria-labelledby="inspector-tab-export" tabIndex={0} hidden={inspectorTab!=='export'}>
 <section className="inspector-section export-section">
  <div className="section-heading" data-guide="export"><span>EXPORT</span><span className="filetype">{exportFormat.toUpperCase()}</span></div>
  <label className="scale-select">Format<select aria-label="Export format" value={exportFormat} onChange={e=>setExportFormat(e.target.value as 'png'|'svg')}><option value="png">PNG · raster</option><option value="svg">SVG · vector</option></select></label>
  <label className="scale-select">Frame size<select aria-label="Frame export scale" value={scale} onChange={e=>setScale(Number(e.target.value))}>{[1,2,4,8].map(s=><option key={s} value={s} disabled={!!d&&exportFormat==='png'&&d.width*d.height*s*s>4_194_304}>{s}× {d?`· ${d.width*s} × ${d.height*s}`:''}</option>)}</select></label>
  <p>{exportFormat==='svg'?'Scalable vector pixels with transparency. Visible layers are combined; the pixel-art shape stays crisp.':'Transparent background. Clean pixels, ready for your game.'}</p>
  <button className="secondary full" disabled={!d||busy} onClick={()=>void exportFrame()}>Current frame {exportFormat.toUpperCase()} <Download size={14}/></button>
  <button className="secondary full" disabled={!d||busy} onClick={()=>void exportSheet()}>Sprite sheet {exportFormat.toUpperCase()} <Download size={14}/></button>
  <button className="secondary full" disabled={!d||busy} onClick={exportAtlas}>Animation atlas JSON <Download size={14}/></button>
  <p>Sprite sheets use native dimensions and contain every frame. The atlas matches the selected format.</p>
  <button className="secondary full" disabled={!d||busy} onClick={()=>{if(d)download(d.name+'.pixel.json',new Blob([JSON.stringify(d)],{type:'application/json'}));}}>Save editable project <Download size={14}/></button>
  <div className="tileset-export-block" data-guide="tileset">
   <p>Building a tile-based game? Slice the current frame into a coordinate-accurate grid, keeping empty tiles and their IDs.</p>
   <label className="effect-field">Tile size<input aria-label="Tileset tile size" type="number" min={1} max={256} value={tileSize} onChange={e=>setTileSize(Number(e.target.value))}/></label>
   <button type="button" className="secondary full" disabled={!d||busy||!Number.isInteger(tileSize)||tileSize<1||d.width%tileSize!==0||d.height%tileSize!==0} onClick={()=>void exportTiles()}><Grid2X2 size={14}/>Tileset ZIP (PNG + SVG + source) <Download size={14}/></button>
   {d&&tileSize>0&&(d.width%tileSize!==0||d.height%tileSize!==0)&&<p className="tileset-warning">Canvas must divide evenly by tile size.</p>}
  </div>
  <div className="pack-export-block" data-guide="pack">
   <p>Export several sprites with their original editable layers, PNG and SVG sheets, named clips and a ready-to-use manifest.</p>
   <button type="button" className="secondary full pack-export-button" disabled={!list.length||busy} onClick={openPack}><FolderOpen size={15}/>Export game pack ZIP <Download size={14}/></button>
  </div>
  </section>
 </div>
 </aside></div>
 <footer className="status-bar"><span data-guide="save-status" className={'save-status '+(displayError?'error':uiDraftCount?'draft':'')}><i className={busy||saveState.pending?'saving':''}/>{displayStatus}</span>{saveState.error&&<>{!saveState.error.conflict&&<button className="text-button save-retry" disabled={busy} onClick={()=>{setError('');queue.current?.retry();}}>Retry save</button>}<button className="text-button save-retry" disabled={busy} onClick={()=>void create(false,current.current?.doc,true)}>Save a copy</button></>}<span className="status-detail">{cursor}</span><span className="status-detail">{d?.layers.length||0} LAYERS</span><span className="status-shortcuts">B pencil<span>E eraser</span><span>G fill</span><span>H grid</span></span></footer>
 <input ref={file} type="file" accept=".json,.pixel.json" className="visually-hidden" aria-label="Import editable project" onChange={async e=>{const f=e.target.files?.[0];if(!f)return;try{if(f.size>12_000_000)throw new Error('Project file is too large.');await create(false,JSON.parse(await f.text()));}catch(err){setError((err as Error).message);}e.target.value='';}}/>
 {packModal&&<div className="modal-backdrop" onClick={()=>!busy&&setPackModal(false)}>
   <section className="new-dialog pack-dialog" role="dialog" aria-modal="true" aria-labelledby="pack-dialog-heading" onClick={e=>e.stopPropagation()}>
    <button className="dialog-close icon-button" type="button" aria-label="Close game pack exporter" disabled={busy} onClick={()=>setPackModal(false)}><X size={18}/></button>
    <span className="eyebrow">GAME ASSET PIPELINE</span><h2 id="pack-dialog-heading">Pack it all together.</h2>
    <p className="pack-description">Choose up to 30 projects. Each becomes a folder containing the editable source, PNG and SVG sprite sheets and matching animation atlases, all indexed by manifest.json.</p>
    <div className="pack-dialog-actions">
     <button type="button" disabled={busy} onClick={()=>setPackIds(list.slice(0,30).map(item=>item.id))}>Select first 30</button>
     <button type="button" disabled={busy} onClick={()=>setPackIds([])}>Clear all</button>
     <span>{packIds.length} / 30 selected</span>
    </div>
    <div className="pack-projects" role="group" aria-label="Choose assets to export">
     {list.map(p=><label className="pack-project" key={p.id}>
      <input type="checkbox" checked={packIds.includes(p.id)} disabled={busy||!packIds.includes(p.id)&&packIds.length>=30}
       onChange={e=>setPackIds(ids=>e.target.checked?[...ids,p.id]:ids.filter(id=>id!==p.id))}/>
      <span><b>{p.name}</b><small>{p.width} × {p.height} pixels</small></span>
     </label>)}
    </div>
    {error&&<p className="error-text" role="alert">{error}</p>}
    <button type="button" className="primary full pack-download" disabled={busy||packIds.length===0} onClick={()=>void exportGamePack()}>
     <Download size={15}/>{busy?'Preparing ZIP…':'Download '+packIds.length+'-asset game pack'}
    </button>
   </section>
  </div>}
 {guide.mode!=='off'&&!modal&&!packModal&&<WorkshopGuide mode={guide.mode} scope={guide.scope} index={guide.index}
  onStart={startGuide} onMove={moveGuide} onClose={closeGuide} onMenu={guideMenu}/>}
  {modal&&<div className="modal-backdrop" onClick={()=>setModal(false)}><section className="new-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onClick={e=>e.stopPropagation()}><button className="dialog-close icon-button" aria-label="Close new canvas dialog" onClick={()=>setModal(false)}><X size={18}/></button><span className="eyebrow">A FRESH LITTLE START</span><h2 id="dialog-title">Make room for an idea.</h2><label>Canvas name<input autoFocus value={name} maxLength={80} onChange={e=>setName(e.target.value)}/></label><div className="dimension-inputs"><label>Width<input type="number" min={1} max={MAX_CANVAS_SIDE} value={width} onChange={e=>setWidth(Number(e.target.value))}/></label><span>×</span><label>Height<input type="number" min={1} max={MAX_CANVAS_SIDE} value={height} onChange={e=>setHeight(Number(e.target.value))}/></label></div><div className="size-presets">{[16,32,48,64,128].map(s=><button key={s} className={width===s&&height===s?'selected':''} onClick={()=>{setWidth(s);setHeight(s);}}>{s}×{s}</button>)}</div>{error&&<p className="error-text">{error}</p>}<button className="primary full" disabled={busy} onClick={()=>void create()}><Plus size={16}/>Create canvas</button><button className="text-button example-button" disabled={busy} onClick={()=>void create('cottage')}>Open Moonkeeper’s cottage · 64 × 64</button><button className="text-button example-button" disabled={busy} onClick={()=>void create(true)}>Or open the little lantern</button></section></div>}
 </main>;
}
