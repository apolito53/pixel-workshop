// Internal Windows offline bundle acceptance. No public deployment, buyer traffic or spending.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';

const stage=resolve(process.argv[2]||'');
if(!process.argv[2])throw new Error('Usage: node scripts/offline-smoke.mjs <bundle-folder>');
for(const f of ['node.exe','server/node.ts','lib/workspace-http.ts','dist-node/index.html','PixelWorkshop.cmd','NODE-LICENSE.txt','DEPENDENCY-LICENSES.json']){
  await access(join(stage,f));
}
const bundledNode=join(stage,'node.exe');
const version=(await import('node:child_process')).execFileSync(bundledNode,['--version'],{encoding:'utf8'}).trim();
assert.match(version,/^v24\./);
const data=await mkdtemp(join(tmpdir(),'pixel-offline-qa-'));
const port=43179;
const base='http://127.0.0.1:'+port;
let child;
let nextId=1;

function start() {
  const proc=spawn(bundledNode,['--experimental-strip-types','server/node.ts'],{
    cwd:stage,windowsHide:true,stdio:['ignore','pipe','pipe'],
    env:{...process.env,PORT:String(port),PIXEL_DATA_DIR:data,NODE_ENV:'production'},
  });
  let stderr='';
  proc.stderr.on('data',chunk=>{stderr+=(String(chunk)).slice(0,3000)});
  proc.stderrText=()=>stderr;
  return proc;
}
async function stop(proc) {
  if(!proc)return;
  if(proc.exitCode!==null||proc.signalCode!==null)return;
  const exited=new Promise(r=>proc.once('exit',r));
  proc.kill();
  await Promise.race([exited,sleep(4000)]);
  if(proc.exitCode===null&&proc.signalCode===null)proc.kill('SIGKILL');
}
async function waitReady(proc) {
  for(let n=0;n<80;n++){
    if(proc.exitCode!==null)throw new Error('Server exited before ready: '+proc.stderrText());
    try{
      const response=await fetch(base+'/',{signal:AbortSignal.timeout(1500)});
      if(response.ok) {
        const html=await response.text();
        assert.match(html,/html/i);
        return;
      }
    }catch{}
    await sleep(250);
  }
  throw new Error('Bundled server did not become ready: '+proc.stderrText());
}
async function rpc(token,method,params) {
  const response=await fetch(base+'/mcp',{
    method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:nextId++,method,params}),
  });
  assert.equal(response.status,200,method+' HTTP '+response.status);
  const reply=await response.json();
  assert.equal(reply.error,undefined,JSON.stringify(reply.error));
  return reply.result;
}
try {
  child=start();await waitReady(child);
  const denied=await fetch(base+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
  assert.equal(denied.status,401,'MCP without a workspace token must fail');
  const crossOrigin=await fetch(base+'/api/pixel/session',{method:'POST',headers:{origin:'https://example.invalid','content-type':'application/json'},body:JSON.stringify({action:'create'})});
  assert.equal(crossOrigin.status,403,'cross-origin session create must fail');
  const session=await fetch(base+'/api/pixel/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'create'})});
  assert.equal(session.status,201);
  const cookie=session.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie?.startsWith('pixel_workspace='));
  const issued=await fetch(base+'/api/pixel/session',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({action:'agent-token'})});
  assert.equal(issued.status,200);
  const {token}=await issued.json();
  assert.match(token,/^v1\.pw_/);
  const listed=await rpc(token,'tools/list');
  assert.ok(listed.tools.some(x=>x.name==='create_canvas'));
  assert.ok(listed.tools.some(x=>x.name==='export_svg'));
  const created=await rpc(token,'tools/call',{name:'create_canvas',arguments:{name:'Bundled QA pixel',width:16,height:16}});
  assert.equal(created.isError,undefined,JSON.stringify(created.content));
  const doc=JSON.parse(created.content[0].text);
  assert.ok(doc.id);
  const layer=doc.layers[0].id;
  const painted=await rpc(token,'tools/call',{name:'paint',arguments:{id:doc.id,revision:doc.revision,commands:[{op:'pixel',layer,x:2,y:3,color:'#ff44dd'}]}});
  assert.equal(painted.isError,undefined,JSON.stringify(painted.content));
  const png=await rpc(token,'tools/call',{name:'export_png',arguments:{id:doc.id}});
  assert.equal(png.isError,undefined);
  const image=png.content.find(x=>x.type==='image');
  assert.equal(image.mimeType,'image/png');
  assert.equal(Buffer.from(image.data,'base64').subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  const svg=await rpc(token,'tools/call',{name:'export_svg',arguments:{id:doc.id}});
  assert.equal(svg.isError,undefined);
  assert.match(svg.content.find(x=>x.type==='resource').resource.text,/<rect /);
  // A duplicate server must not silently take over the same loopback port.
  const conflict=start();
  await Promise.race([new Promise(r=>conflict.once('exit',r)),sleep(3500)]);
  assert.notEqual(conflict.exitCode,null,'Second server must exit on a busy port');
  await stop(conflict);
  await stop(child);
  child=start();await waitReady(child);
  const persisted=await rpc(token,'tools/call',{name:'get_canvas',arguments:{id:doc.id}});
  assert.equal(persisted.isError,undefined,JSON.stringify(persisted.content));
  assert.equal(JSON.parse(persisted.content[0].text).revision,1);
  console.log('PASS: Windows bundle boot, static UI, session isolation, token auth, MCP create/paint/PNG/SVG, port conflict, persistence after restart.');
} finally {
  await stop(child);
  await rm(data,{recursive:true,force:true});
}
