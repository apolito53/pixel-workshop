import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyCommands,createDocument,DEFAULT_PALETTE,frameView,validateDocument} from '../lib/pixels.ts';
import {artworkColors,isHexInk,normalizeInk,opacityPercent,rememberInk,rgbHex,splitProjectPalette,suggestColors,withOpacity,withRgb} from '../lib/color-workflow.ts';

test('new canvases start without unexplained saved swatches, while imports keep legacy palettes',()=>{
 const fresh=createDocument('Fresh',16,16);
 assert.deepEqual(fresh.palette,[]);
 const imported={...fresh,palette:[...DEFAULT_PALETTE]};
 assert.equal(validateDocument(imported).palette.length,24);
 assert.deepEqual(imported.palette,DEFAULT_PALETTE);
 const saved=applyCommands(fresh,[{op:'palette',colors:['#cc4433','#1d77cc']}]);
 assert.deepEqual(saved.palette,['#cc4433','#1d77cc']);
 assert.deepEqual(fresh.palette,[],'saving must not mutate source');
});
test('color entry accepts RGB and RGBA and native picker preserves chosen opacity',()=>{
 assert.ok(isHexInk('#123abc'));
 assert.ok(isHexInk('#123abc80'));
 assert.ok(!isHexInk('#abc'));
 assert.ok(!isHexInk('#xx22ab'));
 assert.equal(normalizeInk('#ABCDEFff'),'#abcdef');
 assert.equal(normalizeInk('#ABCDEF80'),'#abcdef80');
 assert.equal(rgbHex('#12345642'),'#123456');
 assert.equal(withRgb('#ab558080','#123456'),'#12345680');
 assert.equal(withRgb('#ab5580','#123456'),'#123456');
 assert.equal(withOpacity('#abcdef',0),'#abcdef00');
 assert.equal(withOpacity('#abcdef',50),'#abcdef80');
 assert.equal(opacityPercent('#abcdef80'),50);
 assert.equal(opacityPercent('#abcdef'),100);
});
test('recently picked colors are unique, capped and never save to the project',()=>{
 const doc=createDocument('Recent',8,8);
 let recent:string[]=[];
 for(const c of ['#abcdef','#112233','#abcdef','#10203080','#ABCDEF']){
  recent=rememberInk(recent,c,3);
 }
 assert.deepEqual(recent,['#abcdef','#10203080','#112233']);
 assert.deepEqual(doc.palette,[]);
});
test('artwork colors reflect visible, composited pixels and change as someone draws',()=>{
 const empty=createDocument('Canvas',8,8);
 assert.deepEqual(artworkColors(empty),[]);
 const first=applyCommands(empty,[
  {op:'rect',x:0,y:0,width:4,height:4,color:'#ad4422'},
  {op:'rect',x:5,y:0,width:2,height:2,color:'#2255cc80'},
 ]);
 assert.equal(artworkColors(first)[0].hex,'#ad4422');
 assert.ok(artworkColors(first).some(c=>c.hex==='#2255cc80'));
 const next=applyCommands(first,[
  {op:'add_layer',id:'hidden',name:'Hidden'},
  {op:'rect',layer:'hidden',x:0,y:0,width:8,height:8,color:'#11aacc'},
  {op:'visibility',layer:'hidden',visible:false},
 ]);
 assert.deepEqual(artworkColors(next),artworkColors(first),'hidden layers should not dominate');
 const newer=applyCommands(next,[{op:'rect',x:4,y:4,width:4,height:4,color:'#ffee22'}]);
 assert.ok(artworkColors(newer).some(c=>c.hex==='#ffee22'));
 assert.deepEqual(artworkColors(newer),artworkColors(newer),'same pixels, same swatches');
 assert.deepEqual(empty.palette,[],'sampling must not save colors');
});
test('artwork suggestions respect the selected frame and use actual visible colors',()=>{
 const doc=applyCommands(createDocument('Animation',5,5),[
  {op:'rect',x:0,y:0,width:5,height:5,color:'#ff0000'},
  {op:'frame_add',blank:true},
  {op:'rect',frame:1,x:0,y:0,width:5,height:5,color:'#0000ff'},
 ]);
 assert.equal(artworkColors(doc,0)[0].hex,'#ff0000');
 assert.equal(artworkColors(doc,1)[0].hex,'#0000ff');
 assert.deepEqual(frameView(doc,0).palette,[]);
 const selected='#6b9d53';
 const a=suggestColors(selected,artworkColors(doc,0));
 const b=suggestColors(selected,artworkColors(doc,1));
 assert.ok(a.every(idea=>isHexInk(idea.hex)));
 assert.ok(a.every(idea=>!idea.hex.endsWith('…')));
 assert.ok(a.some(idea=>idea.label==='Highlight'));
 assert.ok(a.some(idea=>idea.label==='Shadow'));
 assert.ok(a.some(idea=>idea.label==='Complement'));
 assert.ok(a.some(idea=>idea.source==='Artwork'));
 assert.notDeepEqual(a,b,'dominant artwork hue should affect relevant companions');
 assert.deepEqual(a,suggestColors(selected,artworkColors(doc,0)),'no randomness');
 const blank=suggestColors(selected,[]);
 assert.ok(blank.every(idea=>idea.source==='Selected color'));
});
test('the color interface has a real always-reachable picker and separate project swatches',()=>{
 const editor=readFileSync(new URL('../app/editor.tsx',import.meta.url),'utf8');
 const workbench=readFileSync(new URL('../app/color-workbench.tsx',import.meta.url),'utf8');
 const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');
 assert.ok(editor.includes('data-guide="current-color"'));
 assert.ok(editor.includes('aria-label="Choose current drawing color"'));
 assert.ok(editor.includes('onChange={e=>selectInk(withRgb(ink,e.target.value))}'));
 assert.ok(editor.includes('<ColorWorkbench'));
 assert.ok(workbench.includes('SUGGESTED COMPANIONS'));
 assert.ok(workbench.includes('IN YOUR ARTWORK'));
 assert.ok(workbench.includes('RECENTLY PICKED'));
 assert.ok(workbench.includes('SAVED PROJECT COLORS'));
 assert.ok(workbench.includes('Not saved'));
 assert.ok(workbench.includes('onClick={onSave}'));
 assert.ok(css.includes('.toolbar-ink-picker'));
 assert.ok(css.includes('.workbench-swatch-grid'));
});

