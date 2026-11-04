import {readStoreZip} from './zip-store.ts';
import {validateDocument,type PixelDocument} from './pixels.ts';
/** Read editable source documents only; exported SVG/PNG are never executed. */
export function readGamePack(bytes:Uint8Array):PixelDocument[]{
 const files=readStoreZip(bytes),decode=new TextDecoder('utf-8',{fatal:true}),manifestBytes=files.get('manifest.json');
 if(!manifestBytes||manifestBytes.length>1_000_000)throw new Error('Game pack has no valid manifest.');
 const manifest=JSON.parse(decode.decode(manifestBytes)) as {format?:string;assets?:{source?:unknown}[]};
 if(manifest.format!=='pixel-workshop-pack/1'||!Array.isArray(manifest.assets)||!manifest.assets.length||manifest.assets.length>30)
  throw new Error('This is not a supported Pixel Workshop game pack.');
 const paths=new Set<string>();
 return manifest.assets.map(item=>{
  if(!item||typeof item.source!=='string')throw new Error('An asset has no editable project.');
  const path=item.source.toLowerCase(),data=files.get(path);
  if(!data||data.length>12_000_000||paths.has(path))throw new Error('A project is missing, duplicated or too large.');
  paths.add(path);return validateDocument(JSON.parse(decode.decode(data)));
 });
}
