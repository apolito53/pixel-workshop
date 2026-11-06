import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import {ProjectService} from '../lib/project-service.ts';
import {fileStore} from '../server/file-store.ts';
import {callTool} from '../lib/mcp-tools.ts';
import {createDocument,frameView,type PixelDocument} from '../lib/pixels.ts';
import {fitReferenceAlignment,prepareReference,referenceRgba} from '../lib/reference.ts';

const source={width:3,height:2,pixels:[0x12345603,0xff0000ff,0x00ff0080,0x102030ff,0x04050600,0xabcdef88]};
const pngFor=(s=source)=>{const png=new PNG({width:s.width,height:s.height});png.data.set(referenceRgba(s));return PNG.sync.write(png).toString('base64');};
async function fixture(run:(service:ProjectService,call:(name:string,args:Record<string,unknown>)=>Promise<any>)=>Promise<void>){
 const dir=await mkdtemp(join(tmpdir(),'pixel-reference-workflow-'));
 try{
  const service=new ProjectService(fileStore(dir));
  await run(service,async(name,args)=>{const result=await callTool(service,name,args);assert.ok(!result.isError,JSON.stringify(result));return JSON.parse(result.content[0].text!);});
 }finally{await rm(dir,{recursive:true,force:true});}
}

test('one-call PNG import produces exact editable artwork and compact verification',()=>fixture(async(service,call)=>{
 const made=await call('import_reference',{png_base64:pngFor(),copy_to_layer:true,name:'Generated sprite'});
 assert.equal(made.copy.exactMatch,true);assert.equal(made.copy.matchingPixels,6);assert.equal(made.copy.layer,'base');assert.equal(made.preview.view,'artwork');
 assert.equal(made.referencePreparation.resampled,false);assert.equal(made.layers[0].pixels,undefined);assert.equal(made.reference.pixels,undefined);
 const doc=(await service.get(made.id)).entry.doc;assert.deepEqual(doc.layers[0].pixels,source.pixels);assert.deepEqual(doc.reference!.pixels,source.pixels);
 const exported=await callTool(service,'export_png',{id:made.id});
 const image=exported.content.find(c=>c.type==='image');assert.ok(image&&image.type==='image');
 const decoded=PNG.sync.read(Buffer.from(image.data,'base64')),expected=referenceRgba(source);
 for(let i=0;i<source.pixels.length;i++){if(expected[i*4+3])assert.deepEqual(decoded.data.subarray(i*4,i*4+4),Buffer.from(expected.subarray(i*4,i*4+4)));else assert.equal(decoded.data[i*4+3],0);}
 const comparison=await call('compare_reference',{id:made.id});assert.equal(comparison.visibleMatch,true);assert.equal(comparison.differentPixels,1);assert.equal(comparison.visibleDifferentPixels,0);
 const edited=await service.edit(made.id,0,'paint',[{op:'pixel',x:1,y:0,color:'#0000ff'}]);
 const changed=await call('compare_reference',{id:made.id,layer:'base'});assert.equal(changed.matchingPixels,5);assert.equal(changed.visibleDifferentPixels,1);assert.deepEqual(changed.firstDifference,{x:1,y:0,expected:'#ff0000ff',actual:'#0000ffff'});
 await service.edit(made.id,edited.revision,'undo');assert.equal((await call('compare_reference',{id:made.id,layer:'base'})).exactMatch,true);
}));

test('copy uses a new layer by default, protects other artwork, and undo/redo includes the whole copy',()=>fixture(async(service,call)=>{
 const made=await call('import_reference',{png_base64:pngFor()});
 const before=await service.edit(made.id,0,'paint',[{op:'pixel',x:0,y:0,color:'#ffffff'}]);
 const copied=await call('copy_reference',{id:made.id,revision:before.revision,name:'Copied source'});
 const doc=(await service.get(made.id)).entry.doc;
 assert.equal(doc.layers.length,2);assert.equal(doc.layers[1].name,'Copied source');assert.deepEqual(doc.layers[0].pixels,before.layers[0].pixels);assert.deepEqual(doc.layers[1].pixels,source.pixels);
 assert.equal(copied.copy.exactMatch,true);assert.equal(copied.layers[1].pixels,undefined);
 assert.equal((await call('compare_reference',{id:made.id})).visibleMatch,false,'composited art can differ even when the copied layer matches');
 const undo=await service.edit(made.id,doc.revision,'undo');assert.equal(undo.layers.length,1);assert.deepEqual(undo.reference,before.reference);
 const redo=await service.edit(made.id,undo.revision,'redo');assert.deepEqual(redo.layers[1].pixels,source.pixels);
 const stale=await callTool(service,'copy_reference',{id:made.id,revision:0});assert.equal(stale.isError,true);assert.equal((await service.get(made.id)).entry.doc.layers.length,2);
}));

