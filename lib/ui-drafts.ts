import type {PixelTextRecipe,UiSlice} from './ui-metadata.ts';

/** Unapplied workbench inputs, kept separately from the saved project. */
export type UiDraft={
 slice?:{base:string;value:UiSlice};
 slot?:{base:string;name:string;frame:number};
 assignment?:{base:string;kitId:string;assetKey:string};
 text?:Record<string,{base:string;value:PixelTextRecipe}>;
};
export type UiDraftMap=Record<string,UiDraft>;
export function hasUiDraft(draft:UiDraft|undefined):boolean{
 return !!draft&&(!!draft.slice||!!draft.slot||!!draft.assignment||!!Object.keys(draft.text??{}).length);
}
export function setProjectDraft(map:UiDraftMap,id:string,draft:UiDraft):UiDraftMap{
 const next={...map};if(hasUiDraft(draft))next[id]=draft;else delete next[id];return next;
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const bounded=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max;
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const inset=(v:unknown)=>object(v)&&['left','top','right','bottom'].every(key=>finite(v[key]));
/** Treat browser storage as untrusted and ignore malformed entries. Invalid but
 * editable inputs remain drafts: saving performs the stricter document checks. */
export function parseUiDrafts(raw:string|null):UiDraftMap{
 if(!raw||raw.length>300_000)return {};
 try{
  const parsed:unknown=JSON.parse(raw);if(!object(parsed))return {};
  const result:UiDraftMap={};
  for(const [id,value] of Object.entries(parsed).slice(0,100)){
   if(!/^[a-z0-9_-]{1,80}$/i.test(id)||['__proto__','constructor','prototype'].includes(id.toLowerCase())||!object(value))continue;
   const draft:UiDraft={};
   if(object(value.slice)&&bounded(value.slice.base,5000)&&inset(value.slice.value)&&
     (!object(value.slice.value)||value.slice.value.content===undefined||inset(value.slice.value.content)))
    draft.slice={base:value.slice.base,value:value.slice.value as UiSlice};
   if(object(value.slot)&&bounded(value.slot.base,5000)&&bounded(value.slot.name,32)&&finite(value.slot.frame))
    draft.slot={base:value.slot.base,name:value.slot.name,frame:value.slot.frame};
   if(object(value.assignment)&&bounded(value.assignment.base,5000)&&bounded(value.assignment.kitId,80)&&bounded(value.assignment.assetKey,80))
    draft.assignment={base:value.assignment.base,kitId:value.assignment.kitId,assetKey:value.assignment.assetKey};
   if(object(value.text)){
    const texts:NonNullable<UiDraft['text']>={};
    for(const [key,item] of Object.entries(value.text).slice(0,256)){
     if(!/^[a-z0-9_-]{1,64}@[0-9]{1,2}$/i.test(key)||!object(item)||!bounded(item.base,5000)||!object(item.value))continue;
     const t=item.value;
     if(!bounded(t.text,100)||!bounded(t.color,9)||!['x','y','scale','spacing','frame'].every(field=>finite(t[field])))continue;
     texts[key]={base:item.base,value:t as PixelTextRecipe};
    }
    if(Object.keys(texts).length)draft.text=texts;
   }
   if(hasUiDraft(draft))result[id]=draft;
  }
  return result;
 }catch{return {};}
}
