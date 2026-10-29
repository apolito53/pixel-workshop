import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectService} from '../lib/project-service.ts';
import {fileStore} from '../server/file-store.ts';
import {privatePixelApi,privateMcpApi,type WorkspaceProviders} from '../lib/workspace-http.ts';
import {makeWorkspaceRecord,matchesWorkspacePassword,issueWorkspaceToken,verifyWorkspaceToken,
  type WorkspaceRecord,type WorkspaceRecordStore} from '../lib/workspace-session.ts';

const origin='https://pixel-workshop.test';
function makeFixture(root:string) {
  const records=new Map<string,WorkspaceRecord>();
  const store:WorkspaceRecordStore={
    get:async id=>records.get(id)??null,
    create:async item=>{if(records.has(item.id))throw new Error('Collision');records.set(item.id,item);},
  };
  const providers:WorkspaceProviders={
    records:store,
    projects:id=>new ProjectService(fileStore(join(root,'workspaces',id,'projects'))),
  };
  const post=async(action:Record<string,unknown>,cookie?:string)=>{
    const res=await privatePixelApi(new Request(origin+'/api/pixel/session',{method:'POST',
      headers:{origin,'content-type':'application/json',...(cookie?{cookie}:{})},
      body:JSON.stringify(action)}),providers);
    return {status:res.status,body:await res.json() as any,cookie:res.headers.get('set-cookie')??''};
  };
  const project=async(method:string,path:string,cookie?:string,body?:unknown)=>
    privatePixelApi(new Request(origin+'/api/pixel/'+path,{method,headers:{
      ...(cookie?{cookie}:{}),...(body?{origin,'content-type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})}),providers);
  const cookie= (value:string) => value.split(';')[0];
  return {records,providers,post,project,cookie};
}

test('passwords are salted, never stored in plaintext; invalid and expired tokens fail',async()=>{
 const password='a-sensible-passphrase';
 const first=await makeWorkspaceRecord(password),second=await makeWorkspaceRecord(password);
 assert.ok(first.id.startsWith('pw_'));assert.notEqual(first.id,second.id);
 assert.ok(first.passwordHash&&!JSON.stringify(first).includes(password));
 assert.notEqual(first.passwordHash,second.passwordHash);
 assert.equal(await matchesWorkspacePassword(first,password),true);
 assert.equal(await matchesWorkspacePassword(first,'wrong password'),false);
 assert.equal(await matchesWorkspacePassword(first),false);
 const time=1_800_000_000;
 const token=await issueWorkspaceToken(first,time);
 assert.equal(await verifyWorkspaceToken(token,first,time),true);
 assert.equal(await verifyWorkspaceToken(token,second,time),false);
 assert.equal(await verifyWorkspaceToken(token,first,time+91*86400),false);
 const pieces=token.split('.');
 assert.equal(await verifyWorkspaceToken(pieces.slice(0,3).join('.')+'.'+pieces[3].replace(/^./,pieces[3][0]==='a'?'b':'a'),first,time),false);
});

test('two browsers get independent persistent workspaces and cannot list, read, edit or export each other’s art',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pixel-workspaces-'));
 try{
  const f=makeFixture(dir);
  const a=await f.post({action:'create',password:'private 123'});
  const b=await f.post({action:'create'});
  assert.equal(a.status,201);assert.equal(b.status,201);
  assert.notEqual(a.body.id,b.body.id);
  assert.ok(a.cookie.includes('HttpOnly')&&a.cookie.includes('SameSite=Lax')&&a.cookie.includes('Secure'));
  const ac=f.cookie(a.cookie),bc=f.cookie(b.cookie);
  const made=await f.project('POST','projects',ac,{name:'A only',width:8,height:8});
  assert.equal(made.status,200);
  const doc=(await made.json() as any).doc;
  const listingA=await (await f.project('GET','projects',ac)).json() as any[];
  const listingB=await (await f.project('GET','projects',bc)).json() as any[];
  assert.deepEqual(listingA.map(d=>d.id),[doc.id]);
  assert.deepEqual(listingB,[]);
  for(const attempt of [
    await f.project('GET','projects/'+doc.id,bc),
    await f.project('GET','projects/'+doc.id+'/png',bc),
    await f.project('POST','projects/'+doc.id,bc,{revision:0,edits:[{action:'paint',commands:[{op:'clear'}]}]}),
  ])assert.equal(attempt.status,400,'another workspace must not access this project');
  assert.equal((await f.project('GET','projects/'+doc.id,ac)).status,200);
  const fakeCookie='pixel_workspace='+a.body.id;
  assert.equal((await f.project('GET','projects',fakeCookie)).status,401);
  assert.equal((await f.project('GET','projects')).status,401);
  const oldLegacy=new ProjectService(fileStore(join(dir,'legacy')));
  await oldLegacy.create('Old shared project',8,8);
  assert.deepEqual(await (await f.project('GET','projects',ac)).json(),listingA,'legacy projects must not appear');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('join by ID with optional password; reopening preserves artwork and incorrect passwords fail',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pixel-workspace-join-'));
 try{
  const f=makeFixture(dir);
  const created=await f.post({action:'create',password:'correct horse battery'});
  const cookie=f.cookie(created.cookie);
  const first=await f.project('POST','projects',cookie,{name:'Saved art',width:4,height:4});
  const project=(await first.json() as any).doc;
  const wrong=await f.post({action:'join',id:created.body.id,password:'bad'});
  assert.equal(wrong.status,401);assert.equal(wrong.cookie,'');
  assert.equal((await f.post({action:'join',id:created.body.id})).status,401);
  const joined=await f.post({action:'join',id:created.body.id,password:'correct horse battery'});
  assert.equal(joined.status,200);
  const newDevice=f.cookie(joined.cookie);
  const listed=await (await f.project('GET','projects',newDevice)).json() as any[];
  assert.equal(listed[0].id,project.id);
  const leave=await f.post({action:'leave'},newDevice);
  assert.equal(leave.status,200);assert.ok(leave.cookie.includes('Max-Age=0'));
  const empty=await f.post({action:'create'});
  const idOnly=await f.post({action:'join',id:empty.body.id});
  assert.equal(idOnly.status,200);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('MCP reads require valid bearer credentials and stay scoped to one workspace',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pixel-mcp-sessions-'));
 try{
  const f=makeFixture(dir);
  const first=await f.post({action:'create'}),second=await f.post({action:'create'});
  const tokenResult=await f.post({action:'agent-token'},f.cookie(first.cookie));
  assert.equal(tokenResult.status,200);
  const token=tokenResult.body.token as string;
  const rpc=async(header?:string,name='list_canvases',args:Record<string,unknown>={})=>{
    const response=await privateMcpApi(new Request(origin+'/mcp',{method:'POST',
      headers:{'content-type':'application/json',...(header?{authorization:header}:{})},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}),f.providers);
    return {status:response.status,body:await response.json() as any};
  };
  assert.equal((await rpc()).status,401);
  assert.equal((await rpc('Bearer '+first.body.id)).status,401);
  const made=await rpc('Bearer '+token,'create_canvas',{name:'Private agent drawing',width:4,height:4});
  assert.equal(made.status,200);assert.equal(made.body.result.isError,undefined);
  const list=await rpc('Bearer '+token);
  const docs=JSON.parse(list.body.result.content[0].text);
  assert.equal(docs.length,1);
  const otherToken=(await f.post({action:'agent-token'},f.cookie(second.cookie))).body.token as string;
  const isolated=await rpc('Bearer '+otherToken);
  assert.deepEqual(JSON.parse(isolated.body.result.content[0].text),[]);
  const cross=await rpc('Bearer '+otherToken,'get_canvas',{id:docs[0].id});
  assert.equal(cross.body.result.isError,true);
  const browserList=await (await f.project('GET','projects',f.cookie(first.cookie))).json() as any[];
  assert.equal(browserList.length,1,'browser and MCP should share only the same workspace');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('cross-origin session creation is rejected; no auto-creation on GET',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pixel-workspace-origin-'));
 try{
  const f=makeFixture(dir);
  const response=await privatePixelApi(new Request(origin+'/api/pixel/session',{
    method:'POST',headers:{origin:'https://malicious.example','content-type':'application/json'},
    body:JSON.stringify({action:'create'})}),f.providers);
  assert.equal(response.status,403);
  assert.equal(f.records.size,0);
  const state=await (await f.project('GET','session')).json() as any;
  assert.deepEqual(state,{authenticated:false});
  assert.equal(f.records.size,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
