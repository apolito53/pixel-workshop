import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyCommands,createDocument,DEFAULT_PALETTE} from '../lib/pixels.ts';
import {
 addRecentColor,artworkColors,contextualColors,normalizeColor,withRgb,withOpacity,
 opacityPercent,saveColor,removeSavedColor,splitSavedPalette,
} from '../lib/color-workbench.ts';

test('new canvases no longer show an unexplained 24-color default palette',()=>{
 const d=createDocument('New',16,16);
 assert.deepEqual(d.palette,[]);
 assert.deepEqual(splitSavedPalette(d.palette),{saved:[],legacy:[]});
});

test('existing default palette metadata remains available, visibly distinguished from user-saved colors',()=>{
 const legacy=[...DEFAULT_PALETTE],withPins=[...legacy,'#abcdef','#102030'];
 assert.deepEqual(splitSavedPalette(legacy),{saved:[],legacy});
 assert.deepEqual(splitSavedPalette(withPins),{saved:['#abcdef','#102030'],legacy});
 const saved=saveColor(withPins,'#feedab');
 assert.deepEqual(splitSavedPalette(saved).saved,['#abcdef','#102030','#feedab']);
 assert.deepEqual(splitSavedPalette(removeSavedColor(saved,'#abcdef')).saved,['#102030','#feedab']);
 assert.deepEqual(saved.slice(0,legacy.length),legacy,'no old color metadata is silently erased');
 assert.deepEqual(splitSavedPalette(['#ffc000']),{saved:['#ffc000'],legacy:[]});
});
test('saving an old starter swatch is an explicit favorite without rewriting its prior metadata',()=>{
 const palette=saveColor([...DEFAULT_PALETTE],DEFAULT_PALETTE[1]);
 assert.equal(palette.length,DEFAULT_PALETTE.length+1);
 assert.deepEqual(splitSavedPalette(palette).saved,[normalizeColor(DEFAULT_PALETTE[1])]);
 assert.deepEqual(removeSavedColor(palette,DEFAULT_PALETTE[1]),DEFAULT_PALETTE);
});
test('color helpers are stable across alpha and RGB updates',()=>{
 assert.equal(normalizeColor('#ABCDEFff'),'#abcdef');
 assert.equal(normalizeColor('#ABCDEF42'),'#abcdef42');
 assert.equal(normalizeColor('not-a-color'),null);
 assert.equal(withOpacity('#aabbcc',50),'#aabbcc80');
 assert.equal(opacityPercent('#aabbcc80'),50);
 assert.equal(withOpacity('#abcdef',0),'#abcdef00');
 assert.equal(withRgb('#77889980','#112233'),'#11223380');
 assert.equal(withRgb('#778899','#112233'),'#112233');
});
test('recently chosen colors deduplicate and retain the most recent eight',()=>{
 let recent:string[]=[];
 for(let i=0;i<12;i++)recent=addRecentColor(recent,'#'+i.toString(16).padStart(6,'0'));
 assert.equal(recent.length,8);
 assert.equal(recent[0],'#00000b');
 assert.equal(recent[7],'#000004');
 recent=addRecentColor(recent,'#000008');
 assert.equal(recent.length,8);assert.equal(recent[0],'#000008');
 assert.equal(new Set(recent).size,recent.length);
});
test('suggestions come from actual painted pixels and evolve after drawing',()=>{
 const blank=createDocument('Blank',8,8);
 const initial=contextualColors(blank,0,'#c08050');
 assert.equal(initial.source,'current');assert.equal(initial.pixelCount,0);
 assert.ok(initial.suggested.length>=4);
 assert.equal(initial.used.length,0);
 const painted=applyCommands(blank,[{op:'rect',x:0,y:0,width:8,height:8,color:'#224488'}]);
 const after=contextualColors(painted,0,'#c08050');
 assert.equal(after.source,'artwork');assert.equal(after.pixelCount,64);
 assert.ok(after.used.some(c=>c.hex==='#224488'));
 assert.notDeepEqual(after.suggested,initial.suggested);
 assert.deepEqual(contextualColors(painted,0,'#c08050'),after,'suggestions must not be random');
 assert.deepEqual(painted.palette,[], 'suggestions never change persisted favorites');
});
test('suggestions reflect the selected animation cel and ignore fully transparent pixels',()=>{
 const d=applyCommands(createDocument('Cel',4,4),[
  {op:'rect',x:0,y:0,width:4,height:4,color:'#ff0000'},
  {op:'frame_add',blank:true},
  {op:'pixel',frame:1,x:1,y:1,color:'#00ff00'},
  {op:'pixel',frame:1,x:2,y:2,color:'#0000ff00'},
 ]);
 const first=artworkColors(d,0),second=artworkColors(d,1);
 assert.equal(first.pixelCount,16);assert.equal(second.pixelCount,1);
 assert.equal(second.colors[0].hex,'#00ff00');
 assert.notDeepEqual(contextualColors(d,0,'#777777').suggested,
  contextualColors(d,1,'#777777').suggested);
});
test('saved palette checks preserve hard capacity and only accept valid colors',()=>{
 assert.throws(()=>saveColor([], '#123'), /valid/);
 const full=Array.from({length:128},(_,i)=>'#'+i.toString(16).padStart(6,'0'));
 assert.throws(()=>saveColor(full,'#fedcba'),/128/);
 assert.deepEqual(saveColor(['#abcdef'],'#ABCDEF'),['#abcdef']);
});
