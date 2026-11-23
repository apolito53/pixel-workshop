import pngjs from 'pngjs/browser.js';
import {Inflate} from 'fflate/browser';
import {MAX_CANVAS_SIDE, MAX_SOURCE_PIXELS, MAX_SOURCE_SIDE} from './canvas-limits.ts';
import {blankCel, CelInterner, type CroppedCel} from './cel-storage.ts';
import {encodeBrowserRgba} from './browser-png.ts';
import {composite, createStackDocument, frameCount, frameView, MAX_ANIMATION_CELLS, MAX_STACK_SLICES, requireInt, validateDocument, type PixelDocument, type StackSettings} from './pixels.ts';
import {validateStackSettings} from './stack-domain.ts';
import {MAX_PROJECT_FILE_BYTES, packProject, unpackProject} from './project-codec.ts';
import {createStoreZip, readStoreZip, MAX_ZIP_BYTES, type ZipItem} from './zip-store.ts';

export const MAX_STACK_ZIP_BYTES = MAX_ZIP_BYTES;
const FORMAT = 'pixel-workshop-stack-pages/1';
const encode = new TextEncoder();
const decode = new TextDecoder('utf-8', {fatal:true});

export type StackPageOptions = {maxPageWidth?:number; maxPageHeight?:number; columns?:number};
export type StackPage = {file:string; firstSlice:number; sliceCount:number; columns:number; width:number; height:number};
export type StackPageManifest = {
  format:typeof FORMAT; name:string; width:number; height:number; sliceCount:number;
  order:'bottom-up'; stack:StackSettings; pages:StackPage[]; source?:string;
};

export function planStackPages(doc:PixelDocument, options:StackPageOptions = {}):StackPageManifest {
  if (!doc.stack) throw new Error('Open a sprite-stack project to export slice pages.');
  const {width,height} = doc;
  const count = frameCount(doc);
  const maxWidth = requireInt(options.maxPageWidth ?? 1024,width,MAX_SOURCE_SIDE,'Maximum page width');
  const maxHeight = requireInt(options.maxPageHeight ?? 1024,height,MAX_SOURCE_SIDE,'Maximum page height');
  const maxColumns = Math.min(count,Math.floor(maxWidth/width),Math.floor(MAX_SOURCE_PIXELS/(width*height)));
  const columns = requireInt(options.columns ?? maxColumns,1,maxColumns,'Page columns');
  const maxRows = Math.min(Math.floor(maxHeight/height),Math.floor(MAX_SOURCE_PIXELS/(columns*width*height)));
  const capacity = columns*maxRows;
  const pages:StackPage[] = [];
  for (let firstSlice=0; firstSlice<count; firstSlice+=capacity) {
    const sliceCount = Math.min(capacity,count-firstSlice);
    const usedColumns = Math.min(columns,sliceCount);
    const file = 'pages/slices-'+String(pages.length+1).padStart(3,'0')+'.png';
    pages.push({file, firstSlice, sliceCount, columns:usedColumns, width:usedColumns*width, height:Math.ceil(sliceCount/usedColumns)*height});
  }
  return {format:FORMAT,name:doc.name,width,height,sliceCount:count,order:'bottom-up',stack:structuredClone(doc.stack),pages};
}

function paintPage(doc:PixelDocument, page:StackPage) {
  const rgba = new Uint8Array(page.width*page.height*4);
  for (let slot=0;slot<page.sliceCount;slot++) {
    const frame = composite(frameView(doc,page.firstSlice+slot));
    const x = slot%page.columns*doc.width, y = Math.floor(slot/page.columns)*doc.height;
    const stride = doc.width*4;
    for (let row=0;row<doc.height;row++)
      rgba.set(frame.subarray(row*stride,(row+1)*stride),((y+row)*page.width+x)*4);
  }
  return encodeBrowserRgba(rgba,page.width,page.height);
}

/** Encode just the requested page; the atlas can be inspected without rendering any pixels. */
export function encodeStackPage(doc:PixelDocument, manifest:StackPageManifest, pageIndex:number) {
  const safe = parseManifest(manifest);
  if (!doc.stack || doc.width!==safe.width || doc.height!==safe.height || frameCount(doc)!==safe.sliceCount)
    throw new Error('Sprite stack dimensions changed since the page layout was built.');
  return paintPage(doc,safe.pages[requireInt(pageIndex,0,safe.pages.length-1,'Page index')]);
}

export function exportStackPages(doc:PixelDocument, options:StackPageOptions = {}):{bytes:Uint8Array<ArrayBuffer>;manifest:StackPageManifest} {
  const manifest = planStackPages(doc,options);
  manifest.source='project.pixel.json';
  const files:ZipItem[] = [{path:'manifest.json',data:encode.encode(JSON.stringify(manifest,null,2))}];
  let sum=files[0].data.length;
  const add = (path:string,data:Uint8Array) => {
    sum+=data.length;
    if(sum>MAX_STACK_ZIP_BYTES) throw new Error('This stack ZIP exceeds 64 MiB. Export individual pages instead.');
    files.push({path,data});
  };
  add(manifest.source,encode.encode(JSON.stringify(packProject(doc))));
  for (const page of manifest.pages) add(page.file,paintPage(doc,page));
  return {bytes:createStoreZip(files,MAX_STACK_SLICES+2),manifest};
}

