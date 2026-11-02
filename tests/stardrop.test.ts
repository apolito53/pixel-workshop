import {test} from 'node:test';
import assert from 'node:assert/strict';
import {composite,frameCount,frameView,validateDocument} from '../lib/pixels.ts';
import {createStardropArt,STARDROP_ASSETS} from '../lib/stardrop-art.ts';

const assets=createStardropArt();

test('all Stardrop assets are valid native Pixel Workshop projects',()=>{
  assert.equal(STARDROP_ASSETS.length,10);
  for(const asset of STARDROP_ASSETS){
    const doc=assets[asset.key];
    assert.equal(doc.format,'pixel-workshop/1',asset.key);
    assert.ok(doc.width<=256&&doc.height<=256,asset.key);
    assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))),doc,asset.key);
    assert.ok(composite(frameView(doc,0)).some(byte=>byte!==0),asset.key+' has no visible pixels');
  }
});
test('Stardrop uses actual animated character, collectibles, enemies, beacon and effects',()=>{
  for(const key of ['moonkeeper','star','shade','beacon','sparkles','burst','pulse'] as const){
    const doc=assets[key];
    assert.ok(frameCount(doc)>=4,key);
    const first=composite(frameView(doc,0)),second=composite(frameView(doc,1));
    assert.notDeepEqual(first,second,key+' must visually animate');
  }
});
test('Stardrop background and pine preserve editable layers',()=>{
  assert.equal(assets.backdrop.layers.length,4);
  assert.equal(assets.tree.layers.length,2);
  assert.equal(assets.moonkeeper.layers.length,2);
  assert.equal(assets.burst.layers[1].name,'Explosion FX');
  assert.equal(assets.pulse.layers[1].name,'Shockwave FX');
});
test('asset generation is deterministic at the pixel level',()=>{
  const twice=createStardropArt();
  for(const {key} of STARDROP_ASSETS){
    const a=assets[key],b=twice[key];
    assert.equal(frameCount(a),frameCount(b));
    for(let i=0;i<frameCount(a);i++){
      assert.deepEqual(composite(frameView(a,i)),composite(frameView(b,i)),key+' frame '+i);
    }
  }
});
