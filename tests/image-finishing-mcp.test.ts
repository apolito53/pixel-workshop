import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {callTool,mcpResponse,toolDefinitions} from '../lib/mcp-tools.ts';
import {finishPng,inspectFinishingPng,MAX_FINISHING_PNG_BASE64} from '../lib/finishing-png.ts';
import {DEFAULT_FINISHING_SETTINGS,renderFinishedImage} from '../lib/image-finishing.ts';
import {FINISHING_RECIPE_FORMAT,readFinishingRecipe,readFinishingProject} from '../lib/finishing-project.ts';
import {ProjectService} from '../lib/project-service.ts';
import {privateMcpApi,type WorkspaceProviders} from '../lib/workspace-http.ts';
import {issueWorkspaceToken,makeWorkspaceRecord} from '../lib/workspace-session.ts';
import {crc32} from '../lib/zip-store.ts';

function statelessService(){
  const touch=()=>{throw new Error('Finishing must not read or write stored pixel projects.');};
  return new ProjectService({list:touch,get:touch,put:touch});
}
function png(width=3,height=2){
  const image=new PNG({width,height});
  for(let i=0;i<width*height;i++){
    image.data.set([40+(i%5)*25,80+(i%3)*35,160-(i%4)*20,[255,128,0][i%3]],i*4);
  }
  return {width,height,data:image.data,bytes:PNG.sync.write(image,{colorType:6})};
}
function addChunk(bytes:Buffer,type:string,data:Buffer){
  const chunk=Buffer.alloc(data.length+12);chunk.writeUInt32BE(data.length);chunk.write(type,4,'ascii');data.copy(chunk,8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4,8+data.length)),8+data.length);
  return Buffer.concat([bytes.subarray(0,33),chunk,bytes.subarray(33)]);
}
function output(result:Awaited<ReturnType<typeof callTool>>){
  assert.ok(!('isError' in result&&result.isError),JSON.stringify(result.content));
  const metadata=result.content.find(item=>item.type==='text');
  const image=result.content.find(item=>item.type==='image');
  assert.ok(metadata&&image);
  return {metadata:JSON.parse(metadata.text),image:PNG.sync.read(Buffer.from(image.data,'base64')),bytes:Buffer.from(image.data,'base64')};
}

test('finish_image is stateless and preserves all neutral source RGBA, including transparent RGB',async()=>{
  const original=png(),base64=original.bytes.toString('base64');
  const result=output(await callTool(statelessService(),'finish_image',{png_base64:base64}));
  assert.deepEqual(result.image.data,original.data);
  assert.deepEqual(result.metadata.source,{width:3,height:2});
  assert.deepEqual([result.metadata.width,result.metadata.height],[3,2]);
  assert.deepEqual(result.metadata.recipe,{format:FINISHING_RECIPE_FORMAT,adjustments:DEFAULT_FINISHING_SETTINGS,crop:null});
  assert.equal(result.metadata.resampled,false);assert.equal(result.metadata.stored,false);
  assert.equal(result.metadata.byteLength,result.bytes.byteLength);
  assert.equal(result.bytes.toString('ascii',37,41),'sRGB','output identifies its color space');
  assert.equal(base64,original.bytes.toString('base64'));
});

test('finish_image applies the shared engine and crops in original pixels; recipes reopen in browser',async()=>{
  const original=png(),adjustments={saturation:-65,exposure:.4,warmth:10,gamma:1.2};
  const crop={x:1,y:0,width:2,height:2};
  const result=output(await callTool(statelessService(),'finish_image',{png_base64:original.bytes.toString('base64'),adjustments,crop}));
  const expected=renderFinishedImage({width:3,height:2,data:new Uint8ClampedArray(original.data)},adjustments,crop);
  assert.deepEqual(result.image.data,Buffer.from(expected.data));
  assert.deepEqual([result.image.width,result.image.height],[2,2]);
  assert.deepEqual(readFinishingRecipe(result.metadata.recipe,3,2),result.metadata.recipe);
  assert.equal(result.metadata.recipe.adjustments.saturation,-65);
  assert.equal(result.metadata.recipe.adjustments.contrast,0);
  assert.deepEqual(result.metadata.recipe.crop,crop);
  const originalAgain=output(await callTool(statelessService(),'finish_image',{png_base64:original.bytes.toString('base64'),adjustments:{}}));
  assert.deepEqual(originalAgain.image.data,original.data,'reapplying neutral settings to the original restores it');
});