function validPath(value:unknown):value is string {
  return typeof value==='string' && /^[a-z\d_-][a-z\d_.-]*(\/[a-z\d_-][a-z\d_.-]*)*$/i.test(value);
}
function parseManifest(raw:unknown):StackPageManifest {
  const m = raw as StackPageManifest;
  if(!m || m.format!==FORMAT || m.order!=='bottom-up' || typeof m.name!=='string' || m.name.length>80)
    throw new Error('Invalid Pixel Workshop sprite-stack manifest.');
  const w = requireInt(m.width,1,MAX_CANVAS_SIDE,'Slice width');
  const h = requireInt(m.height,1,MAX_CANVAS_SIDE,'Slice height');
  const count = requireInt(m.sliceCount,1,MAX_STACK_SLICES,'Stack depth');
  const stack = validateStackSettings(m.stack);
  if (!Array.isArray(m.pages) || !m.pages.length || m.pages.length>count || (m.source!==undefined && !validPath(m.source)))
    throw new Error('Invalid sprite-stack page list.');
  const used=new Set(['manifest.json']);
  if (m.source) {
    if(!/\.json$/i.test(m.source) || used.has(m.source.toLowerCase())) throw new Error('Invalid editable-source path.');
    used.add(m.source.toLowerCase());
  }
  let next = 0;
  for (const p of m.pages) {
    if(!p || !validPath(p.file) || !/\.png$/i.test(p.file) || used.has(p.file.toLowerCase()) || p.firstSlice!==next)
      throw new Error('Stack pages must have unique PNG paths and contiguous bottom-up slice ranges.');
    used.add(p.file.toLowerCase());
    const n = requireInt(p.sliceCount,1,count-next,'Page slice count');
    const columns = requireInt(p.columns,1,n,'Page columns');
    if (p.width!==columns*w || p.height!==Math.ceil(n/columns)*h || p.width>MAX_SOURCE_SIDE || p.height>MAX_SOURCE_SIDE || p.width*p.height>MAX_SOURCE_PIXELS)
      throw new Error('Invalid stack page layout or page dimensions.');
    next+=n;
  }
  if (next!==count) throw new Error('Stack pages do not cover every slice.');
  return {...m,stack};
}

function decodePage(bytes:Uint8Array | undefined,p:StackPage):Uint8Array {
  if (!bytes || bytes.length<33 || bytes.length>MAX_STACK_ZIP_BYTES) throw new Error('Missing or truncated stack page: '+p.file);
  const header=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(header.getUint32(0)!==0x89504e47 || header.getUint32(4)!==0x0d0a1a0a ||
      header.getUint32(8)!==13 || header.getUint32(12)!==0x49484452 || header.getUint32(16)!==p.width || header.getUint32(20)!==p.height ||
      ![1,2,4,8].includes(bytes[24]))
    throw new Error('Stack page must be a matching 8-bit or indexed PNG: '+p.file);
  // pngjs bounds inflation by dimensions on its non-interlaced path. Check the
  // whole chunk framing first so a later header cannot override those bounds.
  if (bytes[28]!==0) throw new Error('Use a non-interlaced PNG for each stack page.');
  let ended=false, hasData=false, hasPalette=false;
  for(let at=8;at<bytes.length;){
    if (at+12>bytes.length) throw new Error('Truncated stack page PNG.');
    const size=header.getUint32(at), type=header.getUint32(at+4), next=at+12+size;
    if(next>bytes.length || (type===0x49484452 && at!==8)) throw new Error('Invalid stack page PNG header or chunk.');
    if(type===0x504c5445) {
      if(hasPalette || hasData || size<3 || size>768 || size%3) throw new Error('Invalid stack page PNG palette.');
      hasPalette=true;
    }
    if(type===0x49444154) hasData=true;
    if(type===0x49454e44) {
      if(size!==0 || next!==bytes.length || !hasData) throw new Error('Invalid end of stack page PNG.');
      ended=true;
    }
    at=next;
  }
  if(!ended)throw new Error('Truncated stack page PNG.');
  const BufferImpl=new pngjs.PNG({width:1,height:1}).data.constructor as typeof Buffer;
  return pngjs.PNG.sync.read(BufferImpl.from(bytes)).data;
}

function readTile(bytes:Uint8Array,p:StackPage,slot:number,w:number,h:number):CroppedCel {
  const ox=slot%p.columns*w, oy=Math.floor(slot/p.columns)*h;
  let left=w,right=-1,top=h,bottom=-1;
  const pixels=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for(let y=0;y<h;y++){
    const offset=(oy+y)*p.width+ox;
    for(let x=0;x<w;x++){
      if(!pixels.getUint32((offset+x)*4)) continue;
      left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=y;
    }
  }
  if(right<left) return blankCel();
  const width=right-left+1,height=bottom-top+1,data=new Array<number>(width*height);
  for(let y=0;y<height;y++){
    const offset=(oy+top+y)*p.width+ox+left;
    for(let x=0;x<width;x++)data[y*width+x]=pixels.getUint32((offset+x)*4);
  }
  return {x:left,y:top,width,height,data};
}

