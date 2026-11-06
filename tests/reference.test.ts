import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import {createDocument,validateDocument,applyCommands,composite,documentCells,MAX_ANIMATION_CELLS} from '../lib/pixels.ts';
import {prepareReference,packRgba,referenceRgba,checkReferencePng,validateReference} from '../lib/reference.ts';
import {referenceFromPng} from '../lib/reference-png.ts';
import {previewPixels,buildCanvasPreview,maxPreviewZoom} from '../lib/canvas-preview.ts';
import {decodeBrowserReference,encodeBrowserPng} from '../lib/browser-png.ts';
import {encodePng} from '../lib/png.ts';
import {encodeSvg} from '../lib/svg.ts';
import {buildSpriteSheet} from '../lib/sprite-sheet.ts';
import {ProjectService} from '../lib/project-service.ts';
import {fileStore} from '../server/file-store.ts';
import {callTool} from '../lib/mcp-tools.ts';

const source={width:3,height:2,pixels:[0x12345603,0xff0000ff,0x00ff0080,0x102030ff,0x04050600,0xabcdef88]};
test('native references preserve straight RGBA and exact dimensions in browser and server decoders',()=>{
 const r=prepareReference(source,'Native');
 const png=new PNG({width:source.width,height:source.height});png.data.set(referenceRgba(source));
 const bytes=PNG.sync.write(png);
 assert.deepEqual(decodeBrowserReference(new Uint8Array(bytes)),source);
 assert.deepEqual(referenceFromPng(bytes.toString('base64'),'Native'),r);
 assert.deepEqual(packRgba(referenceRgba(r)),source.pixels);
 assert.throws(()=>validateReference(r,4,2),/exactly match/);
 assert.throws(()=>prepareReference(source,'bad',{width:2,height:2,offsetX:0,offsetY:0,cellWidth:0,cellHeight:1}),/spacing/);
 assert.throws(()=>checkReferencePng(new Uint8Array(33)),/PNG/);
 const bomb=Buffer.from(bytes);bomb.writeUInt32BE(9000,16);assert.throws(()=>checkReferencePng(bomb),/4096/);
 assert.throws(()=>referenceFromPng('not base64','Bad'),/base64/);
});
test('calibration recovers enlarged pixels using spacing and source offsets, with explicit transparent padding',()=>{
 const enlarged={width:14,height:11,pixels:Array<number>(154).fill(0xffffffff)};
 for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++)for(let yy=0;yy<4;yy++)for(let xx=0;xx<4;xx++)enlarged.pixels[(1+y*4+yy)*14+2+x*4+xx]=source.pixels[y*3+x];
 const alignment={width:3,height:2,offsetX:2,offsetY:1,cellWidth:4,cellHeight:4};
 assert.deepEqual(prepareReference(enlarged,'4x',alignment).pixels,source.pixels);
 assert.deepEqual(prepareReference(enlarged,'fractional',{...alignment,offsetX:1.5,offsetY:.5,cellWidth:4.125,cellHeight:4.125}).pixels,source.pixels);
 const padded=prepareReference(source,'Pad',{width:4,height:2,offsetX:-1,offsetY:0,cellWidth:1,cellHeight:1});
 assert.deepEqual(padded.pixels,[0,...source.pixels.slice(0,3),0,...source.pixels.slice(3)]);
});
test('references are immutable guides across paint, animation, palette remap and artwork exports',()=>{
 let doc=applyCommands(createDocument('Trace',3,2),[{op:'reference_set',reference:prepareReference(source,'Guide')}]);
 doc=applyCommands(doc,[{op:'pixel',x:1,y:0,color:'#ff0000'},{op:'palette_remap',fromColor:'#ff0000',toColor:'#0000ff'},{op:'frame_add',blank:true}]);
 assert.deepEqual(doc.reference!.pixels,source.pixels);
 assert.equal(doc.layers[0].pixels[1],0x0000ffff);
 assert.equal(PNG.sync.read(encodePng(doc)).data[3],0);
 assert.deepEqual(PNG.sync.read(Buffer.from(encodeBrowserPng(doc))).data,PNG.sync.read(encodePng(doc)).data);
 assert.deepEqual(buildSpriteSheet(doc).bytes.subarray(0,4),new Uint8Array(4));
 assert.doesNotMatch(encodeSvg(doc),/#123456|#abcdef/);
 assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(doc))),doc);
 assert.throws(()=>applyCommands(doc,[{op:'pixel',x:0,y:0,color:'#ffffff'},{op:'reference_set',reference:{...doc.reference,width:4}}]),/exactly match/);
 assert.equal(doc.layers[0].pixels[0],0,'invalid batch is atomic');
});
test('overlay opacity, native crop and integer grid magnification keep every cell registered',()=>{
 const doc=createDocument('Overlay',3,2);doc.reference=prepareReference(source,'Guide');doc.layers[0].pixels[1]=0x0000ffff;
 assert.deepEqual(previewPixels(doc,{view:'reference'}),referenceRgba(source));
 assert.deepEqual(previewPixels(doc,{view:'artwork'}),composite(doc));
 const overlay=previewPixels(doc,{view:'overlay',referenceOpacity:1,artworkOpacity:.5});
 assert.deepEqual([...overlay.slice(4,8)],[128,0,128,255]);
 for(const scale of [1,3,8]){
  const region={x:1,y:0,width:2,height:2},big=buildCanvasPreview(doc,{view:'overlay',referenceOpacity:1,artworkOpacity:.5,region,scale});
  for(let y=0;y<big.height;y++)for(let x=0;x<big.width;x++){
   const native=((region.y+Math.floor(y/scale))*3+region.x+Math.floor(x/scale))*4;
   assert.deepEqual(big.bytes.slice((y*big.width+x)*4,(y*big.width+x)*4+4),overlay.slice(native,native+4));
  }
  const grid=buildCanvasPreview(doc,{view:'reference',scale,grid:true});
  if(scale>=3)assert.deepEqual(grid.bytes.slice((grid.width+1)*4,(grid.width+1)*4+4),referenceRgba(source).slice(0,4));
 }
 assert.throws(()=>buildCanvasPreview(doc,{region:{x:2,y:0,width:2,height:1}}),/fit/);
 assert.throws(()=>previewPixels(doc,{view:'overlay',artworkOpacity:NaN}),/opacity/);
 assert.throws(()=>previewPixels(createDocument('No reference',2,2),{view:'reference'}),/no tracing reference/);
});
test('larger canvases share the existing cell budget including the reference and all frames',()=>{
 const doc=createDocument('Large',256,384);doc.reference=prepareReference({width:256,height:384,pixels:Array(256*384).fill(0)},'Tall');
 assert.equal(validateDocument(doc).height,384);
 const large=createDocument('Limit',512,512);large.reference=prepareReference({width:512,height:512,pixels:Array(512*512).fill(0)},'Full');
 const two=applyCommands(large,[{op:'add_layer',id:'second'}]);assert.ok(documentCells(two)<=MAX_ANIMATION_CELLS);
 assert.throws(()=>applyCommands(two,[{op:'add_layer',id:'third'}]),/budget/);
 assert.throws(()=>applyCommands(two,[{op:'frame_add'}]),/budget/);
 assert.throws(()=>validateDocument({...two,layers:[...two.layers,{...two.layers[0],id:'third'}]}),/budget/);
 assert.equal(maxPreviewZoom(512,512),4);assert.throws(()=>createDocument('Oversized',513,2));
});
test('MCP imports, inspects close-ups, rejects mismatches and stale revisions, and undo restores references',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pixel-tracing-'));
 try{
  const service=new ProjectService(fileStore(dir)),png=new PNG({width:3,height:2});png.data.set(referenceRgba(source));
  const png_base64=PNG.sync.write(png).toString('base64');
  const made=await callTool(service,'import_reference',{png_base64,name:'MCP trace'});assert.ok(!made.isError);
  const doc=JSON.parse(made.content[0].text!);assert.deepEqual([doc.width,doc.height],[3,2]);assert.equal(doc.reference.pixels,undefined);
  const viewed=await callTool(service,'get_canvas',{id:doc.id,view:'reference',include_pixels:true,scale:4,grid:true,region:{x:1,y:0,width:2,height:2}});
  assert.ok(!viewed.isError);assert.deepEqual(JSON.parse(viewed.content[0].text!).reference.pixels,source.pixels);
  const image=viewed.content.find(c=>c.type==='image');assert.ok(image&&image.type==='image');
  const actual=PNG.sync.read(Buffer.from(image.data,'base64'));
  const expected=buildCanvasPreview((await service.get(doc.id)).entry.doc,{view:'reference',scale:4,grid:true,region:{x:1,y:0,width:2,height:2}});
  assert.deepEqual(actual.data,Buffer.from(expected.bytes));
  assert.equal((await callTool(service,'import_reference',{id:doc.id,png_base64})).isError,true);
  const mismatch=await service.create('Wrong size',4,4);
  assert.equal((await callTool(service,'import_reference',{id:mismatch.id,revision:0,png_base64})).isError,true);
  assert.equal((await service.get(mismatch.id)).entry.doc.revision,0);
  const removed=await service.edit(doc.id,0,'paint',[{op:'reference_set',reference:null}]);assert.equal(removed.reference,undefined);
  assert.equal((await callTool(service,'import_reference',{id:doc.id,revision:0,png_base64})).isError,true);
  assert.deepEqual((await service.edit(doc.id,1,'undo')).reference!.pixels,source.pixels);
  assert.equal((await service.edit(doc.id,2,'redo')).reference,undefined);
  const calibrated=await callTool(service,'import_reference',{png_base64,alignment:{width:2,height:1,offsetX:1,offsetY:0,cellWidth:1,cellHeight:1}});assert.ok(!calibrated.isError);
  const calibratedDoc=JSON.parse(calibrated.content[0].text!);assert.deepEqual([calibratedDoc.width,calibratedDoc.height],[2,1]);
 }finally{await rm(dir,{recursive:true,force:true});}
});
