import {celData,celPixel} from '../lib/cel-storage.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {applyCommands,applySnapshotCommands,createCompactDocument,createDocument,color,composite,frameCount,frameView,readRegion,validateDocument,canvasCapacity,documentCapacity,documentCells,MAX_LAYERS,MAX_ANIMATION_FRAMES,type AnimationClip} from '../lib/pixels.ts';
import {EFFECT_KINDS,EFFECT_PRESETS,EFFECT_GROUPS,effectCel,effectPixels,generateEffectCommands,regenerateEffectCommands,hasFreeEffectLayerSlot} from '../lib/effects.ts';
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
  assert.equal(celPixel(base.layers[0].pixels,1,1,base.width),color('#ff0000'));
  assert.equal(celPixel(base.layers[0].pixels,2,2,base.width),0);
  assert.equal(celPixel(frameView(base,1).layers[0].pixels,0,0,base.width),color('#ff0000'));
  assert.equal(celPixel(frameView(base,1).layers[0].pixels,1,1,base.width),0);
  assert.equal(celPixel(frameView(base,1).layers[0].pixels,2,2,base.width),color('#00ff00'));
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
  assert.equal(celPixel(frameView(doc,1).layers[1].pixels,0,0,doc.width),color('#abcdef80'));
  assert.equal(celPixel(frameView(doc,0).layers[1].pixels,0,0,doc.width),0);
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
  assert.equal(celPixel(frameView(d,1).layers[0].pixels,0,0,d.width),0);
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
test('the default sheet grid fits large animations even when its last row would exceed the output limit',()=>{
 const d=createDocument('High tide',600,600);
 const blank=d.layers[0].pixels;
 d.animation={fps:6,frames:Array.from({length:10},(_,i)=>({id:`f-${i+1}`,pixels:{base:blank}}))};
 assert.throws(()=>buildSpriteSheet(d,8),/export pixel limit/);
 const sheet=buildSpriteSheet(d);
 assert.equal(sheet.atlas.frames.length,11);
 assert.equal(sheet.width*sheet.height,600*600*11);
 const last=sheet.atlas.frames[10];
 assert.ok(last.x+last.width<=sheet.width && last.y+last.height<=sheet.height);
});

