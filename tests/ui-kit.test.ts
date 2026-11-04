import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyCommands,composite,createDocument,frameView,validateDocument,type PixelDocument} from '../lib/pixels.ts';
import type {Entry} from '../lib/project-service.ts';
import {stretchNineSlice} from '../lib/ui-metadata.ts';
import {buildSpriteSheet} from '../lib/sprite-sheet.ts';
import {buildGamePack} from '../lib/game-pack.ts';

test('nine-slice preview preserves corners and alpha while scaling the center',()=>{
 const source=new Uint8Array(5*5*4);
 for(let i=0;i<25;i++)source.set([i,40,80,i===0?0:150],i*4);
 const image=stretchNineSlice(source,5,5,{left:1,right:1,top:1,bottom:1},9,7);
 const get=(bytes:Uint8Array,w:number,x:number,y:number)=>Array.from(bytes.subarray((y*w+x)*4,(y*w+x)*4+4));
 assert.deepEqual(get(image,9,0,0),get(source,5,0,0));
 assert.deepEqual(get(image,9,8,0),get(source,5,4,0));
 assert.deepEqual(get(image,9,0,6),get(source,5,0,4));
 assert.deepEqual(get(image,9,8,6),get(source,5,4,4));
 assert.deepEqual(get(image,9,4,3),get(source,5,2,2));
 assert.throws(()=>stretchNineSlice(source,5,5,{left:3,right:2,top:1,bottom:1},9,7),/center pixel/);
 assert.throws(()=>stretchNineSlice(source,5,5,{left:2,right:2,top:1,bottom:1},4,7),/Preview width/);
});
test('UI metadata survives native projects and both atlas and pack exports',()=>{
 const slice={left:2,top:2,right:2,bottom:2,content:{left:3,top:3,right:3,bottom:3}};
 const a=applyCommands(createDocument('Frame',16,16,'frame'),[
  {op:'frame_add',id:'hover',blank:true},{op:'pixel',x:3,y:3,color:'#f0da92'},
  {op:'ui_set',ui:{kind:'button',assetKey:'uiButton',kitId:'demo-kit',slice,slots:[{name:'rest',frame:0},{name:'hover',frame:1}]}}
 ]);
 assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(a))).ui,a.ui);
 assert.deepEqual(buildSpriteSheet(a).atlas.ui,a.ui);
 assert.deepEqual(buildGamePack([a]).manifest.assets[0].ui,a.ui);
 assert.throws(()=>applyCommands(a,[{op:'ui_set',ui:{slice:{left:8,right:8,top:2,bottom:2}}}]),/center pixel/);
 assert.throws(()=>applyCommands(a,[{op:'ui_set',ui:{slots:[{name:'rest',frame:3}]}}]),/UI entry frame/);
});
test('deleting a frame adjusts named UI entries and preserves source on failed edits',()=>{
 const a=applyCommands(createDocument('States',8,8),[
  {op:'frame_add',id:'a',blank:true},{op:'frame_add',id:'b',blank:true},
  {op:'ui_set',ui:{kind:'button',slots:[{name:'rest',frame:0},{name:'hover',frame:1},{name:'pressed',frame:2}]}}
 ]);
 const b=applyCommands(a,[{op:'frame_delete',frame:1}]);
 assert.deepEqual(b.ui?.slots,[{name:'rest',frame:0},{name:'pressed',frame:1}]);
 assert.equal(a.ui?.slots?.length,3);
 assert.throws(()=>applyCommands(a,[{op:'ui_set',ui:{slots:[{name:'rest',frame:0},{name:'REST',frame:1}]}}]),/unique/);
 assert.equal(a.ui?.slots?.length,3);
});
test('typed text survives project round trips, can be edited, and becomes ordinary pixels when painted',()=>{
 const text={text:'STAR',x:1,y:1,scale:1,spacing:1,color:'#ff990080',frame:0};
 const d=applyCommands(createDocument('Title',32,16),[{op:'add_layer',id:'title',name:'Editable title'},{op:'text_set',layer:'title',text}]);
 assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(d))).layers[1].text,text);
 assert.ok(composite(frameView(d)).some((value,i)=>i%4===3&&value===128));
 const edit=applyCommands(d,[{op:'text_set',layer:'title',text:{...text,text:'MOON'}}]);
 assert.notDeepEqual(edit.layers[1].pixels,d.layers[1].pixels);
 assert.equal(edit.layers[1].text?.text,'MOON');
 const painted=applyCommands(edit,[{op:'pixel',layer:'title',x:0,y:0,color:'#123456'}]);
 assert.equal(painted.layers[1].text,undefined);
 assert.notEqual(painted.layers[1].pixels[0],0);
});
test('palette remapping reaches hidden layers and every frame without changing transparency',()=>{
 const d=applyCommands(createDocument('Colors',8,8),[
  {op:'pixel',x:0,y:0,color:'#ff000080'},{op:'frame_add',id:'two',source_frame:0},
  {op:'add_layer',id:'hidden',name:'Hidden'},{op:'pixel',layer:'hidden',x:1,y:1,color:'#ff000040'},
  {op:'visibility',layer:'hidden',visible:false},{op:'palette',colors:['#ff0000','#12345680']}
 ]);
 const changed=applyCommands(d,[{op:'palette_remap',fromColor:'#ff0000',toColor:'#00ff00'}]);
 assert.equal(changed.layers[0].pixels[0],0x00ff0080);
 assert.equal(changed.layers[1].pixels[9],0x00ff0040);
 assert.equal(changed.animation?.frames[0].pixels.base[0],0x00ff0080);
 assert.deepEqual(changed.palette,['#00ff00','#12345680']);
 assert.equal(d.layers[0].pixels[0],0xff000080);
});

