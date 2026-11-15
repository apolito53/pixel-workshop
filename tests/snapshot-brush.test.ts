import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyCommands,applySnapshotCommands,createDocument,type PaintCommand} from '../lib/pixels.ts';

function layersAndText(){
  return applyCommands(createDocument('Ink',8,8),[
    {op:'add_layer',id:'ink'},{op:'frame_add',id:'a'},{op:'frame_add',id:'b'},
    {op:'text_set',layer:'ink',text:{text:'X',x:0,y:0,color:'#ffaa00',frame:1,scale:1,spacing:1}}
  ]);
}
test('a brush batch copies only the addressed cels and matches every dense drawing command',()=>{
  const source=layersAndText(),before=structuredClone(source);
  const ops:PaintCommand[]=[
    {op:'fill',x:0,y:0,color:'#101010'},
    {op:'pixel',layer:'ink',frame:1,x:1,y:2,color:'#ffffff'},
    {op:'line',layer:'ink',frame:1,x:1,y:2,x2:6,y2:6,color:'#ffee22'},
    {op:'ellipse',layer:'ink',frame:2,x:1,y:0,width:6,height:7,color:'#770033'},
    {op:'rect',layer:'ink',frame:2,x:0,y:1,width:8,height:5,filled:false,color:'#123456'},
    {op:'paste',layer:'ink',frame:1,x:0,y:0,width:2,height:1,pixels:[0x00ccffff,0]},
    {op:'stamp',layer:'ink',frame:1,x:1,y:0,width:2,height:1,pixels:[0,0xabcdef01]},
    {op:'transform',layer:'ink',frame:1,x:0,y:0,width:2,height:2,mode:'move',x2:4,y2:4},
    {op:'clear',layer:'ink',frame:2}
  ];
  const out=applySnapshotCommands(source,ops),dense=applyCommands(source,ops);
  assert.deepEqual({...out,updatedAt:0},{...dense,updatedAt:0});
  assert.deepEqual(source,before);
  assert.equal(out.layers[1].text,undefined);
  assert.notEqual(out.layers[0].pixels,source.layers[0].pixels);
  assert.equal(out.layers[1].pixels,source.layers[1].pixels);
  assert.equal(out.animation!.frames[0].pixels.base,source.animation!.frames[0].pixels.base);
  assert.notEqual(out.animation!.frames[0].pixels.ink,source.animation!.frames[0].pixels.ink);
  assert.equal(out.animation!.frames[1].pixels.ink,out.layers[1].pixels,'cleared artwork rejoins the shared blank');
  assert.notEqual(dense.layers[1].pixels,source.layers[1].pixels);
});

test('failed multi-frame paints keep every preceding snapshot and text recipe intact',()=>{
  const source=layersAndText(),before=structuredClone(source);
  const red={op:'pixel',x:2,y:2,color:'#ff0000',layer:'ink',frame:1};
  assert.throws(()=>applySnapshotCommands(source,[red,{...red,frame:2,x:99}]));
  assert.throws(()=>applySnapshotCommands(source,[red,{...red,layer:'missing'}]));
  assert.deepEqual(source,before);
  const next=applySnapshotCommands(source,[red]);
  const second=applySnapshotCommands(next,[{...red,color:'#00ffff'}]);
  assert.equal(source.animation!.frames[0].pixels.ink[18],before.animation!.frames[0].pixels.ink[18]);
  assert.equal(next.animation!.frames[0].pixels.ink[18],0xff0000ff);
  assert.equal(second.animation!.frames[0].pixels.ink[18],0x00ffffff);
  const structural=applySnapshotCommands(source,[red,{op:'rename',name:'New name'}]);
  assert.equal(structural.layers[0].pixels,source.layers[0].pixels,'a metadata edit preserves the held background');
  assert.deepEqual(source,before);
});
