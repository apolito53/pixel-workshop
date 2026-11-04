'use client';
import {useEffect,useMemo,useRef,useState,type CSSProperties,type PointerEvent,type SetStateAction} from 'react';
import {composite,frameCount,frameView,type PaintCommand,type PixelDocument} from '../lib/pixels.ts';
import {stretchNineSlice,validatePixelText,validateSlice,type PixelTextRecipe,type UiMetadata,type UiSlice} from '../lib/ui-metadata.ts';
import {textDimensions} from '../lib/pixel-font.ts';

type Props={doc:PixelDocument;frame:number;layer:string;ink:string;busy:boolean;
 onCommit:(commands:PaintCommand[])=>Promise<boolean>;onFrame:(frame:number)=>void;onLayer:(layer:string)=>void;
 onRemap:(from:string,to:string,kitId:string)=>Promise<void>;onInspectKit:(kitId:string)=>Promise<{count:number;colors:string[]}>;
 onExportKit:()=>Promise<void>;onPreviewKit:()=>Promise<void>};
const fields=['left','top','right','bottom'] as const;
const label=(s:string)=>s.charAt(0).toUpperCase()+s.slice(1);
function initialSlice(doc:PixelDocument):UiSlice{
 if(doc.ui?.slice)return structuredClone(doc.ui.slice);
 const x=Math.floor((doc.width-1)/4),y=Math.floor((doc.height-1)/4);
 return {left:x,right:x,top:y,bottom:y,content:{left:x,right:x,top:y,bottom:y}};
}
function Artwork({doc,frame,className}:{doc:PixelDocument;frame:number;className?:string}){
 const ref=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{const canvas=ref.current;if(!canvas)return;canvas.width=doc.width;canvas.height=doc.height;
  canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(composite(frameView(doc,frame))),doc.width,doc.height),0,0);
 },[doc,frame]);
 return <canvas ref={ref} aria-label={`Frame ${frame+1} artwork`} className={className}/>;
}
function PanelPreview({doc,frame,slice,width,height}:{doc:PixelDocument;frame:number;slice:UiSlice;width:number;height:number}){
 const ref=useRef<HTMLCanvasElement>(null);
 const result=useMemo(()=>{
  try{return {pixels:stretchNineSlice(composite(frameView(doc,frame)),doc.width,doc.height,slice,width,height),problem:''};}
  catch(e){return {pixels:null,problem:(e as Error).message};}
 },[doc,frame,slice,width,height]);
 useEffect(()=>{const canvas=ref.current;if(!canvas||!result.pixels)return;canvas.width=width;canvas.height=height;
  canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(result.pixels),width,height),0,0);
 },[result.pixels,width,height]);
 return <div className="ui-preview-box"><canvas ref={ref} hidden={!!result.problem} aria-label="Resizable panel preview"/>{result.problem&&<span className="ui-note ui-warning" role="status">{result.problem}</span>}</div>;
}
function StatePreview({doc,slice}:{doc:PixelDocument;slice:UiSlice}){
 const [interaction,setInteraction]=useState<'rest'|'hover'|'pressed'|'disabled'>('rest'),button=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  const element=button.current,slots=doc.ui?.slots??[];
  const slot=slots.find(item=>item.name.toLowerCase()===interaction)??slots.find(item=>item.name.toLowerCase()==='rest');
  if(!element)return;
  if(!slot){element.style.borderImageSource='';return;}
  const canvas=document.createElement('canvas');canvas.width=doc.width;canvas.height=doc.height;
  canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(composite(frameView(doc,slot.frame))),doc.width,doc.height),0,0);
  element.style.borderImageSource=`url("${canvas.toDataURL('image/png')}")`;
 },[doc,interaction]);
 const style:CSSProperties={border:'12px solid transparent',borderImageSlice:`${slice.top} ${slice.right} ${slice.bottom} ${slice.left} fill`,borderImageWidth:'12px',borderImageRepeat:'stretch'};
 return <div className="ui-state-preview"><button ref={button} type="button" className="ui-sample-button" style={style}
  onMouseEnter={()=>setInteraction('hover')} onMouseLeave={()=>setInteraction('rest')}
  onPointerDown={()=>setInteraction('pressed')} onPointerUp={()=>setInteraction('hover')}
  onFocus={()=>setInteraction('hover')} onBlur={()=>setInteraction('rest')}>Try this button</button>
  <div className="ui-state-choices">{(['rest','hover','pressed','disabled'] as const).map(state=><button type="button" key={state}
   aria-pressed={interaction===state} onClick={()=>setInteraction(state)}>{label(state)}</button>)}</div>
 </div>;
}
export default function UiKitPanel({doc,frame,layer,ink,busy,onCommit,onFrame,onLayer,onRemap,onInspectKit,onExportKit,onPreviewKit}:Props){
 // Drafts are tied to their source metadata, so undo or a project change resets them without an effect.
 const sliceKey=doc.id+':'+JSON.stringify(doc.ui?.slice);
 const [sliceDraft,setSliceDraft]=useState(()=>({key:sliceKey,value:initialSlice(doc)}));
 const slice=sliceDraft.key===sliceKey?sliceDraft.value:initialSlice(doc);
 const setSlice=(next:SetStateAction<UiSlice>)=>setSliceDraft(old=>{
  const value=old.key===sliceKey?old.value:initialSlice(doc);
  return {key:sliceKey,value:typeof next==='function'?next(value):next};
 });
 const [previewWidth,setPreviewWidth]=useState(144),[previewHeight,setPreviewHeight]=useState(64);
 const [slotName,setSlotName]=useState('rest'),[frameDraft,setFrameDraft]=useState({source:frame,value:frame});
 const slotFrame=frameDraft.source===frame?frameDraft.value:frame;
 const setSlotFrame=(value:number)=>setFrameDraft({source:frame,value});
 const kitKey=doc.id+':'+(doc.ui?.kitId??''),assetKey=doc.id+':'+(doc.ui?.assetKey??'');
 const [kitState,setKitState]=useState(()=>({key:kitKey,value:doc.ui?.kitId??''})),[assetState,setAssetState]=useState(()=>({key:assetKey,value:doc.ui?.assetKey??''}));
 const kitDraft=kitState.key===kitKey?kitState.value:doc.ui?.kitId??'',assetDraft=assetState.key===assetKey?assetState.value:doc.ui?.assetKey??'';
 const setKitDraft=(value:string)=>setKitState({key:kitKey,value}),setAssetDraft=(value:string)=>setAssetState({key:assetKey,value});
 const [fromColor,setFromColor]=useState('#f7b95e'),[toColor,setToColor]=useState('#d194cf');
 const [paletteState,setPaletteState]=useState<{kitId:string;count:number;colors:string[]}|null>(null),[inspecting,setInspecting]=useState(false);
 const kitPalette=paletteState?.kitId===doc.ui?.kitId?paletteState:null;
 const selected=doc.layers.find(item=>item.id===layer),storedText=selected?.text;
 const textKey=doc.id+':'+layer+':'+JSON.stringify(storedText);
 const initialText=():PixelTextRecipe=>storedText??{text:'STARDROP',x:Math.min(1,doc.width-1),y:Math.min(1,doc.height-1),scale:1,spacing:1,color:ink,frame};
 const [textDraft,setTextDraft]=useState(()=>({key:textKey,value:initialText()}));
 const text=textDraft.key===textKey?textDraft.value:initialText();
 const setText=(next:SetStateAction<PixelTextRecipe>)=>setTextDraft(old=>{
  const value=old.key===textKey?old.value:initialText();
  return {key:textKey,value:typeof next==='function'?next(value):next};
 });
 const [problem,setProblem]=useState('');
 const guideArea=useRef<HTMLDivElement>(null),drag=useRef<typeof fields[number]|null>(null);
 const inspect=async()=>{if(!doc.ui?.kitId)return;setInspecting(true);try{setPaletteState({kitId:doc.ui.kitId,...await onInspectKit(doc.ui.kitId)});setProblem('');}catch(e){setProblem((e as Error).message);}finally{setInspecting(false);}};
 const writeUi=async(change:Partial<UiMetadata>)=>onCommit([{op:'ui_set',ui:{...doc.ui,...change}}]);
 const changeGuide=(field:typeof fields[number],value:number)=>setSlice(old=>{
  const limit=field==='left'?doc.width-1-old.right:field==='right'?doc.width-1-old.left:field==='top'?doc.height-1-old.bottom:doc.height-1-old.top;
  return {...old,[field]:Math.max(0,Math.min(limit,Math.round(value)))};
 });
 const dragGuide=(e:PointerEvent<HTMLDivElement>)=>{
  const area=guideArea.current,field=drag.current;if(!area||!field)return;
  const rect=area.getBoundingClientRect(),x=Math.round((e.clientX-rect.left)/rect.width*doc.width),y=Math.round((e.clientY-rect.top)/rect.height*doc.height);
  if(field==='left')changeGuide(field,Math.min(x,doc.width-1-slice.right));
  else if(field==='right')changeGuide(field,Math.min(doc.width-x,doc.width-1-slice.left));
  else if(field==='top')changeGuide(field,Math.min(y,doc.height-1-slice.bottom));
  else changeGuide(field,Math.min(doc.height-y,doc.height-1-slice.top));
 };
 const guideStyle=(field:typeof fields[number]):CSSProperties=>field==='left'?{left:(slice.left/doc.width*100)+'%'}:
  field==='right'?{left:((doc.width-slice.right)/doc.width*100)+'%'}:field==='top'?{top:(slice.top/doc.height*100)+'%'}:{top:((doc.height-slice.bottom)/doc.height*100)+'%'};
 const saveSlice=async()=>{try{const valid=validateSlice(slice,doc.width,doc.height);setProblem('');await writeUi({kind:doc.ui?.kind??'panel',slice:valid});}catch(e){setProblem((e as Error).message);}};
 const saveSlot=async()=>{
  const name=slotName.trim();const slots=[...(doc.ui?.slots??[])].filter(s=>s.name.toLowerCase()!==name.toLowerCase());
  slots.push({name,frame:slotFrame});try{setProblem('');await writeUi({kind:doc.ui?.kind??'button',slots});}catch(e){setProblem((e as Error).message);}
 };
 const saveText=async()=>{
  try{
   const recipe=validatePixelText({...text,frame:storedText?.frame??frame},doc.width,doc.height,frameCount(doc));
   const id=storedText?layer:'text-'+crypto.randomUUID().slice(0,12);
   if(!storedText&&doc.layers.length>=8)throw new Error('Free a layer before adding editable text.');
   const ops:PaintCommand[]=storedText?[]:[{op:'add_layer',id,name:'Pixel text'}];
   ops.push({op:'text_set',layer:id,text:recipe});
   if(await onCommit(ops))onLayer(id);setProblem('');
  }catch(e){setProblem((e as Error).message);}
 };
 const fits=(()=>{try{const size=textDimensions(validatePixelText(text,doc.width,doc.height,frameCount(doc)));return text.x+size.width<=doc.width&&text.y+size.height<=doc.height;}catch{return false;}})();
 return <div className="ui-kit-workbench">
  <section className="inspector-section"><div className="section-heading" data-guide="ui-workbench"><span>UI KIT WORKBENCH</span></div>
   <p className="ui-note">Make reusable panels, buttons, icons and lettering. Save your guides and names with the project.</p>
   {problem&&<p className="ui-warning" role="alert">{problem}</p>}
  </section>
  <details className="inspector-section ui-section" open>
   <summary data-guide="ui-panel-guides">Resizable panel guides</summary>
   <p className="ui-note">Drag the gold guides or enter pixel insets. Corners stay fixed while the center stretches.</p>
   <div className="ui-guide-area" ref={guideArea} onPointerMove={dragGuide}
    onPointerUp={e=>{drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
    onPointerCancel={()=>{drag.current=null;}}>
    <Artwork doc={doc} frame={frame} className="ui-guide-art"/>
    {fields.map(field=><div key={field} role="slider" tabIndex={0} aria-label={`${label(field)} panel guide`} aria-valuemin={0}
     aria-valuemax={field==='left'||field==='right'?doc.width-1:doc.height-1} aria-valuenow={slice[field]}
     className={'ui-guide '+(field==='left'||field==='right'?'vertical':'horizontal')} style={guideStyle(field)}
     onPointerDown={e=>{e.preventDefault();e.stopPropagation();drag.current=field;e.currentTarget.parentElement?.setPointerCapture(e.pointerId);}}
     onKeyDown={e=>{const horizontal=field==='left'||field==='right',negative=horizontal?e.key==='ArrowLeft':e.key==='ArrowUp',positive=horizontal?e.key==='ArrowRight':e.key==='ArrowDown';
      if(negative||positive){e.preventDefault();const direction=(negative?-1:1)*(field==='right'||field==='bottom'?-1:1);changeGuide(field,slice[field]+direction);}}}/>) }
   </div>
   <div className="ui-field-grid">{fields.map(field=><label key={field}>{label(field)}<input type="number" min={0} max={field==='left'||field==='right'?doc.width-1:doc.height-1}
    aria-label={`${label(field)} slice inset`} value={slice[field]} onChange={e=>changeGuide(field,Number(e.target.value))}/></label>)}</div>
   <p className="ui-note">Content insets describe where labels can sit inside the frame.</p>
   <div className="ui-field-grid">{fields.map(field=><label key={field}>{label(field)}<input type="number" min={0} max={field==='left'||field==='right'?doc.width-1:doc.height-1}
    aria-label={`${label(field)} content inset`} value={slice.content?.[field]??slice[field]}
    onChange={e=>setSlice(old=>({...old,content:{...(old.content??{left:old.left,right:old.right,top:old.top,bottom:old.bottom}),[field]:Number(e.target.value)}}))}/></label>)}</div>
   <button type="button" className="secondary full" disabled={busy} onClick={()=>void saveSlice()}>Save panel guides</button>
   <div className="ui-preview-fields"><label>Width<input type="number" aria-label="Panel preview width" min={1} max={1024} value={previewWidth} onChange={e=>setPreviewWidth(Number(e.target.value))}/></label>
    <label>Height<input type="number" aria-label="Panel preview height" min={1} max={1024} value={previewHeight} onChange={e=>setPreviewHeight(Number(e.target.value))}/></label></div>
   <PanelPreview doc={doc} frame={frame} slice={slice} width={previewWidth} height={previewHeight}/>
  </details>
  <details className="inspector-section ui-section"><summary data-guide="ui-state-names">Button states &amp; icons</summary>
   <p className="ui-note">Name frames so they export as button states or individual icons.</p>
   <label className="ui-field">Asset type<select aria-label="UI asset type" value={doc.ui?.kind??'other'} disabled={busy}
    onChange={e=>void writeUi({kind:e.target.value as UiMetadata['kind']})}>
    <option value="other">Other artwork</option><option value="panel">Panel</option><option value="button">Button</option><option value="icons">Icon set</option>
   </select></label>
   <label className="ui-field">Name<input aria-label="UI entry name" value={slotName} maxLength={32} onChange={e=>setSlotName(e.target.value)}/></label>
   <label className="ui-field">Frame<select aria-label="UI entry frame" value={slotFrame} onChange={e=>setSlotFrame(Number(e.target.value))}>
    {Array.from({length:frameCount(doc)},(_,i)=><option key={i} value={i}>Frame {i+1}</option>)}
   </select></label>
   <button className="secondary full" type="button" disabled={busy||!slotName.trim()} onClick={()=>void saveSlot()}>Save named frame</button>
   <div className="ui-slots">{(doc.ui?.slots??[]).map(slot=><div key={slot.name} className="ui-slot">
    <button type="button" onClick={()=>{onFrame(slot.frame);setSlotName(slot.name);setSlotFrame(slot.frame);}}><Artwork doc={doc} frame={slot.frame}/><span>{slot.name}<small>Frame {slot.frame+1}</small></span></button>
    <button type="button" className="ui-remove" aria-label={`Remove ${slot.name}`} disabled={busy} onClick={()=>void writeUi({slots:(doc.ui?.slots??[]).filter(item=>item.name!==slot.name)})}>×</button>
   </div>)}</div>
   {doc.ui?.kind==='button'&&!!doc.ui.slots?.length&&<StatePreview doc={doc} slice={doc.ui.slice??slice}/>}
  </details>
  <details className="inspector-section ui-section"><summary data-guide="ui-text">Pixel text</summary>
   <p className="ui-note">Tiny Caps is a built-in 5×7 pixel font. It accepts basic Latin; lowercase is drawn as capitals and missing ASCII glyphs appear as ?. Painting on the text frame of its layer makes it ordinary pixels.</p>
   <label className="ui-field">Text<textarea aria-label="Pixel text" rows={2} value={text.text} maxLength={100} onChange={e=>setText(t=>({...t,text:e.target.value}))}/></label>
   <div className="ui-field-grid">{(['x','y','scale','spacing'] as const).map(field=><label key={field}>{label(field)}<input aria-label={`Text ${field}`} type="number" min={field==='scale'?1:0} max={field==='scale'||field==='spacing'?8:field==='x'?doc.width-1:doc.height-1} value={text[field]} onChange={e=>setText(t=>({...t,[field]:Number(e.target.value)}))}/></label>)}</div>
   <label className="ui-field">Color<input aria-label="Pixel text color" value={text.color} maxLength={9} onChange={e=>setText(t=>({...t,color:e.target.value}))}/></label>
   <button className="text-button" type="button" onClick={()=>setText(t=>({...t,color:ink}))}>Use current drawing color</button>
   {!fits&&<p className="ui-note ui-warning">Text extends outside the canvas or has invalid settings.</p>}
   <button className="secondary full" type="button" disabled={busy||!text.text||!fits||(!storedText&&doc.layers.length>=8)} onClick={()=>void saveText()}>{storedText?'Update selected text':'Add text layer'}</button>
  </details>
  <details className="inspector-section ui-section"><summary data-guide="ui-kit-colors">Kit &amp; shared colors</summary>
   <p className="ui-note">Give related projects the same kit ID. A color replacement then applies across all their layers and frames.</p>
   <label className="ui-field">Kit ID<input aria-label="UI kit ID" value={kitDraft} maxLength={80} placeholder="my-ui-kit" onChange={e=>setKitDraft(e.target.value)}/></label>
   <label className="ui-field">Asset key<input aria-label="UI asset key" value={assetDraft} maxLength={80} placeholder="optional-name" onChange={e=>setAssetDraft(e.target.value)}/></label>
   <button className="secondary full" type="button" disabled={busy} onClick={()=>{
    const next={...doc.ui};if(kitDraft.trim())next.kitId=kitDraft.trim();else delete next.kitId;
    if(assetDraft.trim())next.assetKey=assetDraft.trim();else delete next.assetKey;
    void onCommit([{op:'ui_set',ui:next}]);
   }}>Save kit assignment</button>
   <button className="secondary full" type="button" disabled={busy||inspecting||!doc.ui?.kitId} onClick={()=>void inspect()}>{inspecting?'Loading palette…':'View shared kit palette'}</button>
   {kitPalette&&<><p className="ui-note">Colors from {kitPalette.count} project{kitPalette.count===1?'':'s'}. Choose one to replace.</p>
    <div className="ui-shared-palette">{kitPalette.colors.map(color=><button type="button" key={color} title={color} aria-label={`Pick shared color ${color}`} style={{backgroundColor:color}} onClick={()=>setFromColor(color)}/>)}</div></>}
   <div className="ui-preview-fields"><label>Replace<input aria-label="Color to replace" value={fromColor} maxLength={7} onChange={e=>setFromColor(e.target.value)}/></label>
    <label>With<input aria-label="Replacement color" value={toColor} maxLength={7} onChange={e=>setToColor(e.target.value)}/></label></div>
   <button className="secondary full" type="button" disabled={busy||!doc.ui?.kitId||!/^#[0-9a-f]{6}$/i.test(fromColor)||!/^#[0-9a-f]{6}$/i.test(toColor)||fromColor.toLowerCase()===toColor.toLowerCase()} onClick={()=>void onRemap(fromColor,toColor,doc.ui!.kitId!).then(()=>inspect())}>Replace color in this kit</button>
   <p className="ui-note">This is an explicit edit. Undo is available in each affected project.</p>
   <button className="secondary full" type="button" disabled={busy||!doc.ui?.kitId} onClick={()=>void onExportKit()}>Export this kit</button>
   <button className="secondary full" type="button" disabled={busy||!doc.ui?.kitId} onClick={()=>void onPreviewKit()}>Preview kit in Stardrop</button>
  </details>
 </div>;
}
