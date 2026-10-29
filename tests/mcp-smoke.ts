import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {writeFile,mkdir} from 'node:fs/promises';
import {lanternCommands} from '../lib/demo.ts';
import {cottageCommands} from '../lib/cottage.ts';
import {PNG} from 'pngjs';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {ProjectService} from '../lib/project-service.ts';
import {fileStore} from '../server/file-store.ts';
import {mcpResponse} from '../lib/mcp-tools.ts';
const remote=process.argv.includes('--http'),cottage=process.argv.includes('--cottage');
const size=cottage?64:48,commands=cottage?cottageCommands():lanternCommands(),prefix=cottage?'cottage':'lantern';
const service=process.argv.includes('--blob')?(await import('../lib/vercel-store.ts')).projectService:new ProjectService(fileStore('./artifacts/mcp-projects'));
const httpServer=remote?createServer(async(req,res)=>{const parts:Buffer[]=[];for await(const part of req)parts.push(part);const response=await mcpResponse(new Request('http://localhost/mcp',{method:req.method,headers:{'content-type':'application/json'},...(parts.length?{body:Buffer.concat(parts)}:{})}),service);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}):null;
if(httpServer)await new Promise<void>(r=>httpServer.listen(0,'127.0.0.1',r));
const port=(httpServer?.address() as {port:number}|null)?.port;
const client=new Client({name:'pixel-workshop-verification',version:'1.0.0'});
const transport=remote?new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)):new StdioClientTransport({command:process.execPath,args:['--experimental-strip-types','server/stdio.ts'],env:{...process.env,PIXEL_DATA_DIR:'./artifacts/mcp-projects'} as Record<string,string>});
try {
await client.connect(transport);
const listed=await client.listTools();assert.equal(listed.tools.length,9);
const created=await client.callTool({name:'create_canvas',arguments:{name:cottage?'Moonkeeper’s cottage':remote?'MCP-painted lantern':'Stdio-painted lantern',width:size,height:size}}) as any;
assert.ok(!created.isError,created.content[0].text);const doc=JSON.parse(created.content[0].text);
const painted=await client.callTool({name:'paint',arguments:{id:doc.id,revision:0,commands}}) as any;assert.ok(!painted.isError,painted.content[0].text);
const exported=await client.callTool({name:'export_png',arguments:{id:doc.id}}) as any;assert.ok(!exported.isError);const bytes=Buffer.from(exported.content.find((c:any)=>c.type==='image').data,'base64'),png=PNG.sync.read(bytes);assert.equal(png.width,size);assert.equal(png.height,size);assert.equal(png.data[3],0);
const inspected=await client.callTool({name:'get_canvas',arguments:{id:doc.id,include_pixels:true}}) as any;let saved=JSON.parse(inspected.content[0].text);assert.equal(saved.layers.length,cottage?5:2);assert.equal(saved.revision,1);
if(process.argv.includes('--blob')){
 const contenders=await Promise.allSettled([service.edit(doc.id,1,'paint',[{op:'rename',name:saved.name}]),service.edit(doc.id,1,'paint',[{op:'rename',name:saved.name}])]);
 assert.equal(contenders.filter(result=>result.status==='fulfilled').length,1,'Concurrent Blob writes must preserve one winner');
 await service.edit(doc.id,2,'undo');saved=(await service.get(doc.id)).entry.doc;
 assert.equal(saved.revision,3);assert.equal(saved.layers.length,5);
}
await mkdir('artifacts',{recursive:true});if(remote){await writeFile(`artifacts/${prefix}.png`,bytes);await writeFile(`artifacts/${prefix}.pixel.json`,JSON.stringify(saved,null,2));const preview=await client.callTool({name:'export_png',arguments:{id:doc.id,scale:8}}) as any;await writeFile(`artifacts/${prefix}-preview.png`,Buffer.from(preview.content[1].data,'base64'));await writeFile(`artifacts/${prefix}-mcp-proof.json`,JSON.stringify({transport:'HTTP',tools:listed.tools.map(t=>t.name),projectId:doc.id,width:png.width,height:png.height,revision:saved.revision},null,2));}
console.log(JSON.stringify({transport:remote?(process.argv.includes('--blob')?'Vercel Blob / HTTP':'HTTP'):'stdio',tools:listed.tools.length,projectId:doc.id,paintedCommands:commands.length,exported:`${png.width}x${png.height}`,transparent:true}));
} finally {
await client.close();
if(httpServer)await new Promise<void>(r=>httpServer.close(()=>r()));

}
