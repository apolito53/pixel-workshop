import {normalizeFinishingSettings,normalizeFinishingCrop,MAX_FINISHING_DIMENSION,MAX_FINISHING_PIXELS,type FinishingSettings,type FinishingCrop} from './image-finishing.ts';

export const FINISHING_RECIPE_FORMAT='pixel-workshop/finishing-recipe-1';
export const FINISHING_PROJECT_FORMAT='pixel-workshop/finishing-project-1';
export const MAX_FINISHING_FILE_BYTES=40_000_000;
export const MAX_FINISHING_PROJECT_BYTES=56_000_000;
export type FinishingRecipe={format:typeof FINISHING_RECIPE_FORMAT;adjustments:FinishingSettings;crop:FinishingCrop|null};
export type FinishingSource={name:string;dataUrl:string;width:number;height:number};
export type FinishingProject={format:typeof FINISHING_PROJECT_FORMAT;name:string;source:FinishingSource;recipe:FinishingRecipe};

function record(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('This is not an image finishing file.');
  return value as Record<string,unknown>;
}
export function validateFinishingDimensions(width:number,height:number){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>MAX_FINISHING_DIMENSION||height>MAX_FINISHING_DIMENSION||width*height>MAX_FINISHING_PIXELS)
    throw new Error(`Choose an image up to ${MAX_FINISHING_PIXELS/1_000_000} megapixels and ${MAX_FINISHING_DIMENSION.toLocaleString()} pixels per side. The image will not be resized automatically.`);
}
export function readFinishingRecipe(value:unknown,width?:number,height?:number):FinishingRecipe{
  const input=record(value);
  if(input.format!==FINISHING_RECIPE_FORMAT)throw new Error('Choose a Pixel Workshop finishing preset or project.');
  const adjustments=normalizeFinishingSettings(record(input.adjustments) as Partial<FinishingSettings>);
  let crop:FinishingCrop|null=null;
  if(input.crop!=null){
    const raw=record(input.crop);
    if(!['x','y','width','height'].every(key=>typeof raw[key]==='number'&&Number.isInteger(raw[key])))throw new Error('The saved crop is invalid.');
    crop={x:raw.x as number,y:raw.y as number,width:raw.width as number,height:raw.height as number};
    if(width!==undefined&&height!==undefined)crop=normalizeFinishingCrop(crop,width,height);
    else if(crop.x<0||crop.y<0||crop.width<1||crop.height<1)throw new Error('The saved crop is invalid.');
  }
  return {format:FINISHING_RECIPE_FORMAT,adjustments,crop};
}
export function readFinishingProject(value:unknown):FinishingProject{
  const input=record(value);
  if(input.format!==FINISHING_PROJECT_FORMAT)throw new Error('Choose an editable .finish.json project.');
  const source=record(input.source),width=source.width as number,height=source.height as number;
  validateFinishingDimensions(width,height);
  if(typeof source.dataUrl!=='string'||source.dataUrl.length>MAX_FINISHING_PROJECT_BYTES||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(source.dataUrl))throw new Error('The project must contain an original PNG, JPEG, or WebP image.');
  const name=typeof input.name==='string'?input.name.slice(0,160):'Untitled image';
  return {format:FINISHING_PROJECT_FORMAT,name,source:{name:typeof source.name==='string'?source.name.slice(0,160):name,dataUrl:source.dataUrl,width,height},recipe:readFinishingRecipe(input.recipe,width,height)};
}
