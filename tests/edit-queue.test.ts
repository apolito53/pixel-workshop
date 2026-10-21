import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EditQueue,type EditorEdit,type EditorSnapshot,type SaveRequest} from '../lib/edit-queue.ts';
import {createDocument,color} from '../lib/pixels.ts';
import {ProjectService,type Entry,type ProjectStore} from '../lib/project-service.ts';
import {pixelApi} from '../lib/http-api.ts';

function memoryStore(){
 const entries=new Map<string,{entry:Entry;etag:string}>();let writes=0,reads=0;
 const store:ProjectStore={
  async list(){return [...entries.values()].map(v=>structuredClone(v.entry.doc));},
  async get(id){reads++;return structuredClone(entries.get(id)??null);},
  async put(id,entry,etag){if(entries.get(id)?.etag!==etag)throw new Error('This project changed.');entries.set(id,{entry:structuredClone(entry),etag:String(++writes)});},
 };
 return {store,get writes(){return writes;},get reads(){return reads;}};
}
const pixel=(x:number,color='#ff0000'):EditorEdit=>({action:'paint',commands:[{op:'pixel',x,y:0,color}]});
const blank=():EditorSnapshot=>({doc:createDocument('Queue test',32,8),canUndo:false,canRedo:false});
function controlledTransport(){
 type Held={request:SaveRequest;resolve:(s:EditorSnapshot)=>void;reject:(e:Error)=>void};
 const held:Held[]=[],waiting:((h:Held)=>void)[]=[];
 return {
  send:(request:SaveRequest)=>new Promise<EditorSnapshot>((resolve,reject)=>{const h={request,resolve,reject},wake=waiting.shift();if(wake)wake(h);else held.push(h);}),
  next:()=>held.length?Promise.resolve(held.shift()!):new Promise<Held>(resolve=>waiting.push(resolve)),
 };
}
const save=(service:ProjectService,id:string,request:SaveRequest)=>service.editSnapshot(id,request.revision,request.edits,request.requestId);

test('rapid strokes render before a delayed save, batch in order, and survive earlier acknowledgements',async()=>{
 const memory=memoryStore(),service=new ProjectService(memory.store),doc=await service.create('Fast',32,8),transport=controlledTransport();
 const q=new EditQueue({doc,canUndo:false,canRedo:false},transport.send,()=>{},0);
 try{
  q.enqueue(pixel(0));const flushed=q.flush(),first=await transport.next();
  for(let x=1;x<20;x++)q.enqueue(pixel(x));
  assert.equal(q.state.pending,20);assert.equal(q.state.snapshot.doc.layers[0].pixels.filter(Boolean).length,20);
  first.resolve(await save(service,doc.id,first.request));
  let request=await transport.next(),batches=1;
  assert.equal(q.state.snapshot.doc.layers[0].pixels.filter(Boolean).length,20,'an old acknowledgement must not erase newer strokes');
  while(true){
   const count=request.request.edits.length;assert.ok(count<=8);
   request.resolve(await save(service,doc.id,request.request));batches++;
   if(q.state.pending===count)break;
   request=await transport.next();
  }
  await flushed;assert.equal(q.state.pending,0);assert.equal(batches,4);
  const saved=(await service.get(doc.id)).entry;
  assert.equal(saved.doc.revision,20);assert.equal(saved.doc.layers[0].pixels.filter(Boolean).length,20);assert.equal(saved.undo.length,12);
 }finally{q.dispose();}
});

test('undo and redo are immediate while saves are pending and preserve one history step per stroke',async()=>{
 const memory=memoryStore(),service=new ProjectService(memory.store),doc=await service.create('History',32,8);
 const q=new EditQueue({doc,canUndo:false,canRedo:false},r=>save(service,doc.id,r),()=>{},10000);
 try{
  q.enqueue(pixel(0));q.enqueue(pixel(1,'#00ff00'));q.enqueue({action:'undo'});
  assert.equal(q.state.snapshot.doc.layers[0].pixels[1],0);assert.equal(q.state.snapshot.canRedo,true);
  q.enqueue({action:'redo'});assert.equal(q.state.snapshot.doc.layers[0].pixels[1],color('#00ff00'));
  await q.flush();assert.equal((await service.get(doc.id)).entry.undo.length,2);
  q.enqueue({action:'undo'});q.enqueue({action:'undo'});assert.equal(q.state.snapshot.canUndo,false);assert.equal(q.state.snapshot.doc.layers[0].pixels.filter(Boolean).length,0);
  await q.flush();assert.equal((await service.get(doc.id)).entry.doc.layers[0].pixels.filter(Boolean).length,0);
 }finally{q.dispose();}
});

