import {composite,frameCount,frameView,requireInt,type PixelDocument} from './pixels.ts';
import {encodeBrowserPng} from './browser-png.ts';
import {createStoreZip} from './zip-store.ts';

const enc=new TextEncoder();
export type TileAtlasCell={id:number;x:number;y:number;width:number;height:number;empty:boolean};
export type TileAtlas={
 format:'pixel-workshop-tileset/1';image:string;frame:number;
 tileWidth:number;tileHeight:number;columns:number;rows:number;
 width:number;height:number;tiles:TileAtlasCell[];
};
/** Divide a canvas into a game-friendly, row-major tile atlas.
 * Transparent cells remain addressable, so exported IDs stay stable.
 */
export function buildTileAtlas(doc:PixelDocument,tileWidth:number,tileHeight=tileWidth,frame=0):TileAtlas{
 requireInt(tileWidth,1,256,'tile width');requireInt(tileHeight,1,256,'tile height');
 requireInt(frame,0,frameCount(doc)-1,'frame');
 if(doc.width%tileWidth!==0||doc.height%tileHeight!==0)
  throw new Error('Canvas dimensions must divide evenly by the selected tile size.');
 const columns=doc.width/tileWidth,rows=doc.height/tileHeight;
 if(columns*rows>4096)throw new Error('Tileset has too many cells (maximum 4096).');
 const pixels=composite(frameView(doc,frame)),tiles:TileAtlasCell[]=[];
 for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
  const x=col*tileWidth,y=row*tileHeight;
  let occupied=false;
  for(let yy=0;yy<tileHeight&&!occupied;yy++)for(let xx=0;xx<tileWidth;xx++)
   if(pixels[((y+yy)*doc.width+x+xx)*4+3]>0){occupied=true;break;}
  tiles.push({id:row*columns+col,x,y,width:tileWidth,height:tileHeight,empty:!occupied});
 }
 const slug=(doc.name.replace(/[^a-z0-9_-]/gi,'-')||'tileset');
 return {format:'pixel-workshop-tileset/1',image:slug+'-tiles.png',frame,tileWidth,tileHeight,columns,rows,
  width:doc.width,height:doc.height,tiles};
}
/** Portable three-file tileset bundle: pixels, source layers and tile coordinates. */
export function buildTilesetPack(doc:PixelDocument,tileWidth:number,tileHeight=tileWidth,frame=0){
 const atlas=buildTileAtlas(doc,tileWidth,tileHeight,frame),slug=atlas.image.replace(/-tiles\.png$/,'');
 const bytes=createStoreZip([
  {path:atlas.image,data:encodeBrowserPng(frameView(doc,frame))},
  {path:slug+'-tileset.json',data:enc.encode(JSON.stringify(atlas,null,2))},
  {path:slug+'.pixel.json',data:enc.encode(JSON.stringify(doc))},
 ]);
 return {bytes,atlas};
}