test('4096-square source exports every pixel without the sprite engine limits or downsampling',()=>{
  const width=4096,height=4096,source=new PNG({width,height});source.data.fill(155);
  source.data.set([81,122,203,255],source.data.length-4);
  const original=PNG.sync.write(source,{colorType:6});
  const finished=finishPng(original.toString('base64'));
  const decoded=PNG.sync.read(finished.bytes);
  assert.deepEqual([decoded.width,decoded.height],[4096,4096]);
  assert.deepEqual(decoded.data,source.data);
});

test('agents exchange editable projects with the browser and revise cumulative settings from the original',async()=>{
  const source=png(),base64=source.bytes.toString('base64');
  const crop={x:1,y:0,width:2,height:2};
  const result=await callTool(statelessService(),'finish_image',{png_base64:base64,name:'Book illustration',adjustments:{saturation:-35,warmth:15},crop,output:'project'});
  assert.ok(!('isError' in result&&result.isError),JSON.stringify(result.content));
  assert.equal(result.content.some(item=>item.type==='image'),false,'project output should not also transfer a flattened image');
  const resource=result.content.find(item=>item.type==='resource');assert.ok(resource&&'text' in resource.resource);
  assert.ok(resource.resource.uri.endsWith('Book-illustration.finish.json'));
  const project=readFinishingProject(JSON.parse(resource.resource.text));
  assert.equal(project.source.dataUrl,'data:image/png;base64,'+base64);
  assert.deepEqual(project.recipe.crop,crop);
  const revised=output(await callTool(statelessService(),'finish_image',{project,adjustments:{saturation:-65},crop:null}));
  assert.equal(revised.metadata.recipe.adjustments.warmth,15,'omitted controls retain saved values');
  assert.equal(revised.metadata.recipe.adjustments.saturation,-65,'an override replaces the saved setting, rather than applying it again');
  assert.equal(revised.metadata.recipe.crop,null);
  assert.deepEqual([revised.image.width,revised.image.height],[3,2],'clearing a crop restores the original dimensions');
  const expected=renderFinishedImage({width:3,height:2,data:new Uint8ClampedArray(source.data)},{saturation:-65,warmth:15});
  assert.deepEqual(revised.image.data,Buffer.from(expected.data));
  assert.equal(project.recipe.adjustments.saturation,-35,'the input project stays unchanged');
  const both=await callTool(statelessService(),'finish_image',{project,output:'both'});
  assert.ok(both.content.some(item=>item.type==='image'));assert.ok(both.content.some(item=>item.type==='resource'));
  const mismatched=await callTool(statelessService(),'finish_image',{project:{...project,source:{...project.source,width:4}}});
  assert.equal('isError' in mismatched&&mismatched.isError,true);
});

test('PNG preflight rejects oversized dimensions and unsupported input before decoding',()=>{
  const source=png().bytes;
  for(const [width,height] of [[6000,6000],[16385,1],[0,1]]){
    const header=Buffer.from(source.subarray(0,33));header.writeUInt32BE(width,16);header.writeUInt32BE(height,20);
    assert.throws(()=>inspectFinishingPng(header),/24 megapixels.*16384/);
  }
  const highDepth=Buffer.from(source);highDepth[24]=16;
  assert.throws(()=>inspectFinishingPng(highDepth),/16-bit/);
  assert.throws(()=>inspectFinishingPng(addChunk(source,'acTL',Buffer.alloc(8))),/still images/);
  assert.throws(()=>inspectFinishingPng(addChunk(source,'iCCP',Buffer.from('custom'))),/ICC profile/);
  const gamma=Buffer.alloc(4);gamma.writeUInt32BE(100000);
  assert.throws(()=>inspectFinishingPng(addChunk(source,'gAMA',gamma)),/non-sRGB/);
  gamma.writeUInt32BE(45455);
  assert.deepEqual(inspectFinishingPng(addChunk(source,'gAMA',gamma)),{width:3,height:2});
  assert.throws(()=>finishPng('A'.repeat(MAX_FINISHING_PNG_BASE64+4)),/8 MB/);
});

