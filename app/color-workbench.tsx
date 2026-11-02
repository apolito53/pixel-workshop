'use client';

import {useMemo} from 'react';
import {Check,Plus,Trash2} from 'lucide-react';
import {DEFAULT_PALETTE,type PixelDocument} from '../lib/pixels.ts';
import {artworkColors,isHexInk,normalizeInk,opacityPercent,rgbHex,suggestColors,withRgb} from '../lib/color-workflow.ts';

type Props={
 doc:PixelDocument|null;frame:number;ink:string;hexDraft:string;
 recent:readonly string[];busy:boolean;
 onPick:(hex:string)=>void;onDraft:(hex:string)=>void;onCommitHex:()=>void;
 onOpacity:(opacity:number)=>void;onSave:()=>void;onRemove:(hex:string)=>void;
 onRemoveStarters:()=>void;
};
function Swatch({hex,selected,onPick,label}:{
 hex:string;selected:boolean;onPick:(hex:string)=>void;label:string;
}){
 return <button type="button" className={'workbench-color-swatch'+(selected?' is-active':'')}
  aria-label={label+' '+hex} aria-pressed={selected} title={label+' · '+hex}
  onClick={()=>onPick(hex)}>
  <span className="workbench-color-fill" style={{backgroundColor:hex}}/>
  {selected&&<Check className="workbench-swatch-check" size={14} strokeWidth={3}/>}
 </button>;
}
export default function ColorWorkbench({
 doc,frame,ink,hexDraft,recent,busy,onPick,onDraft,onCommitHex,onOpacity,onSave,onRemove,onRemoveStarters,
}:Props){
 const used=useMemo(()=>doc?artworkColors(doc,frame):[],[doc,frame]);
 const suggested=useMemo(()=>suggestColors(ink,used),[ink,used]);
 const saved=doc?.palette??[];
 const selectedKey=normalizeInk(ink);
 const isSaved=saved.some(c=>normalizeInk(c)===selectedKey);
 const hasLegacyStarters=saved.length>=DEFAULT_PALETTE.length&&
  DEFAULT_PALETTE.every((c,i)=>normalizeInk(saved[i])===normalizeInk(c));
 return <section className="inspector-section color-workbench" aria-label="Color workbench">
  <div className="section-heading"><span>CURRENT COLOR</span><span className="muted">PICK ANY COLOR</span></div>
  <div className="color-controls" data-guide="palette">
   <label className="color-picker workbench-native-picker" title="Open your device's color picker">
    <span aria-hidden="true" style={{backgroundColor:ink}}/>
    <input type="color" aria-label="Pick current drawing color" value={rgbHex(ink)}
     onChange={e=>onPick(withRgb(ink,e.target.value))}/>
   </label>
   <input className="hex-input" aria-label="Hex drawing color, optionally including alpha"
    value={hexDraft} maxLength={9} spellCheck={false} autoCapitalize="off"
    onChange={e=>onDraft(e.target.value)} onBlur={onCommitHex}
    onKeyDown={e=>{if(e.key==='Enter'){e.currentTarget.blur();}}}
    aria-invalid={hexDraft.length>0&&!isHexInk(hexDraft)}/>
  </div>
  <p className="workbench-hint">Click the color square for your device's picker, or enter <code>#RRGGBB</code> or <code>#RRGGBBAA</code>.</p>
  <label className="workbench-opacity">
   <span>Opacity</span><input type="range" aria-label="Current color opacity" min={0} max={100} step={1}
    value={opacityPercent(ink)} onChange={e=>onOpacity(Number(e.target.value))}/>
   <span className="workbench-opacity-value">{opacityPercent(ink)}%</span>
  </label>

  {recent.length>0&&<div className="workbench-group">
   <div className="workbench-heading"><b>RECENTLY PICKED</b><small>This session only</small></div>
   <div className="workbench-swatch-grid">{recent.map(c=><Swatch key={c} hex={c}
    selected={normalizeInk(c)===selectedKey} onPick={onPick} label="Recently picked color"/>)}</div>
  </div>}

  <div className="workbench-group" data-guide="color-ideas">
   <div className="workbench-heading"><b>IN YOUR ARTWORK</b><small>Visible frame colors</small></div>
   {used.length?<div className="workbench-swatch-grid">{used.map(c=><Swatch key={c.hex} hex={c.hex}
    selected={normalizeInk(c.hex)===selectedKey} onPick={onPick}
    label={'Used on '+c.pixelCount+' pixels'}/>)}</div>
    :<p className="workbench-empty">No painted colors yet. They'll appear here as you draw.</p>}

   <div className="workbench-heading workbench-suggestion-heading"><b>SUGGESTED COMPANIONS</b><small>Not saved</small></div>
   <p className="workbench-hint">Color relationships from your current selection and the most-used visible color. They update with your artwork, never at random.</p>
   <div className="workbench-suggestion-grid">{suggested.map(c=><button type="button"
     key={c.label+'-'+c.hex} className={'workbench-idea'+(normalizeInk(c.hex)===selectedKey?' is-active':'')}
     aria-label={'Try '+c.label.toLowerCase()+' color '+c.hex+' based on '+c.source}
     title={c.source+' · '+c.hex} onClick={()=>onPick(c.hex)}>
      <span className="workbench-idea-swatch" style={{backgroundColor:c.hex}} aria-hidden="true"/>
      <span>{c.label}</span>
     </button>)}</div>
  </div>

  <div className="workbench-group workbench-saved-group">
   <div className="workbench-heading"><b>SAVED PROJECT COLORS</b><small>{saved.length} / 128</small></div>
   <p className="workbench-hint">Only colors you save here travel with the editable project. Suggestions and recent colors won't alter it.</p>
   <div className="workbench-save-actions">
    <button type="button" className="secondary workbench-save" onClick={onSave}
     disabled={busy||!doc||!isHexInk(ink)||isSaved||saved.length>=128}>
     <Plus size={14}/> Save current color
    </button>
    {isSaved&&<button type="button" className="workbench-remove-current" disabled={busy}
     aria-label="Remove current color from saved project colors" title="Remove saved swatch; pixels remain unchanged"
     onClick={()=>onRemove(ink)}><Trash2 size={14}/></button>}
   </div>
   {saved.length?<div className="workbench-swatch-grid workbench-saved-swatches">{saved.map((c,i)=>
    <Swatch key={c+'-'+i} hex={c} selected={normalizeInk(c)===selectedKey}
     onPick={onPick} label="Saved project color"/>)}</div>
   :<p className="workbench-empty">Nothing saved yet. Start with any color and save your favorites here.</p>}
   {hasLegacyStarters&&<div className="workbench-legacy">
    <p>This older project includes the original 24 starter swatches. They're not recommendations.</p>
    <button type="button" disabled={busy} onClick={onRemoveStarters}>Remove original starter swatches</button>
   </div>}
  </div>
 </section>;
}
