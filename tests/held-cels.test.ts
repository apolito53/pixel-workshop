import {packProject,unpackProject} from '../lib/project-codec.ts';
import {celPixel} from '../lib/cel-storage.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applySnapshotCommands as edit,createDocument,documentCapacity,documentCells,MAX_ANIMATION_CELLS,frameView,validateDocument} from '../lib/pixels.ts';

test('a 64-layer, 96-frame scene charges held artwork once and detaches only the painted cel',()=>{
  const base=createDocument('Coast',320,180);
  const doc=edit(base,[{op:'pixel',x:1,y:1,color:'#110033'},
    ...Array.from({length:63},(_,i)=>({op:'add_layer',id:'tree-'+i})),
    ...Array.from({length:95},()=>({op:'frame_add'}))]);
  assert.equal(documentCells(doc),1);
  const painted=edit(doc,[{op:'pixel',layer:'tree-62',frame:95,x:1,y:1,color:'#aa3388'}]);
  assert.equal(documentCells(painted),2);
  assert.equal(celPixel(painted.animation!.frames[94].pixels['tree-62'],1,1,320),0xaa3388ff);
  assert.equal(painted.animation!.frames[93].pixels['tree-62'],doc.layers[1].pixels);
  assert.equal(celPixel(doc.animation!.frames[94].pixels['tree-62'],1,1,320),0);
  const remapped=edit(painted,[{op:'palette_remap',fromColor:'#110033',toColor:'#334455'}]);
  assert.equal(documentCells(remapped),2);
  assert.equal(remapped.layers[0].pixels,remapped.animation!.frames[94].pixels.base);
  assert.equal(celPixel(remapped.layers[0].pixels,1,1,320),0x334455ff);
  assert.equal(celPixel(doc.layers[0].pixels,1,1,320),0x110033ff);
  const restored=edit(remapped,[{op:'hold_cel',layer:'tree-62',frame:95,source_frame:1}]);
  assert.equal(documentCells(restored),1);
  const noChange=edit(restored,[{op:'pixel',layer:'tree-62',frame:95,x:0,y:0,color:'transparent'}]);
  assert.equal(documentCells(noChange),1);
});

test('a full drawing budget permits held frames, independent edits in place, and reusing existing drawings',()=>{
  const source=createDocument('Four drawings',1024,1024);
  let full=edit(source,Array.from({length:3},()=>({op:'frame_add'})));
  for(let frame=0;frame<4;frame++)full=edit(full,[
    {op:'pixel',frame,x:0,y:0,color:['#110000','#220000','#330000','#440000'][frame]},
    {op:'pixel',frame,x:1023,y:1023,color:'#557788'}]);
  assert.equal(documentCells(full),MAX_ANIMATION_CELLS);
  assert.equal(documentCapacity(full).remainingCelBuffers,0);
  assert.equal(documentCapacity(full).maxLayers,64);
  const withLayer=edit(full,[{op:'add_layer',id:'holds'},{op:'frame_add',source_frame:1}]);
  assert.throws(()=>edit(withLayer,[{op:'pixel',frame:4,x:8,y:3,color:'#ffffff'}]),/pixel budget/);
  assert.equal(celPixel(withLayer.animation!.frames[3].pixels.base,8,3,1024),0);
  const same=edit(withLayer,[{op:'pixel',layer:'holds',frame:4,x:0,y:0,color:'#220000'},
    {op:'pixel',layer:'holds',frame:4,x:1023,y:1023,color:'#557788'}]);
  assert.equal(same.animation!.frames[3].pixels.holds,same.animation!.frames[0].pixels.base);
  const whole=edit(full,[{op:'pixel',frame:2,x:15,y:11,color:'#ffffff'}]);
  assert.equal(documentCells(whole),MAX_ANIMATION_CELLS);
  assert.equal(celPixel(full.animation!.frames[1].pixels.base,15,11,1024),0);
  const blank=edit(whole,[{op:'add_layer',id:'empty'}]);
  assert.equal(documentCells(blank),MAX_ANIMATION_CELLS);
  assert.equal(edit(whole,[{op:'duplicate_layer',layer:'base',id:'backup'}]).layers.length,2);
});

