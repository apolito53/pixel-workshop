'use client';

import {useEffect,useRef,useState,type ChangeEvent,type PointerEvent} from 'react';
import {ArrowLeft,ArrowLeftRight,Check,ChevronDown,Crop,Download,FolderOpen,ImagePlus,RotateCcw,Save,SlidersHorizontal,Sparkles,Undo2,Redo2,X} from 'lucide-react';
import {DEFAULT_FINISHING_SETTINGS,FINISHING_CONTROLS,normalizeFinishingSettings,normalizeFinishingCrop,type FinishingImage,type FinishingSettings,type FinishingCrop} from '../lib/image-finishing.ts';
import {FINISHING_PROJECT_FORMAT,FINISHING_RECIPE_FORMAT,MAX_FINISHING_FILE_BYTES,MAX_FINISHING_PROJECT_BYTES,readFinishingProject,readFinishingRecipe,validateFinishingDimensions,type FinishingSource,type FinishingRecipe} from '../lib/finishing-project.ts';
import './image-finishing.css';

type Edit={settings:FinishingSettings;crop:FinishingCrop|null};
type History={past:Edit[];present:Edit;future:Edit[]};
type Preset={name:string;settings:FinishingSettings};
type PreviewRequest={kind:'preview';id:number;sourceId:number;settings:FinishingSettings;crop:FinishingCrop|null};
type WorkerResult={kind:'loaded'|'preview'|'export'|'error';sourceId:number;id?:number;image?:FinishingImage;message?:string;operation?:string};
type ExportRequest={id:number;format:'png'|'jpeg';name:string;matte:string};
const PRESET_KEY='pixel-workshop-finishing-presets-v1';
const blankEdit=():Edit=>({settings:{...DEFAULT_FINISHING_SETTINGS},crop:null});
const editKey=(edit:Edit)=>JSON.stringify(edit);
const cleanName=(name:string)=>name.replace(/\.(png|jpe?g|webp|finish\.json)$/i,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-')||'Finished image';
const formatDimensions=(width:number,height:number)=>`${width.toLocaleString()} × ${height.toLocaleString()} px`;
function download(name:string,blob:Blob){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10_000);}
function readDataUrl(file:Blob):Promise<string>{return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Unable to read this image.'));reader.readAsDataURL(file);});}
function loadImage(url:string):Promise<HTMLImageElement>{return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('This image could not be decoded. Choose a PNG, JPEG, or WebP file.'));image.src=url;});}
function canvasPixels(image:HTMLImageElement,width:number,height:number):FinishingImage{
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw new Error('Your browser could not create an image canvas.');
  context.drawImage(image,0,0,width,height);
  const data=context.getImageData(0,0,width,height).data;canvas.width=canvas.height=1;
  return {width,height,data};
}
async function sampleFile():Promise<File>{
  const canvas=document.createElement('canvas');canvas.width=1800;canvas.height=1200;
  const context=canvas.getContext('2d')!;
  const sky=context.createLinearGradient(0,0,0,1200);sky.addColorStop(0,'#394963');sky.addColorStop(.48,'#c18d87');sky.addColorStop(.73,'#edc6a0');sky.addColorStop(1,'#596b76');context.fillStyle=sky;context.fillRect(0,0,1800,1200);
  const glow=context.createRadialGradient(1130,365,12,1130,365,340);glow.addColorStop(0,'#ffdfad99');glow.addColorStop(1,'#ffdfad00');context.fillStyle=glow;context.fillRect(700,0,900,850);
  context.fillStyle='#ffe3ac';context.beginPath();context.arc(1130,365,82,0,Math.PI*2);context.fill();
  const mountain=(points:number[][],color:string)=>{context.fillStyle=color;context.beginPath();context.moveTo(0,1200);for(const [x,y]of points)context.lineTo(x,y);context.lineTo(1800,1200);context.closePath();context.fill();};
  mountain([[0,650],[180,435],[340,600],[615,305],[850,640],[1080,510],[1260,620],[1540,370],[1800,610]],'#6f6880');
  mountain([[0,730],[270,565],[520,755],[805,610],[1030,760],[1270,630],[1500,740],[1800,550]],'#575d75');
  mountain([[0,860],[300,715],[540,840],[880,770],[1200,870],[1490,730],[1800,880]],'#394c60');
  const water=context.createLinearGradient(0,820,0,1200);water.addColorStop(0,'#8e9a9c');water.addColorStop(.5,'#687f89');water.addColorStop(1,'#384f60');context.fillStyle=water;context.fillRect(0,860,1800,340);
  for(let index=0;index<40;index++){const y=870+index*8;context.strokeStyle=`rgba(245,203,162,${.18*(1-index/45)})`;context.lineWidth=2+index*.05;context.beginPath();context.moveTo(1000-index*10,y);context.lineTo(1250+index*9,y);context.stroke();}
  mountain([[0,925],[220,870],[450,920],[680,1100],[830,1200],[1800,1200]],'#293c43');
  const pine=(x:number,y:number,size:number,color:string)=>{context.fillStyle=color;context.fillRect(x-size*.025,y-size*.8,size*.05,size*.9);for(let tier=0;tier<5;tier++){const top=y-size+tier*size*.14,w=size*(.13+tier*.045);context.beginPath();context.moveTo(x,top);context.lineTo(x-w,top+size*.38);context.lineTo(x+w,top+size*.38);context.closePath();context.fill();}};
  pine(125,950,500,'#20343d');pine(340,1010,350,'#253b43');pine(1740,1100,610,'#24363f');pine(1555,1080,390,'#293e46');
  context.strokeStyle='#b4a681';context.lineWidth=5;context.beginPath();context.moveTo(80,1100);context.quadraticCurveTo(370,1040,550,1170);context.stroke();
  let seed=11753;for(let i=0;i<170;i++){seed=(seed*1664525+1013904223)>>>0;const x=seed%640;seed=(seed*1664525+1013904223)>>>0;const y=1000+seed%200;context.fillStyle=i%3===0?'#c5a5aa':i%3===1?'#7c8d79':'#b58c76';context.beginPath();context.ellipse(x,y,3+(i%4),2+(i%3),-.7,0,Math.PI*2);context.fill();}
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>{if(blob)resolve(new File([blob],'Evening in the valley.png',{type:'image/png'}));else reject(new Error('Unable to prepare the sample image.'));},'image/png'));
}
function SliderControl({control,value,onLive,onCommit,onBegin,onEnd}:{control:typeof FINISHING_CONTROLS[number];value:number;onLive:(value:number)=>void;onCommit:(value:number)=>void;onBegin:()=>void;onEnd:()=>void}){
  const [draft,setDraft]=useState(String(value));
  useEffect(()=>setDraft(String(value)),[value]);
  const finishNumber=()=>{const parsed=Number(draft);if(draft.trim()&&Number.isFinite(parsed))onCommit(Math.min(control.max,Math.max(control.min,parsed)));else setDraft(String(value));};
  return <div className="finish-control">
    <label htmlFor={`finish-${control.key}`}>{control.label}</label>
    <button type="button" className="finish-control-reset" title={`Reset ${control.label.toLowerCase()}`} aria-label={`Reset ${control.label.toLowerCase()}`} disabled={value===control.defaultValue} onClick={()=>onCommit(control.defaultValue)}><RotateCcw size={12}/></button>
    <input className="finish-value" aria-label={`${control.label} value`} type="number" min={control.min} max={control.max} step={control.step} value={draft}
      onChange={event=>setDraft(event.target.value)} onBlur={finishNumber} onKeyDown={event=>{if(event.key==='Enter')event.currentTarget.blur();}}/>
    <input id={`finish-${control.key}`} type="range" min={control.min} max={control.max} step={control.step} value={value}
      onPointerDown={onBegin} onPointerUp={onEnd} onPointerCancel={onEnd} onBlur={onEnd}
      onKeyDown={event=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key))onBegin();}}
      onKeyUp={onEnd} onChange={event=>onLive(Number(event.target.value))}/>
  </div>;
}

