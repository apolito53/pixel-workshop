import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const editor=readFileSync(new URL('../app/editor.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');

test('touch gesture capture is on the canvas viewport without replacing one-finger painting',()=>{
 assert.ok(editor.includes('onPointerDownCapture={touchDown}'));
 assert.ok(editor.includes('onPointerMoveCapture={touchMove}'));
 assert.ok(editor.includes('onPointerUpCapture={touchEnd}'));
 assert.ok(editor.includes('onPointerCancelCapture={touchEnd}'));
 assert.ok(editor.includes('onPointerDown={down} onPointerMove={move} onPointerUp={up}'));
 assert.ok(editor.includes("e.pointerType==='touch'&&(touchGesture.current!==null||suppressTouchDrawing.current)"));
});

test('the second touch cancels any preview rather than saving stray pixels',()=>{
 assert.ok(editor.includes('const cancelActiveStroke=()=>'));
 assert.ok(editor.includes('stroke.current=null;selectionDrag.current=null;'));
 assert.ok(editor.includes('present(queue.current?.state.snapshot ?? st?.base ?? drag!.base)'));
 assert.ok(editor.includes('cancelActiveStroke();'));
 assert.ok(editor.includes("if(e.pointerType==='touch'){\n   // Defer the save"));
 assert.ok(editor.includes('if(touchPoints.current.size===0)suppressTouchDrawing.current=false;'));
});

test('mobile canvas pans through a centered stage and Fit restores its position',()=>{
 assert.ok(css.includes('.canvas-scroll{overflow:hidden;touch-action:none'));
 assert.ok(css.includes('.canvas-mat{width:100%;min-width:100%;height:100%;min-height:100%'));
 assert.ok(css.includes('.canvas-frame{transform-origin:center center'));
 assert.ok(editor.includes('canvasPan.x')&&editor.includes('pinchScale'));
 assert.ok(editor.includes('aria-label="Fit canvas to workspace" onClick={()=>{resetPan();setFitMode(true);}}'));
 assert.ok(editor.includes('setFitMode(false);'));
});