test('layer stack operations preserve per-frame content, group metadata, and legal IDs',()=>{
  const source=createDocument('Order',2,1);
  const art=edit(source,[{op:'frame_add'},{op:'add_layer',id:'__proto__'},
    {op:'pixel',layer:'__proto__',frame:1,x:1,y:0,color:'#123456'},
    {op:'duplicate_layer',layer:'__proto__',id:'saved'},
    {op:'set_layer_group',layer:'saved',group:'  branches  '},
    {op:'move_layer',layer:'saved',index:0}]);
  assert.deepEqual(art.layers.map(l=>l.id),['saved','base','__proto__']);
  assert.equal(art.layers[0].group,'branches');
  assert.equal(frameView(art,1).layers[0].pixels,frameView(art,1).layers[2].pixels);
  const detached=edit(art,[{op:'pixel',layer:'__proto__',frame:1,x:1,y:0,color:'#eeeeee'},
    {op:'set_layer_group',layer:'saved',group:''}]);
  assert.equal(detached.layers[0].group,undefined);
  assert.equal(celPixel(frameView(detached,1).layers[0].pixels,1,0,2),0x123456ff);
  assert.equal(celPixel(frameView(detached,1).layers[2].pixels,1,0,2),0xeeeeeeff);
  const imported=validateDocument(JSON.parse(JSON.stringify(art)));
  assert.equal(imported.layers[0].group,'branches');
  assert.equal(imported.animation!.frames[0].pixels.saved,imported.animation!.frames[0].pixels.__proto__);
  assert.throws(()=>edit(art,[{op:'set_layer_group',layer:'saved',group:'x'.repeat(61)}]));
  assert.throws(()=>edit(art,[{op:'move_layer',layer:'saved',index:-1}]));
});

test('dense legacy cels normalize by exact RGBA value, with references charged separately',()=>{
  const source=createDocument('Legacy',2,1);
  source.layers[0].pixels[0]=0x11000000;
  source.animation={fps:8,frames:[
    {id:'copy',pixels:{base:[0x11000000,0]}},
    {id:'other',pixels:{base:[0x22000000,0]}},
    {id:'return',pixels:{base:[0x11000000,0]}}]};
  source.reference={name:'Guide',width:2,height:1,pixels:source.layers[0].pixels.slice()};
  const doc=validateDocument(source);
  assert.equal(documentCells(doc),4);
  assert.equal(doc.layers[0].pixels,doc.animation!.frames[0].pixels.base);
  assert.equal(doc.layers[0].pixels,doc.animation!.frames[2].pixels.base);
  assert.notEqual(doc.layers[0].pixels,doc.animation!.frames[1].pixels.base);
  assert.notEqual(doc.layers[0].pixels,source.layers[0].pixels);
  const hole=Array<number>(2);hole[0]=0;
  assert.throws(()=>validateDocument({...doc,layers:[{...doc.layers[0],pixels:hole}]}),/pixels/);
});

test('cropped cels expand and shrink across tile edges and retain RGB beneath zero alpha',()=>{
  const source=createDocument('Wisteria highlights',1024,1024);
  const hidden=0xdeadbe00;
  const pair=edit(source,[
    {op:'replace_cel',x:1020,y:1012,width:3,height:2,pixels:[0,hidden,0,0,0,0]},
    {op:'frame_add'},
    {op:'pixel',frame:1,x:1006,y:995,color:'#abcdef01'},
  ]);
  const original=pair.layers[0].pixels;
  assert.deepEqual(original,{x:1021,y:1012,width:1,height:1,data:[hidden]});
  assert.equal(documentCells(pair),1+16*18);
  const erased=edit(pair,[{op:'pixel',frame:1,x:1006,y:995,color:'transparent'}]);
  assert.deepEqual(erased.animation!.frames[0].pixels.base,original);
  const blank=edit(erased,[{op:'replace_cel',frame:1,x:0,y:0,width:0,height:0,pixels:[]}]);
  assert.deepEqual(blank.animation!.frames[0].pixels.base,{x:0,y:0,width:0,height:0,data:[]});
  assert.equal(documentCells(blank),1);
  assert.equal(blank.layers[0].pixels,original);
  assert.throws(()=>edit(blank,[{op:'replace_cel',x:1023,y:0,width:2,height:1,pixels:[1,2]}]),/width/);
  assert.throws(()=>validateDocument({...blank,layers:[{...blank.layers[0],pixels:{x:1023,y:0,width:2,height:1,data:[1,2]}}]}),/pixels/);
});

test('independently redrawn identical cels have the same meter before and after reopening',()=>{
  const stroke={op:'pixel',x:125,y:61,color:'#bc19aa00'};
  const base=edit(createDocument('Meter stability',256,256),[stroke,{op:'add_layer',id:'flowers'},{op:'frame_add',blank:true}]);
  const next=edit(base,[{...stroke,frame:1,layer:'flowers'},{...stroke,x:126,frame:1,layer:'base'}]);
  assert.equal(next.animation!.frames[0].pixels.flowers,next.layers[0].pixels);
  assert.notEqual(next.animation!.frames[0].pixels.base,next.layers[0].pixels);
  assert.equal(documentCells(next),2);
  const reopened=validateDocument(unpackProject(JSON.parse(JSON.stringify(packProject(next)))));
  assert.deepEqual(documentCapacity(reopened),documentCapacity(next));
  const shifted=edit(next,[{op:'clear',layer:'flowers',frame:1},{...stroke,frame:1,layer:'flowers',x:126}]);
  assert.equal(shifted.animation!.frames[0].pixels.flowers,shifted.animation!.frames[0].pixels.base);
  assert.equal(documentCells(shifted),2);
});
