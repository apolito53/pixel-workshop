'use client';
import {useEffect,useMemo,useRef,useState,type CSSProperties,type PointerEvent,type SetStateAction} from 'react';
import {composite,frameCount,frameView,type PaintCommand,type PixelDocument} from '../lib/pixels.ts';
import {nineSliceContentBounds,stretchNineSlice,validatePixelText,validateSlice,type PixelTextRecipe,type UiMetadata,type UiSlice} from '../lib/ui-metadata.ts';
import {renderPixelText,textDimensions} from '../lib/pixel-font.ts';
import {hasUiDraft,type UiDraft} from '../lib/ui-drafts.ts';
import type {UiSection} from '../lib/ui-return.ts';
import type {ColorImpact,KitColorReview,KitOverview,KitUndo} from '../lib/kit-review.ts';

type Props={doc:PixelDocument;frame:number;layer:string;ink:string;busy:boolean;
 onCommit:(commands:PaintCommand[])=>Promise<boolean>;onSaveDraft:(commands:PaintCommand[])=>Promise<boolean>;onFrame:(frame:number)=>void;onLayer:(layer:string)=>void;
 draft:UiDraft;draftStorageError:boolean;onDraftChange:(change:(old:UiDraft)=>UiDraft)=>void;sections:UiSection[];onSectionToggle:(section:UiSection,open:boolean)=>void;
 onRemap:(review:KitColorReview)=>Promise<boolean>;onInspectKit:(kitId:string)=>Promise<KitOverview>;
 onReviewKit:(from:string,to:string,kitId:string)=>Promise<KitColorReview>;onOpenProject:(id:string)=>Promise<void>;
 kitUndo:KitUndo|null;kitUndoStorageError:boolean;onUndoKit:()=>Promise<void>;
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
function PanelPreview({doc,frame,slice,width,height,showContent}:{doc:PixelDocument;frame:number;slice:UiSlice;width:number;height:number;showContent:boolean}){
 const ref=useRef<HTMLCanvasElement>(null);
 const result=useMemo(()=>{
  try{return {pixels:stretchNineSlice(composite(frameView(doc,frame)),doc.width,doc.height,slice,width,height),bounds:nineSliceContentBounds(doc.width,doc.height,slice,width,height),problem:''};}
  catch(e){return {pixels:null,bounds:null,problem:(e as Error).message};}
 },[doc,frame,slice,width,height]);
 useEffect(()=>{const canvas=ref.current;if(!canvas||!result.pixels)return;canvas.width=width;canvas.height=height;
  canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(result.pixels),width,height),0,0);
 },[result.pixels,width,height]);
 return <div className="ui-preview-box">{!result.problem&&<div className="ui-preview-image" style={{width,maxWidth:'100%',aspectRatio:`${width}/${height}`}}>
  <canvas ref={ref} aria-label="Resizable panel preview"/>
  {showContent&&result.bounds&&<div className="ui-content-overlay" aria-label="Content safe area" style={{left:result.bounds.left/width*100+'%',top:result.bounds.top/height*100+'%',width:result.bounds.width/width*100+'%',height:result.bounds.height/height*100+'%'}}><span>CONTENT</span></div>}
 </div>}{result.problem&&<span className="ui-note ui-warning" role="status">{result.problem}</span>}</div>;
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
 const missing=!(doc.ui?.slots??[]).some(slot=>slot.name.toLowerCase()===interaction);
 return <div className="ui-state-preview"><button ref={button} type="button" className="ui-sample-button" style={style}
  onMouseEnter={()=>setInteraction('hover')} onMouseLeave={()=>setInteraction('rest')}
  onPointerDown={()=>setInteraction('pressed')} onPointerUp={()=>setInteraction('hover')}
  onFocus={()=>setInteraction('hover')} onBlur={()=>setInteraction('rest')}>Try this button</button>
  <div className="ui-state-choices">{(['rest','hover','pressed','disabled'] as const).map(state=><button type="button" key={state}
   aria-pressed={interaction===state} onClick={()=>setInteraction(state)}>{label(state)}</button>)}</div>
  {missing&&<span className="ui-note" role="status">No {interaction} frame is named; showing rest when available.</span>}
 </div>;
}
function TextPreview({doc,layer,recipe,editing}:{doc:PixelDocument;layer:string;recipe:PixelTextRecipe;editing:boolean}){
 const ref=useRef<HTMLCanvasElement>(null);
 const pixels=useMemo(()=>{
  try{
   const valid=validatePixelText(recipe,doc.width,doc.height,frameCount(doc)),size=textDimensions(valid);
   if(valid.x+size.width>doc.width||valid.y+size.height>doc.height)return null;
   const textPixels=renderPixelText(valid,doc.width,doc.height),view=frameView(doc,valid.frame);
   const layers=editing?view.layers.map(item=>item.id===layer?{...item,pixels:textPixels}:item):
    [...view.layers,{id:'preview-text',name:'Preview',visible:true,pixels:textPixels}];
   return composite({...view,layers});
  }catch{return null;}
 },[doc,layer,recipe,editing]);
 useEffect(()=>{const canvas=ref.current;if(!canvas||!pixels)return;canvas.width=doc.width;canvas.height=doc.height;
  canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(pixels),doc.width,doc.height),0,0);
 },[pixels,doc.width,doc.height]);
 return pixels?<div className="ui-text-preview"><span>TEXT PREVIEW · NOT APPLIED</span><canvas ref={ref} aria-label="Pixel text preview"/></div>:null;
}
function ColorSample({impact}:{impact:ColorImpact}){
 const before=useRef<HTMLCanvasElement>(null),after=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{for(const [canvas,pixels] of [[before.current,impact.before],[after.current,impact.after]] as const){
  if(!canvas)continue;canvas.width=impact.width;canvas.height=impact.height;
  canvas.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(pixels),impact.width,impact.height),0,0);
 }},[impact]);
 return <div className="ui-color-impact"><div><b>{impact.name}</b><small>{impact.pixels} matching pixel{impact.pixels===1?'':'s'}{impact.metadata?' · palette or recipe':''}</small></div>
  <div className="ui-color-samples"><span>Before<canvas ref={before} aria-label={`${impact.name} before recolor`}/></span><span>After<canvas ref={after} aria-label={`${impact.name} after recolor`}/></span></div></div>;
}
export default function UiKitPanel({doc,frame,layer,ink,busy,onCommit,onSaveDraft,onFrame,onLayer,draft,draftStorageError,onDraftChange,sections,onSectionToggle,onRemap,onInspectKit,onReviewKit,onOpenProject,kitUndo,kitUndoStorageError,onUndoKit,onExportKit,onPreviewKit}:Props){
 const sliceBase=JSON.stringify(doc.ui?.slice??null),slice=draft.slice?.value??initialSlice(doc);
 const setSlice=(next:SetStateAction<UiSlice>)=>onDraftChange(old=>{
  const value=old.slice?.value??initialSlice(doc),updated=typeof next==='function'?next(value):next,result={...old};
  if(JSON.stringify(updated)===JSON.stringify(initialSlice(doc)))delete result.slice;
  else result.slice={base:old.slice?.base??sliceBase,value:updated};
  return result;
 });
 const [previewWidth,setPreviewWidth]=useState(144),[previewHeight,setPreviewHeight]=useState(64),[showContent,setShowContent]=useState(true);
 const [slotView,setSlotView]=useState({name:'rest',source:frame,value:frame});
 const slotBase=JSON.stringify(doc.ui?.slots??[]),slotName=draft.slot?.name??slotView.name;
 const slotFrame=draft.slot?.frame??(slotView.source===frame?slotView.value:frame);
 const setSlot=(name:string,value:number)=>{
  setSlotView({name,source:frame,value});
  onDraftChange(old=>{
   const match=doc.ui?.slots?.find(item=>item.name.toLowerCase()===name.trim().toLowerCase());
   const result={...old};if(match&&match.frame===value)delete result.slot;
   else result.slot={base:old.slot?.base??slotBase,name,frame:value};return result;
  });
 };
 const assignmentBase=JSON.stringify([doc.ui?.kitId??'',doc.ui?.assetKey??'']);
 const kitDraft=draft.assignment?.kitId??doc.ui?.kitId??'',assetDraft=draft.assignment?.assetKey??doc.ui?.assetKey??'';
 const setAssignment=(kitId:string,assetKey:string)=>onDraftChange(old=>{
  const result={...old};if(kitId===(doc.ui?.kitId??'')&&assetKey===(doc.ui?.assetKey??''))delete result.assignment;
  else result.assignment={base:old.assignment?.base??assignmentBase,kitId,assetKey};return result;
 });
 const [fromColor,setFromColor]=useState('#f7b95e'),[toColor,setToColor]=useState('#d194cf');
 const [paletteState,setPaletteState]=useState<(KitOverview&{kitId:string})|null>(null),[inspecting,setInspecting]=useState(false);
 const [colorReview,setColorReview]=useState<KitColorReview|null>(null),[reviewing,setReviewing]=useState(false);
 const kitPalette=paletteState?.kitId===doc.ui?.kitId?paletteState:null;
 const selected=doc.layers.find(item=>item.id===layer),storedText=selected?.text;
 const textKey=layer+'@'+(storedText?.frame??frame),textBase=JSON.stringify(storedText??null);
 const initialText=():PixelTextRecipe=>storedText??{text:doc.width>=49?'STARDROP':doc.width>=13?'OK':doc.width>=6?'I':'',x:Math.min(1,doc.width-1),y:Math.min(1,doc.height-1),scale:1,spacing:1,color:ink,frame};
 const text=draft.text?.[textKey]?.value??initialText();
 const setText=(next:SetStateAction<PixelTextRecipe>)=>onDraftChange(old=>{
  const value=old.text?.[textKey]?.value??initialText(),updated=typeof next==='function'?next(value):next;
  const texts={...old.text},result={...old};
  if(JSON.stringify(updated)===JSON.stringify(initialText()))delete texts[textKey];
  else texts[textKey]={base:old.text?.[textKey]?.base??textBase,value:updated};
  if(Object.keys(texts).length)result.text=texts;else delete result.text;return result;
 });
 const [problem,setProblem]=useState(''),[savingDraft,setSavingDraft]=useState(false);
 const saveDraft=async(ops:PaintCommand[])=>{setSavingDraft(true);try{return await onSaveDraft(ops);}finally{setSavingDraft(false);}};
 const clearField=(field:'slice'|'slot'|'assignment',expected:unknown)=>onDraftChange(old=>{
  if(JSON.stringify(old[field])!==JSON.stringify(expected))return old;const next={...old};delete next[field];return next;
 });
 const clearText=(key:string,expected:unknown)=>onDraftChange(old=>{
  if(JSON.stringify(old.text?.[key])!==JSON.stringify(expected))return old;const next={...old},texts={...old.text};
  delete texts[key];if(Object.keys(texts).length)next.text=texts;else delete next.text;return next;
 });
 const sliceChanged=!!draft.slice&&draft.slice.base!==sliceBase,slotChanged=!!draft.slot&&draft.slot.base!==slotBase;
 const assignmentChanged=!!draft.assignment&&draft.assignment.base!==assignmentBase,textChanged=!!draft.text?.[textKey]&&draft.text[textKey].base!==textBase;
 const guideArea=useRef<HTMLDivElement>(null),drag=useRef<typeof fields[number]|null>(null);
 const inspect=async()=>{if(!doc.ui?.kitId)return;setInspecting(true);try{setPaletteState({kitId:doc.ui.kitId,...await onInspectKit(doc.ui.kitId)});setProblem('');}catch(e){setProblem((e as Error).message);}finally{setInspecting(false);}};
 const review=async()=>{if(!doc.ui?.kitId)return;setReviewing(true);try{setColorReview(await onReviewKit(fromColor,toColor,doc.ui.kitId));setProblem('');}catch(e){setProblem((e as Error).message);setColorReview(null);}finally{setReviewing(false);}};
 const currentReview=colorReview&&colorReview.kitId===doc.ui?.kitId&&colorReview.from===fromColor.toLowerCase()&&colorReview.to===toColor.toLowerCase()?colorReview:null;
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
 const saveSlice=async()=>{try{const valid=validateSlice(slice,doc.width,doc.height),expected=draft.slice;setProblem('');
  if(await saveDraft([{op:'ui_set',ui:{...doc.ui,kind:doc.ui?.kind??'panel',slice:valid}}]))clearField('slice',expected);
 }catch(e){setProblem((e as Error).message);}};
 const saveSlot=async()=>{
  const name=slotName.trim();const slots=[...(doc.ui?.slots??[])].filter(s=>s.name.toLowerCase()!==name.toLowerCase());
  slots.push({name,frame:slotFrame});try{const expected=draft.slot;setProblem('');
   if(await saveDraft([{op:'ui_set',ui:{...doc.ui,kind:doc.ui?.kind??'button',slots}}]))clearField('slot',expected);
  }catch(e){setProblem((e as Error).message);}
 };
 const saveText=async()=>{
  try{
   const recipe=validatePixelText({...text,frame:storedText?.frame??frame},doc.width,doc.height,frameCount(doc));
   const id=storedText?layer:'text-'+crypto.randomUUID().slice(0,12);
   if(!storedText&&doc.layers.length>=8)throw new Error('Free a layer before adding editable text.');
   const ops:PaintCommand[]=storedText?[]:[{op:'add_layer',id,name:'Pixel text'}];
   ops.push({op:'text_set',layer:id,text:recipe});
   const expected=draft.text?.[textKey];
   if(await saveDraft(ops)){clearText(textKey,expected);onLayer(id);}setProblem('');
  }catch(e){setProblem((e as Error).message);}
 };
 const fits=(()=>{try{const size=textDimensions(validatePixelText(text,doc.width,doc.height,frameCount(doc)));return text.x+size.width<=doc.width&&text.y+size.height<=doc.height;}catch{return false;}})();
 return <div className="ui-kit-workbench">
  <section className="inspector-section"><div className="section-heading" data-guide="ui-workbench"><span>UI KIT WORKBENCH</span></div>
   <p className="ui-note">Make reusable panels, buttons, icons and lettering. Save your guides and names with the project.</p>
   {hasUiDraft(draft)&&<div className="ui-draft-banner" role="status"><span>UI drafts are not applied to this project yet. {draftStorageError?'Browser storage is unavailable; save or discard them before leaving this page.':'They stay on this device until you save or discard them. Use one tab per project.'}</span>
    <button type="button" disabled={savingDraft} onClick={()=>onDraftChange(()=>({}))}>Discard all UI drafts</button></div>}
   {problem&&<p className="ui-warning" role="alert">{problem}</p>}
  </section>
  <details className="inspector-section ui-section" open={sections.includes('panel')} onToggle={e=>onSectionToggle('panel',e.currentTarget.open)}>
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
   {sliceChanged&&<p className="ui-warning">Saved guides changed since this draft began. Saving will replace the newer guides.</p>}
   {draft.slice&&<button type="button" className="ui-discard" disabled={savingDraft} onClick={()=>clearField('slice',draft.slice)}>Discard panel guide draft</button>}
   <button type="button" className="secondary full" disabled={busy||savingDraft} onClick={()=>void saveSlice()}>{sliceChanged?'Replace newer panel guides':'Save panel guides'}</button>
   <div className="ui-preview-fields"><label>Width<input type="number" aria-label="Panel preview width" min={1} max={1024} value={previewWidth} onChange={e=>setPreviewWidth(Number(e.target.value))}/></label>
    <label>Height<input type="number" aria-label="Panel preview height" min={1} max={1024} value={previewHeight} onChange={e=>setPreviewHeight(Number(e.target.value))}/></label></div>
   <label className="ui-preview-toggle"><input type="checkbox" checked={showContent} onChange={e=>setShowContent(e.target.checked)}/> Show content area</label>
   <PanelPreview doc={doc} frame={frame} slice={slice} width={previewWidth} height={previewHeight} showContent={showContent}/>
  </details>
  <details className="inspector-section ui-section" open={sections.includes('states')} onToggle={e=>onSectionToggle('states',e.currentTarget.open)}><summary data-guide="ui-state-names">Button states &amp; icons</summary>
   <p className="ui-note">Name frames so they export as button states or individual icons.</p>
   <label className="ui-field">Asset type<select aria-label="UI asset type" value={doc.ui?.kind??'other'} disabled={busy||savingDraft}
    onChange={e=>void writeUi({kind:e.target.value as UiMetadata['kind']})}>
    <option value="other">Other artwork</option><option value="panel">Panel</option><option value="button">Button</option><option value="icons">Icon set</option>
   </select></label>
   <label className="ui-field">Name<input aria-label="UI entry name" value={slotName} maxLength={32} onChange={e=>setSlot(e.target.value,slotFrame)}/></label>
   <label className="ui-field">Frame<select aria-label="UI entry frame" value={slotFrame} onChange={e=>setSlot(slotName,Number(e.target.value))}>
    {Array.from({length:frameCount(doc)},(_,i)=><option key={i} value={i}>Frame {i+1}</option>)}
   </select></label>
   {slotChanged&&<p className="ui-warning">Named frames changed since this draft began. Saving replaces the matching name in the current set.</p>}
   {draft.slot&&<button type="button" className="ui-discard" disabled={savingDraft} onClick={()=>clearField('slot',draft.slot)}>Discard named-frame draft</button>}
   <button className="secondary full" type="button" disabled={busy||savingDraft||!slotName.trim()} onClick={()=>void saveSlot()}>Save named frame</button>
   <div className={'ui-slots '+(doc.ui?.kind==='icons'?'ui-icon-grid':'')}>{(doc.ui?.slots??[]).map(slot=><div key={slot.name} className="ui-slot">
    <button type="button" onClick={()=>{if(draft.slot){setProblem('Save or discard the named-frame draft before selecting another entry.');return;}
     setProblem('');setSlotView({name:slot.name,source:slot.frame,value:slot.frame});onFrame(slot.frame);}}><Artwork doc={doc} frame={slot.frame}/><span>{slot.name}<small>Frame {slot.frame+1}</small></span></button>
    <button type="button" className="ui-remove" aria-label={`Remove ${slot.name}`} disabled={busy||savingDraft} onClick={()=>void writeUi({slots:(doc.ui?.slots??[]).filter(item=>item.name!==slot.name)})}>×</button>
   </div>)}</div>
   {doc.ui?.kind==='button'&&!!doc.ui.slots?.length&&<StatePreview doc={doc} slice={doc.ui.slice??slice}/>}
  </details>
  <details className="inspector-section ui-section" open={sections.includes('text')} onToggle={e=>onSectionToggle('text',e.currentTarget.open)}><summary data-guide="ui-text">Pixel text</summary>
   <p className="ui-note">Tiny Caps is a built-in 5×7 pixel font. It accepts basic Latin; lowercase is drawn as capitals and missing ASCII glyphs appear as ?. Painting on the text frame of its layer makes it ordinary pixels.</p>
   <label className="ui-field">Text<textarea aria-label="Pixel text" rows={2} value={text.text} maxLength={100} onChange={e=>setText(t=>({...t,text:e.target.value}))}/></label>
   <div className="ui-field-grid">{(['x','y','scale','spacing'] as const).map(field=><label key={field}>{label(field)}<input aria-label={`Text ${field}`} type="number" min={field==='scale'?1:0} max={field==='scale'||field==='spacing'?8:field==='x'?doc.width-1:doc.height-1} value={text[field]} onChange={e=>setText(t=>({...t,[field]:Number(e.target.value)}))}/></label>)}</div>
   <label className="ui-field">Color<input aria-label="Pixel text color" value={text.color} maxLength={9} onChange={e=>setText(t=>({...t,color:e.target.value}))}/></label>
   <button className="text-button" type="button" onClick={()=>setText(t=>({...t,color:ink}))}>Use current drawing color</button>
   <TextPreview doc={doc} layer={layer} recipe={text} editing={!!storedText}/>
   {!fits&&<p className="ui-note ui-warning">Text extends outside the canvas or has invalid settings.</p>}
   {!storedText&&doc.layers.length>=8&&<p className="ui-note ui-warning">Free a layer before adding text.</p>}
   {textChanged&&<p className="ui-warning">This layer changed since the text draft began. Discard the draft to keep the newer artwork.</p>}
   {draft.text?.[textKey]&&<button type="button" className="ui-discard" disabled={savingDraft} onClick={()=>clearText(textKey,draft.text?.[textKey])}>Discard text draft</button>}
   <button className="secondary full" type="button" disabled={busy||savingDraft||textChanged||!text.text||!fits||(!storedText&&doc.layers.length>=8)} onClick={()=>void saveText()}>{storedText?'Update selected text':'Add text layer'}</button>
  </details>
  <details className="inspector-section ui-section" open={sections.includes('kit')} onToggle={e=>onSectionToggle('kit',e.currentTarget.open)}><summary data-guide="ui-kit-colors">Kit &amp; shared colors</summary>
   <p className="ui-note">Give related projects the same kit ID. A color replacement then applies across all their layers and frames.</p>
   <label className="ui-field">Kit ID<input aria-label="UI kit ID" value={kitDraft} maxLength={80} placeholder="my-ui-kit" onChange={e=>setAssignment(e.target.value,assetDraft)}/></label>
   <label className="ui-field">Asset key<input aria-label="UI asset key" value={assetDraft} maxLength={80} placeholder="optional-name" onChange={e=>setAssignment(kitDraft,e.target.value)}/></label>
   {assignmentChanged&&<p className="ui-warning">The saved kit assignment changed since this draft began. Saving replaces that assignment.</p>}
   {draft.assignment&&<button type="button" className="ui-discard" disabled={savingDraft} onClick={()=>clearField('assignment',draft.assignment)}>Discard kit assignment draft</button>}
   <button className="secondary full" type="button" disabled={busy||savingDraft} onClick={()=>{
    const next={...doc.ui};if(kitDraft.trim())next.kitId=kitDraft.trim();else delete next.kitId;
    if(assetDraft.trim())next.assetKey=assetDraft.trim();else delete next.assetKey;
    const expected=draft.assignment;void saveDraft([{op:'ui_set',ui:next}]).then(ok=>{if(ok)clearField('assignment',expected);});
   }}>Save kit assignment</button>
   <button className="secondary full" type="button" disabled={busy||inspecting||!doc.ui?.kitId} onClick={()=>void inspect()}>{inspecting?'Loading kit…':'View kit projects & palette'}</button>
   {kitPalette&&<><p className="ui-note">Colors from {kitPalette.count} project{kitPalette.count===1?'':'s'}. Choose one to replace.</p>
    <div className="ui-shared-palette">{kitPalette.colors.map(color=><button type="button" key={color} title={color} aria-label={`Pick shared color ${color}`} style={{backgroundColor:color}} onClick={()=>setFromColor(color)}/>)}</div>
    <div className="ui-kit-members" aria-label="Projects in this kit">{kitPalette.members.map(member=>{
     const duplicate=member.assetKey&&kitPalette.members.filter(other=>other.assetKey?.toLowerCase()===member.assetKey?.toLowerCase()).length>1;
     return <button type="button" key={member.id} disabled={busy} onClick={()=>void onOpenProject(member.id)}><span>{member.name}</span><small>{member.assetKey??'No asset key'}{duplicate?' · duplicate':''} · {member.frames} frame{member.frames===1?'':'s'}</small></button>;
    })}</div></>}
   <div className="ui-preview-fields"><label>Replace<input aria-label="Color to replace" value={fromColor} maxLength={7} onChange={e=>setFromColor(e.target.value)}/></label>
    <label>With<input aria-label="Replacement color" value={toColor} maxLength={7} onChange={e=>setToColor(e.target.value)}/></label></div>
   <button className="secondary full" type="button" disabled={busy||reviewing||!doc.ui?.kitId||!/^#[0-9a-f]{6}$/i.test(fromColor)||!/^#[0-9a-f]{6}$/i.test(toColor)||fromColor.toLowerCase()===toColor.toLowerCase()} onClick={()=>void review()}>{reviewing?'Reviewing…':'Review color change'}</button>
   {currentReview&&<div className="ui-color-review"><p className="ui-note">{currentReview.impacts.length?`${currentReview.impacts.length} project${currentReview.impacts.length===1?'':'s'} will change. Samples show frame 1; counts include every frame and layer.`:'No projects use this color.'}</p>
    <div className="ui-color-impact-list">{currentReview.impacts.map(impact=><ColorSample key={impact.id} impact={impact}/>)}</div>
    <button className="secondary full" type="button" disabled={busy||!currentReview.impacts.length} onClick={()=>void onRemap(currentReview).then(ok=>{setColorReview(null);if(ok)void inspect();})}>Apply color change</button>
   </div>}
   {kitUndo&&<><button className="secondary full" type="button" disabled={busy} onClick={()=>void onUndoKit().then(()=>inspect())}>Undo last kit recolor</button>
    <p className="ui-note">Undo restores {kitUndo.entries.length} project{kitUndo.entries.length===1?'':'s'} if none has changed since the recolor.{kitUndoStorageError?' Undo is available until this page closes.':''}</p></>}
   <p className="ui-note">Save or discard kit drafts before recoloring, exporting or previewing. A failed batch reports any partial changes.</p>
   <button className="secondary full" type="button" disabled={busy||!doc.ui?.kitId} onClick={()=>void onExportKit()}>Export this kit</button>
   <button className="secondary full" type="button" disabled={busy||!doc.ui?.kitId} onClick={()=>void onPreviewKit()}>Preview kit in Stardrop</button>
  </details>
 </div>;
}
