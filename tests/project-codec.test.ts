import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDocument,validateDocument,MAX_ANIMATION_CELLS} from '../lib/pixels.ts';
import {packProject,unpackProject,PACKED_PROJECT_FORMAT,PACKED_PROJECT_MEDIA} from '../lib/project-codec.ts';
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

test('packed projects preserve all RGBA words, exact duplicate frames, independent editable buffers and references',()=>{
  const doc=sprite(),packed=packProject(doc);
  assert.equal(packed.format,PACKED_PROJECT_FORMAT);
  if(packed.format!==PACKED_PROJECT_FORMAT)throw new Error();
  assert.deepEqual(packed.animation?.frames[0].pixels.base,{data:'',delta:true});
  assert.ok(JSON.stringify(packed).length<JSON.stringify(doc).length);
  const restored=unpackProject(JSON.parse(JSON.stringify(packed)));
  assert.deepEqual(restored,doc);
  restored.animation!.frames[0].pixels.base[13000]=0;
  assert.equal(restored.layers[0].pixels[13000],0xabcdee00);
  const old=createDocument('Old',8,8);
  assert.equal(packProject(old),old);
  assert.deepEqual(validateDocument(unpackProject(JSON.parse(JSON.stringify(old)))),old);
});

test('bounded decode rejects oversized project, invalid ranges, truncated streams, counterfeit inherited cels and unknown layer IDs',()=>{
  const packed=packProject(sprite());
  if(packed.format!==PACKED_PROJECT_FORMAT)throw new Error();
  const cel=packed.layers[0].pixels;
  assert.throws(()=>unpackProject({...packed,width:MAX_ANIMATION_CELLS}));
  for(const data of ['AA==','!!!!','//8=','gA==','']){
    assert.throws(()=>unpackProject({...packed,layers:[{...packed.layers[0],pixels:{...cel,data}}]}));
  }
  assert.throws(()=>unpackProject({...packed,layers:[{...packed.layers[0],pixels:{data:'',delta:true}}]}));
  assert.throws(()=>unpackProject({...packed,animation:{fps:1,frames:[{id:'a',pixels:{wrong:{data:'',delta:true}}}]}}));
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
    assert.deepEqual(unpackProject((await call(path)).doc).reference,original.reference);
  }finally{await rm(root,{recursive:true,force:true});}
});
