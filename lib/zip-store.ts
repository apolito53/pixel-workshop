/** Dependency-free ZIP/STORE writer used for browser asset-pack downloads.
 * No unsafe path traversal, no network calls and no platform ZIP APIs.
 */
export type ZipItem={path:string;data:Uint8Array};
const enc=new TextEncoder();
const MAX_ZIP_BYTES=64*1024*1024;
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
export function createStoreZip(entries:ZipItem[]):Uint8Array<ArrayBuffer>{
 if(!entries.length||entries.length>150)throw new Error('ZIP needs 1–150 files.');
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
 if(total>MAX_ZIP_BYTES)throw new Error('Game pack is larger than 64 MB. Export fewer projects.');
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