export default function ImageFinishing({open,onClose}:{open:boolean;onClose:()=>void}){
  const [source,setSource]=useState<FinishingSource|null>(null),[history,setHistory]=useState<History>({past:[],present:blankEdit(),future:[]});
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [group,setGroup]=useState<'light'|'color'|'detail'|'crop'>('light');
  const [compare,setCompare]=useState(true),[original,setOriginal]=useState(false),[divider,setDivider]=useState(50);
  const [previewSize,setPreviewSize]=useState({width:1,height:1}),[rendering,setRendering]=useState(false);
  const [stageSpace,setStageSpace]=useState({width:900,height:500});
  const [cropDraft,setCropDraft]=useState({x:'0',y:'0',width:'1',height:'1'});
  const [presets,setPresets]=useState<Preset[]>([]),[presetName,setPresetName]=useState('');
  const [format,setFormat]=useState<'png'|'jpeg'>('png'),[matte,setMatte]=useState('#ffffff');
  const [pendingFile,setPendingFile]=useState<File|null>(null),[dragOver,setDragOver]=useState(false);
  const workerRef=useRef<Worker|null>(null),loadedRef=useRef(false),workerBusy=useRef(false),queuedPreview=useRef<PreviewRequest|null>(null);
  const historyRef=useRef(history),sourceRef=useRef(source),gestureStart=useRef<Edit|null>(null),sourceId=useRef(0),requestId=useRef(0),latestPreviewId=useRef(0),exportRequest=useRef<ExportRequest|null>(null);
  const lastSaved=useRef(''),sourceImage=useRef<HTMLImageElement|null>(null),previewImage=useRef<FinishingImage|null>(null);
  const canvas=useRef<HTMLCanvasElement>(null),beforeCanvas=useRef<HTMLCanvasElement>(null),stageWrap=useRef<HTMLDivElement>(null),dialog=useRef<HTMLElement>(null),closeButton=useRef<HTMLButtonElement>(null),fileInput=useRef<HTMLInputElement>(null),presetInput=useRef<HTMLInputElement>(null);
  const loadGeneration=useRef(0),onCloseRef=useRef(onClose),renderCallback=useRef<()=>void>(()=>{}),paintCallback=useRef<()=>void>(()=>{});
  onCloseRef.current=onClose;

  const installHistory=(next:History)=>{historyRef.current=next;setHistory(next);};
  const commit=(next:Edit,previous?:Edit)=>{
    const current=historyRef.current,start=previous??current.present;
    gestureStart.current=null;
    if(editKey(start)===editKey(next)){if(editKey(current.present)!==editKey(next))installHistory({...current,present:next});return;}
    installHistory({past:[...current.past,start].slice(-80),present:next,future:[]});
    setNotice('');
  };
  const beginGesture=()=>{gestureStart.current??=historyRef.current.present;};
  const endGesture=()=>{if(gestureStart.current)commit(historyRef.current.present,gestureStart.current);};
  const changeValue=(key:keyof FinishingSettings,value:number,live=false)=>{
    const current=historyRef.current,next={...current.present,settings:{...current.present.settings,[key]:value}};
    if(live){beginGesture();installHistory({...current,present:next});}else commit(next);
  };
  const travelHistory=(direction:'undo'|'redo')=>{
    endGesture();const current=historyRef.current;
    if(direction==='undo'&&current.past.length)installHistory({past:current.past.slice(0,-1),present:current.past[current.past.length-1],future:[current.present,...current.future]});
    if(direction==='redo'&&current.future.length)installHistory({past:[...current.past,current.present],present:current.future[0],future:current.future.slice(1)});
  };
  const historyAction=useRef(travelHistory);historyAction.current=travelHistory;

  const paintPreview=()=>{
    const result=previewImage.current,originalImage=sourceImage.current,currentSource=sourceRef.current;
    if(!result||!canvas.current||!beforeCanvas.current||!originalImage||!currentSource)return;
    canvas.current.width=result.width;canvas.current.height=result.height;
    canvas.current.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(result.data),result.width,result.height),0,0);
    beforeCanvas.current.width=result.width;beforeCanvas.current.height=result.height;
    const crop=historyRef.current.present.crop??{x:0,y:0,width:currentSource.width,height:currentSource.height};
    beforeCanvas.current.getContext('2d')?.drawImage(originalImage,crop.x,crop.y,crop.width,crop.height,0,0,result.width,result.height);
  };
  paintCallback.current=paintPreview;
  const sendQueuedPreview=()=>{
    if(!workerRef.current||!loadedRef.current||workerBusy.current||!queuedPreview.current)return;
    const request=queuedPreview.current;queuedPreview.current=null;workerBusy.current=true;workerRef.current.postMessage(request);
  };
  const requestPreview=()=>{
    if(!sourceRef.current)return;
    const edit=historyRef.current.present,id=++requestId.current;latestPreviewId.current=id;
    queuedPreview.current={kind:'preview',id,sourceId:sourceId.current,settings:edit.settings,crop:edit.crop};setRendering(true);sendQueuedPreview();
  };
  renderCallback.current=requestPreview;

  useEffect(()=>{
    let worker:Worker;
    try{worker=new Worker(new URL('./image-finishing.worker.ts',import.meta.url),{type:'module'});workerRef.current=worker;}
    catch{setError('Image processing could not start in this browser. Refresh the page and try again.');return;}
    worker.onmessage=(event:MessageEvent<WorkerResult>)=>{
      const result=event.data;if(result.sourceId!==sourceId.current)return;
      if(result.kind==='loaded'){loadedRef.current=true;workerBusy.current=false;renderCallback.current();return;}
      if(result.kind==='error'){
        setError(result.message||'Unable to finish the image.');setBusy('');setRendering(false);workerBusy.current=false;
        if(result.operation==='export')exportRequest.current=null;
        sendQueuedPreview();return;
      }
      if(result.kind==='preview'){
        workerBusy.current=false;
        if(result.id===latestPreviewId.current&&result.image){previewImage.current=result.image;setPreviewSize({width:result.image.width,height:result.image.height});paintCallback.current();setRendering(false);}
        sendQueuedPreview();return;
      }
      const requested=exportRequest.current;
      if(result.kind==='export'&&result.image&&requested&&requested.id===result.id){
        exportRequest.current=null;
        try{
          const output=document.createElement('canvas');output.width=result.image.width;output.height=result.image.height;
          const context=output.getContext('2d');if(!context)throw new Error('The export canvas could not be created.');
          context.putImageData(new ImageData(new Uint8ClampedArray(result.image.data),result.image.width,result.image.height),0,0);
          if(requested.format==='jpeg'){context.globalCompositeOperation='destination-over';context.fillStyle=requested.matte;context.fillRect(0,0,output.width,output.height);}
          output.toBlob(blob=>{
            if(blob){download(`${requested.name}-finished.${requested.format==='jpeg'?'jpg':'png'}`,blob);setNotice(`Exported ${formatDimensions(output.width,output.height)}. Your original is unchanged.`);}
            else setError('The browser could not encode this image. Try PNG or a smaller crop.');
            output.width=output.height=1;setBusy('');
          },requested.format==='jpeg'?'image/jpeg':'image/png',.95);
        }catch(error){setError(error instanceof Error?error.message:'Unable to export image.');setBusy('');}
      }
    };
    worker.onerror=()=>{
      loadedRef.current=false;workerBusy.current=false;queuedPreview.current=null;exportRequest.current=null;
      worker.terminate();workerRef.current=null;
      setError('Image processing stopped. Save an editable project, then refresh to restart image processing.');setBusy('');setRendering(false);
    };
    return()=>{worker.terminate();workerRef.current=null;};
  },[]);

  useEffect(()=>{
    try{
      const parsed:unknown=JSON.parse(localStorage.getItem(PRESET_KEY)||'[]');
      if(Array.isArray(parsed))setPresets(parsed.slice(0,20).flatMap(value=>{
        try{if(!value||typeof value.name!=='string')return [];return [{name:value.name.slice(0,60),settings:normalizeFinishingSettings(value.settings)}];}catch{return [];}
      }));
    }catch{/* Presets are optional; image work does not depend on local storage. */}
  },[]);
  useEffect(()=>{
    const timer=setTimeout(()=>requestPreview(),65);return()=>clearTimeout(timer);
  },[history.present,source]);
  useEffect(()=>{if(open)requestAnimationFrame(()=>paintPreview());},[open,previewSize]);
  useEffect(()=>{
    const element=stageWrap.current;if(!open||!element)return;
    const resize=()=>{const style=getComputedStyle(element);setStageSpace({width:Math.max(1,element.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight)),height:Math.max(1,element.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom))});};
    resize();const observer=new ResizeObserver(resize);observer.observe(element);return()=>observer.disconnect();
  },[open,source]);
  useEffect(()=>{
    if(!source)return;
    const crop=history.present.crop??{x:0,y:0,width:source.width,height:source.height};
    setCropDraft({x:String(crop.x),y:String(crop.y),width:String(crop.width),height:String(crop.height)});
  },[source,history.present.crop]);
  useEffect(()=>{
    const beforeUnload=(event:BeforeUnloadEvent)=>{
      if(sourceRef.current&&editKey(historyRef.current.present)!==lastSaved.current){event.preventDefault();event.returnValue='';}
    };
    window.addEventListener('beforeunload',beforeUnload);return()=>window.removeEventListener('beforeunload',beforeUnload);
  },[]);
  useEffect(()=>{
    if(!open)return;
    const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow;document.body.style.overflow='hidden';closeButton.current?.focus();
    const keydown=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(dialog.current?.querySelector('.finish-replace'))setPendingFile(null);else onCloseRef.current();return;}
      const target=event.target as HTMLElement|null,typing=target?.closest('input:not([type="range"]),textarea,select');
      if((event.ctrlKey||event.metaKey)&&!typing&&['z','y'].includes(event.key.toLowerCase())){
        event.preventDefault();event.stopImmediatePropagation();historyAction.current(event.shiftKey||event.key.toLowerCase()==='y'?'redo':'undo');return;
      }
      if(event.key==='Tab'){
        const scope=dialog.current?.querySelector('.finish-replace')??dialog.current;
        const focusable=Array.from(scope?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')??[]).filter(element=>element.offsetParent!==null);
        const first=focusable[0],last=focusable[focusable.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    window.addEventListener('keydown',keydown,true);
    return()=>{document.body.style.overflow=overflow;window.removeEventListener('keydown',keydown,true);previous?.focus();};
  },[open]);
  useEffect(()=>{if(pendingFile)dialog.current?.querySelector<HTMLElement>('.finish-replace button')?.focus();},[pendingFile]);

  const loadFile=async(file:File)=>{
    if(!workerRef.current){setError('The image processor is unavailable. Refresh the page to try again.');return;}
    const generation=++loadGeneration.current;setBusy('Opening image…');setError('');setNotice('');
    try{
      const projectFile=/\.json$/i.test(file.name);
      if(file.size>(projectFile?MAX_FINISHING_PROJECT_BYTES:MAX_FINISHING_FILE_BYTES))throw new Error(projectFile?'Choose a finishing project smaller than 56 MB.':'Choose an image smaller than 40 MB.');
      let nextSource:FinishingSource,nextEdit=blankEdit(),url:string;
      if(projectFile){const project=readFinishingProject(JSON.parse(await file.text()));nextSource=project.source;url=nextSource.dataUrl;nextEdit={settings:project.recipe.adjustments,crop:project.recipe.crop};}
      else{
        if(!/^image\/(png|jpeg|webp)$/.test(file.type))throw new Error('Choose a PNG, JPEG, WebP, or .finish.json project.');
        url=await readDataUrl(file);nextSource={name:file.name,dataUrl:url,width:0,height:0};
      }
      const image=await loadImage(url);validateFinishingDimensions(image.naturalWidth,image.naturalHeight);
      if(projectFile&&(image.naturalWidth!==nextSource.width||image.naturalHeight!==nextSource.height))throw new Error('The project dimensions do not match its original image.');
      nextSource={...nextSource,width:image.naturalWidth,height:image.naturalHeight};
      const scale=Math.min(1,1400/Math.max(image.naturalWidth,image.naturalHeight));
      const preview=canvasPixels(image,Math.max(1,Math.round(image.naturalWidth*scale)),Math.max(1,Math.round(image.naturalHeight*scale)));
      const full=canvasPixels(image,image.naturalWidth,image.naturalHeight);
      if(generation!==loadGeneration.current)return;
      sourceId.current++;loadedRef.current=false;queuedPreview.current=null;workerBusy.current=false;previewImage.current=null;sourceImage.current=image;sourceRef.current=nextSource;setSource(nextSource);
      installHistory({past:[],present:nextEdit,future:[]});gestureStart.current=null;lastSaved.current=editKey(nextEdit);
      setPreviewSize({width:preview.width,height:preview.height});setOriginal(false);setDivider(50);
      workerRef.current.postMessage({kind:'load',sourceId:sourceId.current,image:full,preview},[full.data.buffer,preview.data.buffer]);
      setNotice(projectFile?'Editable project opened. Every adjustment is still reversible.':'Original preserved. Adjust the sliders to find your finish.');
    }catch(error){if(generation===loadGeneration.current)setError(error instanceof Error?error.message:'Unable to open this image.');}
    finally{if(generation===loadGeneration.current)setBusy('');}
  };
  const chooseFile=(file?:File)=>{if(!file||busy)return;if(source)setPendingFile(file);else void loadFile(file);};
  const fileChanged=(event:ChangeEvent<HTMLInputElement>)=>{chooseFile(event.target.files?.[0]);event.target.value='';};
  const saveProject=()=>{
    if(!sourceRef.current)return;endGesture();const edit=historyRef.current.present;
    const project={format:FINISHING_PROJECT_FORMAT,name:cleanName(sourceRef.current.name),source:sourceRef.current,recipe:{format:FINISHING_RECIPE_FORMAT,adjustments:edit.settings,crop:edit.crop}};
    download(`${cleanName(sourceRef.current.name)}.finish.json`,new Blob([JSON.stringify(project)],{type:'application/json'}));lastSaved.current=editKey(edit);setNotice('Editable project downloaded with the original image and adjustments.');
  };
  const exportImage=()=>{
    if(!source||busy||!loadedRef.current)return;endGesture();const id=++requestId.current,edit=historyRef.current.present;
    exportRequest.current={id,format,name:cleanName(source.name),matte};setBusy('Rendering full-resolution export…');setError('');
    workerRef.current?.postMessage({kind:'export',id,sourceId:sourceId.current,settings:edit.settings,crop:edit.crop});
  };
  const applyCrop=()=>{
    if(!source)return;
    try{
      const crop=normalizeFinishingCrop({x:Number(cropDraft.x),y:Number(cropDraft.y),width:Number(cropDraft.width),height:Number(cropDraft.height)},source.width,source.height);
      commit({...historyRef.current.present,crop:crop.x===0&&crop.y===0&&crop.width===source.width&&crop.height===source.height?null:crop});setError('');
    }catch(error){setError(error instanceof Error?error.message:'Enter a crop within the image.');}
  };
  const aspectCrop=(ratio:number|null)=>{
    if(!source)return;
    if(ratio===null){commit({...historyRef.current.present,crop:null});return;}
    let width=source.width,height=Math.round(width/ratio);
    if(height>source.height){height=source.height;width=Math.round(height*ratio);}
    commit({...historyRef.current.present,crop:{x:Math.floor((source.width-width)/2),y:Math.floor((source.height-height)/2),width:Math.max(1,width),height:Math.max(1,height)}});
  };
  const savePreset=()=>{
    const name=presetName.trim().slice(0,60)||`My look ${presets.length+1}`,preset={name,settings:{...historyRef.current.present.settings}},next=[preset,...presets.filter(item=>item.name!==name)].slice(0,20);
    try{localStorage.setItem(PRESET_KEY,JSON.stringify(next));setPresets(next);setPresetName('');setNotice(`Saved “${name}” on this device. Presets change color and light; each image keeps its crop.`);}
    catch{setError('This browser could not save the preset. Download the preset file to keep it.');}
  };
  const downloadPreset=()=>{
    const recipe:FinishingRecipe={format:FINISHING_RECIPE_FORMAT,adjustments:historyRef.current.present.settings,crop:null};
    download(`${cleanName(presetName.trim()||'My look')}.finish-preset.json`,new Blob([JSON.stringify(recipe,null,2)],{type:'application/json'}));setNotice('Preset downloaded. Open it on another image to reuse this finish.');
  };
  const loadPreset=async(event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.target.files?.[0];event.target.value='';if(!file)return;
    try{if(file.size>20_000)throw new Error('Choose a small .finish-preset.json file.');const recipe=readFinishingRecipe(JSON.parse(await file.text()));commit({...historyRef.current.present,settings:recipe.adjustments});setNotice('Preset applied. Your current crop is preserved.');setError('');}
    catch(error){setError(error instanceof Error?error.message:'Unable to open this preset.');}
  };
  const moveDivider=(event:PointerEvent<HTMLDivElement>)=>{
    if(!event.currentTarget.hasPointerCapture(event.pointerId))return;
    const bounds=event.currentTarget.getBoundingClientRect();setDivider(Math.max(0,Math.min(100,(event.clientX-bounds.left)/bounds.width*100)));
  };

  if(!open)return null;
  const edit=history.present,output=edit.crop??source,controls=FINISHING_CONTROLS.filter(control=>control.group===group);
  return <section ref={dialog} className="finishing-workspace" role="dialog" aria-modal="true" aria-labelledby="finishing-title"
    onDragOver={event=>{event.preventDefault();if(!busy)setDragOver(true);}}
    onDragLeave={event=>{if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))setDragOver(false);}}
    onDrop={event=>{event.preventDefault();setDragOver(false);chooseFile(event.dataTransfer.files[0]);}}>
    <header className="finish-header">
      <button ref={closeButton} type="button" className="finish-back" onClick={onClose} title="Back to Pixel Workshop. Your image stays open." aria-label="Back to Pixel Workshop"><ArrowLeft size={19}/><span>Workshop</span></button>
      <div className="finish-brand"><span className="finish-brand-icon"><SlidersHorizontal size={22}/></span><div><span className="finish-eyebrow">PIXEL WORKSHOP</span><h1 id="finishing-title">Image Finishing</h1></div></div>
      <span className="finish-private"><i/>On your device</span>
      <button type="button" className="finish-button" disabled={!!busy} onClick={()=>fileInput.current?.click()}><FolderOpen size={16}/><span>{source?'Open another':'Open image'}</span></button>
      {source&&<button type="button" className="finish-button finish-project-save" disabled={!!busy} onClick={saveProject}><Save size={16}/><span>Save project</span></button>}
    </header>
    <input ref={fileInput} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp,.finish.json,.json" onChange={fileChanged}/>
    <input ref={presetInput} className="visually-hidden" type="file" accept=".json,application/json" onChange={event=>void loadPreset(event)}/>
    {!source?<div className="finish-welcome">
      <div className="finish-welcome-copy"><span className="finish-eyebrow">THE LAST LITTLE TOUCHES</span><h2>Keep the image.<br/><em>Find the feeling.</em></h2><p>Fine-tune color, light, and detail with precise, reversible adjustments. Your original stays untouched.</p></div>
      <button type="button" className="finish-upload" disabled={!!busy} onClick={()=>fileInput.current?.click()}><span className="finish-upload-icon"><ImagePlus size={34}/></span><strong>{busy||'Bring an image into the workshop'}</strong><span>Drop it here, or choose a file</span><small>PNG · JPEG · WebP · Editable finishing projects</small><b>Open image <ArrowLeft size={15}/></b></button>
      <button type="button" className="finish-sample-button" disabled={!!busy} onClick={()=>{setBusy('Preparing sample…');void sampleFile().then(file=>loadFile(file)).catch(error=>{setBusy('');setError(error instanceof Error?error.message:'Unable to load the sample.');});}}><Sparkles size={14}/>Try a sample</button>
      <div className="finish-welcome-notes"><span><Check size={15}/>Full-resolution export</span><span><Check size={15}/>No regeneration</span><span><Check size={15}/>Processed on this device</span></div>
      {error&&<p role="alert" className="finish-message error">{error}</p>}
    </div>:<>
      <div className="finish-body">
        <div className="finish-main">
          <div className="finish-imagebar"><div><strong title={source.name}>{source.name}</strong><span>{formatDimensions(source.width,source.height)} original</span></div><div className="finish-history"><button type="button" aria-label="Undo image adjustment" title="Undo (Ctrl/⌘ Z)" disabled={!history.past.length||!!busy} onClick={()=>travelHistory('undo')}><Undo2 size={18}/></button><button type="button" aria-label="Redo image adjustment" title="Redo (Ctrl/⌘ Shift Z)" disabled={!history.future.length||!!busy} onClick={()=>travelHistory('redo')}><Redo2 size={18}/></button><button type="button" className="finish-reset-all" disabled={editKey(edit)===editKey(blankEdit())||!!busy} onClick={()=>commit(blankEdit())}><RotateCcw size={15}/><span>Reset all</span></button></div></div>
          <div className="finish-view-controls"><div role="group" aria-label="Image comparison"><button type="button" aria-pressed={!original} className={!original?'active':''} onClick={()=>setOriginal(false)}>Edited</button><button type="button" aria-pressed={original} className={original?'active':''} onClick={()=>setOriginal(true)}>Original</button></div><button type="button" className={compare&&!original?'active':''} aria-pressed={compare&&!original} onClick={()=>{setOriginal(false);setCompare(value=>!value);}}><ArrowLeftRight size={15}/>Compare</button><span aria-live="polite">{rendering?'Updating preview…':'Fit preview'}</span></div>
          <div ref={stageWrap} className="finish-stage-wrap">
            <div className="finish-stage" style={{aspectRatio:`${previewSize.width} / ${previewSize.height}`,width:Math.min(stageSpace.width,stageSpace.height*previewSize.width/previewSize.height),maxWidth:'100%'}}
              onPointerDown={event=>{if(compare&&!original){event.currentTarget.setPointerCapture(event.pointerId);moveDivider(event);}}} onPointerMove={moveDivider} onPointerUp={event=>{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}>
              <canvas ref={canvas} aria-label="Finished image preview"/>
              <canvas ref={beforeCanvas} className="finish-before" aria-label="Original image preview" style={{clipPath:original?'none':compare?`inset(0 ${100-divider}% 0 0)`:'inset(0 100% 0 0)'}}/>
              {compare&&!original&&<><span className="finish-image-label before">Original</span><span className="finish-image-label after">Edited</span><div className="finish-divider" style={{left:`${divider}%`}}><span><ArrowLeftRight size={17}/></span></div></>}
              {original&&<span className="finish-image-label before">Original · same crop</span>}
            </div>
          </div>
          {compare&&!original&&<label className="finish-comparison-range">Before / after<input aria-label="Before and after divider" type="range" min={0} max={100} value={divider} onChange={event=>setDivider(Number(event.target.value))}/></label>}
          <footer className="finish-preview-footer"><span><i/>{output?formatDimensions(output.width,output.height):''} export{edit.crop?' · Cropped':''}</span><span>Preview fits the screen. Export uses every pixel.</span></footer>
          {(error||notice||busy)&&<p className={`finish-message ${error?'error':''}`} role={error?'alert':'status'}>{error||busy||notice}</p>}
        </div>
        <aside className="finish-sidebar" aria-label="Image adjustments">
          <div className="finish-sidebar-heading"><span className="finish-eyebrow">MAKE IT YOURS</span><h2>A little more…</h2><p>Every adjustment stays reversible.</p></div>
          <div className="finish-tabs" role="tablist" aria-label="Adjustment category">{(['light','color','detail','crop'] as const).map(tab=><button type="button" key={tab} role="tab" aria-selected={group===tab} aria-controls={`finish-panel-${tab}`} className={group===tab?'active':''} onClick={()=>setGroup(tab)}>{tab==='crop'?<Crop size={15}/>:null}{tab[0].toUpperCase()+tab.slice(1)}</button>)}</div>
          <fieldset className="finish-adjustments" id={`finish-panel-${group}`} role="tabpanel" aria-label={`${group} adjustments`} disabled={!!busy}>
            {group!=='crop'?controls.map(control=><SliderControl key={control.key} control={control} value={edit.settings[control.key]} onLive={value=>changeValue(control.key,value,true)} onCommit={value=>changeValue(control.key,value)} onBegin={beginGesture} onEnd={endGesture}/>):<div className="finish-crop-panel"><p>Trim the edges without losing the original. Reset the crop any time.</p><div className="finish-aspects">{[['Full',null],['Square',1],['4:3',4/3],['3:4',3/4],['16:9',16/9]] .map(([label,ratio])=><button type="button" key={String(label)} onClick={()=>aspectCrop(ratio as number|null)}>{label}</button>)}</div><div className="finish-crop-fields">{(['x','y','width','height'] as const).map(key=><label key={key}>{key==='x'?'Left':key==='y'?'Top':key[0].toUpperCase()+key.slice(1)}<input type="number" min={key==='x'||key==='y'?0:1} step={1} value={cropDraft[key]} onChange={event=>setCropDraft(old=>({...old,[key]:event.target.value}))}/></label>)}</div><span className="finish-help">Coordinates and dimensions are original image pixels.</span><button type="button" className="finish-button" onClick={applyCrop}><Crop size={15}/>Apply crop</button>{edit.crop&&<button type="button" className="finish-link" onClick={()=>aspectCrop(null)}>Restore full image</button>}</div>}
            {group==='detail'&&<p className="finish-help">Detail is rendered again at full resolution when you export.</p>}
          </fieldset>
          <details className="finish-presets"><summary><Sparkles size={15}/>Reusable looks<ChevronDown size={14}/></summary><div className="finish-preset-body"><p>Keep a consistent finish across a set of illustrations.</p><select aria-label="Apply a saved finishing preset" value="" disabled={!!busy} onChange={event=>{const preset=presets[Number(event.target.value)];if(preset)commit({...historyRef.current.present,settings:{...preset.settings}});}}><option value="">Choose a saved look…</option>{presets.map((preset,index)=><option value={index} key={preset.name}>{preset.name}</option>)}</select><div className="finish-preset-save"><input aria-label="Preset name" placeholder="Name this look" value={presetName} maxLength={60} onChange={event=>setPresetName(event.target.value)}/><button type="button" aria-label="Save finishing preset" onClick={savePreset}><Save size={16}/></button></div><div className="finish-preset-files"><button type="button" onClick={downloadPreset}>Download preset</button><button type="button" disabled={!!busy} onClick={()=>presetInput.current?.click()}>Open preset</button></div><small>Saved looks stay in this browser. Download a preset to keep or share it.</small></div></details>
          <section className="finish-export"><span className="finish-eyebrow">READY WHEN YOU ARE</span><div className="finish-export-options"><label>File format<select value={format} onChange={event=>setFormat(event.target.value as 'png'|'jpeg')}><option value="png">PNG · lossless</option><option value="jpeg">JPEG · 95% quality</option></select></label>{format==='jpeg'&&<label className="finish-matte">Background<input type="color" value={matte} onChange={event=>setMatte(event.target.value)} aria-label="JPEG background color"/></label>}</div><button type="button" className="finish-export-button" disabled={!!busy||!loadedRef.current} onClick={exportImage}><Download size={17}/>{busy.startsWith('Rendering')?'Rendering…':`Export ${format==='png'?'PNG':'JPEG'}`}<span>{output?`${output.width} × ${output.height}`:''}</span></button><button type="button" className="finish-save-bottom" disabled={!!busy} onClick={saveProject}><Save size={14}/>Download editable project</button><p>Edits live in this tab. Save a project to reopen your original and adjustments later.</p></section>
        </aside>
      </div>
    </>}
    {dragOver&&<div className="finish-drop-overlay"><ImagePlus size={45}/><strong>Drop an image to open it</strong><span>PNG, JPEG, WebP, or an editable project</span></div>}
    {pendingFile&&<div className="finish-replace-backdrop"><section className="finish-replace" role="alertdialog" aria-modal="true" aria-labelledby="finish-replace-heading"><button type="button" className="finish-replace-close" aria-label="Cancel opening another image" onClick={()=>setPendingFile(null)}><X size={18}/></button><h2 id="finish-replace-heading">Keep this finish?</h2><p>Download an editable project if you want to return to this image and its adjustments. Opening another image replaces the one in this tab.</p><div><button type="button" className="finish-button" onClick={saveProject}><Save size={15}/>Save current project</button><button type="button" className="finish-button finish-confirm" onClick={()=>{const next=pendingFile;setPendingFile(null);void loadFile(next);}}>Open {pendingFile.name.length>25?'new image':pendingFile.name}</button></div><button type="button" className="finish-link" onClick={()=>setPendingFile(null)}>Keep working on this image</button></section></div>}
  </section>;
}
