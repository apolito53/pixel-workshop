import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve,extname } from 'node:path';
import { ProjectService } from '../lib/project-service.ts';
import { pixelApi } from '../lib/http-api.ts';
import { mcpResponse } from '../lib/mcp-tools.ts';
import { fileStore } from './file-store.ts';
const service=new ProjectService(fileStore());const port=Number(process.env.PORT||4317),root=resolve('dist-node');
createServer(async(req,res)=>{
  try{
    const chunks:Buffer[]=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>12_000_000){res.writeHead(413);res.end('Request too large');return;}chunks.push(chunk);}
    const path=req.url||'/',headers=new Headers();for(const [key,value]of Object.entries(req.headers))if(value)headers.set(key,Array.isArray(value)?value.join(','):value);
    const request=new Request(`http://127.0.0.1:${port}${path}`,{method:req.method,headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})});
    let response:Response;
    if(path.startsWith('/api/pixel/'))response=await pixelApi(request,service);
    else if(path==='/mcp')response=await mcpResponse(request,service);
    else{const filename=resolve(root,'.'+decodeURIComponent(path.split('?')[0]==='/'?'/index.html':path.split('?')[0]));if(!filename.startsWith(root+'/'))throw new Error('Invalid path');const bytes=await readFile(filename);response=new Response(bytes,{headers:{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'} as Record<string,string>)[extname(filename)]||'application/octet-stream'}});}
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(e){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:e instanceof Error?e.message:'Request failed'}));}
}).listen(port,'127.0.0.1',()=>console.error(`Pixel Workshop: http://127.0.0.1:${port}`));
