import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {applySnapshotCommands,createDocument,validateDocument,MAX_ANIMATION_CELLS} from '../lib/pixels.ts';
import {denseProject,packProject,packPooledProject,packLegacyProject,unpackProject,POOLED_PROJECT_FORMAT,POOLED_PROJECT_MEDIA,PACKED_PROJECT_FORMAT,PACKED_PROJECT_MEDIA,LEGACY_PACKED_MEDIA} from '../lib/project-codec.ts';
import {celPixel} from '../lib/cel-storage.ts';
import {pixelApi} from '../lib/http-api.ts';
import {ProjectService} from '../lib/project-service.ts';
import {fileStore} from '../server/file-store.ts';

function sprite() {
  const doc=createDocument('Unusual pixels',256,256);
  const pixels=doc.layers[0].pixels;
  let state=1;
  for(let i=0;i<12800;i++){
    state=(Math.imul(state,1664525)+1013904223)>>>0;
    pixels[i]=state; // Include invisible RGB and fractional alpha, both editable.
  }
  pixels[13000]=0xabcdee00;
  const cel=pixels.slice();cel[13999]=0x77777711;
  doc.animation={fps:12,frames:[{id:'same',pixels:{base:pixels.slice()}},{id:'changed',pixels:{base:cel}},{id:'return',pixels:{base:pixels.slice()}}]};
  doc.reference={name:'Guide',width:doc.width,height:doc.height,pixels:pixels.slice()};
  return doc;
}

test('packed sources budget unique RGBA buffers and restore nonconsecutive holds from either format',()=>{
  const doc=sprite(),packed=packProject(doc),pooled=packPooledProject(doc),legacy=packLegacyProject(doc);
  if(packed.format!==PACKED_PROJECT_FORMAT||pooled.format!==POOLED_PROJECT_FORMAT||legacy.format==='pixel-workshop/1')throw new Error('Expected packed projects');
  assert.equal(packed.cels.length,2);
  assert.equal(packed.cels[1].base,0);
  assert.deepEqual(packed.animation?.frames.map(f=>f.pixels.base),[0,1,0]);
  assert.ok(JSON.stringify(packed).length<JSON.stringify(doc).length);
  for(const format of [packed,pooled,legacy]){
    const restored=unpackProject(JSON.parse(JSON.stringify(format)));
    assert.deepEqual(denseProject(restored),doc);
    assert.equal(restored.animation!.frames[0].pixels.base,restored.layers[0].pixels);
    assert.equal(restored.animation!.frames[2].pixels.base,restored.layers[0].pixels);
    assert.notEqual(restored.reference!.pixels,restored.layers[0].pixels);
    const edited=applySnapshotCommands(restored,[{op:'pixel',frame:1,x:200,y:50,color:'#102030'}]);
    assert.equal(celPixel(edited.layers[0].pixels,200,50,256),0xabcdee00);
    assert.equal(celPixel(edited.animation!.frames[0].pixels.base,200,50,256),0x102030ff);
    assert.equal(celPixel(edited.animation!.frames[2].pixels.base,200,50,256),0xabcdee00);
  }
  const old=createDocument('Old',8,8);
  assert.equal(packProject(old),old);
  assert.deepEqual(denseProject(validateDocument(unpackProject(JSON.parse(JSON.stringify(old))))),old);
});

test('pool decoder verifies selectors, previous bases, physical bounds and encoded pixel counts',()=>{
  const packed=packProject(sprite());
  if(packed.format!==PACKED_PROJECT_FORMAT)throw new Error();
  assert.throws(()=>unpackProject({...packed,width:MAX_ANIMATION_CELLS}));
  for(const data of ['AA==','!!!!','//8=','gA==','']){
    assert.throws(()=>unpackProject({...packed,cels:[{...packed.cels[0],data},packed.cels[1]]}));
  }
  for(const base of [0,1,-1,'0'])assert.throws(()=>unpackProject({...packed,cels:[{...packed.cels[0],base},packed.cels[1]]}));
  for(const index of [2,-1,'0',0.5])assert.throws(()=>unpackProject({...packed,layers:[{...packed.layers[0],pixels:index}]}));
  assert.throws(()=>unpackProject({...packed,cels:[...packed.cels,packed.cels[0]]})); // unused
  assert.throws(()=>unpackProject({...packed,animation:{fps:1,frames:[{id:'a',pixels:{wrong:0}}]}}));
  for(const bad of [{x:-1},{width:1.5},{width:0},{x:255},{y:Number.MAX_SAFE_INTEGER},{local:true},{height:'1'}]){
    assert.throws(()=>unpackProject({...packed,cels:[{...packed.cels[0],...bad},packed.cels[1]]}));
  }
  // Five individually legal 1024² allocations must be rejected before decoding.
  const layers=Array.from({length:5},(_,i)=>({...packed.layers[0],id:'layer'+i,pixels:i}));
  const cels=layers.map(()=>({x:0,y:0,width:1024,height:1024,data:''}));
  assert.throws(()=>unpackProject({...packed,width:1024,height:1024,layers,animation:undefined,reference:undefined,cels}));
  const legacy=packLegacyProject(sprite());
  if(legacy.format==='pixel-workshop/1')throw new Error();
  assert.throws(()=>unpackProject({...legacy,width:1024,height:1024,reference:{...legacy.reference,width:1024,height:1024}}));
  assert.throws(()=>unpackProject({...legacy,layers:[{...legacy.layers[0],pixels:{data:'',delta:true}}]}));
});