test('a lost save response retains the local canvas and retries the same request without duplicate history',async()=>{
 const memory=memoryStore(),service=new ProjectService(memory.store),doc=await service.create('Retry',32,8);let drop=true;const requests:SaveRequest[]=[];
 const q=new EditQueue({doc,canUndo:false,canRedo:false},async r=>{requests.push(r);const saved=await save(service,doc.id,r);if(drop){drop=false;throw new Error('Network response lost');}return saved;},()=>{},10000);
 try{
  q.enqueue(pixel(0));await assert.rejects(q.flush(),/Network/);
  assert.equal(q.state.pending,1);assert.equal(q.state.snapshot.doc.layers[0].pixels[0],color('#ff0000'));
  q.enqueue(pixel(1));q.retry();await q.flush();
  assert.equal(requests[0].requestId,requests[1].requestId);assert.equal(requests[1].edits.length,1);
  const saved=(await service.get(doc.id)).entry;assert.equal(saved.doc.revision,2);assert.equal(saved.undo.length,2);assert.equal(saved.doc.layers[0].pixels.filter(Boolean).length,2);
 }finally{q.dispose();}
});

test('a conflicting MCP edit pauses saves without replacing or discarding the unsaved drawing',async()=>{
 const memory=memoryStore(),service=new ProjectService(memory.store),doc=await service.create('Conflict',32,8),transport=controlledTransport();
 const q=new EditQueue({doc,canUndo:false,canRedo:false},transport.send,()=>{},0);
 try{
  q.enqueue(pixel(0));const rejected=assert.rejects(q.flush(),/changed/),held=await transport.next();q.enqueue(pixel(1));
  await service.edit(doc.id,0,'paint',[{op:'pixel',x:7,y:0,color:'#0000ff'}]);
  try{await save(service,doc.id,held.request);assert.fail('Expected revision conflict');}catch(error){held.reject(Object.assign(error as Error,{status:409}));}
  await rejected;assert.equal(q.state.error?.conflict,true);assert.equal(q.state.pending,2);
  assert.equal(q.state.snapshot.doc.layers[0].pixels[0],color('#ff0000'));assert.equal(q.state.snapshot.doc.layers[0].pixels[1],color('#ff0000'));
  const remote=(await service.get(doc.id)).entry.doc;assert.equal(remote.layers[0].pixels[0],0);assert.equal(remote.layers[0].pixels[7],color('#0000ff'));
 }finally{q.dispose();}
});

test('older server history is resolved before replaying later optimistic strokes',async()=>{
 const memory=memoryStore(),service=new ProjectService(memory.store),doc=await service.create('Reopen',32,8);
 const old=await service.edit(doc.id,0,'paint',[{op:'pixel',x:0,y:0,color:'#ffffff'}]);
 const q=new EditQueue({doc:old,canUndo:true,canRedo:false},r=>save(service,doc.id,r),()=>{},10000);
 try{
  q.enqueue({action:'undo'});q.enqueue(pixel(1));await q.flush();
  assert.equal(q.state.snapshot.doc.layers[0].pixels[0],0);assert.equal(q.state.snapshot.doc.layers[0].pixels[1],color('#ff0000'));
  q.enqueue({action:'undo'});await q.flush();assert.equal(q.state.snapshot.doc.layers[0].pixels.filter(Boolean).length,0);
 }finally{q.dispose();}
});

test('HTTP save batches are atomic, idempotent, and return the saved snapshot without another storage read',async()=>{
 const memory=memoryStore(),service=new ProjectService(memory.store),doc=await service.create('HTTP',32,8);
 const request={revision:0,requestId:'save-one',edits:[pixel(0),pixel(1)]};
 const post=(body:unknown)=>pixelApi(new Request(`http://local/api/pixel/projects/${doc.id}`,{method:'POST',body:JSON.stringify(body)}),service);
 let before=memory.reads;const first=await post(request);assert.equal(first.status,200);assert.equal(memory.reads-before,1);
 const duplicate=await post(request),reply=await duplicate.json() as EditorSnapshot;
 assert.equal(reply.doc.revision,2);assert.equal((await service.get(doc.id)).entry.undo.length,2);
 const invalid=await post({revision:2,requestId:'invalid',edits:[pixel(2),pixel(99)]});assert.equal(invalid.status,400);
 assert.equal((await service.get(doc.id)).entry.doc.revision,2);assert.equal((await service.get(doc.id)).entry.doc.layers[0].pixels[2],0);
 await service.edit(doc.id,2,'paint',[{op:'clear'}]);assert.equal((await post(request)).status,409);
});
