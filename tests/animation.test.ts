import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {applyCommands,createDocument,color,composite,frameCount,frameView,readRegion,validateDocument,type AnimationClip} from '../lib/pixels.ts';
import {EFFECT_KINDS,EFFECT_PRESETS,EFFECT_GROUPS,effectPixels,generateEffectCommands,hasFreeEffectLayerSlot} from '../lib/effects.ts';
import {buildSpriteSheet} from '../lib/sprite-sheet.ts';
import {encodeRgbaPng} from '../lib/png.ts';
import {encodeBrowserRgba} from '../lib/browser-png.ts';

test('legacy static canvases still round-trip and display one frame',()=>{
  const source=applyCommands(createDocument('Legacy',3,3),[{op:'pixel',x:1,y:1,color:'#caffee'}]);
  assert.equal(frameCount(source),1);
  assert.equal(frameView(source,0),source);
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(source))),source);
});
test('adding the same frame is deterministic during optimistic saves and rebasing',()=>{
 const base=createDocument('Deterministic',4,4),ops=[{op:'frame_add'}];
 const first=applyCommands(base,ops),again=applyCommands(base,ops);
 assert.equal(first.animation!.frames[0].id,again.animation!.frames[0].id);
 const second=applyCommands(first,[{op:'frame_add',source_frame:1}]);
 assert.notEqual(second.animation!.frames[0].id,second.animation!.frames[1].id);
});
test('editing an animation frame leaves base art untouched; transforms use selected cel',()=>{
  const base=applyCommands(createDocument('Walker',4,4),[
    {op:'pixel',x:1,y:1,color:'#ff0000'},
    {op:'frame_add',source_frame:0},
    {op:'pixel',frame:1,x:2,y:2,color:'#00ff00'},
    {op:'transform',frame:1,mode:'move',x:1,y:1,width:1,height:1,x2:0,y2:0}
  ]);
  assert.equal(frameCount(base),2);
  assert.equal(base.layers[0].pixels[1+4],color('#ff0000'));
  assert.equal(base.layers[0].pixels[2+8],0);
  assert.equal(frameView(base,1).layers[0].pixels[0],color('#ff0000'));
  assert.equal(frameView(base,1).layers[0].pixels[1+4],0);
  assert.equal(frameView(base,1).layers[0].pixels[2+8],color('#00ff00'));
  assert.deepEqual(readRegion(base,'base',{x:0,y:0,width:1,height:1},1),[color('#ff0000')]);
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(base))),base);
});
test('layer management propagates to all frames; blank cels and frame deletion work',()=>{
  let doc=applyCommands(createDocument('Frames',2,2),[
    {op:'frame_add',source_frame:0,blank:true},
    {op:'add_layer',id:'glow',name:'Glow'},
    {op:'pixel',layer:'glow',frame:1,x:0,y:0,color:'#abcdef80'},
    {op:'set_fps',fps:12}
  ]);
  assert.equal(doc.animation?.fps,12);
  assert.equal(frameView(doc,1).layers[1].pixels[0],color('#abcdef80'));
  assert.equal(frameView(doc,0).layers[1].pixels[0],0);
  doc=applyCommands(doc,[{op:'delete_layer',layer:'base'}]);
  assert.equal(doc.layers.length,1);
  assert.deepEqual(Object.keys(doc.animation!.frames[0].pixels),['glow']);
  doc=applyCommands(doc,[{op:'frame_delete',frame:1}]);
  assert.equal(frameCount(doc),1);
  assert.throws(()=>applyCommands(doc,[{op:'frame_delete',frame:0}]));
});
test('invalid imported cels and impossible edits fail without modifying original source',()=>{
  const d=applyCommands(createDocument('Strict',2,2),[{op:'frame_add',source_frame:0}]);
  const bad=structuredClone(d);bad.animation!.frames[0].pixels.base=[1];
  assert.throws(()=>validateDocument(bad),/cel pixels/);
  assert.throws(()=>applyCommands(d,[{op:'pixel',frame:1,x:0,y:0,color:'#00ff00'},{op:'pixel',frame:2,x:0,y:0,color:'#ff0000'}]));
  assert.equal(frameView(d,1).layers[0].pixels[0],0);
});
test('sprite sheet exports exact RGBA and matching atlas coordinates',()=>{
  const d=applyCommands(createDocument('Two Frames',2,2),[
    {op:'pixel',x:0,y:0,color:'#ff0000'},
    {op:'frame_add',blank:true},
    {op:'pixel',frame:1,x:1,y:0,color:'#00ff0080'},
    {op:'set_fps',fps:10}
  ]);
  const sheet=buildSpriteSheet(d,2);
  assert.equal(sheet.width,4);assert.equal(sheet.height,2);
  assert.deepEqual(sheet.atlas.frames.map(f=>({x:f.x,y:f.y,durationMs:f.durationMs})),[
    {x:0,y:0,durationMs:100},{x:2,y:0,durationMs:100}
  ]);
  assert.deepEqual(Array.from(sheet.bytes.slice(0,4)),[255,0,0,255]);
  assert.deepEqual(Array.from(sheet.bytes.slice(12,16)),[0,255,0,128]);
  const png=PNG.sync.read(encodeRgbaPng(sheet.bytes,sheet.width,sheet.height));
  const browser=PNG.sync.read(Buffer.from(encodeBrowserRgba(sheet.bytes,sheet.width,sheet.height)));
  assert.deepEqual(png.data,browser.data);
  assert.deepEqual(png.data,Buffer.from(sheet.bytes));
});
test('layer-capacity recovers after deletion, while visibility does not free slots',()=>{
 const recipe={kind:'sparkles' as const,seed:53,ink:'#f6da92'};
 let doc=applyCommands(createDocument('Layer cap',16,16),
   Array.from({length:7},(_,i)=>({op:'add_layer',id:'layer-'+(i+1),name:'Layer '+(i+1)})));
 assert.equal(doc.layers.length,8);
 assert.equal(hasFreeEffectLayerSlot(doc),false);
 assert.throws(()=>generateEffectCommands(doc,recipe),/free layer/);
 doc=applyCommands(doc,[{op:'visibility',layer:'layer-7',visible:false}]);
 assert.equal(doc.layers.length,8,'hiding must not consume or release a layer slot');
 assert.throws(()=>generateEffectCommands(doc,recipe),/free layer/);
 doc=applyCommands(doc,[{op:'delete_layer',layer:'layer-7'}]);
 assert.equal(doc.layers.length,7);
 assert.equal(hasFreeEffectLayerSlot(doc),true,'Generate must re-enable as soon as a layer is removed');
 assert.equal(Object.keys(doc.animation?.frames[0].pixels||{}).length,0);
 doc=applyCommands(doc,generateEffectCommands(doc,recipe));
 assert.equal(doc.layers.length,8,'generation must be usable again after deleting a layer');
 assert.equal(hasFreeEffectLayerSlot(doc),false);
 assert.ok(doc.layers.some(l=>l.name==='Sparkles FX'));
});
test('seeded procedural VFX produce editable transparent layers, preserving original artwork',()=>{
  const base=applyCommands(createDocument('Campfire',32,32),[{op:'pixel',x:1,y:1,color:'#ffffff'}]);
  const recipe={kind:'embers' as const,seed:53,ink:'#ff963d'};
  assert.deepEqual(effectPixels(32,32,3,8,recipe),effectPixels(32,32,3,8,recipe));
  assert.notDeepEqual(effectPixels(32,32,3,8,recipe),effectPixels(32,32,4,8,recipe));
  const commands=generateEffectCommands(base,recipe);
  assert.equal(commands[0].op,'add_layer');
  const animated=applyCommands(base,commands);
  assert.ok(frameCount(animated)>1);
  assert.equal(animated.layers[0].pixels[33],color('#ffffff'));
  assert.equal(animated.layers.length,2);
  assert.ok(frameView(animated,1).layers[1].pixels.some(Boolean));
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(animated))),animated);
  assert.equal(composite(frameView(animated,1)).length,32*32*4);
});