test('original 24 starter swatches appear only in a collapsed legacy section, not saved favorites',()=>{
 const initial=[...DEFAULT_PALETTE];
 assert.deepEqual(splitProjectPalette(initial),{legacy:initial,saved:[]});
 assert.deepEqual(splitProjectPalette([]),{legacy:[],saved:[]});
 const pinned=[...initial,'#112233',DEFAULT_PALETTE[2]];
 assert.deepEqual(splitProjectPalette(pinned).legacy,initial);
 assert.deepEqual(splitProjectPalette(pinned).saved,['#112233',DEFAULT_PALETTE[2]]);
 assert.deepEqual(splitProjectPalette(['#123456','#abcdef']),{legacy:[],saved:['#123456','#abcdef']});
 const workbench=readFileSync(new URL('../app/color-workbench.tsx',import.meta.url),'utf8');
 const editor=readFileSync(new URL('../app/editor.tsx',import.meta.url),'utf8');
 const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');
 assert.ok(workbench.includes('<details className="workbench-legacy">'));
 assert.ok(workbench.includes('Original starter swatches'));
 assert.ok(workbench.includes('24 from the older editor'));
 assert.ok(workbench.includes('const {legacy,saved}=splitProjectPalette(stored)'));
 assert.ok(workbench.includes('onPick={onPick} label="Original starter swatch"'));
 assert.ok(editor.includes('const {legacy,saved}=splitProjectPalette(doc.palette)'));
 assert.ok(css.includes('.workbench-legacy summary'));
 assert.ok(!css.includes('.workbench-legacy button{border:'));
});