test('64 layers and 96 large held frames persist and load without expanding the logical timeline',async()=>{
  const doc=createDocument('Holds',1024,1024);
  const blank=doc.layers[0].pixels;
  doc.layers=Array.from({length:64},(_,i)=>({id:'layer-'+i,name:'Layer '+i,visible:true,pixels:blank}));
  doc.animation={fps:12,frames:Array.from({length:95},(_,i)=>({
    id:'frame-'+i,pixels:Object.fromEntries(doc.layers.map(layer=>[layer.id,blank]))
  }))};
  const packed=packProject(doc);
  if(packed.format!==PACKED_PROJECT_FORMAT)throw new Error();
  assert.equal(packed.cels.length,1);
  const json=JSON.stringify(packed);
  assert.ok(json.length<150_000);
  const restored=unpackProject(JSON.parse(json));
  assert.equal(restored.animation!.frames.length,95);
  assert.equal(restored.layers[0].pixels,restored.animation!.frames[94].pixels['layer-63']);
  assert.throws(()=>unpackProject({...packed,cels:Array(5).fill(packed.cels[0])}));
  const root=await mkdtemp(join(tmpdir(),'pw-held-'));
  try{
    const store=fileStore(root);
    await store.put(doc.id,{doc,undo:[],redo:[]});
    const saved=await store.get(doc.id);
    assert.ok(saved);
    assert.equal(saved.entry.doc.layers[0].pixels,saved.entry.doc.animation!.frames[94].pixels['layer-63']);
    const response=await pixelApi(new Request('https://pixel.test/api/pixel/projects/'+doc.id),new ProjectService(store));
    assert.equal(response.status,200);
    const snapshot=await response.json() as {doc:{format:string}};
    assert.equal(snapshot.doc.format,PACKED_PROJECT_FORMAT);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('packed browser negotiation imports, reads, edits, undoes, reopens after save and preserves dense JSON for older API callers',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pw-transport-'));
  try{
    const service=new ProjectService(fileStore(root));
    const call=async(path:string,body?:unknown,packed=true)=>{
      const res=await pixelApi(new Request('https://pixel.test/api/pixel/projects'+path,{
        headers:{accept:packed?PACKED_PROJECT_MEDIA:'application/json'},
        ...(body?{method:'POST',body:JSON.stringify(body)}:{})}),service);
      assert.equal(res.status,200);
      return await res.json() as {doc:ReturnType<typeof packProject>;canUndo:boolean;canRedo:boolean};
    };
    const original=sprite();
    const made=await call('',{document:packProject(original)});
    assert.equal(made.doc.format,PACKED_PROJECT_FORMAT);
    const path='/'+made.doc.id;
    const persisted=JSON.parse(await readFile(join(root,made.doc.id+'.json'),'utf8'));
    assert.equal(persisted.doc.format,PACKED_PROJECT_FORMAT);
    const painted=await call(path,{revision:made.doc.revision,action:'paint',commands:[{op:'pixel',x:4,y:4,color:'#00ffff'}]});
    assert.equal(painted.canUndo,true);
    const undone=await call(path,{revision:painted.doc.revision,action:'undo'});
    assert.deepEqual(denseProject(unpackProject(undone.doc)).layers,original.layers);
    const dense=(await call(path,undefined,false)).doc;
    assert.equal(dense.format,'pixel-workshop/1');
    assert.deepEqual(dense.layers,original.layers);
    const v2Response=await pixelApi(new Request('https://pixel.test/api/pixel/projects'+path,{headers:{accept:POOLED_PROJECT_MEDIA}}),service);
    assert.equal((await v2Response.json() as {doc:{format:string}}).doc.format,POOLED_PROJECT_FORMAT);
    const oldResponse=await pixelApi(new Request('https://pixel.test/api/pixel/projects'+path,{headers:{accept:LEGACY_PACKED_MEDIA}}),service);
    assert.equal((await oldResponse.json() as {doc:{format:string}}).doc.format,'pixel-workshop/packed-1');
    assert.deepEqual(unpackProject((await call(path)).doc).reference,original.reference);
  }finally{await rm(root,{recursive:true,force:true});}
});


test('legacy format rejection leaves project creation, revision and history atomic',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pw-legacy-limit-'));
  try{
    const service=new ProjectService(fileStore(root));
    const doc=createDocument('Independent marks',1024,1024);
    const commands=Array.from({length:4},(_,i)=>({op:'frame_add',source_frame:0,id:'f'+i}));
    const held=applySnapshotCommands(doc,commands);
    const distinct=Array.from({length:4},(_,i)=>({op:'pixel',frame:i+1,x:i,y:i,color:'#ffaa00'}));
    const send=(path:string,body:unknown,media:string)=>pixelApi(new Request('https://pixel.test/api/pixel/projects'+path,{
      method:'POST',headers:{accept:media},body:JSON.stringify(body)}),service);
    const request={document:packProject(applySnapshotCommands(held,distinct))};
    assert.equal((await send('',request,POOLED_PROJECT_MEDIA)).status,406);
    assert.equal((await service.listSummaries()).length,0);
    const saved=await service.create(doc.name,doc.width,doc.height,packProject(held));
    const path='/'+saved.id,change={action:'paint',revision:saved.revision,commands:distinct};
    assert.equal((await send(path,change,POOLED_PROJECT_MEDIA)).status,406);
    const {entry}=await service.get(saved.id);
    assert.equal(entry.doc.revision,saved.revision);
    assert.equal(entry.undo.length,0);
    assert.equal((await send(path,change,PACKED_PROJECT_MEDIA)).status,200);
  }finally{await rm(root,{recursive:true,force:true});}
});
