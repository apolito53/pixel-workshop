'use client';
import {Fragment,useState,type DragEvent} from 'react';
import {ArrowDown,ArrowUp,ChevronDown,ChevronRight,Eye,EyeOff,Folder,GripVertical,Link2,Pencil,Plus,Trash2} from 'lucide-react';
import {MAX_LAYERS,frameView,type Layer,type PaintCommand,type PixelDocument} from '../lib/pixels.ts';

type Props={
 doc:PixelDocument;active:string;frame:number;busy:boolean;playing:boolean;addLimit:string;usage:string;
 onSelect:(id:string)=>void;onCommit:(commands:PaintCommand[])=>Promise<boolean>;
};
type DropTarget={id:string;above:boolean};

function LayerProperties({item,folders,busy,onCommit,onClose}:{
 item:Layer;folders:string[];busy:boolean;onCommit:Props['onCommit'];onClose:()=>void;
}){
 const [name,setName]=useState(item.name),[folder,setFolder]=useState(item.group||'');
 const submit=async()=>{
  if(!name.trim())return;
  const commands:PaintCommand[]=[];
  if(name.trim()!==item.name)commands.push({op:'rename_layer',layer:item.id,name:name.trim()});
  if(folder.trim()!==(item.group||''))commands.push({op:'set_layer_group',layer:item.id,group:folder.trim()});
  if(!commands.length||await onCommit(commands))onClose();
 };
 return <form className="layer-properties" onSubmit={event=>{event.preventDefault();void submit();}}
  onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();onClose();}}}>
  <label>Layer name<input value={name} maxLength={60} autoFocus onChange={e=>setName(e.target.value)}/></label>
  <label>Folder<input list="layer-folder-names" value={folder} maxLength={60} placeholder="Ungrouped" onChange={e=>setFolder(e.target.value)}/></label>
  <datalist id="layer-folder-names">{folders.map(group=><option key={group} value={group}/>)}</datalist>
  <div><button type="submit" className="secondary" disabled={busy||!name.trim()}>Save</button><button type="button" className="text-button" onClick={onClose}>Cancel</button></div>
 </form>;
}

