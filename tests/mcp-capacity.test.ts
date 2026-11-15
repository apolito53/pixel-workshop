import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {PNG} from 'pngjs';

test('stdio MCP edits the last frame and layer, regenerates FX, and exports at expanded capacity',async()=>{
 const data=await mkdtemp(join(tmpdir(),'pw-capacity-'));
 const client=new Client({name:'pixel-capacity-test',version:'1'});
 const transport=new StdioClientTransport({command:process.execPath,args:['server/stdio.ts'],env:{...process.env,PIXEL_DATA_DIR:data} as Record<string,string>});
 try{
  await client.connect(transport);
  async function call(name:string,args:Record<string,unknown>){
   const result=await client.callTool({name,arguments:args});
   assert.ok(Array.isArray(result.content));
   const first=result.content[0];assert.equal(first.type,'text');
   assert.ok(!result.isError,first.text);
   return {summary:JSON.parse(first.text),image:result.content.find(item=>item.type==='image')};
  }
  const large=await call('create_canvas',{name:'Wide panorama',width:1024,height:7});
  await call('paint',{id:large.summary.id,revision:0,commands:[{op:'pixel',x:1023,y:6,color:'#42ad59'}]});
  const inspection=await call('get_canvas',{id:large.summary.id,include_pixels:true});
  assert.equal(inspection.summary.pixelCells.used,1);
  assert.equal(inspection.summary.layers[0].pixels.length,1024*7);
  assert.equal(inspection.summary.layers[0].pixels.at(-1),0x42ad59ff);
  const panorama=await call('export_png',{id:large.summary.id});assert.ok(panorama.image);
  const wide=PNG.sync.read(Buffer.from(panorama.image.data,'base64'));
  assert.deepEqual([wide.width,wide.height],[1024,7]);assert.deepEqual([...wide.data.subarray(-4)],[66,173,89,255]);
  const {summary:{id}}=await call('create_canvas',{name:'Layered wind',width:4,height:4});
  const commands:Record<string,unknown>[]=[{op:'pixel',x:2,y:1,color:'#ff7518'}];
  for(let n=1;n<63;n++)commands.push({op:'add_layer',id:`layer-${n}`,name:`Layer ${n+1}`});
  for(let n=1;n<96;n++)commands.push({op:'frame_add',blank:true});
  commands.push({op:'pixel',layer:'layer-62',frame:95,x:3,y:3,color:'#ab23ef'},{op:'clip_set',name:'Last breeze',from:94,to:95,fps:12,mode:'loop'});
  const {summary:painted}=await call('paint',{id,revision:0,commands});assert.equal(painted.frameCount,96);
  const {summary:fx}=await call('generate_effect',{id,revision:painted.revision,kind:'leaves',seed:42,ink:'#efef11'});
  assert.equal(fx.layers.length,64);
  const layer=fx.layers.at(-1).id;
  const {summary:regen}=await call('regenerate_effect',{id,revision:fx.revision,layer,seed:81});
  await call('paint',{id,revision:regen.revision,commands:[{op:'visibility',layer,visible:false}]});
  const sheet=await call('export_sprite_sheet',{id,columns:96});assert.ok(sheet.image);
  const atlas=sheet.summary;assert.equal(atlas.frames.length,96);assert.deepEqual(atlas.clips[0].frames,[94,95]);
  const png=PNG.sync.read(Buffer.from(sheet.image.data,'base64'));
  assert.deepEqual([png.width,png.height],[384,4]);
  assert.deepEqual([...png.data.subarray(-4)],[171,35,239,255]);
 }finally{await client.close();await rm(data,{recursive:true,force:true});}
});
