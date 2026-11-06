import {PNG} from 'pngjs';
import {checkReferencePng,packRgba,prepareReference,type ReferenceAlignment} from './reference.ts';
export function referenceFromPng(base64:unknown,name:string,alignment?:ReferenceAlignment){
 if(typeof base64!=='string'||base64.length>10_666_668||base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))
  throw new Error('Send a PNG as base64 (maximum 8 MB decoded).');
 const bytes=Buffer.from(base64,'base64');checkReferencePng(bytes);
 const png=PNG.sync.read(bytes);
 if(png.depth===16)throw new Error('Use an 8-bit or indexed PNG reference.');
 return prepareReference({width:png.width,height:png.height,pixels:packRgba(png.data)},name,alignment);
}
