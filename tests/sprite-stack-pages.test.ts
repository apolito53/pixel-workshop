import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {createStackDocument, frameView, composite, validateDocument, type PixelDocument} from '../lib/pixels.ts';
import {encodeStackPage, exportStackPages, importStackPages, planStackPages, readStackPages} from '../lib/sprite-stack-pages.ts';

function oddStack():PixelDocument {
  const doc:PixelDocument=createStackDocument('Five uneven slices',3,5,5,{origin:[1,2],zMin:-4,sliceHeight:2});
  doc.layers[0].pixels={x:1,y:0,width:1,height:1,data:[0xe112ae80]};
  doc.layers.push({id:'guide',name:'Hidden guide',visible:false,pixels:{x:0,y:0,width:1,height:1,data:[0xaba3af00]}});
  for(const [i,frame] of doc.animation!.frames.entries()){
    frame.pixels[doc.layers[0].id]={x:i%3,y:i+1,width:1,height:1,data:[0x83a33f7d+i]};
    frame.pixels.guide=doc.layers[1].pixels;
  }
  return validateDocument(doc);
}

test('transparent slice pages wrap odd cells and preserve exact coordinates, pixel colors and editable layers',()=>{
  const doc=oddStack();
  const {bytes,manifest}=exportStackPages(doc,{maxPageWidth:7,maxPageHeight:11});
  assert.deepEqual(manifest.pages.map(p=>[p.firstSlice,p.sliceCount,p.columns,p.width,p.height]),[[0,4,2,6,10],[4,1,1,3,5]]);
  assert.deepEqual(importStackPages(bytes),doc);
  const pages=new Map<string,Uint8Array>(manifest.pages.map((p,i)=>[p.file,encodeStackPage(doc,manifest,i)]));
  // A game engine or external pixel artist needs only the transparent PNGs and their manifest.
  const fromPixels=readStackPages(manifest,file=>pages.get(file));
  assert.equal(fromPixels.layers.length,1);
  assert.deepEqual(fromPixels.stack,doc.stack);
  for(let z=0;z<5;z++)assert.deepEqual(composite(frameView(fromPixels,z)),composite(frameView(doc,z)));
  const edited=PNG.sync.read(Buffer.from(pages.get(manifest.pages[1].file)!));
  edited.data.set([211,82,155,173],0);
  pages.set(manifest.pages[1].file,PNG.sync.write(edited));
  const result=readStackPages(manifest,file=>pages.get(file));
  assert.deepEqual(Array.from(composite(frameView(result,4)).subarray(0,4)),[211,82,155,173]);
});

test('packed source never masks externally edited PNGs or missing pages',()=>{
  const doc=oddStack();
  const {manifest}=exportStackPages(doc,{columns:1,maxPageHeight:15});
  const files=new Map<string,Uint8Array>(manifest.pages.map((p,i)=>[p.file,encodeStackPage(doc,manifest,i)]));
  files.set(manifest.source!,new TextEncoder().encode(JSON.stringify(doc)));
  const p=manifest.pages[1],edited=PNG.sync.read(Buffer.from(files.get(p.file)!));
  edited.data.set([24,20,88,137],0);
  files.set(p.file,PNG.sync.write(edited));
  const result=readStackPages(manifest,file=>files.get(file));
  assert.equal(result.layers.length,1);
  assert.deepEqual(Array.from(composite(frameView(result,p.firstSlice)).subarray(0,4)),[24,20,88,137]);
  files.delete(p.file);
  assert.throws(()=>readStackPages(manifest,file=>files.get(file)),/Missing/);
});

test('invalid or overlapping ranges, path traversal, wrong PNG dimensions and oversize requests fail before importing',()=>{
  const doc=oddStack(),opts={maxPageWidth:6,maxPageHeight:5},m=planStackPages(doc,opts);
  for(const alter of [
    (v:typeof m)=>{v.pages[1].firstSlice=1;},
    (v:typeof m)=>{v.pages[0].width=4097;},
    (v:typeof m)=>{v.pages[0].file='../image.png';},
    (v:typeof m)=>{v.pages[1].file=v.pages[0].file;},
    (v:typeof m)=>{v.pages.pop();},
  ]){
    const v=structuredClone(m);alter(v);
    assert.throws(()=>readStackPages(v,()=>{throw new Error('Read before validation');}),e=>!(e as Error).message.includes('Read before validation'));
  }
  const png=encodeStackPage(doc,m,0);
  assert.throws(()=>readStackPages(m,()=>png),/matching/);
  assert.throws(()=>planStackPages(doc,{maxPageWidth:2}),/Maximum page width/);
  assert.throws(()=>planStackPages(doc,{maxPageWidth:6,columns:3}),/columns/);
  assert.throws(()=>encodeStackPage(doc,m,m.pages.length),/Page index/);
});

