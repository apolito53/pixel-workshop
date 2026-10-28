import {test} from 'node:test';
import assert from 'node:assert/strict';
import {beginPinch,movePinch,finishPinch,touchMidpoint,touchDistance} from '../lib/touch-gestures.ts';

const viewport={center:{x:200,y:300},width:360,height:520},canvas={width:64,height:64};
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-7,`${a} !== ${b}`);

test('two-finger translation pans without zoom, even when the canvas fits',()=>{
 const start=beginPinch({x:155,y:300},{x:245,y:300},viewport,canvas,3,{x:0,y:0});
 const view=movePinch(start,{x:180,y:325},{x:270,y:325},viewport,canvas);
 close(view.scale,1);close(view.pan.x,25);close(view.pan.y,25);
 const end=finishPinch(start,view,viewport,canvas);
 assert.equal(end.zoom,3);close(end.pan.x,25);close(end.pan.y,25);
});

test('pinch zoom follows both the finger midpoint and the anchored canvas pixel',()=>{
 const first={x:175,y:300},second={x:265,y:300};
 const start=beginPinch(first,second,viewport,canvas,4,{x:12,y:-8});
 const view=movePinch(start,{x:130,y:330},{x:310,y:330},viewport,canvas);
 close(view.scale,2);
 const apparentX=viewport.center.x+view.pan.x+(start.anchor.x-canvas.width/2)*4*view.scale;
 const apparentY=viewport.center.y+view.pan.y+(start.anchor.y-canvas.height/2)*4*view.scale;
 close(apparentX,view.midpoint.x);close(apparentY,view.midpoint.y);
 const finished=finishPinch(start,view,viewport,canvas);
 assert.equal(finished.zoom,8);
 close(finished.pan.x,view.pan.x);close(finished.pan.y,view.pan.y);
});

test('pinch zoom clamps to the supported pixel-grid range without losing the image',()=>{
 const a={x:185,y:300},b={x:215,y:300};
 const start=beginPinch(a,b,viewport,canvas,6,{x:0,y:0});
 const maximum=movePinch(start,{x:-3000,y:300},{x:3400,y:300},viewport,canvas);
 assert.equal(maximum.scale,4);
 assert.equal(finishPinch(start,maximum,viewport,canvas).zoom,24);
 const minimum=movePinch(start,{x:199,y:300},{x:201,y:300},viewport,canvas);
 assert.equal(minimum.scale,1/6);
 assert.equal(finishPinch(start,minimum,viewport,canvas).zoom,1);
});

test('large pans keep a small part of the canvas visible',()=>{
 const start=beginPinch({x:150,y:300},{x:250,y:300},viewport,canvas,2,{x:0,y:0});
 const view=movePinch(start,{x:2000,y:300},{x:2100,y:300},viewport,canvas);
 const maxX=(viewport.width+canvas.width*2)/2-28;
 close(view.pan.x,maxX);
});

test('basic midpoint and distance geometry',()=>{
 assert.deepEqual(touchMidpoint({x:1,y:3},{x:5,y:7}),{x:3,y:5});
 close(touchDistance({x:0,y:0},{x:3,y:4}),5);
});
