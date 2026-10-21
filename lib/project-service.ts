import { applyCommands, createDocument, validateDocument, type PixelDocument, type PaintCommand } from './pixels.ts';
export type Entry={doc:PixelDocument;undo:PixelDocument[];redo:PixelDocument[]};
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
    const {entry,etag}=await this.get(id);
    if(revision!==entry.doc.revision)throw new Error('This project changed. Reload it before applying your edit.');
    const old=entry.doc;
    if(action==='paint'){entry.doc=applyCommands(old,commands!);entry.undo=[...entry.undo,old].slice(-12);entry.redo=[];}
    else {
      const from=action==='undo'?entry.undo:entry.redo,to=action==='undo'?entry.redo:entry.undo;
      if(!from.length)throw new Error(`Nothing to ${action}.`);
      const restored=from.pop()!;to.push(old);entry.doc={...restored,revision:old.revision+1,updatedAt:new Date().toISOString()};
    }
    // Bound history memory for larger canvases while retaining twelve steps for small sprites.
    const maxHistory=Math.max(1,Math.min(12,Math.floor(400000/(entry.doc.width*entry.doc.height*entry.doc.layers.length))));
    entry.undo=entry.undo.slice(-maxHistory);entry.redo=entry.redo.slice(-maxHistory);
    await this.store.put(id,entry,etag);return entry.doc;
  }
}