test('invalid controls, crops and malformed PNGs produce tool errors without project access',async()=>{
  const source=png().bytes.toString('base64');
  const attempts=[
    {},
    {png_base64:source,project:{}},
    {png_base64:source,output:'nonsense'},
    {png_base64:'data:image/png;base64,'+source},
    {png_base64:'AAAA'},
    {png_base64:source,adjustments:{saturation:101}},
    {png_base64:source,adjustments:{exposure:'1'}},
    {png_base64:source,adjustments:{imaginary:10}},
    {png_base64:source,crop:{x:2,y:0,width:2,height:2}},
    {png_base64:source,crop:{x:.5,y:0,width:1,height:1}},
  ];
  for(const args of attempts){const result=await callTool(statelessService(),'finish_image',args);assert.equal('isError' in result&&result.isError,true,JSON.stringify(args));}
});

test('hosted finishing keeps workspace authorization and the existing request cap',async()=>{
  const record=await makeWorkspaceRecord(),token=await issueWorkspaceToken(record);
  const providers:WorkspaceProviders={records:{get:async id=>id===record.id?record:null,create:async()=>{}},projects:()=>statelessService()};
  const body=JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'finish_image',arguments:{png_base64:png().bytes.toString('base64'),adjustments:{contrast:12}}}});
  const request=(authorization?:string)=>new Request('https://pixel.test/mcp',{method:'POST',headers:authorization?{authorization}:undefined,body});
  assert.equal((await privateMcpApi(request(),providers)).status,401);
  assert.equal((await privateMcpApi(request('Bearer '+record.id),providers)).status,401);
  const authorized=await privateMcpApi(request('Bearer '+token),providers);assert.equal(authorized.status,200);
  const result=await authorized.json() as {result:{isError?:boolean;content:{text:string}[]}};assert.equal(result.result.isError,undefined);
  assert.equal(JSON.parse(result.result.content[0].text).recipe.adjustments.contrast,12);
  const oversized=await mcpResponse(new Request('https://pixel.test/mcp',{method:'POST',headers:{'content-length':'12000001'},body:'{}'}),statelessService());
  assert.equal(oversized.status,413);
});

test('stdio discovers finishing, validates control ranges, and returns exact full-resolution PNG',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'finishing-mcp-'));
  const client=new Client({name:'image-finishing-test',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,args:['--experimental-strip-types','server/stdio.ts'],env:{...process.env,PIXEL_DATA_DIR:directory} as Record<string,string>});
  try{
    await client.connect(transport);
    const listed=await client.listTools();assert.ok(listed.tools.some(tool=>tool.name==='finish_image'));
    assert.ok(toolDefinitions.find(tool=>tool.name==='finish_image')?.annotations?.readOnlyHint);
    const source=png();
    const result=await client.callTool({name:'finish_image',arguments:{png_base64:source.bytes.toString('base64'),crop:null,adjustments:{saturation:-100}}});
    assert.ok(!result.isError,JSON.stringify(result.content));
    assert.ok(Array.isArray(result.content));
    const image=result.content.find(item=>item.type==='image');assert.ok(image);
    const decoded=PNG.sync.read(Buffer.from(image.data,'base64'));
    assert.deepEqual([decoded.width,decoded.height],[3,2]);
    assert.equal(decoded.data[0],decoded.data[1]);assert.equal(decoded.data[1],decoded.data[2]);
    const invalid=await client.callTool({name:'finish_image',arguments:{png_base64:source.bytes.toString('base64'),adjustments:{gamma:0}}});
    assert.equal(invalid.isError,true);
    assert.deepEqual(await readdir(directory),[],'finishing must not create or change a pixel document');
  }finally{await client.close();await rm(directory,{recursive:true,force:true});}
});
