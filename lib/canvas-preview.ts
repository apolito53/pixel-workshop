import {composite,type PixelDocument,type PixelRegion} from './pixels.ts';
import {referenceRgba} from './reference.ts';

export type CanvasView='artwork'|'overlay'|'reference';
export type CanvasPreviewOptions={view?:CanvasView;referenceOpacity?:number;artworkOpacity?:number;scale?:number;grid?:boolean;region?:PixelRegion};
const opacity=(v:number)=>{if(!Number.isFinite(v)||v<0||v>1)throw new Error('Preview opacity must be between 0 and 1.');return v;};
export function maxPreviewZoom(width:number,height:number){return Math.max(1,Math.min(24,Math.floor(Math.sqrt(4_194_304/(width*height)))));}
export function previewPixels(doc:PixelDocument,options:CanvasPreviewOptions={}):Uint8Array{
 const view=options.view??(doc.reference?'overlay':'artwork');
 if(!['artwork','overlay','reference'].includes(view))throw new Error('Unknown preview view.');
 if(view==='artwork')return composite(doc);
 if(!doc.reference)throw new Error('This canvas has no tracing reference.');
 const rgba=referenceRgba(doc.reference);
 if(view==='reference')return rgba;
 const referenceOpacity=opacity(options.referenceOpacity??.5),artworkOpacity=opacity(options.artworkOpacity??1),art=composite(doc);
 for(let j=0;j<rgba.length;j+=4){
  const ra=rgba[j+3]/255*referenceOpacity,aa=art[j+3]/255*artworkOpacity,outA=aa+ra*(1-aa);
  for(let c=0;c<3;c++)rgba[j+c]=outA?Math.round((art[j+c]*aa+rgba[j+c]*ra*(1-aa))/outA):0;
  rgba[j+3]=Math.round(outA*255);
 }
 return rgba;
}
/** Browser and MCP use identical integer magnification, grid boundaries, and crop coordinates. */
export function buildCanvasPreview(doc:PixelDocument,options:CanvasPreviewOptions={}){
 const scale=options.scale??1,r=options.region??{x:0,y:0,width:doc.width,height:doc.height};
 if(!Number.isInteger(scale)||scale<1||scale>24)throw new Error('Preview scale must be an integer from 1 to 24.');
 if(![r.x,r.y,r.width,r.height].every(Number.isInteger)||r.x<0||r.y<0||r.width<1||r.height<1||r.x+r.width>doc.width||r.y+r.height>doc.height)throw new Error('Preview region must fit the canvas.');
 const width=r.width*scale,height=r.height*scale;
 if(width*height>4_194_304)throw new Error('Preview exceeds 4 million pixels. Choose a smaller scale or region.');
 const native=previewPixels(doc,options),bytes=new Uint8Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const src=((r.y+Math.floor(y/scale))*doc.width+r.x+Math.floor(x/scale))*4,dst=(y*width+x)*4;
  bytes[dst]=native[src];bytes[dst+1]=native[src+1];bytes[dst+2]=native[src+2];bytes[dst+3]=native[src+3];
  if(options.grid&&scale>=3&&(x%scale===0||y%scale===0)){
   const a=56/255,oldA=bytes[dst+3]/255,outA=a+oldA*(1-a);
   for(let c=0;c<3;c++)bytes[dst+c]=Math.round((255*a+bytes[dst+c]*oldA*(1-a))/outA);
   bytes[dst+3]=Math.round(outA*255);
  }
 }
 return {bytes,width,height,scale,region:r};
}