test('exported kit can be read back and refuses corrupted ZIP contents',async()=>{
 const {readGamePack}=await import('../lib/read-game-pack.ts');
 const {applyStardropUiKit}=await import('../lib/stardrop-kit.ts');
 const {createStardropArt}=await import('../lib/stardrop-art.ts');
 const art=createStardropArt(),edited=applyCommands(art.uiPanel,[{op:'pixel',layer:'base',x:20,y:20,color:'#123456'}]);
 const bytes=buildGamePack([edited]).bytes,docs=readGamePack(bytes);
 assert.equal(docs.length,1);assert.deepEqual(docs[0].ui,edited.ui);
 assert.equal(applyStardropUiKit(art,docs).art.uiPanel.layers[0].pixels[20+20*edited.width],0x123456ff);
 assert.throws(()=>applyStardropUiKit(art,[edited,edited]),/more than one/);
 const corrupted=bytes.slice(),firstNameLength=new DataView(corrupted.buffer).getUint16(26,true);corrupted[30+firstNameLength+10]^=1;
 assert.throws(()=>readGamePack(corrupted),/integrity|game pack|entry|manifest/i);
});

test('the advertised 30-project pack can be exported and read back',async()=>{
 const {readGamePack}=await import('../lib/read-game-pack.ts');
 const documents=Array.from({length:30},(_,i)=>createDocument(`Asset ${i}`,4,4,`asset-${i}`));
 assert.equal(readGamePack(buildGamePack(documents).bytes).length,30);
});

test('Stardrop UI projects survive workspace import, editing, export and game preview',async()=>{
 const {ProjectService}=await import('../lib/project-service.ts');
 const {pixelApi}=await import('../lib/http-api.ts');
 const {STARDROP_UI_ASSETS}=await import('../lib/stardrop-ui-art.ts');
 const {createStardropArt}=await import('../lib/stardrop-art.ts');
 const {applyStardropUiKit,uiFrame}=await import('../lib/stardrop-kit.ts');
 const {readGamePack}=await import('../lib/read-game-pack.ts');
 const entries=new Map<string,{entry:Entry;etag:string}>();let version=0;
 const service=new ProjectService({
  async list(){return [...entries.values()].map(item=>structuredClone(item.entry.doc));},
  async get(id){return structuredClone(entries.get(id)??null);},
  async put(id,entry,etag){if(entries.get(id)?.etag!==etag)throw new Error('This project changed.');entries.set(id,{entry:structuredClone(entry),etag:String(++version)});}
 });
 const request=async(path:string,body?:unknown)=>{
  const response=await pixelApi(new Request('https://workshop.test/api/pixel/'+path,{method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})}),service);
  const data=await response.json() as {doc:PixelDocument};assert.equal(response.status,200,JSON.stringify(data));return data;
 };
 const original=createStardropArt(),projects:PixelDocument[]=[];
 for(const {key} of STARDROP_UI_ASSETS){
  const document=structuredClone(original[key]);document.ui={...document.ui,kitId:'roundtrip-kit'};
  const created=await request('projects',{document});projects.push(created.doc);
  assert.notEqual(created.doc.id,document.id);
 }
 const panel=projects.find(d=>d.ui?.assetKey==='uiPanel')!;
 const panelEdit=await request(`projects/${panel.id}`,{revision:panel.revision,action:'paint',commands:[
  {op:'pixel',layer:'base',x:20,y:20,color:'#123456'},
  {op:'ui_set',ui:{...panel.ui,slice:{left:10,right:12,top:12,bottom:12,content:{left:14,right:14,top:12,bottom:12}}}}
 ]});
 const button=projects.find(d=>d.ui?.assetKey==='uiButton')!;
 await request(`projects/${button.id}`,{revision:button.revision,action:'paint',commands:[
  {op:'ui_set',ui:{...button.ui,slots:button.ui!.slots!.map(slot=>slot.name==='rest'?{...slot,frame:3}:slot)}}
 ]});
 const logo=projects.find(d=>d.ui?.assetKey==='uiLogo')!;
 await request(`projects/${logo.id}`,{revision:logo.revision,action:'paint',commands:[
  {op:'add_layer',id:'headline',name:'Editable headline'},
  {op:'text_set',layer:'headline',text:{text:'STAR',x:1,y:1,scale:1,spacing:1,color:'#c29965',frame:0}}
 ]});
 for(const item of await service.store.list())await request(`projects/${item.id}`,{revision:item.revision,action:'paint',commands:[{op:'palette_remap',fromColor:'#c29965',toColor:'#34aadd'}]});
 const saved=await service.store.list(),pack=buildGamePack(saved),documents=readGamePack(pack.bytes);
 const preview=applyStardropUiKit(original,documents);
 assert.equal(preview.count,8);
 assert.equal(preview.art.uiPanel.layers[0].pixels[20+20*panel.width],0x123456ff);
 assert.deepEqual(preview.art.uiPanel.ui?.slice,panelEdit.doc.ui!.slice);
 assert.equal(uiFrame(preview.art.uiButton,'rest',0),3);
 assert.equal(preview.art.uiLogo.layers.find(layer=>layer.id==='headline')?.text?.color,'#34aadd');
 assert.equal(preview.art.moonkeeper,original.moonkeeper);
 assert.equal(original.uiPanel.layers[0].pixels[20+20*panel.width]===0x123456ff,false);
 assert.ok(pack.manifest.assets.every(asset=>asset.ui?.kitId==='roundtrip-kit'));
});
