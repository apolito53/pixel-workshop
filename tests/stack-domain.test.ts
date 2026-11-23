import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommands, applySnapshotCommands, createCompactDocument, createStackDocument, documentCapacity, documentCells, frameCount, readRegion, validateDocument, type PixelDocument} from '../lib/pixels.ts';
import {packEntry, packLegacyProject, packProject, projectSummary, unpackEntry, unpackProject} from '../lib/project-codec.ts';
import {ProjectService} from '../lib/project-service.ts';
import {EditQueue} from '../lib/edit-queue.ts';
import {effectCapacity,generateEffectCommands,regenerateEffectCommands} from '../lib/effects.ts';
import {parseUiReturn} from '../lib/ui-return.ts';
import {buildSpriteSheet} from '../lib/sprite-sheet.ts';

const plane=(d:PixelDocument,i:number)=>readRegion(d,'base',{x:0,y:0,width:1,height:1},i)[0];
const indexes=(d:PixelDocument)=>Array.from({length:frameCount(d)},(_,i)=>plane(d,i));

test('sparse stacked artwork above the old animation and dense sheet limits is editable and persists without dense allocation',()=>{
  let tree:PixelDocument=createStackDocument('Tree',1024,1024,512,{origin:[120,120],zMin:-24,sliceHeight:1});
  assert.equal(documentCells(tree),0);
  assert.equal(documentCapacity(tree).maxFrames,512);
  tree=applySnapshotCommands(tree,[{op:'pixel',x:0,y:0,frame:157,color:'#e1a9ed'},{op:'pixel',x:1023,y:1023,frame:511,color:'#754d36'}]);
  assert.equal(documentCells(tree),2);
  const packed=packEntry({doc:tree,undo:[],redo:[]});
  assert(JSON.stringify(packed).length<40_000);
  const restored=unpackEntry(JSON.parse(JSON.stringify(packed))).doc;
  assert.deepEqual(projectSummary(packed.doc).stack,tree.stack);
  assert.equal(plane(restored,157),0xe1a9edff);
  assert.equal(readRegion(restored,'base',{x:1023,y:1023,width:1,height:1},511)[0],0x754d36ff);
  assert.equal(restored.layers[0].pixels,restored.animation!.frames[0].pixels.base);
  assert.throws(()=>applyCommands(restored,[{op:'slice_insert',index:512}]),/limit/);
  assert.throws(()=>applyCommands(restored,[{op:'stack_disable'}]),/96/);
  assert.throws(()=>packLegacyProject(restored),/does not support|capacity/);
  assert.throws(()=>createStackDocument('Too many',10,10,513),/512/);
  const sprite=createCompactDocument('Sprite',10,10);
  assert.equal(documentCapacity(sprite).maxFrames,96);
  assert.equal(projectSummary(packProject(sprite)).stack,undefined);
  assert.equal(unpackProject(JSON.parse(JSON.stringify(packProject(sprite)))).stack,undefined);
});

test('slice ordering, including insertion and deletion at floor level, preserves clip ranges and independent cels',()=>{
  const d=createCompactDocument('Cutaway',4,4);
  let doc=applyCommands(d,[{op:'pixel',x:0,y:0,color:'#aa0000'},{op:'frame_add',blank:true},
    {op:'pixel',x:0,y:0,frame:1,color:'#00bb00'},{op:'frame_add',blank:true},
    {op:'pixel',x:0,y:0,frame:2,color:'#0000cc'},{op:'clip_set',name:'Accent',from:1,to:2}]);
  const old=doc, rgb=indexes(doc);
  doc=applySnapshotCommands(doc,[{op:'stack_settings',zMin:-3,origin:[1.5,2],sliceHeight:.5,view:{yaw:387,pitch:55,zoom:1.5,spread:.3}}]);
  assert.equal(doc.stack!.view?.yaw,27);
  assert.equal(old.stack,undefined);
  assert.deepEqual(doc.animation!.clips,old.animation!.clips);
  doc=applySnapshotCommands(doc,[{op:'slice_insert',index:0,source_slice:2}]);
  assert.deepEqual(indexes(doc),[rgb[2],...rgb]);
  assert.deepEqual(doc.animation!.clips!.map(c=>[c.from,c.to]),[[2,3]]);
  const before=doc;
  doc=applySnapshotCommands(doc,[{op:'pixel',x:0,y:0,frame:0,color:'#dc82c0'},{op:'slice_move',from:3,to:0}]);
  assert.deepEqual(indexes(doc),[rgb[2],0xdc82c0ff,rgb[0],rgb[1]]);
  assert.deepEqual(indexes(before),[rgb[2],...rgb]);
  doc=applySnapshotCommands(doc,[{op:'slice_delete',index:0},{op:'stack_settings',view:null},{op:'stack_disable'}]);
  assert.deepEqual(indexes(doc),[0xdc82c0ff,rgb[0],rgb[1]]);
  assert.equal(doc.stack,undefined);
  assert.deepEqual(doc.animation!.clips!.map(c=>[c.from,c.to]),[[1,2]]);
  assert.equal(validateDocument(doc).animation!.frames.length,2);
  assert.throws(()=>applyCommands(d,[{op:'slice_delete',index:0}]),/stack/);
  assert.throws(()=>applyCommands(createStackDocument('One',1,1,1),[{op:'slice_delete',index:0}]),/one slice/);
});

