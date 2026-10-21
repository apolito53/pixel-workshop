import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import {createDocument,applyCommands,composite,color,validateDocument,readRegion} from '../lib/pixels.ts';
import {ProjectService} from '../lib/project-service.ts';
import {fileStore} from '../server/file-store.ts';
import {encodePng} from '../lib/png.ts';
import {encodeBrowserPng} from '../lib/browser-png.ts';
import {mcpResponse} from '../lib/mcp-tools.ts';
import {lanternDemo} from '../lib/demo.ts';

test('drawing is exact and atomic; invalid batches do not alter source',()=>{
 const source=createDocument('Test',8,8),next=applyCommands(source,[{op:'line',x:0,y:0,x2:7,y2:7,color:'#ff0000'}]);
 assert.equal(next.layers[0].pixels.filter(Boolean).length,8);assert.equal(source.layers[0].pixels.filter(Boolean).length,0);
 assert.throws(()=>applyCommands(source,[{op:'pixel',x:0,y:0,color:'#ff0000'},{op:'pixel',x:8,y:0,color:'#ff0000'}]));assert.equal(source.layers[0].pixels[0],0);
});
test('flood fill respects a closed outline; transparent erase preserves other pixels',()=>{
 let d=applyCommands(createDocument('Fill',8,8),[{op:'rect',x:1,y:1,width:6,height:6,filled:false,color:'#123456'},{op:'fill',x:2,y:2,color:'#ff0000'}]);
 assert.equal(d.layers[0].pixels[0],0);assert.equal(d.layers[0].pixels[2*8+2],color('#ff0000'));assert.equal(d.layers[0].pixels[1*8+1],color('#123456'));
 d=applyCommands(d,[{op:'pixel',x:2,y:2,color:'transparent'}]);assert.equal(d.layers[0].pixels[2*8+2],0);
});
test('selection transforms preserve exact RGBA and handle overlapping moves atomically',()=>{
 const a=color('#ff000080'),b=color('#00ff00'),base=applyCommands(createDocument('Selection',5,3),[{op:'paste',x:0,y:0,width:3,height:2,pixels:[a,0,b,b,a,0]}]);
 const moved=applyCommands(base,[{op:'transform',mode:'move',x:0,y:0,width:3,height:2,x2:1,y2:1}]);
 assert.deepEqual(readRegion(moved,'base',{x:1,y:1,width:3,height:2}),[a,0,b,b,a,0]);
 assert.deepEqual(readRegion(moved,'base',{x:0,y:0,width:5,height:1}),[0,0,0,0,0]);
 const flipped=applyCommands(base,[{op:'transform',mode:'flip_horizontal',x:0,y:0,width:3,height:2},{op:'transform',mode:'flip_vertical',x:0,y:0,width:3,height:2}]);
 assert.deepEqual(readRegion(flipped,'base',{x:0,y:0,width:3,height:2}),[0,a,b,b,0,a]);
 const copied=applyCommands(base,[{op:'transform',mode:'copy',x:0,y:0,width:2,height:2,x2:3,y2:1}]);
 assert.deepEqual(readRegion(copied,'base',{x:3,y:1,width:2,height:2}),[a,0,b,a]);
 assert.equal(copied.layers[0].pixels[0],a);
 assert.throws(()=>applyCommands(base,[{op:'clear'},{op:'transform',mode:'move',x:0,y:0,width:3,height:2,x2:4,y2:0}]));
 assert.equal(base.layers[0].pixels[0],a);
 assert.throws(()=>applyCommands(base,[{op:'paste',x:0,y:0,width:1,height:1,pixels:[-1]}]));
});
test('layers composite alpha and visibility correctly',()=>{
 let d=applyCommands(createDocument('Layers',1,1),[{op:'pixel',x:0,y:0,color:'#ff0000'},{op:'add_layer',id:'top',name:'Top'},{op:'pixel',layer:'top',x:0,y:0,color:'#0000ff80'}]);
 assert.deepEqual(Array.from(composite(d)),[127,0,128,255]);d=applyCommands(d,[{op:'visibility',layer:'top',visible:false}]);assert.deepEqual(Array.from(composite(d)),[255,0,0,255]);
});
test('native PNG round-trips exact RGBA; integer scale repeats pixels',()=>{
 const d=applyCommands(createDocument('PNG',2,2),[{op:'pixel',x:1,y:0,color:'#aabbcc80'}]),png=PNG.sync.read(encodePng(d));
 assert.equal(png.width,2);assert.equal(png.height,2);assert.deepEqual(png.data,Buffer.from(composite(d)));
 const big=PNG.sync.read(encodePng(d,4));assert.equal(big.width,8);for(let y=0;y<8;y++)for(let x=0;x<8;x++)assert.deepEqual(big.data.subarray((y*8+x)*4,(y*8+x)*4+4),png.data.subarray((Math.floor(y/4)*2+Math.floor(x/4))*4,(Math.floor(y/4)*2+Math.floor(x/4))*4+4));
});
test('browser PNG export preserves exact translucent RGBA at native and integer scales',()=>{
 const d=applyCommands(createDocument('Browser PNG',2,2),[{op:'pixel',x:0,y:0,color:'#f6da9280'},{op:'pixel',x:1,y:1,color:'#12345603'}]);
 for(const scale of [1,4]){const browser=PNG.sync.read(Buffer.from(encodeBrowserPng(d,scale))),server=PNG.sync.read(encodePng(d,scale));assert.deepEqual(browser.data,server.data);assert.equal(browser.width,2*scale);}
});
test('project JSON round-trips and rejects corrupt layers',()=>{
 const d=lanternDemo();assert.deepEqual(validateDocument(JSON.parse(JSON.stringify(d))),d);assert.throws(()=>validateDocument({...d,layers:[{...d.layers[0],pixels:[1]}]}));
});
test('storage persists edits and undo/redo; stale revisions and concurrent writes fail safely',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pixel-test-'));try{
 const s=new ProjectService(fileStore(dir));const d=await s.create('Saved',8,8);await s.edit(d.id,0,'paint',[{op:'pixel',x:0,y:0,color:'#ffffff'}]);
 const restored=new ProjectService(fileStore(dir));assert.equal((await restored.get(d.id)).entry.doc.layers[0].pixels[0],color('#ffffff'));
 await assert.rejects(()=>restored.edit(d.id,0,'paint',[{op:'clear'}]),/changed/);
 const u=await restored.edit(d.id,1,'undo');assert.equal(u.revision,2);assert.equal(u.layers[0].pixels[0],0);const r=await restored.edit(d.id,2,'redo');assert.equal(r.revision,3);assert.equal(r.layers[0].pixels[0],color('#ffffff'));
 const results=await Promise.allSettled([s.edit(d.id,3,'paint',[{op:'pixel',x:1,y:1,color:'#ff0000'}]),restored.edit(d.id,3,'paint',[{op:'pixel',x:2,y:2,color:'#00ff00'}])]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('hosted JSON-RPC exposes tools, reports invalid operations, and returns real PNGs',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pixel-mcp-'));try{const s=new ProjectService(fileStore(dir));const rpc=async(method:string,params={})=>(await (await mcpResponse(new Request('http://local/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),s)).json()) as any;
 assert.equal((await rpc('server/discover')).result.supportedVersions[0],'2026-07-28');assert.equal((await rpc('tools/list')).result.tools.length,7);
 const made=await rpc('tools/call',{name:'create_canvas',arguments:{name:'MCP sprite',width:16,height:16}}),d=JSON.parse(made.result.content[0].text);
 const painted=await rpc('tools/call',{name:'paint',arguments:{id:d.id,revision:0,commands:[{op:'rect',x:2,y:2,width:12,height:12,color:'#ffaa55'}]}});assert.equal(painted.result.isError,undefined);
 const exported=await rpc('tools/call',{name:'export_png',arguments:{id:d.id}});const img=PNG.sync.read(Buffer.from(exported.result.content[1].data,'base64'));assert.equal(img.width,16);assert.equal(img.data[3],0);
 assert.equal((await rpc('tools/call',{name:'paint',arguments:{id:d.id,revision:1,commands:[{op:'pixel',x:17,y:0,color:'#fff000'}]}})).result.isError,true);
 }finally{await rm(dir,{recursive:true,force:true});}
});
