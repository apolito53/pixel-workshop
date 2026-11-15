import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applySnapshotCommands as edit,createDocument,documentCapacity,documentCells,MAX_ANIMATION_CELLS,frameView,validateDocument} from '../lib/pixels.ts';

test('a 64-layer, 96-frame scene charges held artwork once and detaches only the painted cel',()=>{
  const base=createDocument('Coast',320,180);
  const doc=edit(base,[{op:'pixel',x:1,y:1,color:'#110033'},
    ...Array.from({length:63},(_,i)=>({op:'add_layer',id:'tree-'+i})),
    ...Array.from({length:95},()=>({op:'frame_add'}))]);
  const area=320*180;
  assert.equal(documentCells(doc),2*area);
  const painted=edit(doc,[{op:'pixel',layer:'tree-62',frame:95,x:1,y:1,color:'#aa3388'}]);
  assert.equal(documentCells(painted),3*area);
  assert.equal(painted.animation!.frames[94].pixels['tree-62'][321],0xaa3388ff);
  assert.equal(painted.animation!.frames[93].pixels['tree-62'],doc.layers[1].pixels);
  assert.equal(doc.animation!.frames[94].pixels['tree-62'][321],0);
  const remapped=edit(painted,[{op:'palette_remap',fromColor:'#110033',toColor:'#334455'}]);
  assert.equal(documentCells(remapped),3*area);
  assert.equal(remapped.layers[0].pixels,remapped.animation!.frames[94].pixels.base);
  assert.equal(remapped.layers[0].pixels[321],0x334455ff);
  assert.equal(doc.layers[0].pixels[321],0x110033ff);
  const restored=edit(remapped,[{op:'hold_cel',layer:'tree-62',frame:95,source_frame:1}]);
  assert.equal(documentCells(restored),2*area);
  const noChange=edit(restored,[{op:'pixel',layer:'tree-62',frame:95,x:0,y:0,color:'transparent'}]);
  assert.equal(documentCells(noChange),2*area);
});

test('a full drawing budget permits held frames, independent edits in place, and reusing existing drawings',()=>{
  const source=createDocument('Four drawings',1024,1024);
  const full=edit(source,[...Array.from({length:4},()=>({op:'frame_add'})),
    ...Array.from({length:3},(_,i)=>({op:'pixel',frame:i+1,x:i,y:i,color:'#778899'}))]);
  assert.equal(documentCells(full),MAX_ANIMATION_CELLS);
  assert.equal(documentCapacity(full).remainingCelBuffers,0);
  assert.equal(documentCapacity(full).maxLayers,64);
  const withLayer=edit(full,[{op:'add_layer',id:'holds'},{op:'frame_add',source_frame:1}]);
  assert.throws(()=>edit(withLayer,[{op:'pixel',frame:5,x:8,y:3,color:'#ffffff'}]),/pixel budget/);
  assert.equal(withLayer.animation!.frames[4].pixels.base[8+3*1024],0);
  const same=edit(withLayer,[{op:'pixel',layer:'holds',frame:4,x:0,y:0,color:'#778899'}]);
  assert.equal(same.animation!.frames[3].pixels.holds,same.animation!.frames[0].pixels.base);
  const whole=edit(full,[{op:'pixel',frame:2,x:15,y:11,color:'#ffffff'}]);
  assert.equal(documentCells(whole),MAX_ANIMATION_CELLS);
  assert.equal(full.animation!.frames[1].pixels.base[15+11*1024],0);
  const repeated=edit(source,[
    {op:'pixel',x:0,y:0,color:'#aa0000'},
    {op:'frame_add'},{op:'pixel',frame:1,x:0,y:0,color:'#00aa00'},
    {op:'frame_add'},{op:'pixel',frame:2,x:0,y:0,color:'#0000aa'},
    {op:'frame_add',source_frame:1},{op:'pixel',frame:3,x:0,y:0,color:'#aa0000'}]);
  assert.equal(repeated.animation!.frames[2].pixels.base,repeated.layers[0].pixels);
  assert.equal(documentCapacity(repeated).remainingCelBuffers,1);
  assert.equal(documentCapacity(repeated).maxLayers,64);
  const allInk=edit(whole,[{op:'frame_delete',frame:4},{op:'pixel',x:5,y:3,color:'#ffffff'}]);
  assert.deepEqual(documentCapacity(allInk),{maxFrames:96,maxLayers:1,blankAvailable:false,remainingCelBuffers:0});
  assert.throws(()=>edit(allInk,[{op:'add_layer',id:'empty'}]),/pixel budget/);
  assert.equal(edit(allInk,[{op:'duplicate_layer',layer:'base',id:'backup'}]).layers.length,2);
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
  assert.equal(frameView(detached,1).layers[0].pixels[1],0x123456ff);
  assert.equal(frameView(detached,1).layers[2].pixels[1],0xeeeeeeff);
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
  assert.equal(documentCells(doc),6);
  assert.equal(doc.layers[0].pixels,doc.animation!.frames[0].pixels.base);
  assert.equal(doc.layers[0].pixels,doc.animation!.frames[2].pixels.base);
  assert.notEqual(doc.layers[0].pixels,doc.animation!.frames[1].pixels.base);
  assert.notEqual(doc.layers[0].pixels,source.layers[0].pixels);
  const hole=Array<number>(2);hole[0]=0;
  assert.throws(()=>validateDocument({...doc,layers:[{...doc.layers[0],pixels:hole}]}),/pixels/);
});
