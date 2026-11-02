import {type AnimationClip,type PixelDocument,frameCount,validateDocument} from './pixels.ts';
import {buildSpriteSheet} from './sprite-sheet.ts';
import {encodeBrowserRgba} from './browser-png.ts';
import {createStoreZip,type ZipItem} from './zip-store.ts';

const enc=new TextEncoder();
export type GamePackAsset={
 id:string;name:string;width:number;height:number;frames:number;layers:number;
 clips:AnimationClip[];source:string;atlas:string;sheet:string;
};
export type GamePackManifest={
 format:'pixel-workshop-pack/1';generator:'Pixel Workshop';assets:GamePackAsset[];
};
export function buildGamePack(documents:PixelDocument[]):{bytes:Uint8Array<ArrayBuffer>;manifest:GamePackManifest}{
 if(!Array.isArray(documents)||documents.length<1||documents.length>30)
  throw new Error('Choose between 1 and 30 projects per game pack.');
 const files:ZipItem[]=[];
 const used=new Set<string>();
 const manifest:GamePackManifest={format:'pixel-workshop-pack/1',generator:'Pixel Workshop',assets:[]};
 for(const input of documents){
  const doc=validateDocument(input);
  const rootName=(doc.name.toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'')||'asset').slice(0,40);
  let slug=rootName,number=2;
  while(used.has(slug)){slug=rootName+'-'+number++;}used.add(slug);
  const dir='assets/'+slug+'/';
  const sheet=buildSpriteSheet(doc);
  const png=encodeBrowserRgba(sheet.bytes,sheet.width,sheet.height);
  const source=dir+slug+'.pixel.json',atlas=dir+slug+'-atlas.json',image=dir+sheet.atlas.image;
  files.push({path:source,data:enc.encode(JSON.stringify(doc))});
  files.push({path:image,data:png});
  files.push({path:atlas,data:enc.encode(JSON.stringify(sheet.atlas,null,2))});
  manifest.assets.push({
   id:doc.id,name:doc.name,width:doc.width,height:doc.height,
   frames:frameCount(doc),layers:doc.layers.length,clips:doc.animation?.clips??[],
   source,atlas,sheet:image,
  });
 }
 files.push({path:'manifest.json',data:enc.encode(JSON.stringify(manifest,null,2))});
 files.push({path:'README.txt',data:enc.encode(
  'Pixel Workshop game asset pack\n\n'+
  'manifest.json lists the assets and their relative paths.\n'+
  'Each asset includes its editable .pixel.json document, a composited RGBA sprite sheet,\n'+
  'and an atlas with frame rectangles, duration, and optional named animation clips.\n'+
  'Import any .pixel.json into Pixel Workshop to continue editing.\n'+
  'Frames are packed left-to-right, top-to-bottom. Coordinates are in native pixels.\n'
 )});
 return {bytes:createStoreZip(files),manifest};
}
