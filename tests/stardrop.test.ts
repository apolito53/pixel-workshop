import {test} from 'node:test';
import assert from 'node:assert/strict';
import {composite,frameCount,frameView,validateDocument} from '../lib/pixels.ts';
import {createStardropArt,STARDROP_ASSETS} from '../lib/stardrop-art.ts';
import {STARDROP_UI_ASSETS,UI_ICONS,UI_STATES,UI_SLICES} from '../lib/stardrop-ui-art.ts';

const assets=createStardropArt();

test('all Stardrop assets are valid native Pixel Workshop projects',()=>{
  assert.equal(STARDROP_ASSETS.length,18);
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

test('Stardrop ships real animation clips and can export its entire art pack',async()=>{
 const {buildGamePack}=await import('../lib/game-pack.ts');
 assert.deepEqual(assets.moonkeeper.animation?.clips?.map(clip=>clip.name),['idle','walk','jump']);
 assert.equal(assets.shade.animation?.clips?.[0].name,'float');
 assert.equal(assets.burst.animation?.clips?.[0].mode,'once');
 const pack=buildGamePack(STARDROP_ASSETS.map(asset=>assets[asset.key]));
 assert.equal(pack.manifest.assets.length,18);
 assert.equal(pack.manifest.assets.find(asset=>asset.name==='The Moonkeeper')?.clips.length,3);
 assert.equal(new DataView(pack.bytes.buffer).getUint32(0,true),0x04034b50);
});

test('UI art keeps transparent corners, stretchable centers and independently editable states',()=>{
 assert.equal(STARDROP_UI_ASSETS.length,8);
 for(const key of ['uiPanel','uiButton','uiButtonGold'] as const){
  const doc=assets[key],slice=UI_SLICES[key];
  for(let frame=0;frame<frameCount(doc);frame++){
   const rgba=composite(frameView(doc,frame));
   assert.equal(rgba[3],0,key+' corner stays transparent');
   const center=(Math.floor(doc.height/2)*doc.width+Math.floor(doc.width/2))*4;
   assert.equal(rgba[center+3],255,key+' center is opaque');
   // A uniform middle row prevents stretched button/panel texture artifacts.
   for(let x=slice;x<doc.width-slice;x++){
    const i=(Math.floor(doc.height/2)*doc.width+x)*4;
    assert.deepEqual(rgba.subarray(i,i+4),rgba.subarray(center,center+4),key+' center stretch');
   }
  }
 }
 for(const key of ['uiButton','uiButtonGold'] as const){
  assert.deepEqual(assets[key].animation?.clips?.map(c=>c.name),[...UI_STATES]);
  for(let i=1;i<4;i++)assert.notDeepEqual(composite(frameView(assets[key],0)),composite(frameView(assets[key],i)),key+' state '+i);
 }
 assert.deepEqual(assets.uiIcons.animation?.clips?.map(c=>c.name),[...UI_ICONS]);
});
