import { applyCommands, historyLimit, type PaintCommand, type PixelDocument } from './pixels.ts';

export type EditorSnapshot={doc:PixelDocument;canUndo:boolean;canRedo:boolean};
export type EditorEdit={action:'paint'|'undo'|'redo';commands?:PaintCommand[]};
export type SaveRequest={revision:number;requestId:string;edits:EditorEdit[]};
export type SaveFailure={message:string;conflict:boolean};
export type QueueState={snapshot:EditorSnapshot;pending:number;saving:boolean;error:SaveFailure|null;version:number};
type History={snapshot:EditorSnapshot;undo:PixelDocument[];redo:PixelDocument[];unknownUndo:boolean;unknownRedo:boolean;unresolved:boolean};
const initial=(snapshot:EditorSnapshot):History=>({snapshot,undo:[],redo:[],unknownUndo:snapshot.canUndo,unknownRedo:snapshot.canRedo,unresolved:false});

// Local history only covers states actually seen by this editor. Older history
// is resolved by the server; subsequent edits are rebased on that response.
function project(base:History,edits:EditorEdit[]):History {
  const state={...base,undo:[...base.undo],redo:[...base.redo],snapshot:{...base.snapshot}};
  for(const edit of edits){
    const old=state.snapshot.doc;
    if(edit.action==='paint'){
      state.snapshot.doc=applyCommands(old,edit.commands!);
      if(!state.unresolved)state.undo.push(old);
      state.redo=[];state.unknownRedo=false;
    }else{
      if(state.unresolved)throw new Error('Wait for the previous history step to save.');
      const undo=edit.action==='undo',from=undo?state.undo:state.redo,to=undo?state.redo:state.undo;
      if(from.length){
        state.snapshot.doc={...from.pop()!,revision:old.revision+1,updatedAt:new Date().toISOString()};to.push(old);
      }else if(undo?state.unknownUndo:state.unknownRedo){
        state.unresolved=true;state.undo=[];state.redo=[];state.unknownUndo=false;state.unknownRedo=false;
        state.snapshot.doc={...old,revision:old.revision+1};
      }else throw new Error(`Nothing to ${edit.action}.`);
    }
    const limit=historyLimit(state.snapshot.doc);
    if(state.undo.length>=limit)state.unknownUndo=false;
    if(state.redo.length>=limit)state.unknownRedo=false;
    state.undo=state.undo.slice(-limit);state.redo=state.redo.slice(-limit);
    state.snapshot.canUndo=!state.unresolved&&(!!state.undo.length||state.unknownUndo);
    state.snapshot.canRedo=!state.unresolved&&(!!state.redo.length||state.unknownRedo);
  }
  return state;
}

// Conservative work bounds let small strokes share a request without exceeding
// the drawing engine's per-request command/work limits.
function workBound(edit:EditorEdit,doc:PixelDocument){
  return (edit.commands??[]).reduce((sum,c)=>{
    const area=Number(c.width)*Number(c.height);
    if(c.op==='rect'||c.op==='ellipse')return sum+area*2;
    if(c.op==='transform'||c.op==='paste')return sum+area*3;
    if(c.op==='fill'||c.op==='clear'||c.op==='add_layer')return sum+doc.width*doc.height;
    if(c.op==='line')return sum+Math.max(Math.abs(Number(c.x2)-Number(c.x)),Math.abs(Number(c.y2)-Number(c.y)))+1;
    return sum+1;
  },0);
}

export class EditQueue {
  private base:History;
  private edits:EditorEdit[]=[];
  private request:SaveRequest|null=null;
  private timer:ReturnType<typeof setTimeout>|null=null;
  private sending=false;
  private closed=false;
  private failure:SaveFailure|null=null;
  private revision=0;
  private view:EditorSnapshot;
  private waiters:{resolve:()=>void;reject:(error:Error)=>void}[]=[];
  private send:(request:SaveRequest)=>Promise<EditorSnapshot>;
  private onChange:(state:QueueState)=>void;
  private delay:number;
  constructor(snapshot:EditorSnapshot,send:(request:SaveRequest)=>Promise<EditorSnapshot>,onChange:(state:QueueState)=>void,delay=75){
    this.base=initial(snapshot);this.view=snapshot;this.send=send;this.onChange=onChange;this.delay=delay;
  }
  get state():QueueState{return {snapshot:this.view,pending:this.edits.length,saving:this.sending,error:this.failure,version:this.revision};}
  enqueue(edit:EditorEdit){
    if(this.closed)throw new Error('Canvas is closed.');
    if(this.edits.length>=256)throw new Error('Too many unsaved edits. Retry saving or save an editable copy.');
    const next=[...this.edits,structuredClone(edit)];
    this.view=project(this.base,next).snapshot;
    this.edits=next;this.emit();this.schedule(this.delay);
  }
  flush():Promise<void>{
    if(this.failure)return Promise.reject(new Error(this.failure.message));
    if(!this.edits.length)return Promise.resolve();
    const done=new Promise<void>((resolve,reject)=>this.waiters.push({resolve,reject}));
    this.schedule(0);return done;
  }
  retry(){if(!this.failure||this.closed)return;this.failure=null;this.emit();this.schedule(0);}
  dispose(){this.closed=true;if(this.timer)clearTimeout(this.timer);this.waiters.splice(0).forEach(w=>w.reject(new Error('Canvas closed.')));}
  private emit(){if(this.closed)return;this.revision++;this.onChange(this.state);}
  private schedule(delay:number){
    if(this.closed||this.failure||!this.edits.length||this.sending)return;
    if(this.timer&&delay>0)return;
    if(this.timer)clearTimeout(this.timer);
    this.timer=setTimeout(()=>{this.timer=null;void this.drain();},delay);
  }
  private makeRequest():SaveRequest {
    let work=0,commands=0;const edits:EditorEdit[]=[];
    for(const edit of this.edits){
      const cost=workBound(edit,this.base.snapshot.doc),count=edit.commands?.length??0;
      if(edits.length&&(edits.length>=8||work+cost>2000000||commands+count>5000))break;
      edits.push(edit);work+=cost;commands+=count;
    }
    // getRandomValues also works on local HTTP previews, where randomUUID is
    // unavailable because it requires a secure browser context.
    const requestId=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
    return {revision:this.base.snapshot.doc.revision,requestId,edits};
  }
  private async drain(){
    if(this.closed||this.sending||this.failure||!this.edits.length)return;
    this.sending=true;this.emit();
    try{
      const request=this.request??this.makeRequest();this.request=request;
      const snapshot=await this.send(request);if(this.closed)return;
      if(snapshot.doc.id!==this.base.snapshot.doc.id||snapshot.doc.revision!==request.revision+request.edits.length){
        throw Object.assign(new Error('This project changed elsewhere. Your unsaved canvas is still available.'),{status:409});
      }
      const acknowledged=project(this.base,request.edits);
      this.base=acknowledged.unresolved?initial(snapshot):{...acknowledged,snapshot};
      this.edits=this.edits.slice(request.edits.length);this.request=null;
      this.view=project(this.base,this.edits).snapshot;
    }catch(error){
      if(this.closed)return;
      const e=error as Error&{status?:number};
      this.failure={message:e.message||'Saving failed.',conflict:e.status===409};
    }finally{
      this.sending=false;
      if(!this.closed){
        this.emit();
        if(this.failure)this.waiters.splice(0).forEach(w=>w.reject(new Error(this.failure!.message)));
        else if(!this.edits.length)this.waiters.splice(0).forEach(w=>w.resolve());
        else this.schedule(0);
      }
    }
  }
}
