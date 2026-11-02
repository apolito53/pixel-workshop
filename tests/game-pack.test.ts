import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {applyCommands,createDocument,frameCount} from '../lib/pixels.ts';
import {createStoreZip,crc32} from '../lib/zip-store.ts';
import {buildGamePack} from '../lib/game-pack.ts';

function readStoredFiles(bytes:Uint8Array):Record<string,Uint8Array>{
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out:Record<string,Uint8Array>={};
 const utf8=new TextDecoder();let offset=0;
 while(view.getUint32(offset,true)===0x04034b50){
  assert.equal(view.getUint16(offset+8,true),0,'method must be STORE');
  const crc=view.getUint32(offset+14,true),size=view.getUint32(offset+18,true);
  const n=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true);
  const path=utf8.decode(bytes.subarray(offset+30,offset+30+n));
  const start=offset+30+n+extra,data=bytes.subarray(start,start+size);
  assert.equal(crc32(data),crc,'CRC for '+path);
  out[path]=data;
  offset=start+size;
 }
 assert.equal(view.getUint32(offset,true),0x02014b50,'central directory must follow local files');
 assert.ok(Object.keys(out).length>=1);
 return out;
}
test('stored ZIP can be read without compression and rejects traversal or duplicate paths',()=>{
 const contents=readStoredFiles(createStoreZip([{path:'safe/demo.txt',data:new TextEncoder().encode('hello')}]));
 assert.equal(new TextDecoder().decode(contents['safe/demo.txt']),'hello');
 assert.throws(()=>createStoreZip([{path:'../escape.txt',data:new Uint8Array()}]),/Unsafe/);
 assert.throws(()=>createStoreZip([
  {path:'SAME.txt',data:new Uint8Array()},{path:'same.txt',data:new Uint8Array()}
 ]),/duplicate/);
});
test('game pack includes editable JSON, PNG sheets, named-clip atlases and a manifest',()=>{
 const hero=applyCommands(createDocument('Hero',4,4,'hero'),[
  {op:'pixel',x:1,y:1,color:'#facade'},
  {op:'frame_add',source_frame:0},
  {op:'pixel',frame:1,x:2,y:2,color:'#cc00ff'},
  {op:'clip_set',name:'Walk',from:0,to:1,fps:9,mode:'pingpong'},
 ]);
 const meadow=applyCommands(createDocument('Meadow',6,6,'meadow'),[{op:'rect',x:0,y:5,width:6,height:1,color:'#55aa33'}]);
 const output=buildGamePack([hero,meadow]);
 const contents=readStoredFiles(output.bytes);
 const manifest=JSON.parse(new TextDecoder().decode(contents['manifest.json']));
 assert.equal(manifest.assets.length,2);
 assert.deepEqual(manifest.assets.map((a:{name:string})=>a.name),['Hero','Meadow']);
 assert.equal(frameCount(hero),2);
 for(const entry of manifest.assets){
  const source=JSON.parse(new TextDecoder().decode(contents[entry.source]));
  const atlas=JSON.parse(new TextDecoder().decode(contents[entry.atlas]));
  const png=PNG.sync.read(Buffer.from(contents[entry.sheet]));
  assert.equal(source.name,entry.name);
  assert.equal(atlas.frames.length,entry.frames);
  assert.equal(png.width,atlas.width);assert.equal(png.height,atlas.height);
 }
 const heroAtlas=JSON.parse(new TextDecoder().decode(contents[manifest.assets[0].atlas]));
 assert.deepEqual(heroAtlas.clips[0].frames,[0,1]);
});
test('asset path collisions are disambiguated even when titles are identical',()=>{
 const a=createDocument('Same',1,1,'a'),b=createDocument('Same',1,1,'b');
 const pack=buildGamePack([a,b]);const files=readStoredFiles(pack.bytes);
 assert.ok(files['assets/same/same.pixel.json']);
 assert.ok(files['assets/same-2/same-2.pixel.json']);
 assert.throws(()=>buildGamePack([]),/between 1 and 30/);
});