test('the complete effect catalog is grouped, documented and has valid suggested colors',()=>{
  assert.equal(EFFECT_KINDS.length,12);
  assert.deepEqual(Object.keys(EFFECT_PRESETS),[...EFFECT_KINDS]);
  for (const kind of EFFECT_KINDS) {
    const preset=EFFECT_PRESETS[kind];
    assert.ok(EFFECT_GROUPS.includes(preset.group),kind);
    assert.ok(preset.label.length>2&&preset.description.length>12,kind);
    assert.equal(color(preset.suggestedInk)&255,255,kind);
  }
});

test('every effect rasterizes repeatably within canvas bounds and animates',()=>{
  for (const kind of EFFECT_KINDS) {
    const recipe={kind,seed:53,ink:'#c09aff'};
    for (const [width,height] of [[1,1],[8,16],[32,32],[48,24]]) {
      const pixels=effectPixels(width,height,2,8,recipe);
      assert.equal(pixels.length,width*height,kind);
      assert.deepEqual(pixels,effectPixels(width,height,2,8,recipe),kind+' seed changed');
      assert.ok(pixels.every(v=>Number.isInteger(v)&&v>=0&&v<=0xffffffff),kind+' invalid RGBA');
    }
    const image=effectPixels(32,32,2,8,recipe);
    assert.ok(image.some(Boolean),kind+' has no visible frame 2 pixels');
    assert.notDeepEqual(image,effectPixels(32,32,3,8,recipe),kind+' does not animate');
    if(kind!=='shockwave') {
      assert.notDeepEqual(image,effectPixels(32,32,2,8,{...recipe,seed:54}),kind+' ignores seed');
    }
  }
});

