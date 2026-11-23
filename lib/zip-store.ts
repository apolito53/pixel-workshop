/** Dependency-free ZIP/STORE writer used for browser asset-pack downloads.
 * No unsafe path traversal, no network calls and no platform ZIP APIs.
 */
export type ZipItem={path:string;data:Uint8Array};
const enc=new TextEncoder();
export const MAX_ZIP_BYTES=64*1024*1024;
const MAX_ZIP_FILES=200;
const table=Uint32Array.from({length:256},(_,i)=>{
 let c=i;for(let j=0;j<8;j++)c=(c&1)?(0xedb88320^(c>>>1)):c>>>1;return c>>>0;
});
export function crc32(bytes:Uint8Array):number{
 let crc=0xffffffff;
 for(const b of bytes)crc=table[(crc^b)&255]^(crc>>>8);
 return(crc^0xffffffff)>>>0;
}
function u16(view:DataView,offset:number,n:number){view.setUint16(offset,n,true);}
function u32(view:DataView,offset:number,n:number){view.setUint32(offset,n>>>0,true);}
function safePath(path:string){
 return /^[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)*$/i.test(path)&&
  !path.split('/').some(part=>part==='.'||part==='..');
}
/** Returns a complete, valid PKZIP file, deliberately using method 0 (store). */
export function createStoreZip(entries:ZipItem[], maxFiles=MAX_ZIP_FILES):Uint8Array<ArrayBuffer>{
 if(!entries.length||entries.length>maxFiles || entries.length>65535)throw new Error(`ZIP needs 1–${maxFiles} files.`);
 const seen=new Set<string>();
 const items=entries.map(({path,data})=>{
  if(!safePath(path)||seen.has(path.toLowerCase()))throw new Error('Unsafe or duplicate ZIP entry path.');
  if(!(data instanceof Uint8Array))throw new Error('ZIP entries must contain byte arrays.');
  seen.add(path.toLowerCase());
  const name=enc.encode(path);
  if(name.length>65535)throw new Error('ZIP file name is too long.');
  return {path,data,name,crc:crc32(data)};
 });
 const localTotal=items.reduce((n,item)=>n+30+item.name.length+item.data.length,0);
 const centralTotal=items.reduce((n,item)=>n+46+item.name.length,0);
 const total=localTotal+centralTotal+22;
 if(total>MAX_ZIP_BYTES)throw new Error('The ZIP archive exceeds 64 MiB.');
 const zip=new Uint8Array(total),view=new DataView(zip.buffer);
 let p=0;const offsets:number[]=[];
 for(const item of items){
  offsets.push(p);
  u32(view,p,0x04034b50);u16(view,p+4,20);u16(view,p+6,0x0800);u16(view,p+8,0);
  u16(view,p+10,0);u16(view,p+12,0);
  u32(view,p+14,item.crc);u32(view,p+18,item.data.length);u32(view,p+22,item.data.length);
  u16(view,p+26,item.name.length);u16(view,p+28,0);
  p+=30;zip.set(item.name,p);p+=item.name.length;
  zip.set(item.data,p);p+=item.data.length;
 }
 const centralStart=p;
 items.forEach((item,i)=>{
  u32(view,p,0x02014b50);u16(view,p+4,20);u16(view,p+6,20);
  u16(view,p+8,0x0800);u16(view,p+10,0);u16(view,p+12,0);u16(view,p+14,0);
  u32(view,p+16,item.crc);u32(view,p+20,item.data.length);u32(view,p+24,item.data.length);
  u16(view,p+28,item.name.length);u16(view,p+30,0);u16(view,p+32,0);
  u16(view,p+34,0);u16(view,p+36,0);u32(view,p+38,0);u32(view,p+42,offsets[i]);
  p+=46;zip.set(item.name,p);p+=item.name.length;
 });
 u32(view,p,0x06054b50);u16(view,p+4,0);u16(view,p+6,0);
 u16(view,p+8,items.length);u16(view,p+10,items.length);
 u32(view,p+12,p-centralStart);u32(view,p+16,centralStart);u16(view,p+20,0);
 if(p+22!==total)throw new Error('ZIP length mismatch.');
 return zip;
}

type InflateEntry=(compressed:Uint8Array,size:number)=>Uint8Array;

/** Read bounded ZIP32 archives from their directory. The optional inflater is
 * supplied only for user-repacked sprite stacks; game packs remain STORE-only. */