test('saved stack metadata and encoded allocation bounds are verified before oversized records can decode',()=>{
  const sample=createStackDocument('S',4,4,2);
  for(const stack of [null,{}, {origin:[1],zMin:0,sliceHeight:1},{...sample.stack,sliceHeight:0},
      {...sample.stack,view:{yaw:0,pitch:100,spread:0,zoom:1}}]){
    assert.throws(()=>validateDocument({...sample,stack}),/stack/i);
    assert.throws(()=>unpackProject({...packProject(sample),stack}),/stack/i);
  }
  const packet=JSON.parse(JSON.stringify(packProject(createStackDocument('Large footprint',1024,1024,5))));
  // Five unrelated declared full canvases exceed the existing 4M word budget.
  packet.cels=Array.from({length:5},()=>({x:0,y:0,width:1024,height:1024,data:'bad'}));
  packet.animation.frames.forEach((f:{pixels:{base:number}},i:number)=>{f.pixels.base=i+1;});
  assert.throws(()=>unpackProject(packet),/Invalid packed/);
  const deep=packProject(createStackDocument('Deep',2,2,158));
  assert.equal(frameCount(validateDocument(unpackProject(deep))),158);
  const asSprite={...deep};
  delete asSprite.stack;
  assert.throws(()=>unpackProject(asSprite),/Invalid packed/);
});

test('single-sheet export bounds independent dense poses before allocating their combined canvas',()=>{
  const d=applySnapshotCommands(createStackDocument('Pages',1024,1024,5),
    Array.from({length:5},(_,i)=>({op:'pixel',frame:i,x:i,y:i,color:'#814aaf'})));
  assert.throws(()=>buildSpriteSheet(d),/sheet.*limit/i);
});

test('native stack edits, structural undo and redo survive a normal save queue and a packed storage reload',async()=>{
  const stored=new Map<string,string>();
  const service=new ProjectService({
    list:async()=>[],
    get:async id=>{const wire=stored.get(id);return wire?{entry:unpackEntry(JSON.parse(wire)),etag:wire}:null;},
    put:async(id,entry,etag)=>{
      if(etag!==stored.get(id))throw new Error('This project changed.');
      stored.set(id,JSON.stringify(packEntry(entry)));
    },
  });
  const imported=await service.create('',1,1,packProject(createStackDocument('Deep',240,240,158,{zMin:-24})));
  const q=new EditQueue({doc:imported,canUndo:false,canRedo:false},r=>service.editSnapshot(imported.id,r.revision,r.edits,r.requestId),()=>{},1000);
  try{
    q.enqueue({action:'paint',commands:[{op:'pixel',frame:157,x:0,y:0,color:'#c290dc'}]});
    q.enqueue({action:'paint',commands:[{op:'slice_move',from:157,to:0}]});
    assert.equal(plane(q.state.snapshot.doc,0),0xc290dcff);
    await q.flush();
    q.enqueue({action:'undo'});await q.flush();
    assert.equal(plane((await service.get(imported.id)).entry.doc,157),0xc290dcff);
    q.enqueue({action:'redo'});await q.flush();
    const final=(await service.get(imported.id)).entry.doc;
    assert.equal(plane(final,0),0xc290dcff);
    assert.deepEqual(final.stack,imported.stack);
    assert.equal(frameCount(final),158);
    await assert.rejects(service.edit(imported.id,0,'paint',[{op:'slice_delete',index:0}]),/changed/);
    assert.equal(plane((await service.get(imported.id)).entry.doc,0),0xc290dcff);
  }finally{q.dispose();}
});

test('temporal generators cannot overwrite spatial slices and UI returns preserve deep selections',()=>{
  const d=createStackDocument('Deep',8,8,158);
  const recipe={kind:'fire' as const,seed:17,ink:'#fbbe85'};
  assert.equal(effectCapacity(d).frames,0);
  assert.throws(()=>generateEffectCommands(d,recipe),/animation timeline/);
  assert.throws(()=>regenerateEffectCommands(d,'base',recipe),/animation timeline/);
  assert.throws(()=>applyCommands(d,[{op:'wind_bake'}]),/animation timeline/);
  const point={format:'pixel-workshop-ui-return/1',workspaceId:'local',projectId:'test',stack:true,frame:157,layer:'base',sections:['panel']};
  assert.deepEqual(parseUiReturn(JSON.stringify(point)),point);
  assert.equal(parseUiReturn(JSON.stringify({...point,frame:512})),null);
});

test('a deep sparse stack can be rendered and its final sheet exported without a dense volume',async()=>{
  const {createSpriteStackRenderer}=await import('../lib/sprite-stack-renderer.ts');
  const {planStackPages,encodeStackPage}=await import('../lib/sprite-stack-pages.ts');
  const doc=applySnapshotCommands(createStackDocument('Needle',256,256,258),[
    {op:'rect',frame:257,x:120,y:120,width:8,height:8,filled:true,color:'#fbc785'},
  ]);
  assert(doc.width*doc.height*frameCount(doc)>16_777_216);
  const frame=createSpriteStackRenderer().render(doc,{width:48,height:48,yaw:0,pitch:90});
  assert(frame.rgba.some((v,i)=>i%4===3&&v>0));
  const layout=planStackPages(doc);
  const last=layout.pages.length-1;
  assert.equal(layout.pages[last].firstSlice+layout.pages[last].sliceCount,258);
  const png=encodeStackPage(doc,layout,last);
  assert.deepEqual(Array.from(png.subarray(0,8)),[137,80,78,71,13,10,26,10]);
});
