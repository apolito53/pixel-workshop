import pngjs from 'pngjs/browser.js';
import { composite, type PixelDocument } from './pixels.ts';

// Encode straight RGBA bytes directly: a canvas round-trip can round partially
// transparent RGB channels when the browser premultiplies its backing buffer.
export function encodeBrowserPng(doc:PixelDocument,scale=1):Uint8Array<ArrayBuffer> {
  if(!Number.isInteger(scale)||scale<1||scale>16)throw new Error('PNG scale must be an integer from 1 to 16.');
  const width=doc.width*scale,height=doc.height*scale;
  if(width*height>4194304)throw new Error('Choose a smaller export scale (maximum 4 million output pixels).');
  const bytes=composite(doc),out=new pngjs.PNG({width,height});
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const src=(Math.floor(y/scale)*doc.width+Math.floor(x/scale))*4,dst=(y*width+x)*4;
    for(let c=0;c<4;c++)out.data[dst+c]=bytes[src+c];
  }
  return new Uint8Array(pngjs.PNG.sync.write(out,{colorType:6}));
}

export function encodeBrowserRgba(bytes: Uint8Array, width: number, height: number): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>4194304 ||
    bytes.length !== width*height*4) throw new Error('Invalid sprite sheet dimensions.');
  const png = new pngjs.PNG({width,height});
  png.data.set(bytes);
  return new Uint8Array(pngjs.PNG.sync.write(png,{colorType:6}));
}
