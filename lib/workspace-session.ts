/** Stateless credential verification with private, durable workspace records.
 *
 * Session IDs are 128-bit random invite capabilities. Optional passwords are
 * PBKDF2-hashed, and the HTTP-only cookie / MCP bearer token is authenticated
 * with a distinct per-workspace HMAC key. No email or global auth secret needed.
 */
export const SESSION_COOKIE = 'pixel_workspace';
export const SESSION_TTL_SECONDS = 90 * 24 * 60 * 60;
const PASSWORD_ITERATIONS = 200_000;
const ID_PATTERN = /^pw_[A-Za-z0-9_-]{22}$/;
const TOKEN_PATTERN = /^(v1)\.(pw_[A-Za-z0-9_-]{22})\.([0-9]{10,12})\.([A-Za-z0-9_-]{43})$/;
const textEncoder = new TextEncoder();
const base64url = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, x => String.fromCharCode(x)).join(''))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
const decode = (value: string): Uint8Array<ArrayBuffer> => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding.');
  const encoded = value.replace(/-/g,'+').replace(/_/g,'/');
  const raw = atob(encoded + '='.repeat((4-encoded.length%4)%4));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
};
const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));

export type WorkspaceRecord = {
  id: string;
  createdAt: string;
  authKey: string;
  passwordSalt?: string;
  passwordHash?: string;
};
export interface WorkspaceRecordStore {
  get(id: string): Promise<WorkspaceRecord|null>;
  create(record: WorkspaceRecord): Promise<void>;
}
export function isWorkspaceId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}
export function requireWorkspaceId(value: string): string {
  if (!isWorkspaceId(value)) throw new Error('Invalid workspace ID.');
  return value;
}
export const hasPassword = (record: WorkspaceRecord) => !!record.passwordHash;

