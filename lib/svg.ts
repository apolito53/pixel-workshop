import { composite, requireInt, type PixelDocument } from './pixels.ts';

type PixelRect = { x:number; y:number; width:number; height:number; rgba:number };

/** Real vector rectangles, composited exactly like PNG. No embedded raster image. */
export function encodeSvg(doc:PixelDocument, scale=1):string {
  return encodeRgbaSvg(composite(doc),doc.width,doc.height,scale);
}

export function encodeRgbaSvg(bytes:Uint8Array, width:number, height:number, scale=1):string {
  requireInt(scale,1,16,'SVG scale');
  if (!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||
      width*height>4_194_304||bytes.length!==width*height*4)
    throw new Error('Invalid SVG dimensions or RGBA buffer.');

  const rectangles:PixelRect[]=[];
  let previous=new Map<string,PixelRect>();
  const pixel=(x:number,y:number)=>{
    const i=(y*width+x)*4;
    return ((bytes[i]<<24)|(bytes[i+1]<<16)|(bytes[i+2]<<8)|bytes[i+3])>>>0;
  };
  // Merge same-color horizontal runs, then identical runs on adjacent rows.
  // Rectangles never overlap, so partial alpha is applied exactly once per pixel.
  for(let y=0;y<height;y++){
    const current=new Map<string,PixelRect>();
    for(let x=0;x<width;){
      const rgba=pixel(x,y),start=x++;
      if((rgba&255)===0)continue;
      while(x<width&&pixel(x,y)===rgba)x++;
      const runWidth=x-start,key=`${start}:${runWidth}:${rgba}`;
      const existing=previous.get(key);
      if(existing){existing.height++;current.set(key,existing);}
      else{
        const rect={x:start,y,width:runWidth,height:1,rgba};
        rectangles.push(rect);current.set(key,rect);
      }
    }
    previous=current;
  }
  const shapes=rectangles.map(r=>{
    const fill=(r.rgba>>>8).toString(16).padStart(6,'0'),alpha=r.rgba&255;
    return `  <rect x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}" fill="#${fill}"${alpha===255?'':` fill-opacity="${alpha/255}"`}/>`;
  });
  // Only validated numbers and generated hex colors enter XML, never project text.
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width*scale}" height="${height*scale}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">`,
    ...shapes,
    '</svg>',
    '',
  ].join('\n');
}
