'use client';

import {Check} from 'lucide-react';
import {normalizeInk,withRgb} from '../lib/color-workflow.ts';
import {QUICK_COLOR_GROUPS} from '../lib/quick-colors.ts';

/** Fixed swatches are shared by the Draw inspector and canvas toolbar popover.
 * They behave like the native RGB picker: switching hue preserves brush opacity.
 */
export default function QuickColorGrid({ink,onPick}:{ink:string;onPick:(hex:string)=>void}){
 const active=normalizeInk(ink);
 return <div className="quick-color-groups">
  {QUICK_COLOR_GROUPS.map(group=><div className="quick-color-group" key={group.id}>
   <div className="quick-color-group-heading">{group.label}</div>
   <div className="quick-color-grid" role="group" aria-label={group.label+' quick colors'}>
    {group.colors.map(color=>{
     const selected=active===color.hex;
     return <button type="button" key={color.hex}
      className={'workbench-color-swatch quick-color-swatch'+(selected?' is-active':'')}
      aria-label={color.name+' quick color '+color.hex}
      aria-pressed={selected} title={color.name+' · '+color.hex}
      onClick={()=>onPick(withRgb(ink,color.hex))}>
      <span className="workbench-color-fill" style={{backgroundColor:color.hex}} aria-hidden="true"/>
      {selected&&<Check className="workbench-swatch-check" size={14} strokeWidth={3} aria-hidden="true"/>}
     </button>;
    })}
   </div>
  </div>)}
 </div>;
}