async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw',textEncoder.encode(password),'PBKDF2',false,['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:decode(salt),iterations:PASSWORD_ITERATIONS},key,256);
  return base64url(new Uint8Array(bits));
}
export async function makeWorkspaceRecord(password?: string): Promise<WorkspaceRecord> {
  if (password && (password.length<8 || password.length>128)) throw new Error('A workspace password must contain 8–128 characters.');
  const record:WorkspaceRecord={
    id:'pw_'+base64url(randomBytes(16)), createdAt:new Date().toISOString(), authKey:base64url(randomBytes(32)),
  };
  if (password) {
    record.passwordSalt=base64url(randomBytes(16));
    record.passwordHash=await hashPassword(password,record.passwordSalt);
  }
  return record;
}
export async function matchesWorkspacePassword(record:WorkspaceRecord,password?:string):Promise<boolean> {
  if (!hasPassword(record))return true;
  if (!password || password.length>128 || !record.passwordSalt || !record.passwordHash)return false;
  const expected=decode(record.passwordHash),actual=decode(await hashPassword(password,record.passwordSalt));
  if (expected.length!==actual.length)return false;
  let difference=0;
  for(let i=0;i<expected.length;i++)difference|=expected[i]^actual[i];
  return difference===0;
}
async function signingKey(record:WorkspaceRecord) {
  return crypto.subtle.importKey('raw',decode(record.authKey),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
export async function issueWorkspaceToken(record:WorkspaceRecord,now=Math.floor(Date.now()/1000)):Promise<string> {
  const message=`v1.${record.id}.${now+SESSION_TTL_SECONDS}`;
  const signature=await crypto.subtle.sign('HMAC',await signingKey(record),textEncoder.encode(message));
  return message+'.'+base64url(new Uint8Array(signature));
}
export async function verifyWorkspaceToken(value:string,record:WorkspaceRecord,now=Math.floor(Date.now()/1000)):Promise<boolean> {
  const match=value.match(TOKEN_PATTERN);
  if(!match || match[2]!==record.id || Number(match[3])<=now || Number(match[3])>now+SESSION_TTL_SECONDS)return false;
  try {
    return await crypto.subtle.verify('HMAC',await signingKey(record),decode(match[4]),textEncoder.encode(`${match[1]}.${match[2]}.${match[3]}`));
  }catch{return false;}
}
function cookieValue(request:Request):string|null {
  const cookie=request.headers.get('cookie')||'';
  for(const part of cookie.split(';')){
    const [name,...value]=part.trim().split('=');
    if(name===SESSION_COOKIE)return value.join('=');
  }
  return null;
}
function bearerValue(request:Request):string|null {
  const header=request.headers.get('authorization');
  return header?.startsWith('Bearer ')?header.slice(7).trim():null;
}
/** A caller can select a workspace only by presenting a valid issued token. */
export async function resolveWorkspace(request:Request,store:WorkspaceRecordStore):Promise<WorkspaceRecord|null> {
  const credential=bearerValue(request)??cookieValue(request);
  const match=credential?.match(TOKEN_PATTERN);
  if(!match)return null;
  const record=await store.get(match[2]);
  return record && await verifyWorkspaceToken(credential!,record)?record:null;
}
function sameOrigin(request:Request):boolean {
  const url=new URL(request.url);
  const origin=request.headers.get('origin');
  if(origin && origin!==url.origin)return false;
  if(request.headers.get('sec-fetch-site')==='cross-site')return false;
  return true;
}
function noStore(headers:HeadersInit={}) {
  return {'cache-control':'no-store','vary':'Cookie, Authorization',...headers};
}
function response(data:unknown,status=200,headers:HeadersInit={}) {
  return Response.json(data,{status,headers:noStore(headers)});
}
function sessionCookie(token:string,request:Request):string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
}
const expiredCookie=(request:Request) => `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${new URL(request.url).protocol==='https:'?'; Secure':''}`;

/** Browser-only login operations. Agent credentials require an authenticated browser to issue. */
export async function workspaceSessionApi(request:Request,store:WorkspaceRecordStore):Promise<Response> {
  if(request.method==='GET'){
    const record=await resolveWorkspace(request,store);
    return response(record?{authenticated:true,id:record.id,hasPassword:hasPassword(record)}:{authenticated:false});
  }
  if(request.method!=='POST')return response({error:'Method not allowed.'},405);
  if(!sameOrigin(request))return response({error:'Cross-origin session changes are not allowed.'},403);
  try{
    const bodyText=await request.text();
    if(bodyText.length>4096)return response({error:'Session request too large.'},413);
    const body=JSON.parse(bodyText) as {action?:string;id?:string;password?:string};
    if(body.action==='leave')return response({authenticated:false},200,{'set-cookie':expiredCookie(request)});
    if(body.action==='agent-token'){
      const record=await resolveWorkspace(request,store);
      if(!record || !cookieValue(request))return response({error:'Sign in to a workspace first.'},401);
      return response({token:await issueWorkspaceToken(record),id:record.id,expiresInSeconds:SESSION_TTL_SECONDS});
    }
    if(body.action==='create'){
      if(typeof body.password!=='undefined'&&typeof body.password!=='string')return response({error:'Invalid password.'},400);
      const record=await makeWorkspaceRecord(body.password);
      await store.create(record);
      return response({authenticated:true,id:record.id,hasPassword:hasPassword(record)},201,
        {'set-cookie':sessionCookie(await issueWorkspaceToken(record),request)});
    }
    if(body.action==='join'){
      if(!isWorkspaceId(body.id))return response({error:'Enter a valid workspace ID.'},400);
      const record=await store.get(body.id);
      if(!record)return response({error:'Workspace not found.'},404);
      if(typeof body.password!=='undefined'&&typeof body.password!=='string')return response({error:'Invalid password.'},400);
      if(!await matchesWorkspacePassword(record,body.password))return response({error:'Incorrect workspace password.'},401);
      return response({authenticated:true,id:record.id,hasPassword:hasPassword(record)},200,
        {'set-cookie':sessionCookie(await issueWorkspaceToken(record),request)});
    }
    return response({error:'Unknown session action.'},400);
  }catch(error){return response({error:error instanceof SyntaxError?'Invalid session request.':error instanceof Error?error.message:'Session failed.'},400);}
}
/** For browser API: invalid credentials must never fall through to legacy projects/. */
export async function requireWorkspace(request:Request,store:WorkspaceRecordStore):Promise<WorkspaceRecord|Response> {
  const record=await resolveWorkspace(request,store);
  return record??response({error:'Open or create a workspace to continue.',code:'WORKSPACE_REQUIRED'},401);
}
