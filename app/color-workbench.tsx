'use client';

import {useEffect,useId,useRef,useState} from 'react';
import {Check,ChevronDown,Palette,Plus,X} from 'lucide-react';
import {
 normalizeColor,opacityPercent,splitSavedPalette,withOpacity,withRgb,
 type ColorContext,
} from '../lib/color-workbench.ts';
import './color-workbench.css';

type Props={
 ink:string;
 onColor:(hex:string)=>void;
 onChoose:(hex:string)=>void;
 recent:string[];
 palette:string[];
 context:ColorContext;
 onSave:()=>void;
 onRemove:(hex:string)=>void;
 disabled?:boolean;
};

function Swatches({title,description,colors,ink,onChoose}:{
 title:string;description?:string;colors:{hex:string;reason:string}[];ink:string;onChoose:(c:string)=>void;
}){
 if(!colors.length)return null;
 return <div className="pw-color-group">
  <div className="pw-color-group-header"><b>{title}</b><small>{description}</small></div>
  <div className="pw-color-swatches" role="group" aria-label={title}>
   {colors.map(({hex,reason})=><button type="button" key={hex} className={'pw-color-swatch '+(normalizeColor(ink)===normalizeColor(hex)?'selected':'')}
    aria-label={reason+' '+hex} title={reason+' · '+hex} aria-pressed={normalizeColor(ink)===normalizeColor(hex)}
    onClick={()=>onChoose(hex)}><span className="pw-color-swatch-fill" style={{background:hex}}/>
    {normalizeColor(ink)===normalizeColor(hex)&&<Check size={11} className="pw-color-swatch-check"/>}
   </button>)}
  </div>
 </div>;
}
function ColorEditor({ink,onColor,onChoose,disabled=false}:Pick<Props,'ink'|'onColor'|'onChoose'|'disabled'>){
 const id=useId(),hexId=id+'-hex',alphaId=id+'-alpha';
 const [draft,setDraft]=useState(ink);
 useEffect(()=>setDraft(ink),[ink]);
 const valid=normalizeColor(draft);
 const applyHex=()=>{
  if(valid)onChoose(valid);
  else setDraft(ink);
 };
 const opaque=normalizeColor(ink)??'#f6da92';
 return <div className="pw-color-editor">
  <div className="pw-color-current-row">
   <label className="pw-color-native-label" title="Choose any RGB color">
    <span className="pw-color-checker"><span style={{background:opaque}}/></span>
    <span className="pw-color-pick-label">Choose color</span>
    <input type="color" aria-label="Choose any RGB color" disabled={disabled}
     value={opaque.slice(0,7)} onChange={e=>onColor(withRgb(opaque,e.target.value))}
     onBlur={()=>onChoose(opaque.slice(0,7)+(opaque.length===9?opaque.slice(7):''))}/>
   </label>
   <div className="pw-color-hex-wrap">
    <label htmlFor={hexId} className="pw-color-field-title">Hex / RGBA</label>
    <input id={hexId} className={'pw-color-hex '+(!valid?'invalid':'')}
     aria-label="Selected color hex or RGBA" autoComplete="off" spellCheck={false} disabled={disabled}
     value={draft} maxLength={9} onChange={e=>setDraft(e.target.value)}
     onBlur={applyHex} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();applyHex();e.currentTarget.blur();}}}/>
   </div>
  </div>
  <div className="pw-color-alpha-row">
   <label htmlFor={alphaId}>Opacity</label>
   <input id={alphaId} aria-label="Color opacity" type="range" min="0" max="100" step="1"
    disabled={disabled} value={opacityPercent(ink)} onChange={e=>onColor(withOpacity(ink,Number(e.target.value)))}
    onPointerUp={()=>onChoose(ink)} onKeyUp={()=>onChoose(ink)}/>
   <output>{opacityPercent(ink)}%</output>
  </div>
  <p className="pw-color-note">Changing your color never repaints existing pixels. Select a color, then draw.</p>
 </div>;
}
function ColorGroups({ink,onChoose,recent,palette,context,onSave,onRemove,disabled=false}:Omit<Props,'onColor'>){
 const {saved,legacy}=splitSavedPalette(palette);
 const used=context.used.map(({hex,pixels})=>({hex,reason:pixels+' visible pixel'+(pixels===1?'':'s')}));
 const recentOptions=recent.map((hex,i)=>({hex,reason:'Recently used '+(i+1)}));
 const currentSaved=saved.some(c=>normalizeColor(c)===normalizeColor(ink));
 return <div className="pw-color-groups">
  <Swatches title="From this artwork" description="Most-used colors in the selected frame" colors={used} ink={ink} onChoose={onChoose}/>
  <Swatches title="Recently chosen" description="Your recent color choices" colors={recentOptions} ink={ink} onChoose={onChoose}/>
  <Swatches title="Suggested colors" description={context.source==='artwork'?'Shades and harmonies based on your drawing':'Shades and harmonies based on Current Color'}
   colors={context.suggested.map(c=>c)} ink={ink} onChoose={onChoose}/>
  <div className="pw-color-group">
   <div className="pw-color-group-header"><b>Saved palette</b><small>Your intentional favorites for this project</small></div>
   {saved.length?<div className="pw-color-saved-grid" role="group" aria-label="Saved colors">
    {saved.map((hex,i)=><div className="pw-color-saved-item" key={i}>
     <button type="button" className={'pw-color-swatch '+(normalizeColor(ink)===normalizeColor(hex)?'selected':'')}
      aria-label={'Use saved color '+hex} title={'Use '+hex} aria-pressed={normalizeColor(ink)===normalizeColor(hex)}
      onClick={()=>onChoose(hex)}><span className="pw-color-swatch-fill" style={{background:hex}}/></button>
     <button type="button" className="pw-color-remove" title={'Remove saved color '+hex}
      aria-label={'Remove saved color '+hex} disabled={disabled} onClick={()=>onRemove(hex)}><X size={12}/></button>
    </div>)}
   </div>:<p className="pw-color-empty">No saved colors yet. Add one you want to keep.</p>}
   <button type="button" className="pw-color-save" disabled={disabled||currentSaved}
    onClick={onSave}><Plus size={14}/>{currentSaved?'Current color saved':'Save current color'}</button>
  </div>
  {legacy.length>0&&<details className="pw-color-legacy">
   <summary><Palette size={14}/>Original starter swatches <small>24 from an older project</small><ChevronDown size={13}/></summary>
   <p>These came with older canvases; they were never chosen for your artwork. New canvases no longer start with them.</p>
   <div className="pw-color-swatches" role="group" aria-label="Original starter colors">
    {legacy.map((hex,i)=><button type="button" key={i} className="pw-color-swatch" title={'Starter color '+hex}
     aria-label={'Use original starter color '+hex} onClick={()=>onChoose(hex)}>
     <span className="pw-color-swatch-fill" style={{background:hex}}/></button>)}
   </div>
  </details>}
 </div>;
}
export function ColorInspector(props:Props){
 return <div className="pw-color-inspector">
  <div className="section-heading"><span>COLOR WORKBENCH</span><Palette size={14}/></div>
  <ColorEditor ink={props.ink} onColor={props.onColor} onChoose={props.onChoose} disabled={props.disabled}/>
  <ColorGroups {...props}/>
 </div>;
}
export default function ColorWorkbench(props:Props){
 const [open,setOpen]=useState(false);
 const root=useRef<HTMLDivElement>(null),toggle=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  if(!open)return;
  const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setOpen(false);};
  const escape=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();setOpen(false);toggle.current?.focus();}
  };
  document.addEventListener('pointerdown',outside);
  window.addEventListener('keydown',escape,true);
  return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('keydown',escape,true);};
 },[open]);
 const selected=normalizeColor(props.ink)??'#f6da92';
 return <div className="pw-color-toolbar" ref={root}>
  <button type="button" ref={toggle} className={'pw-color-trigger'+(open?' is-open':'')}
   aria-label={'Current color '+selected+'. Open color picker'} aria-haspopup="dialog" aria-expanded={open}
   title="Current color · choose any color" onClick={()=>setOpen(o=>!o)}>
   <span className="pw-color-trigger-swatch"><span style={{background:selected}}/></span>
   <span className="pw-color-trigger-copy"><b>Current color</b><small>{selected.toUpperCase()}</small></span>
   <ChevronDown size={15} className="pw-color-trigger-arrow"/>
  </button>
  {open&&<div className="pw-color-popover" role="dialog" aria-modal="false" aria-label="Current color picker and palette">
   <div className="pw-color-popover-header"><b>Choose a color</b><button type="button" onClick={()=>{setOpen(false);toggle.current?.focus();}}
    aria-label="Close color picker"><X size={17}/></button></div>
   <div className="pw-color-popover-body">
    <ColorEditor ink={props.ink} onColor={props.onColor} onChoose={props.onChoose} disabled={props.disabled}/>
    <ColorGroups {...props} onChoose={hex=>{props.onChoose(hex);setOpen(false);toggle.current?.focus();}}/>
   </div>
  </div>}
 </div>;
}
