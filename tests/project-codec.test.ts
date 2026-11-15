import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {applySnapshotCommands,createDocument,validateDocument,MAX_ANIMATION_CELLS} from '../lib/pixels.ts';
import {packProject,packLegacyProject,unpackProject,PACKED_PROJECT_FORMAT,PACKED_PROJECT_MEDIA,LEGACY_PACKED_MEDIA} from '../lib/project-codec.ts';
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
  const doc=sprite(),packed=packProject(doc),legacy=packLegacyProject(doc);
  if(packed.format!==PACKED_PROJECT_FORMAT||legacy.format==='pixel-workshop/1')throw new Error('Expected packed projects');
  assert.equal(packed.cels.length,2);
  assert.equal(packed.cels[1].base,0);
  assert.deepEqual(packed.animation?.frames.map(f=>f.pixels.base),[0,1,0]);
  assert.ok(JSON.stringify(packed).length<JSON.stringify(doc).length);
  for(const format of [packed,legacy]){
    const restored=unpackProject(JSON.parse(JSON.stringify(format)));
    assert.deepEqual(restored,doc);
    assert.equal(restored.animation!.frames[0].pixels.base,restored.layers[0].pixels);
    assert.equal(restored.animation!.frames[2].pixels.base,restored.layers[0].pixels);
    assert.notEqual(restored.reference!.pixels,restored.layers[0].pixels);
    const edited=applySnapshotCommands(restored,[{op:'pixel',frame:1,x:200,y:50,color:'#102030'}]);
    assert.equal(edited.layers[0].pixels[13000],0xabcdee00);
    assert.equal(edited.animation!.frames[0].pixels.base[13000],0x102030ff);
    assert.equal(edited.animation!.frames[2].pixels.base[13000],0xabcdee00);
  }
  const old=createDocument('Old',8,8);
  assert.equal(packProject(old),old);
  assert.deepEqual(validateDocument(unpackProject(JSON.parse(JSON.stringify(old)))),old);
});

test('pool decoder verifies selectors, previous bases, physical bounds and encoded pixel counts',()=>{
  const packed=packProject(sprite());
  if(packed.format!==PACKED_PROJECT_FORMAT)throw new Error();
  assert.throws(()=>unpackProject({...packed,width:MAX_ANIMATION_CELLS}));
  for(const data of ['AA==','!!!!','//8=','gA==','']){
    assert.throws(()=>unpackProject({...packed,cels:[{data},packed.cels[1]]}));
  }
  for(const base of [0,1,-1,'0'])assert.throws(()=>unpackProject({...packed,cels:[{...packed.cels[0],base},packed.cels[1]]}));
  for(const index of [2,-1,'0',0.5])assert.throws(()=>unpackProject({...packed,layers:[{...packed.layers[0],pixels:index}]}));
  assert.throws(()=>unpackProject({...packed,cels:[...packed.cels,packed.cels[0]]})); // unused
  assert.throws(()=>unpackProject({...packed,animation:{fps:1,frames:[{id:'a',pixels:{wrong:0}}]}}));
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
    assert.deepEqual(unpackProject(undone.doc).layers,original.layers);
    assert.equal((await call(path,undefined,false)).doc.format,'pixel-workshop/1');
    const oldResponse=await pixelApi(new Request('https://pixel.test/api/pixel/projects'+path,{headers:{accept:LEGACY_PACKED_MEDIA}}),service);
    assert.equal((await oldResponse.json() as {doc:{format:string}}).doc.format,'pixel-workshop/packed-1');
    assert.deepEqual(unpackProject((await call(path)).doc).reference,original.reference);
  }finally{await rm(root,{recursive:true,force:true});}
});
