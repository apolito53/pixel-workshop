import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommands,applySnapshotCommands,color,createDocument,frameCount,frameView, type PixelDocument} from '../lib/pixels.ts';
import {windAngle,windPose} from '../lib/wind.ts';

const bake = {op:'wind_bake',layer:'branch',pivot_x:8,pivot_y:13,degrees:25,frames:12,delay:2};
function scene() {
  return applyCommands(createDocument('Pinned branch',17,17),[
    {op:'pixel',x:0,y:0,color:'#b2bace'}, {op:'add_layer',id:'branch'},
    {op:'line',layer:'branch',x:8,y:1,x2:8,y2:13,color:'#008855a0'},
    {op:'pixel',layer:'branch',x:8,y:13,color:'#846443'}
  ]);
}
const cel=(d:PixelDocument,i:number)=>frameView(d,i).layers[1].pixels;

test('wind moves the tip, fixes the pivot, preserves alpha and holds repeated poses',()=>{
  const old=scene(), next=applySnapshotCommands(old,[bake]);
  assert.equal(frameCount(next),12);
  assert.deepEqual(cel(next,2),cel(old,0));
  assert.strictEqual(cel(next,2),cel(next,8));
  assert.strictEqual(cel(next,3),cel(next,7));
  assert.notDeepEqual(cel(next,5),cel(next,2));
  assert.equal(cel(next,5)[1*17+8],0);
  for(let i=0;i<12;i++) {
    assert.equal(cel(next,i)[13*17+8],color('#846443'));
    assert.ok(cel(next,i).some(p=>p===color('#008855a0')));
    assert.deepEqual(frameView(next,i).layers[0].pixels, old.layers[0].pixels);
    assert.equal(windAngle(i,12,25,2),windAngle(i+12,12,25,2));
  }
  const edited=applySnapshotCommands(next,[{op:'pixel',layer:'branch',frame:2,x:1,y:1,color:'#aa3355'}]);
  assert.equal(cel(edited,8)[18],0);
  assert.equal(cel(edited,2)[18],color('#aa3355'));
});

test('wind uses the selected source, preserves other animation and clips, and rejects invalid bakes atomically',()=>{
  let d=applyCommands(scene(),Array.from({length:11},()=>({op:'frame_add'})));
  d=applyCommands(d,[{op:'pixel',layer:'branch',frame:7,x:0,y:4,color:'#123456'},
    {op:'pixel',layer:'base',frame:8,x:0,y:0,color:'#ff44aa'},{op:'clip_set',name:'gust',from:2,to:9}]);
  const old=structuredClone(d);
  const baked=applyCommands(d,[{...bake,source_frame:7}]);
  assert.deepEqual(cel(baked,2),cel(d,7));
  for(let i=0;i<12;i++){
    assert.deepEqual(cel(baked,i),windPose(cel(d,7),17,17,8,13,windAngle(i,12,25,2)));
    assert.deepEqual(frameView(baked,i).layers[0].pixels,frameView(d,i).layers[0].pixels);
  }
  assert.deepEqual(baked.animation!.clips,d.animation!.clips);
  for(const bad of [{pivot_y:-1},{delay:12},{frames:6},{degrees:NaN},{layer:'absent'}])
    assert.throws(()=>applySnapshotCommands(d,[{...bake,...bad}]));
  assert.deepEqual(d,old);
});

test('rebaking a full project releases old animated poses before allocating new ones',()=>{
  const base=createDocument('Full loop',1024,1024);
  const drawing=base.layers[0].pixels;
  drawing[1]=color('#779944');
  const d=applySnapshotCommands(base,[
    {op:'frame_add'},{op:'frame_add'},{op:'frame_add'},
    ...[1,2,3].map(frame=>({op:'pixel',frame,x:200+frame,y:0,color:'#1122aa'}))
  ]);
  const baked=applySnapshotCommands(d,[{op:'wind_bake',layer:'base',frames:4,pivot_x:0,pivot_y:1023,delay:1,degrees:2}]);
  assert.equal(frameCount(baked),4);
  assert.deepEqual(baked.animation!.frames[0].pixels.base,drawing);
  assert.strictEqual(baked.animation!.frames[2].pixels.base,baked.animation!.frames[0].pixels.base);
});
