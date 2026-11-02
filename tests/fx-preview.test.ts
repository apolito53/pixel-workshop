import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyCommands,createDocument,frameView,validateDocument,color} from '../lib/pixels.ts';
import {generateEffectCommands,regenerateEffectCommands} from '../lib/effects.ts';
import {compareEffectFrame} from '../lib/fx-preview.ts';

test('effect comparison renders both choices without mutating native artwork',()=>{
 const base=applyCommands(createDocument('Moonkeeper',24,24),[{op:'rect',x:0,y:23,width:24,height:1,color:'#666666'}]);
 const recipe={kind:'sparkles' as const,seed:53,ink:'#dfb1f0',speed:1,opacity:1,drift:0};
 const first=applyCommands(base,generateEffectCommands(base,recipe));
 const fx=first.layers.find(l=>l.effect)!;
 const before=structuredClone(first);
 const comparison=compareEffectFrame(first,fx.id,0,{...recipe,seed:117});
 assert.equal(comparison.width,24);assert.equal(comparison.frame,0);
 assert.equal(comparison.before.length,24*24*4);assert.equal(comparison.after.length,24*24*4);
 assert.ok(comparison.changedPixels>0);
 assert.deepEqual(first,before,'previews must not modify any source cels or layer recipes');
 assert.throws(()=>compareEffectFrame(first,fx.id,99,recipe),/frame/);
});
test('duplicated backup preserves all original cels and has no regenerable recipe',()=>{
 const base=createDocument('Backup',24,24);
 const recipe={kind:'embers' as const,seed:53,ink:'#ffae75'};
 const generated=applyCommands(base,generateEffectCommands(base,recipe));
 const layer=generated.layers.find(l=>l.effect)!;
 const before=structuredClone(generated);
 const cmds=[{op:'duplicate_layer',layer:layer.id,id:'frozen',name:'Original FX Backup'},
  ...regenerateEffectCommands(generated,layer.id,{...recipe,seed:117})];
 const updated=applyCommands(generated,cmds);
 assert.equal(updated.layers.length,generated.layers.length+1);
 assert.equal(updated.layers.find(l=>l.id==='frozen')?.effect,undefined);
 for(let i=0;i<generated.animation!.frames.length+1;i++){
  const original=frameView(before,i).layers.find(l=>l.id===layer.id)!;
  const saved=frameView(updated,i).layers.find(l=>l.id==='frozen')!;
  assert.deepEqual(saved.pixels,original.pixels,'backup frame '+i);
 }
 assert.equal(updated.layers[0].pixels[0],before.layers[0].pixels[0]);
 assert.deepEqual(validateDocument(updated),updated);
});
test('duplicate layer errors leave the original document unchanged',()=>{
 const d=createDocument('Safety',8,8);
 assert.throws(()=>applyCommands(d,[{op:'duplicate_layer',layer:'base',id:'base'}]),/unique/);
 const full=applyCommands(d,Array.from({length:7},(_,i)=>({op:'add_layer',id:'layer'+i,name:'extra'})));
 assert.throws(()=>applyCommands(full,[{op:'duplicate_layer',layer:'base',id:'backup'}]),/eight slots/);
 assert.equal(full.layers.length,8);
});
