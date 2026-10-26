import { PNG } from 'pngjs';
import { composite, type PixelDocument } from './pixels.ts';
export function encodePng(doc:PixelDocument, scale=1) {
  if(!Number.isInteger(scale)||scale<1||scale>16)throw new Error('PNG scale must be an integer from 1 to 16.');
  if(doc.width*scale*doc.height*scale>4194304)throw new Error('Choose a smaller export scale (maximum 4 million output pixels).');
  const bytes=composite(doc),w=doc.width*scale,h=doc.height*scale,out=new PNG({width:w,height:h});
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const src=(Math.floor(y/scale)*doc.width+Math.floor(x/scale))*4,dst=(y*w+x)*4;
    for(let c=0;c<4;c++)out.data[dst+c]=bytes[src+c];
  }
  return PNG.sync.write(out,{colorType:6});
}

export function encodeRgbaPng(bytes: Uint8Array,width: number,height: number): Buffer {
  if (!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>4194304 ||
    bytes.length !== width*height*4) throw new Error('Invalid sprite sheet dimensions.');
  const png = new PNG({width,height});png.data.set(bytes);
  return PNG.sync.write(png,{colorType:6});
}