test('layer-capacity recovers after deletion, while visibility does not free slots',()=>{
 const recipe={kind:'sparkles' as const,seed:53,ink:'#f6da92'};
 let doc=applyCommands(createDocument('Layer cap',16,16),
   Array.from({length:MAX_LAYERS-1},(_,i)=>({op:'add_layer',id:'layer-'+(i+1),name:'Layer '+(i+1)})));
 assert.equal(doc.layers.length,MAX_LAYERS);
 assert.equal(hasFreeEffectLayerSlot(doc),false);
 assert.throws(()=>generateEffectCommands(doc,recipe),/free layer/);
 doc=applyCommands(doc,[{op:'visibility',layer:'layer-7',visible:false}]);
 assert.equal(doc.layers.length,MAX_LAYERS,'hiding must not consume or release a layer slot');
 assert.throws(()=>generateEffectCommands(doc,recipe),/free layer/);
 doc=applyCommands(doc,[{op:'delete_layer',layer:'layer-7'}]);
 assert.equal(doc.layers.length,MAX_LAYERS-1);
 assert.equal(hasFreeEffectLayerSlot(doc),true,'Generate must re-enable as soon as a layer is removed');
 assert.equal(Object.keys(doc.animation?.frames[0].pixels||{}).length,0);
 doc=applyCommands(doc,generateEffectCommands(doc,recipe));
 assert.equal(doc.layers.length,MAX_LAYERS,'generation must be usable again after deleting a layer');
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
  assert.equal(celPixel(animated.layers[0].pixels,1,1,animated.width),color('#ffffff'));
  assert.equal(animated.layers.length,2);
  assert.ok(celData(frameView(animated,1).layers[1].pixels).some(Boolean));
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
    assert.equal(celPixel(withFx.layers[0].pixels,1,1,withFx.width),color('#aabbcc'),kind);
    assert.ok(celData(frameView(withFx,2).layers[1].pixels).some(Boolean),kind);
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

test('saved VFX recipes survive import and can be regenerated without touching other artwork',()=>{
 const d=applyCommands(createDocument('Reusable VFX',32,32),[{op:'pixel',x:0,y:0,color:'#abcdef'}]);
 const recipe={kind:'sparkles' as const,seed:53,ink:'#ffd8aa',speed:1,opacity:1,drift:0};
 const first=applyCommands(d,generateEffectCommands(d,recipe));
 const fx=first.layers.find(l=>l.effect)!;
 assert.ok(fx,'created FX layer must remember its recipe');
 assert.deepEqual(fx.effect,recipe);
 const modified=applyCommands(first,regenerateEffectCommands(first,fx.id,{...recipe,seed:117,speed:2,opacity:.5,drift:1}));
 assert.equal(modified.layers.length,2);
 assert.equal(celPixel(modified.layers[0].pixels,0,0,modified.width),color('#abcdef'));
 assert.equal(frameCount(modified),frameCount(first));
 assert.equal(modified.layers.find(l=>l.id===fx.id)?.effect?.seed,117);
 assert.equal(modified.layers.find(l=>l.id===fx.id)?.effect?.speed,2);
 assert.notDeepEqual(composite(frameView(first,3)),composite(frameView(modified,3)));
 assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(modified))),modified);
 assert.throws(()=>regenerateEffectCommands(d,'base',recipe),/generated effect layer/);
});
test('invalid procedural recipes cannot be imported or attached',()=>{
 const doc=createDocument('Recipe validation',8,8);
 assert.throws(()=>applyCommands(doc,[{op:'effect_recipe',layer:'base',recipe:{
  kind:'sparkles',seed:12,ink:'#fffddd',speed:0,opacity:1,drift:0
 }}]),/Invalid procedural/);
 const copy=structuredClone(doc);
 copy.layers[0].effect={kind:'sparkles',seed:4,ink:'#fffddd',speed:1,opacity:1,drift:99};
 assert.throws(()=>validateDocument(copy),/Invalid procedural/);
});

test('independent frame estimates and held cel capacity distinguish artwork from timeline slots',()=>{
  assert.deepEqual(canvasCapacity(128,128,3,18),{maxFrames:85,maxLayers:14});
  assert.deepEqual(canvasCapacity(320,180,3,18),{maxFrames:24,maxLayers:4});
  assert.deepEqual(canvasCapacity(1024,1024,1,1,true),{maxFrames:3,maxLayers:3});
  assert.deepEqual(canvasCapacity(1024,1024,1,1),{maxFrames:4,maxLayers:4});
  const doc=applyCommands(createDocument('Wisteria',128,128),[
    {op:'add_layer',id:'blossoms'},{op:'add_layer',id:'lamp'},
    ...Array.from({length:17},()=>({op:'frame_add'})),
  ]);
  assert.equal(documentCells(doc),0);
  assert.deepEqual(documentCapacity(doc),{maxFrames:96,maxLayers:64,remainingCelBuffers:256,blankAvailable:true,storedCells:0,remainingCells:4194304});
  assert.deepEqual(frameView(doc,17).layers.map(layer=>layer.pixels===doc.layers[0].pixels),[true,true,true]);
});
test('96 frames and 64 layers support late-cel edits, FX, named clips, imports and exports',()=>{
  const base=createDocument('Long loop',6,8);
  const long=applyCommands(base,Array.from({length:95},()=>({op:'frame_add'})));
  const fx=generateEffectCommands(long,{seed:53,kind:'sparkles',ink:'#ffeecc'});
  const final=applyCommands(long,[...fx,...Array.from({length:62},(_,i)=>({op:'add_layer',id:'extra-'+i})),
    {op:'clip_set',name:'ending',from:94,to:95,fps:10,mode:'loop'},
    {op:'text_set',layer:'extra-61',text:{text:'A',x:0,y:0,color:'#ffeecc',scale:1,spacing:0,frame:95}}]);
  assert.equal(MAX_ANIMATION_FRAMES,96);assert.equal(MAX_LAYERS,64);
  assert.equal(frameCount(final),96);assert.equal(final.layers.length,64);
  assert.equal(final.layers.at(-1)?.text?.frame,95);
  assert.deepEqual(buildSpriteSheet(final).atlas.clips?.[0].frames,[94,95]);
  assert.deepEqual(validateDocument(final),final);
  assert.throws(()=>applyCommands(final,[{op:'frame_add'}]),/96 frames/);
  assert.throws(()=>applyCommands(final,[{op:'add_layer',id:'overflow'}]),/64 layers/);
  assert.throws(()=>validateDocument({...final,layers:[...final.layers,final.layers[0]]}),/64 layers/);
  assert.throws(()=>validateDocument({...final,animation:{...final.animation,frames:[...final.animation!.frames,final.animation!.frames[0]]}}),/animation settings/);
});

