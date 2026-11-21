import {PNG} from 'pngjs';
import {
  MAX_FINISHING_DIMENSION,MAX_FINISHING_PIXELS,
  normalizeFinishingCrop,normalizeFinishingSettings,renderFinishedImage,
} from './image-finishing.ts';
import {FINISHING_RECIPE_FORMAT,type FinishingRecipe} from './finishing-project.ts';
import {crc32} from './zip-store.ts';

// Leave room for the JSON-RPC envelope in the existing 12 MB HTTP request limit.
export const MAX_FINISHING_PNG_BYTES=8_000_000;
export const MAX_FINISHING_PNG_BASE64=Math.ceil(MAX_FINISHING_PNG_BYTES/3)*4;

function tagSrgbPng(bytes:Buffer):Buffer{
  const chunk=Buffer.alloc(13);chunk.writeUInt32BE(1);chunk.write('sRGB',4,'ascii');
  // Rendering intent 0 (perceptual); the engine's channels are encoded sRGB.
  chunk.writeUInt32BE(crc32(chunk.subarray(4,9)),9);
  return Buffer.concat([bytes.subarray(0,33),chunk,bytes.subarray(33)]);
}

/** Inspect dimensions before pngjs inflates an untrusted upload. */
export function inspectFinishingPng(bytes:Uint8Array):{width:number;height:number}{
  if(bytes.byteLength>MAX_FINISHING_PNG_BYTES)throw new Error('MCP image finishing accepts PNG files up to 8 MB. Open larger files in Image Finishing in the browser.');
  const signature=[137,80,78,71,13,10,26,10];
  if(bytes.byteLength<33||signature.some((value,index)=>bytes[index]!==value))throw new Error('Send a PNG image as png_base64.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(view.getUint32(8)!==13||String.fromCharCode(...bytes.subarray(12,16))!=='IHDR')throw new Error('The PNG image header is invalid.');
  const width=view.getUint32(16),height=view.getUint32(20);
  if(!width||!height||width>MAX_FINISHING_DIMENSION||height>MAX_FINISHING_DIMENSION||width*height>MAX_FINISHING_PIXELS)
    throw new Error(`Image finishing accepts up to ${MAX_FINISHING_PIXELS/1_000_000} megapixels and ${MAX_FINISHING_DIMENSION} pixels per side. The image will not be resized automatically.`);
  if(bytes[24]===16)throw new Error('MCP image finishing uses 8-bit output. Convert this 16-bit PNG to an 8-bit sRGB PNG explicitly before editing.');
  // pngjs reads raw channel values, without ICC conversion. Reject profiles it
  // cannot honor instead of producing a differently colored, untagged export.
  for(let offset=8;offset+12<=bytes.byteLength;){
    const length=view.getUint32(offset),end=offset+12+length;
    if(end>bytes.byteLength)throw new Error('The PNG image is truncated.');
    const kind=String.fromCharCode(...bytes.subarray(offset+4,offset+8));
    if(kind==='acTL')throw new Error('Image finishing works on still images. Export an animation frame as a PNG first.');
    if(kind==='iCCP')throw new Error('This PNG has an embedded ICC profile. Convert it to an 8-bit sRGB PNG before MCP finishing so its colors are preserved.');
    if(['cICP','mDCV','cLLI'].includes(kind))throw new Error('This PNG has color or HDR metadata that MCP finishing cannot interpret. Convert it to an 8-bit sRGB PNG first.');
    if(kind==='gAMA'&&(length!==4||view.getUint32(offset+8)!==45455))
      throw new Error('This PNG uses a non-sRGB gamma profile. Convert it to an 8-bit sRGB PNG before MCP finishing.');
    if(kind==='cHRM'){
      const srgb=[31270,32900,64000,33000,30000,60000,15000,6000];
      if(length!==32||srgb.some((value,index)=>view.getUint32(offset+8+index*4)!==value))
        throw new Error('This PNG uses non-sRGB color primaries. Convert it to an 8-bit sRGB PNG before MCP finishing.');
    }
    if(kind==='IEND')break;
    offset=end;
  }
  return {width,height};
}

export function prepareFinishingPng(pngBase64:unknown,adjustments?:unknown,crop?:unknown){
  if(typeof pngBase64!=='string'||!pngBase64.length||pngBase64.length>MAX_FINISHING_PNG_BASE64||pngBase64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(pngBase64))
    throw new Error('Send png_base64 as plain PNG base64, without a data URL prefix (maximum 8 MB decoded).');
  const settings=normalizeFinishingSettings(adjustments);
  const sourceBytes=Buffer.from(pngBase64,'base64');
  const source=inspectFinishingPng(sourceBytes);
  const bounds=normalizeFinishingCrop(crop,source.width,source.height);
  const decoded=PNG.sync.read(sourceBytes);
  const image={...source,data:new Uint8ClampedArray(decoded.data.buffer,decoded.data.byteOffset,decoded.data.byteLength)};
  const recipe:FinishingRecipe={format:FINISHING_RECIPE_FORMAT,adjustments:settings,crop:crop==null?null:bounds};
  return {source,image,bounds,recipe};
}

export function renderFinishingPng(prepared:ReturnType<typeof prepareFinishingPng>){
  const {image,recipe,bounds,source}=prepared;
  const finished=renderFinishedImage(image,recipe.adjustments,bounds);
  // Use a view rather than copying a second full-resolution output buffer.
  const output=new PNG();output.width=finished.width;output.height=finished.height;
  output.data=Buffer.from(finished.data.buffer,finished.data.byteOffset,finished.data.byteLength);
  const bytes=tagSrgbPng(PNG.sync.write(output,{colorType:6}));
  return {bytes,source,width:finished.width,height:finished.height,recipe};
}

export function finishPng(pngBase64:unknown,adjustments?:unknown,crop?:unknown){
  return renderFinishingPng(prepareFinishingPng(pngBase64,adjustments,crop));
}
