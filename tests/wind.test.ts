import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCommands,applySnapshotCommands,color,createDocument,createCompactDocument,documentCells,frameCount,frameView, type PixelDocument} from '../lib/pixels.ts';
import {celData,celPixel,denseCel} from '../lib/cel-storage.ts';
import {windAngle,windPose,windPoseCel} from '../lib/wind.ts';

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
  assert.equal(celPixel(cel(next,5),8,1,17),0);
  for(let i=0;i<12;i++) {
    assert.equal(celPixel(cel(next,i),8,13,17),color('#846443'));
    assert.ok(celData(cel(next,i)).some(p=>p===color('#008855a0')));
    assert.deepEqual(frameView(next,i).layers[0].pixels, old.layers[0].pixels);
    assert.equal(windAngle(i,12,25,2),windAngle(i+12,12,25,2));
  }
  const edited=applySnapshotCommands(next,[{op:'pixel',layer:'branch',frame:2,x:1,y:1,color:'#aa3355'}]);
  assert.equal(celPixel(cel(edited,8),1,1,17),0);
  assert.equal(celPixel(cel(edited,2),1,1,17),color('#aa3355'));
});

test('wind uses the selected source, preserves other animation and clips, and rejects invalid bakes atomically',()=>{
  let d=applyCommands(scene(),Array.from({length:11},()=>({op:'frame_add'})));
  d=applyCommands(d,[{op:'pixel',layer:'branch',frame:7,x:0,y:4,color:'#123456'},
    {op:'pixel',layer:'base',frame:8,x:0,y:0,color:'#ff44aa'},{op:'clip_set',name:'gust',from:2,to:9}]);
  const old=structuredClone(d);
  const baked=applyCommands(d,[{...bake,source_frame:7}]);
  assert.deepEqual(cel(baked,2),cel(d,7));
  for(let i=0;i<12;i++){
    assert.deepEqual(denseCel(cel(baked,i),17,17),windPose(cel(d,7),17,17,8,13,windAngle(i,12,25,2)));
    assert.deepEqual(frameView(baked,i).layers[0].pixels,frameView(d,i).layers[0].pixels);
  }
  assert.deepEqual(baked.animation!.clips,d.animation!.clips);
  for(const bad of [{pivot_y:-1},{delay:12},{frames:6},{degrees:NaN},{layer:'absent'}])
    assert.throws(()=>applySnapshotCommands(d,[{...bake,...bad}]));
  assert.deepEqual(d,old);
});

test('rebaking a large canvas replaces previous poses and shares the new rest pose',()=>{
  const base=createDocument('Full loop',1024,1024);
  const drawing=base.layers[0].pixels;
  drawing[1]=color('#779944');
  const d=applySnapshotCommands(base,[
    {op:'frame_add'},{op:'frame_add'},{op:'frame_add'},
    ...[1,2,3].map(frame=>({op:'pixel',frame,x:200+frame,y:0,color:'#1122aa'}))
  ]);
  const baked=applySnapshotCommands(d,[{op:'wind_bake',layer:'base',frames:4,pivot_x:0,pivot_y:1023,delay:1,degrees:2}]);
  assert.equal(frameCount(baked),4);
  assert.deepEqual(denseCel(baked.animation!.frames[0].pixels.base,1024,1024),drawing);
  assert.strictEqual(baked.animation!.frames[2].pixels.base,baked.animation!.frames[0].pixels.base);
});

test('a small drawing bakes across 96 frames on a 1024-square canvas',()=>{
  const base=applySnapshotCommands(createCompactDocument('Lantern',1024,1024),[
    {op:'rect',x:510,y:514,width:9,height:16,filled:true,color:'#ee88aacc'}]);
  const result=applySnapshotCommands(base,[{op:'wind_bake',layer:'base',frames:96,pivot_x:514,pivot_y:480,degrees:18,delay:5}]);
  assert.equal(frameCount(result),96);
  assert.ok(documentCells(result)<16_000);
  assert.strictEqual(frameView(result,5).layers[0].pixels,frameView(result,53).layers[0].pixels);
});

test('trimmed rotations match full-canvas nearest-neighbor sampling at every edge',()=>{
  const width=37,height=21;
  for(const [left,top] of [[0,0],[33,0],[0,18],[33,18],[12,7]]) {
    const source=Array<number>(width*height).fill(0);
    for(let y=top;y<top+3;y++)for(let x=left;x<left+4;x++)source[y*width+x]=(x+y)%2?0x55aaff44:0x01020300;
    for(const [px,py] of [[0,0],[36,20],[left,top]])for(const angle of [-30,-6,0,4.375,29.9]){
      const sin=Math.sin(angle*Math.PI/180),cos=Math.cos(angle*Math.PI/180);
      const expected=source.map((_,i)=>{
        const dx=i%width-px,dy=Math.floor(i/width)-py;
        const x=Math.round(px+dx*cos+dy*sin),y=Math.round(py-dx*sin+dy*cos);
        return x>=0&&x<width&&y>=0&&y<height?source[y*width+x]:0;
      });
      assert.deepEqual(denseCel(windPoseCel(source,width,height,px,py,angle),width,height),expected);
    }
  }
});