export default function LayerPanel({doc,active,frame,busy,playing,addLimit,usage,onSelect,onCommit}:Props){
 const [editing,setEditing]=useState<string|null>(null);
 const [collapsed,setCollapsed]=useState<Set<string>>(()=>new Set());
 const [dragging,setDragging]=useState<string|null>(null),[drop,setDrop]=useState<DropTarget|null>(null);
 const index=doc.layers.findIndex(l=>l.id===active),selected=doc.layers[index];
 const stack=[...doc.layers].reverse(),folders=[...new Set(stack.flatMap(l=>l.group?[l.group]:[]))];
 const isHeld=!!selected&&frame>0&&frameView(doc,frame).layers[index].pixels===frameView(doc,frame-1).layers[index].pixels;
 const move=(id:string,to:number)=>onCommit([{op:'move_layer',layer:id,index:to}]);
 const add=async()=>{
  const id='layer-'+Date.now().toString(36);
  if(await onCommit([{op:'add_layer',id,name:'Layer '+(doc.layers.length+1)}]))onSelect(id);
 };
 const toggle=(group:string)=>setCollapsed(current=>{
  const next=new Set(current);if(next.has(group))next.delete(group);else next.add(group);return next;
 });
 const dropTarget=(event:DragEvent<HTMLDivElement>,id:string)=>{
  const rect=event.currentTarget.getBoundingClientRect();
  return {id,above:event.clientY<rect.top+rect.height/2};
 };
 const finishDrop=(event:DragEvent<HTMLElement>,id:string,above:boolean,group?:string)=>{
  if(!dragging)return;
  event.preventDefault();
  const from=doc.layers.findIndex(l=>l.id===dragging),target=doc.layers.findIndex(l=>l.id===id);
  const insertion=target+Number(above);
  const to=insertion-Number(from<insertion);
  if(!busy&&from>=0&&target>=0){
   const commands:PaintCommand[]=[];
   if(from!==to)commands.push({op:'move_layer',layer:dragging,index:to});
   if(group!==undefined&&doc.layers[from].group!==group)commands.push({op:'set_layer_group',layer:dragging,group});
   const id=dragging;
   if(commands.length)void onCommit(commands).then(ok=>{if(ok)onSelect(id);});
  }
  setDragging(null);setDrop(null);
 };
 return <section className="inspector-section layers-section">
  <div className="section-heading" data-guide="layers"><span>LAYERS</span><span className="muted" aria-label="Layer slots used">{doc.layers.length} / {MAX_LAYERS}</span>
   <button className="mini-button" aria-label="Add layer" title={addLimit||'Add a blank layer on every frame'} aria-describedby={addLimit?'layer-capacity-note':undefined}
    disabled={busy||!!addLimit} onClick={()=>void add()}><Plus size={16}/></button></div>
  {selected&&<div className="layer-actions">
   <strong title={selected.name}>{selected.name}</strong>
   <button type="button" className="mini-button" aria-label="Move selected layer up" title="Move layer up" disabled={busy||index===doc.layers.length-1} onClick={()=>void move(active,index+1)}><ArrowUp size={15}/></button>
   <button type="button" className="mini-button" aria-label="Move selected layer down" title="Move layer down" disabled={busy||index===0} onClick={()=>void move(active,index-1)}><ArrowDown size={15}/></button>
   <button type="button" className="mini-button" aria-label="Edit layer name and folder" title="Edit name and folder" aria-expanded={editing===active} disabled={busy}
    onClick={()=>setEditing(editing===active?null:active)}><Pencil size={14}/></button>
  </div>}
  {selected&&editing===active&&<LayerProperties key={active} item={selected} folders={folders} busy={busy} onCommit={onCommit} onClose={()=>setEditing(null)}/>}
  {selected&&frame>0&&<div className="layer-cel">
   {isHeld?<span><Link2 size={13}/>Held from frame {frame}</span>:
    <button className="text-button" disabled={busy||playing} title={`Use frame ${frame}’s drawing for this layer in frame ${frame+1}. Undo to restore.`}
     onClick={()=>void onCommit([{op:'hold_cel',layer:active,frame,source_frame:frame-1}])}><Link2 size={13}/>Hold previous cel</button>}
  </div>}
  <div className="layer-stack" aria-label="Layer stack, top first">
  {stack.map((item,i)=><Fragment key={item.id}>
   {item.group&&item.group!==stack[i-1]?.group&&<button type="button" className="layer-folder" aria-expanded={!collapsed.has(item.group)}
    aria-label={`${collapsed.has(item.group)?'Expand':'Collapse'} ${item.group} folder`} onClick={()=>toggle(item.group!)}
    title={`Drop a layer here to move it into ${item.group}`}
    onDragOver={event=>{if(dragging&&!busy){event.preventDefault();event.dataTransfer.dropEffect='move';setDrop(null);}}}
    onDrop={event=>finishDrop(event,item.id,true,item.group)}>
    {collapsed.has(item.group)?<ChevronRight size={13}/>:<ChevronDown size={13}/>}<Folder size={14}/><span>{item.group}</span></button>}
   {(!item.group||!collapsed.has(item.group))&&<div
    className={['layer-row',item.group?'in-folder':'',item.id===active?'selected':'',drop?.id===item.id?(drop.above?'drop-above':'drop-below'):''].join(' ')}
    onDragOver={event=>{if(dragging&&!busy){event.preventDefault();event.dataTransfer.dropEffect='move';setDrop(dropTarget(event,item.id));}}}
    onDrop={event=>finishDrop(event,item.id,dropTarget(event,item.id).above)}>
    <button className="layer-select" type="button" title={item.name} aria-pressed={active===item.id} draggable={!busy}
     onDragStart={event=>{event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',item.id);setDragging(item.id);}}
     onDragEnd={()=>{setDragging(null);setDrop(null);}} onClick={()=>{onSelect(item.id);if(item.id!==active)setEditing(null);}}>
     <GripVertical size={14} aria-hidden="true"/><span>{item.name}</span></button>
    <button type="button" className="mini-button" aria-label={`${item.visible?'Hide':'Show'} ${item.name} layer`} disabled={busy}
     onClick={()=>void onCommit([{op:'visibility',layer:item.id,visible:!item.visible}])}>{item.visible?<Eye size={15}/>:<EyeOff size={15}/>}</button>
    <button type="button" className="mini-button layer-delete" aria-label={`Delete ${item.name} layer`}
     title={doc.layers.length===1?'Keep at least one layer':'Delete layer (Undo to restore)'} disabled={busy||doc.layers.length===1}
     onClick={()=>void onCommit([{op:'delete_layer',layer:item.id}])}><Trash2 size={15}/></button>
   </div>}
  </Fragment>)}</div>
  {addLimit&&<span id="layer-capacity-note" className="layer-note">{addLimit}</span>}
  <p className="layer-note">{usage}</p>
 </section>;
}
