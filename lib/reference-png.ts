import {PNG} from 'pngjs';
import {MAX_CANVAS_SIDE} from './canvas-limits.ts';
import {checkReferencePng,packRgba,prepareReference,fitReferenceAlignment,type ReferenceAlignment} from './reference.ts';
export function referenceFromPng(base64:unknown,name:string,alignment?:ReferenceAlignment,sizing:'fit'|'native'='fit'){
 if(!['fit','native'].includes(sizing))throw new Error('Choose fit or native reference sizing.');
 if(typeof base64!=='string'||base64.length>10_666_668||base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))
  throw new Error('Send a PNG as base64 (maximum 8 MB decoded).');
 const bytes=Buffer.from(base64,'base64');checkReferencePng(bytes);
 const png=PNG.sync.read(bytes);
 if(png.depth===16)throw new Error('Use an 8-bit or indexed PNG reference.');
 if(!alignment&&sizing==='native'&&(png.width>MAX_CANVAS_SIDE||png.height>MAX_CANVAS_SIDE))
  throw new Error('Native import needs at most 512 pixels per side. Use sizing:"fit" to resize, or alignment with cellWidth/cellHeight:1 to extract an exact source region.');
 return prepareReference({width:png.width,height:png.height,pixels:packRgba(png.data)},name,alignment??(sizing==='fit'?fitReferenceAlignment(png.width,png.height):undefined));
}