test('all generators become undoable pixel layers without altering existing art',()=>{
  for (const kind of EFFECT_KINDS) {
    const original=applyCommands(createDocument(kind,24,24),[{op:'pixel',x:1,y:1,color:'#aabbcc'}]);
    const ops=generateEffectCommands(original,{kind,seed:53,ink:EFFECT_PRESETS[kind].suggestedInk});
    const withFx=applyCommands(original,ops);
    assert.equal(frameCount(withFx),8,kind);
    assert.equal(withFx.layers.length,2,kind);
    assert.equal(withFx.layers[1].name,EFFECT_PRESETS[kind].label+' FX',kind);
    assert.equal(withFx.layers[0].pixels[25],color('#aabbcc'),kind);
    assert.ok(frameView(withFx,2).layers[1].pixels.some(Boolean),kind);
    assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(withFx))),withFx,kind);
  }
});

test('named animation clips survive import and export with independent playback modes',()=>{
 const d=applyCommands(createDocument('Clips',4,4),[
  {op:'frame_add'},{op:'frame_add'},{op:'frame_add'},{op:'frame_add'},
  {op:'clip_set',name:'Idle',from:0,to:1,fps:4,mode:'loop'},
  {op:'clip_set',name:'Walk',from:1,to:4,fps:12,mode:'pingpong'},
  {op:'clip_set',name:'Blink',from:3,to:4,fps:6,mode:'once'},
 ]);
 assert.equal(d.animation?.clips?.length,3);
 const atlas=buildSpriteSheet(d,2).atlas;
 assert.deepEqual(atlas.clips?.find(c=>c.name==='Walk')?.frames,[1,2,3,4,3,2]);
 assert.deepEqual(atlas.clips?.find(c=>c.name==='Blink')?.frames,[3,4]);
 assert.equal(atlas.clips?.find(c=>c.name==='Idle')?.fps,4);
 assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(d))),d);
 const updated=applyCommands(d,[{op:'clip_set',name:'WALK',from:0,to:3,fps:10,mode:'once'}]);
 assert.equal(updated.animation?.clips?.length,3,'clip names are case-insensitively unique');
 assert.equal(updated.animation?.clips?.find(c=>c.name==='WALK')?.to,3);
 assert.equal(applyCommands(updated,[{op:'clip_delete',name:'blink'}]).animation?.clips?.length,2);
});
test('deleting animation frames updates or removes named clip ranges atomically',()=>{
 const d=applyCommands(createDocument('Clip deletion',4,4),[
  {op:'frame_add'},{op:'frame_add'},{op:'frame_add'},
  {op:'clip_set',name:'Long',from:1,to:3,fps:8,mode:'loop'},
  {op:'clip_set',name:'Only',from:2,to:2,fps:8,mode:'once'},
 ]);
 const changed=applyCommands(d,[{op:'frame_delete',frame:2}]);
 assert.deepEqual(changed.animation?.clips,[{name:'Long',from:1,to:2,fps:8,mode:'loop'}]);
 assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(changed))),changed);
});
test('invalid clip metadata and impossible clip edits cannot damage originals',()=>{
 const d=applyCommands(createDocument('Clip validation',4,4),[{op:'frame_add'},{op:'clip_set',name:'Idle',from:0,to:1,fps:4,mode:'loop'}]);
 for(const bad of [{...d.animation!.clips![0],from:5},{...d.animation!.clips![0],fps:0},{...d.animation!.clips![0],mode:'infinite'}]){
  const copy=structuredClone(d);copy.animation!.clips=[bad as AnimationClip];
  assert.throws(()=>validateDocument(copy),/Invalid or duplicate animation clip/);
 }
 assert.throws(()=>applyCommands(d,[{op:'clip_set',name:'Invalid',from:1,to:8,fps:8}]),/to/);
 assert.equal(d.animation?.clips?.length,1);
});
