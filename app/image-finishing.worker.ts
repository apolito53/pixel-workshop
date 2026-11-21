import {renderFinishedImage,type FinishingImage,type FinishingSettings,type FinishingCrop} from '../lib/image-finishing.ts';

type LoadMessage={kind:'load';sourceId:number;image:FinishingImage;preview:FinishingImage};
type RenderMessage={kind:'preview'|'export';sourceId:number;id:number;settings:FinishingSettings;crop:FinishingCrop|null};
let source:FinishingImage|null=null,preview:FinishingImage|null=null,sourceId=0;

// Keep the untouched full-resolution image in this worker. Only previews and
// final rendered copies leave it; slider movements never rewrite the original.
self.onmessage=(event:MessageEvent<LoadMessage|RenderMessage>)=>{
  const message=event.data;
  try{
    if(message.kind==='load'){
      source=message.image;preview=message.preview;sourceId=message.sourceId;
      self.postMessage({kind:'loaded',sourceId});return;
    }
    if(!source||!preview||message.sourceId!==sourceId)return;
    let image=source,crop=message.crop,spatialScale=1;
    if(message.kind==='preview'){
      image=preview;
      const sx=preview.width/source.width,sy=preview.height/source.height;
      spatialScale=Math.min(sx,sy);
      if(crop){
        const x=Math.min(preview.width-1,Math.floor(crop.x*sx)),y=Math.min(preview.height-1,Math.floor(crop.y*sy));
        crop={x,y,width:Math.min(preview.width-x,Math.max(1,Math.round((crop.x+crop.width)*sx)-x)),height:Math.min(preview.height-y,Math.max(1,Math.round((crop.y+crop.height)*sy)-y))};
      }
    }
    const rendered=renderFinishedImage(image,message.settings,crop,{spatialScale});
    self.postMessage({kind:message.kind,id:message.id,sourceId,image:rendered},{transfer:[rendered.data.buffer as ArrayBuffer]});
  }catch(error){
    self.postMessage({kind:'error',sourceId:message.sourceId,id:'id' in message?message.id:0,operation:message.kind,message:error instanceof Error?error.message:'Unable to render the image.'});
  }
};
