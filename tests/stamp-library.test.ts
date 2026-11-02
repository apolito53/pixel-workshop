import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyCommands,createDocument,color,frameView} from '../lib/pixels.ts';
import {STAMP_LIBRARY_LIMIT,captureStamp,stampCommand,stampRgba,loadStamps,addSavedStamp,positionStamp} from '../lib/stamp-library.ts';
test('capture a painted region and stamp without erasing transparent destination cells',()=>{
 const original=applyCommands(createDocument('Stamp',8,8),[
  {op:'rect',x:0,y:0,width:8,height:8,color:'#113355'},
  {op:'pixel',x:1,y:1,color:'#ff000080'},
  {op:'pixel',x:2,y:2,color:'transparent'}]);
 const captured=captureStamp(original,'base',{x:1,y:1,width:2,height:2},0,'tree');
 const after=applyCommands(original,[stampCommand(original,captured,4,4,'base',0,0)]);
 assert.equal(after.layers[0].pixels[4*8+4],color('#ff000080'));
 assert.equal(after.layers[0].pixels[5*8+5],color('#113355'));
 assert.equal(original.layers[0].pixels[4*8+4],color('#113355'));
 assert.deepEqual(Array.from(stampRgba(captured).slice(0,4)),[255,0,0,128]);
});
test('snapping and stamps respect frame isolation',()=>{
 const doc=applyCommands(createDocument('Cels',16,16),[{op:'frame_add',blank:true},{op:'pixel',frame:1,x:0,y:0,color:'#cc33cc'}]);
 const stamp=captureStamp(doc,'base',{x:0,y:0,width:1,height:1},1,'cel');
 assert.deepEqual(positionStamp(doc,stamp,15,15,8),{x:8,y:8});
 const after=applyCommands(doc,[stampCommand(doc,stamp,10,10,'base',1,8)]);
 assert.equal(frameView(after,1).layers[0].pixels[8*16+8],color('#cc33cc'));
 assert.equal(frameView(after,0).layers[0].pixels[8*16+8],0);
});
test('stamp validation and bounded library',()=>{
 const doc=createDocument('Empty',4,4);
 assert.throws(()=>captureStamp(doc,'base',{x:0,y:0,width:4,height:4},0,'empty'),/No painted pixels/);
 assert.throws(()=>applyCommands(doc,[{op:'stamp',x:0,y:0,width:1,height:1,pixels:[-1]}]));
 const painted=applyCommands(doc,[{op:'pixel',x:0,y:0,color:'#ff0000'}]);
 const stamp=captureStamp(painted,'base',{x:0,y:0,width:1,height:1},0,'one');
 const saved=addSavedStamp([],stamp,'Flower');assert.equal(saved[0].name,'Flower');
 assert.deepEqual(loadStamps([saved[0],{bad:1},saved[0]]),saved);
 const full=Array(STAMP_LIBRARY_LIMIT).fill(stamp).map((x,i)=>({...x,id:'id'+i}));
 assert.throws(()=>addSavedStamp(full,{...stamp,id:'extra'},'Extra'),/12/);
 assert.throws(()=>positionStamp(doc,stamp,0,0,17),/grid/);
 assert.throws(()=>captureStamp(painted,'base',{x:0,y:0,width:999,height:999},0,'large'),/4096/);
});