export function readStoreZip(bytes:Uint8Array,maxFiles=MAX_ZIP_FILES,inflate?:InflateEntry):Map<string,Uint8Array>{
 if(!(bytes instanceof Uint8Array)||bytes.length<22||bytes.length>MAX_ZIP_BYTES)throw new Error('Invalid or oversized ZIP archive.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const decoder=new TextDecoder('utf-8',{fatal:true});
 const u16=(p:number)=>view.getUint16(p,true),u32=(p:number)=>view.getUint32(p,true);
 let end=bytes.length-22;
 const earliest=inflate?Math.max(0,end-65535):end;
 while(end>=earliest && (u32(end)!==0x06054b50 || end+22+u16(end+20)!==bytes.length))end--;
 if(end<earliest || u16(end+4)!==0 || u16(end+6)!==0)throw new Error('Invalid ZIP directory.');
 const count=u16(end+10),start=u32(end+16);
 if(!count||count>maxFiles||count!==u16(end+8)||start+u32(end+12)!==end)throw new Error('Invalid ZIP directory size.');
 type Entry={path:string;start:number;end:number;offset:number;recordEnd:number;size:number;crc:number;method:number;folder:boolean};
 const entries:Entry[]=[];
 const names=new Set<string>();
 let at=start,total=0;
 for(let i=0;i<count;i++){
  if(at+46>end||u32(at)!==0x02014b50)throw new Error('Invalid ZIP directory entry.');
  const flags=u16(at+8),method=u16(at+10),crc=u32(at+16),compressed=u32(at+20),size=u32(at+24);
  const nameLength=u16(at+28),next=at+46+nameLength+u16(at+30)+u16(at+32),offset=u32(at+42);
  if(next>end||u16(at+34)!==0||offset+30>start||u32(offset)!==0x04034b50)throw new Error('Invalid ZIP file record.');
  if((flags&~0x080e)!==0 || (method!==0 && (!inflate||method!==8)) || (!inflate && (flags&8)!==0))
   throw new Error('Unsupported ZIP compression or encryption.');
  const raw=decoder.decode(bytes.subarray(at+46,at+46+nameLength));
  const folder=raw.endsWith('/'),path=folder?raw.slice(0,-1):raw;
  const safe=inflate ? path.length>0 && !/[\\:\x00-\x1f\x7f]/.test(path) && path.split('/').every(part=>part&&part!=='.'&&part!=='..') : safePath(raw);
  if(!safe || names.has(raw.toLowerCase()) || (folder && (!inflate||size!==0)))throw new Error('Unsafe or duplicate ZIP file path.');
  names.add(raw.toLowerCase());
  total+=size;
  if(total>MAX_ZIP_BYTES)throw new Error('Expanded ZIP exceeds 64 MiB.');
  const a=offset+30,b=a+u16(offset+26),from=b+u16(offset+28),to=from+compressed;
  if(to>start||decoder.decode(bytes.subarray(a,b))!==raw||u16(offset+6)!==flags||u16(offset+8)!==method||
     (method===0 && compressed!==size))throw new Error('ZIP directory and file records disagree.');
  let recordEnd=to;
  if(flags&8){
   const signed=to+4<=start&&u32(to)===0x08074b50;
   const descriptor=to+(signed?4:0);
   recordEnd=descriptor+12;
   if(recordEnd>start||u32(descriptor)!==crc||u32(descriptor+4)!==compressed||u32(descriptor+8)!==size)
    throw new Error('Invalid ZIP data descriptor.');
  }else if(u32(offset+14)!==crc||u32(offset+18)!==compressed||u32(offset+22)!==size){
   throw new Error('ZIP directory and file records disagree.');
  }
  entries.push({path:raw.toLowerCase(),start:from,end:to,offset,recordEnd,size,crc,method,folder});
  at=next;
 }
 if(at!==end)throw new Error('Invalid ZIP directory length.');
 entries.sort((a,b)=>a.offset-b.offset);
 const files=new Map<string,Uint8Array>();
 let last=0;
 for(const e of entries){
  if(e.offset<last)throw new Error('Overlapping ZIP entries.');
  last=e.recordEnd;
  const input=bytes.subarray(e.start,e.end),data=e.method===0?input:inflate!(input,e.size);
  if(data.length!==e.size||crc32(data)!==e.crc)throw new Error('ZIP file failed its integrity check.');
  if(!e.folder)files.set(e.path,data);
 }
 return files;
}
