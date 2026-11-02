import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clipRange,clipColor,clipsAtFrame} from '../lib/clip-range.ts';
import type {AnimationClip} from '../lib/pixels.ts';

test('dragging a timeline range works in either direction and clamps to legal frames',()=>{
 assert.deepEqual(clipRange(2,7,10),{from:2,to:7});
 assert.deepEqual(clipRange(7,2,10),{from:2,to:7});
 assert.deepEqual(clipRange(-9,99,8),{from:0,to:7});
 assert.deepEqual(clipRange(0,0,1),{from:0,to:0});
 assert.throws(()=>clipRange(0,4,0));
});
test('clip markers consistently identify overlapping named animations',()=>{
 const clips:AnimationClip[]=[
 {name:'idle',from:0,to:2,fps:4,mode:'loop'},
 {name:'walk',from:1,to:4,fps:8,mode:'pingpong'},
 {name:'attack',from:4,to:5,fps:10,mode:'once'},
 ];
 assert.deepEqual(clipsAtFrame(clips,1).map(x=>x.clip.name),['idle','walk']);
 assert.deepEqual(clipsAtFrame(clips,4).map(x=>x.clip.name),['walk','attack']);
 assert.deepEqual(clipsAtFrame(clips,6),[]);
 assert.equal(clipColor(0),clipColor(6));
});