test('weather fits a new still to actual cropped work and available pixels, preserving existing timeline lengths',()=>{
  const still=createCompactDocument('Rain',1024,1024),recipe={kind:'rain' as const,seed:53,ink:'#4499cc'};
  const blank=applySnapshotCommands(still,generateEffectCommands(still,recipe));
  assert.equal(frameCount(blank),4);
  const reference={width:1024,height:1024,name:'Guide',pixels:new Array<number>(1024*1024).fill(0)};
  const guided={...still,reference};
  const shorter=applySnapshotCommands(guided,generateEffectCommands(guided,recipe));
  assert.equal(frameCount(shorter),3);
  const five=applySnapshotCommands(still,Array.from({length:4},()=>({op:'frame_add'})));
  assert.throws(()=>generateEffectCommands(five,recipe),/too large/);
  const fullLayers=Array.from({length:2},(_,i)=>({...still.layers[0],id:'l'+i,
    pixels:{x:0,y:0,width:1024,height:1024,data:new Array<number>(1024*1024).fill(i+1)}}));
  assert.throws(()=>generateEffectCommands({...guided,layers:fullLayers},recipe),/available project pixels/);
});

test('regeneration releases all slots of a held drawing before charging its replacements',()=>{
  const doc=createCompactDocument('Blast',1024,1024),recipe={kind:'explosion' as const,seed:53,ink:'#4499cc',speed:1,opacity:1,drift:0};
  const base=doc.layers[0],solid={x:0,y:0,width:1024,height:1024,data:Array<number>(1024*1024).fill(0xf87722ff)};
  const fx={...base,id:'fx',name:'Old blast',effect:recipe,pixels:solid};
  const scenery=[1,2].map(i=>({...base,id:'bg'+i,pixels:{...solid,data:Array<number>(solid.data.length).fill(i)}}));
  const layers=[base,...scenery,fx];
  const held=Object.fromEntries(layers.map(layer=>[layer.id,layer.pixels]));
  const original={...doc,layers,reference:{name:'Guide',width:1024,height:1024,pixels:Array<number>(1024*1024).fill(0)},
    animation:{fps:8,frames:[{id:'middle',pixels:{...held}},{id:'end',pixels:{...held}}]}};
  const commands=regenerateEffectCommands(original,'fx',recipe);
  assert.throws(()=>applySnapshotCommands(original,commands.filter(c=>c.op!=='clear')),/pixel budget/);
  const replaced=applySnapshotCommands(original,commands);
  assert.equal(frameCount(replaced),3);
  assert.equal(replaced.layers[0].pixels,base.pixels);
  assert.deepEqual(replaced.layers.at(-1)!.pixels,effectCel(1024,1024,0,3,recipe));
});