test('copy targets only the requested animation cel, replacing transparent pixels exactly',()=>fixture(async(service,call)=>{
 const made=await call('import_reference',{png_base64:pngFor()});
 const before=await service.edit(made.id,0,'paint',[{op:'rect',x:0,y:0,width:3,height:2,color:'#ffffffff'},{op:'frame_add'}]);
 const copied=await call('copy_reference',{id:made.id,revision:before.revision,layer:'base',frame:1});
 const doc=(await service.get(made.id)).entry.doc;assert.deepEqual(doc.layers[0].pixels,before.layers[0].pixels);assert.deepEqual(frameView(doc,1).layers[0].pixels,source.pixels);
 assert.equal(copied.copy.frame,1);assert.equal(copied.copy.exactMatch,true);
 const beforeInvalid=structuredClone(doc);
 for(const args of [{frame:2},{frame:.5},{layer:'missing'},{layer:'base',name:'Misleading'},{name:''}]){
  assert.equal((await callTool(service,'copy_reference',{id:made.id,revision:doc.revision,...args})).isError,true);
  assert.deepEqual((await service.get(made.id)).entry.doc,beforeInvalid);
 }
 assert.equal((await callTool(service,'compare_reference',{id:made.id,frame:2})).isError,true);
}));

test('copy detaches recipes that could overwrite the copied image',()=>fixture(async(service,call)=>{
 const made=await call('import_reference',{png_base64:pngFor()});
 const withRecipe=await service.edit(made.id,0,'paint',[{op:'effect_recipe',layer:'base',recipe:{kind:'sparkles',seed:1,ink:'#ffffff',speed:1,opacity:1,drift:0}}]);
 const copied=await call('copy_reference',{id:made.id,revision:withRecipe.revision,layer:'base'});
 assert.equal((await service.get(made.id)).entry.doc.layers[0].effect,undefined);
 assert.equal((await service.edit(made.id,copied.revision,'undo')).layers[0].effect?.kind,'sparkles');
}));

test('fitting is shared with the browser, native sizing rejects loss, and crops preserve source pixels',()=>fixture(async(service,call)=>{
 const large={width:1024,height:768,pixels:Array.from({length:1024*768},(_,i)=>((i*256)>>>0)|255)};
 const png_base64=pngFor(large),alignment=fitReferenceAlignment(large.width,large.height);
 assert.deepEqual([alignment.width,alignment.height],[512,384]);
 assert.deepEqual(fitReferenceAlignment(4096,1),{width:512,height:1,offsetX:0,offsetY:0,cellWidth:8,cellHeight:1});
 const strip={width:4096,height:1,pixels:Array(4096).fill(0x123456ff)};
 assert.ok(prepareReference(strip,'Strip',fitReferenceAlignment(4096,1)).pixels.every(p=>p===0x123456ff));
 const tall={width:1,height:4096,pixels:strip.pixels};
 assert.ok(prepareReference(tall,'Tall',fitReferenceAlignment(1,4096)).pixels.every(p=>p===0x123456ff));
 const made=await call('import_reference',{png_base64,copy_to_layer:true});
 assert.deepEqual([made.width,made.height],[512,384]);assert.equal(made.referencePreparation.resampled,true);assert.equal(made.referencePreparation.sourceWidth,1024);assert.equal(made.copy.exactMatch,true);
 assert.deepEqual((await service.get(made.id)).entry.doc.layers[0].pixels,prepareReference(large,'Expected',alignment).pixels);
 const count=(await service.store.list()).length;
 for(const args of [{sizing:'native'},{sizing:'invalid'},{sizing:'native',alignment}])assert.equal((await callTool(service,'import_reference',{png_base64,...args})).isError,true);
 assert.equal((await service.store.list()).length,count,'invalid imports leave no projects');
 const crop=await call('import_reference',{png_base64,copy_to_layer:true,alignment:{width:2,height:2,offsetX:513,offsetY:44,cellWidth:1,cellHeight:1}});
 assert.equal(crop.referencePreparation.resampled,false);assert.equal(crop.referencePreparation.croppedOrPadded,true);
 assert.deepEqual((await service.get(crop.id)).entry.doc.layers[0].pixels,[large.pixels[44*1024+513],large.pixels[44*1024+514],large.pixels[45*1024+513],large.pixels[45*1024+514]]);
}));

test('attaching and copying a reference to an existing canvas is one atomic, undoable edit',()=>fixture(async(service,call)=>{
 const before=await service.create('Existing',3,2);
 const made=await call('import_reference',{id:before.id,revision:0,png_base64:pngFor(),copy_to_layer:true});
 assert.equal(made.revision,1);assert.equal(made.layers.length,2);assert.equal(made.copy.exactMatch,true);
 const undo=await service.edit(made.id,1,'undo');assert.equal(undo.reference,undefined);assert.equal(undo.layers.length,1);
 const wrong=await service.create('Mismatch',4,4);
 assert.equal((await callTool(service,'import_reference',{id:wrong.id,revision:0,png_base64:pngFor(),copy_to_layer:true})).isError,true);
 assert.deepEqual((await service.get(wrong.id)).entry.doc,wrong);
}));

test('missing references and layer budgets fail without modifying saved artwork',()=>fixture(async(service,call)=>{
 const empty=await service.create('Empty',3,2);
 for(const name of ['copy_reference','compare_reference'])assert.equal((await callTool(service,name,{id:empty.id,revision:0})).isError,true);
 let full:PixelDocument={...createDocument('Budget',512,512),reference:prepareReference({width:512,height:512,pixels:Array(512*512).fill(0xff112280)},'Large')};
 full.layers.push({...full.layers[0],id:'second'});full=await service.create('Budget',512,512,full);
 assert.equal((await callTool(service,'copy_reference',{id:full.id,revision:0})).isError,true);
 assert.deepEqual((await service.get(full.id)).entry.doc,full);
 assert.equal((await call('copy_reference',{id:full.id,revision:0,layer:'base'})).copy.exactMatch,true,'explicit replacement remains possible at the budget');
}));
