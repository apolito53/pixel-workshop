import test from 'node:test';
import assert from 'node:assert/strict';
import {applySnapshotCommands,createDocument} from '../lib/pixels.ts';
import {buildSpriteSheet} from '../lib/sprite-sheet.ts';

test('oversize sheets reuse visible held poses and retain timeline and clip indices',()=>{
  const d=applySnapshotCommands(createDocument('Large holds',384,384),[
    {op:'pixel',x:0,y:0,color:'#228811'},{op:'add_layer',id:'hidden'},
    {op:'visibility',layer:'hidden',visible:false},
    ...Array.from({length:95},()=>({op:'frame_add'})),
    {op:'pixel',layer:'hidden',frame:1,x:1,y:1,color:'#110099'},
    {op:'pixel',frame:93,x:0,y:0,color:'#aa1212'},
    {op:'hold_cel',frame:95,source_frame:93},{op:'clip_set',name:'Gust',from:93,to:95}
  ]);
  const sheet=buildSpriteSheet(d);
  assert.deepEqual([sheet.width,sheet.height],[768,384]);
  assert.equal(sheet.atlas.frames.length,96);
  assert.deepEqual(sheet.atlas.clips?.[0].frames,[93,94,95]);
  assert.deepEqual(sheet.atlas.frames.slice(93).map(f=>f.x),[384,0,384]);
  assert.equal(sheet.atlas.frames[1].x,0);
  assert.deepEqual([...sheet.bytes.subarray(384*4,384*4+4)],[170,18,18,255]);
  assert.deepEqual([...sheet.bytes.subarray(0,4)],[34,136,17,255]);
});