test('page decoding checks PNG headers and archive directory integrity before restoring a project',()=>{
  const doc=oddStack(),{bytes,manifest}=exportStackPages(doc);
  const png=encodeStackPage(doc,manifest,0),interlaced=new Uint8Array(png);
  interlaced[28]=1;
  assert.throws(()=>readStackPages(manifest, file=>file.endsWith('.png')?interlaced:undefined),/non-interlaced/);
  assert.throws(()=>readStackPages(manifest, file=>file.endsWith('.png')?png.subarray(0,-9):undefined),/Truncated/);
  const broken=new Uint8Array(bytes);
  const view=new DataView(broken.buffer),central=view.getUint32(broken.length-6,true);
  broken[central+16]^=1;
  assert.throws(()=>importStackPages(broken),/directory/i);
});

test('one-PNG-per-slice exports can cover the full native depth',()=>{
  const doc=createStackDocument('Sparse',1,1,512);
  const pack=exportStackPages(doc,{maxPageWidth:1,maxPageHeight:1});
  assert.equal(pack.manifest.pages.length,512);
  assert.equal(importStackPages(pack.bytes).animation!.frames.length,511);
});

test('opens a desktop-repacked DEFLATE ZIP in a containing folder',()=>{
  // Python zipfile + Pillow fixture: directory entries, descriptors, a ZIP comment,
  // and two differently colored RGBA slices in a single externally saved PNG.
  const bytes=Buffer.from('UEsDBBQACAAIABlwd10AAAAAAAAAAAAAAAAJAAAATXkgc3RhY2svAwBQSwcIAAAAAAIAAAAAAAAAUEsDBBQACAAIABlwd10AAAAAAAAAAAAAAAAPAAAATXkgc3RhY2svcGFnZXMvAwBQSwcIAAAAAAIAAAAAAAAAUEsDBBQACAAIABlwd10AAAAAAAAAAAAAAAAWAAAATXkgc3RhY2svbWFuaWZlc3QuanNvbm2PvQ7CMAyEX6XKTKDtyMrCwgIj6hDaNImaPyWpiqj67tihVEJis7/z2eeZ9C4YlsixIF49uaaTC0OUztOYWDtQzwSPh4rsCmKZ4Th35R4U3iGbVJckwApqyZWQaW2iVi0/udEiqAG40PGA9odLyRk6evTnI0Bn0JVQFsp7uSvKBrTXJfd0W3feDiyAcjKcn0mvdE72Cev33gpc3qsQ0w2dIJb/QrVOj8bGtfs+U/88szTLG1BLBwiBXGhBtAAAACYBAABQSwMEFAAIAAgAGXB3XQAAAAAAAAAAAAAAABQAAABNeSBzdGFjay9wYWdlcy9wLnBuZ+sM8HPn5ZLiYmBg4PX0cAkC0kxAzMjBBiS/KNV3ASlBTxfHkIo5yQ+EJv6u75+oLs/ANY1pmvJC/yygJIOnq5/LOqeEJgBQSwcI8OHWykYAAABKAAAAUEsBAhQDFAAIAAgAGXB3XQAAAAACAAAAAAAAAAkAAAAAAAAAAAAQAP1BAAAAAE15IHN0YWNrL1BLAQIUAxQACAAIABlwd10AAAAAAgAAAAAAAAAPAAAAAAAAAAAAEAD9QTkAAABNeSBzdGFjay9wYWdlcy9QSwECFAMUAAgACAAZcHddgVxoQbQAAAAmAQAAFgAAAAAAAAAAAAAAgAF4AAAATXkgc3RhY2svbWFuaWZlc3QuanNvblBLAQIUAxQACAAIABlwd13w4dbKRgAAAEoAAAAUAAAAAAAAAAAAAACAAXABAABNeSBzdGFjay9wYWdlcy9wLnBuZ1BLBQYAAAAABAAEAPoAAAD4AQAACQBwaXhlbCBhcnQ=','base64');
  const doc=importStackPages(bytes);
  assert.deepEqual(doc.stack?.origin,[0,0]);
  assert.equal(doc.stack?.zMin,-1);
  assert.deepEqual(Array.from(composite(frameView(doc,0))),[10,20,30,255]);
  assert.deepEqual(Array.from(composite(frameView(doc,1))),[222,1,12,111]);
});
