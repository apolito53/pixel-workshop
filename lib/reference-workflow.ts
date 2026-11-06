import {composite,frameView,hex,type PixelDocument,type PaintCommand} from './pixels.ts';
import {packRgba,type ReferenceImage} from './reference.ts';

export function referencePreparation(reference:ReferenceImage){
 const source=reference.source;
 return {
  sourceWidth:source?.widthPixels??reference.width,sourceHeight:source?.heightPixels??reference.height,
  width:reference.width,height:reference.height,
  resampled:!!source&&(source.cellWidth!==1||source.cellHeight!==1),
  croppedOrPadded:!!source&&(source.offsetX!==0||source.offsetY!==0||Math.abs(source.width*source.cellWidth-source.widthPixels)>.000001||Math.abs(source.height*source.cellHeight-source.heightPixels)>.000001),
  sampling:'nearest-neighbor cell centers',comparisonBasis:'prepared reference',
 };
}

/** Build server-local edits; the reference array never has to cross MCP again. */
export function referenceCopyCommands(doc:PixelDocument,options:{layer?:unknown;name?:unknown;frame?:unknown}={}){
 if(!doc.reference)throw new Error('This canvas has no tracing reference.');
 const frame=options.frame===undefined?0:options.frame;
 frameView(doc,frame as number); // Validate before planning any mutation.
 if(options.layer!==undefined&&typeof options.layer!=='string')throw new Error('Choose a valid target layer.');
 if(options.name!==undefined&&(typeof options.name!=='string'||!options.name.trim()||options.name.length>60))throw new Error('Layer name needs 1–60 characters.');
 if(options.layer!==undefined&&options.name!==undefined)throw new Error('name is only used when creating a new layer.');
 const layer=options.layer as string|undefined??crypto.randomUUID();
 const commands:PaintCommand[]=[];
 if(options.layer===undefined)commands.push({op:'add_layer',id:layer,name:options.name??doc.reference.name.slice(0,60)});
 else if(!doc.layers.some(l=>l.id===layer))throw new Error('Layer not found.');
 commands.push({op:'paste',layer,frame,x:0,y:0,width:doc.width,height:doc.height,pixels:doc.reference.pixels});
 // A copied image must not retain a procedural recipe that can overwrite it later.
 if(options.layer!==undefined&&doc.layers.find(l=>l.id===layer)?.effect)commands.push({op:'effect_detach',layer});
 return {commands,layer,frame:frame as number};
}

export function compareReference(doc:PixelDocument,frame=0,layer?:string){
 if(!doc.reference)throw new Error('This canvas has no tracing reference.');
 const view=frameView(doc,frame),target=layer===undefined?undefined:view.layers.find(l=>l.id===layer);
 if(layer!==undefined&&!target)throw new Error('Layer not found.');
 const actual=target?target.pixels:packRgba(composite(view)),expected=doc.reference.pixels;
 let differentPixels=0,visibleDifferentPixels=0;
 type Difference={x:number;y:number;expected:string;actual:string};
 let firstDifference:Difference|null=null;
 let firstVisibleDifference:Difference|null=null;
 for(let i=0;i<expected.length;i++)if(actual[i]!==expected[i]){
  differentPixels++;
  const difference={x:i%doc.width,y:Math.floor(i/doc.width),expected:hex(expected[i]),actual:hex(actual[i])};
  firstDifference??=difference;
  // RGB under zero alpha is retained in layers but normalized by artwork compositing.
  if((actual[i]&255)!==0||(expected[i]&255)!==0){visibleDifferentPixels++;firstVisibleDifference??=difference;}
 }
 return {frame,layer:layer??null,target:layer===undefined?'composited artwork':'layer',
  ...referencePreparation(doc.reference),totalPixels:expected.length,matchingPixels:expected.length-differentPixels,
  differentPixels,visibleDifferentPixels,exactMatch:differentPixels===0,visibleMatch:visibleDifferentPixels===0,
  firstDifference,firstVisibleDifference};
}