function matchesTile(doc:PixelDocument,p:StackPage,slot:number,bytes:Uint8Array) {
  const frame=composite(frameView(doc,p.firstSlice+slot));
  const w=doc.width,h=doc.height,x=slot%p.columns*w,y=Math.floor(slot/p.columns)*h;
  const source=new DataView(frame.buffer,frame.byteOffset,frame.byteLength);
  const page=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  // Compare bytes directly so straight RGBA alpha and partially transparent colors survive.
  for(let row=0;row<h;row++){
    const start=((y+row)*p.width+x)*4;
    for(let col=0;col<w;col++){
      const j=row*w+col;
      if (page.getUint32(start+col*4)!==source.getUint32(j*4))return false;
    }
  }
  return true;
}

export function readStackPages(raw:unknown,getFile:(path:string)=>Uint8Array|undefined):PixelDocument {
  const m=parseManifest(raw);
  const sourceBytes=m.source ? getFile(m.source) : undefined;
  if (sourceBytes) {
    if(sourceBytes.length>MAX_PROJECT_FILE_BYTES) throw new Error('Stack source project is too large.');
    const source=validateDocument(unpackProject(JSON.parse(decode.decode(sourceBytes))));
    if(!source.stack || source.width!==m.width || source.height!==m.height || frameCount(source)!==m.sliceCount ||
        source.stack.origin[0]!==m.stack.origin[0] || source.stack.origin[1]!==m.stack.origin[1] ||
        source.stack.zMin!==m.stack.zMin || source.stack.sliceHeight!==m.stack.sliceHeight)
      throw new Error('Stack source and page coordinates disagree.');
    let same=true;
    for(const p of m.pages){
      const bytes=decodePage(getFile(p.file),p);
      for(let slot=0;same && slot<p.sliceCount;slot++) same=matchesTile(source,p,slot,bytes);
      if(!same)break;
    }
    // Preserve editable hidden layers, palettes, recipes, and references on the
    // normal lossless round trip. Externally edited PNGs are the new artwork.
    if(same)return {...source,name:m.name,stack:m.stack};
  }
  const doc=createStackDocument(m.name,m.width,m.height,m.sliceCount,m.stack);
  const id=doc.layers[0].id;
  const cels=new CelInterner<CroppedCel>();
  for(const p of m.pages){
    const bytes=decodePage(getFile(p.file),p);
    for(let slot=0;slot<p.sliceCount;slot++){
      const slice=p.firstSlice+slot;
      const cel=cels.intern(readTile(bytes,p,slot,m.width,m.height));
      if(cels.cells>MAX_ANIMATION_CELLS) throw new Error('Stack page artwork exceeds the editable pixel budget.');
      if(slice===0)doc.layers[0].pixels=cel;
      else doc.animation!.frames[slice-1].pixels[id]=cel;
    }
  }
  return validateDocument(doc);
}

export function importStackPages(zip:Uint8Array):PixelDocument {
  // Desktop archivers may add directory records or macOS resource metadata.
  // Their uncompressed sizes still count toward the archive-wide byte limit.
  const files=readStoreZip(zip,MAX_STACK_SLICES*3+32,(compressed,size)=>{
    const output=new Uint8Array(size);
    let pos=0;
    const decoder=new Inflate(chunk=>{
      if(pos+chunk.length>size)throw new Error('Expanded ZIP entry exceeds its declared size.');
      output.set(chunk,pos);pos+=chunk.length;
    });
    if(!compressed.length)throw new Error('Empty DEFLATE stream.');
    // Feeding small chunks bounds transient inflate output even for a false
    // uncompressed-size header. Abort as soon as this entry exceeds its budget.
    for(let i=0;i<compressed.length;i+=4096){
      const end=Math.min(compressed.length,i+4096);
      decoder.push(compressed.subarray(i,end),end===compressed.length);
    }
    if(pos!==size)throw new Error('Expanded ZIP entry does not match its declared size.');
    return output;
  });
  // Finder and Explorer can put the selected folder itself inside the ZIP.
  const manifests=[...files.keys()].filter(path=>!path.split('/').includes('__macosx') &&
    (path==='manifest.json'||path.endsWith('/manifest.json')));
  const file=files.has('manifest.json')?'manifest.json':manifests.length===1?manifests[0]:undefined;
  if(!file)throw new Error('Choose an archive containing one stack page manifest.');
  const manifest=files.get(file)!;
  if(manifest.length>1_000_000)throw new Error('Oversized stack page manifest.');
  const root=file.slice(0,-'manifest.json'.length);
  return readStackPages(JSON.parse(decode.decode(manifest)),path=>files.get(root+path.toLowerCase()));
}
