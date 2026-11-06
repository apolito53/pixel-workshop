import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';

const dir=await mkdtemp(join(tmpdir(),'pixel-mcp-reference-'));
const client=new Client({name:'pixel-tracing-verification',version:'1.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:['--experimental-strip-types','server/stdio.ts'],env:{...process.env,PIXEL_DATA_DIR:dir} as Record<string,string>});
try{
 await client.connect(transport);
 const tools=await client.listTools();assert.ok(tools.tools.some(t=>t.name==='import_reference'));
 const call=async(name:string,args:Record<string,unknown>)=>{
  const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));return result;
 };
 const source=new PNG({width:256,height:384});
 for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
  const i=(y*source.width+x)*4;source.data[i]=x;source.data[i+1]=y%256;source.data[i+2]=53;source.data[i+3]=255;
 }
 const png_base64=PNG.sync.write(source).toString('base64');
 const imported=await call('import_reference',{name:'Tall tracing fixture',png_base64});
 const summary=JSON.parse((imported.content as any[]).find(c=>c.type==='text').text);
 assert.deepEqual([summary.width,summary.height],[256,384]);
 const close=await call('get_canvas',{id:summary.id,view:'reference',region:{x:17,y:23,width:2,height:2},scale:8});
 const image=(close.content as any[]).find(c=>c.type==='image'),decoded=PNG.sync.read(Buffer.from(image.data,'base64'));
 assert.deepEqual([...decoded.data.slice(0,4)],[17,23,53,255]);assert.deepEqual([decoded.width,decoded.height],[16,16]);
 await call('get_canvas',{id:summary.id,view:'overlay',referenceOpacity:.75,artworkOpacity:.25,grid:true,region:{x:17,y:23,width:2,height:2},scale:8});
 await call('paint',{id:summary.id,revision:0,commands:[{op:'pixel',x:17,y:23,color:'#ff00ff'}]});
 const exported=await call('export_png',{id:summary.id});
 const art=PNG.sync.read(Buffer.from((exported.content as any[]).find(c=>c.type==='image').data,'base64'));
 assert.deepEqual([art.width,art.height],[256,384]);
 let visible=0;for(let i=3;i<art.data.length;i+=4)if(art.data[i])visible++;
 assert.equal(visible,1);
 const calibrated=await call('import_reference',{name:'Prepared reference',png_base64,alignment:{width:64,height:96,offsetX:0,offsetY:0,cellWidth:4,cellHeight:4}});
 const small=JSON.parse((calibrated.content as any[]).find(c=>c.type==='text').text);assert.deepEqual([small.width,small.height],[64,96]);
 console.log(JSON.stringify({transport:'stdio',nativeReference:'256x384',preparedReference:'64x96',spacing:'4x4',closeUp:'2x2 at 8x',exportVisiblePixels:visible,tools:tools.tools.length}));
}finally{await client.close();await rm(dir,{recursive:true,force:true});}
