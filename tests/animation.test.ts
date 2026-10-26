import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {applyCommands,createDocument,color,composite,frameCount,frameView,readRegion,validateDocument} from '../lib/pixels.ts';
import {effectPixels,generateEffectCommands} from '../lib/effects.ts';
import {buildSpriteSheet} from '../lib/sprite-sheet.ts';
import {encodeRgbaPng} from '../lib/png.ts';
import {encodeBrowserRgba} from '../lib/browser-png.ts';

test('legacy static canvases still round-trip and display one frame',()=>{
  const source=applyCommands(createDocument('Legacy',3,3),[{op:'pixel',x:1,y:1,color:'#caffee'}]);
  assert.equal(frameCount(source),1);
  assert.equal(frameView(source,0),source);
  assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(source))),source);
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
