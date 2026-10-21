import { applyCommands, createDocument, validateDocument, historyLimit, type PixelDocument, type PaintCommand } from './pixels.ts';
import type { EditorEdit, EditorSnapshot } from './edit-queue.ts';
export type Entry={doc:PixelDocument;undo:PixelDocument[];redo:PixelDocument[];lastRequest?:{id:string;revision:number}};
export interface ProjectStore { list():Promise<PixelDocument[]>; get(id:string):Promise<{entry:Entry;etag:string}|null>; put(id:string,entry:Entry,etag?:string):Promise<void> }
export function safeId(id:string){if(!/^[a-z0-9_-]{1,80}$/i.test(id))throw new Error('Invalid project ID.');return id;}
export class ProjectService {
  store:ProjectStore;
  constructor(store:ProjectStore){this.store=store;}
  async create(name:string,width:number,height:number,imported?:unknown){
    const doc=imported?validateDocument(imported):createDocument(name,width,height);doc.id=crypto.randomUUID();doc.revision=0;doc.updatedAt=new Date().toISOString();
    await this.store.put(doc.id,{doc,undo:[],redo:[]});return doc;
  }
  async get(id:string){const result=await this.store.get(safeId(id));if(!result)throw new Error('Project not found.');return result;}
  async edit(id:string,revision:number,action:'paint'|'undo'|'redo',commands?:PaintCommand[]){
    return (await this.editSnapshot(id,revision,[{action,commands}])).doc;
  }
  async editSnapshot(id:string,revision:number,edits:EditorEdit[],requestId?:string):Promise<EditorSnapshot>{
    if(!Array.isArray(edits)||!edits.length||edits.length>8||edits.some(e=>!e||!['paint','undo','redo'].includes(e.action)))throw new Error('Send 1–8 valid edits in one save.');
    if(edits.reduce((n,e)=>n+(e.commands?.length??0),0)>5000)throw new Error('Send at most 5000 drawing commands in one save.');
    if(requestId!==undefined&&(typeof requestId!=='string'||!/^[a-z0-9_-]{1,100}$/i.test(requestId)))throw new Error('Invalid save request ID.');
    const {entry,etag}=await this.get(id);
    const snapshot=()=>({doc:entry.doc,canUndo:!!entry.undo.length,canRedo:!!entry.redo.length});
    // A lost response can be retried without painting twice or adding another
    // undo step. A later external edit still triggers the revision guard.
    if(requestId&&entry.lastRequest?.id===requestId&&entry.lastRequest.revision===entry.doc.revision)return snapshot();
    if(revision!==entry.doc.revision)throw new Error('This project changed. Reload it before applying your edit.');
    const work={spent:0};
    for(const {action,commands} of edits){
     const old=entry.doc;
     if(action==='paint'){entry.doc=applyCommands(old,commands!,work);entry.undo=[...entry.undo,old].slice(-12);entry.redo=[];}
     else {
      const from=action==='undo'?entry.undo:entry.redo,to=action==='undo'?entry.redo:entry.undo;
      if(!from.length)throw new Error(`Nothing to ${action}.`);
      const restored=from.pop()!;to.push(old);entry.doc={...restored,revision:old.revision+1,updatedAt:new Date().toISOString()};
     }
     const limit=historyLimit(entry.doc);entry.undo=entry.undo.slice(-limit);entry.redo=entry.redo.slice(-limit);
    }
    if(requestId)entry.lastRequest={id:requestId,revision:entry.doc.revision};
    await this.store.put(id,entry,etag);return snapshot();
  }
}
