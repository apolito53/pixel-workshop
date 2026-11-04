import { clipFrameSequence, composite, frameCount, frameView, requireInt, type AnimationClip, type PixelDocument } from './pixels.ts';
import type {UiMetadata} from './ui-metadata.ts';

export type AtlasFrame = { index: number; x: number; y: number; width: number; height: number; durationMs: number };
export type AtlasClip = AnimationClip & { frames: number[] };
export type SpriteAtlas = { format: 'pixel-workshop-atlas/1'; image: string; width: number; height: number; frameWidth: number; frameHeight: number; fps: number; frames: AtlasFrame[]; clips?: AtlasClip[];ui?:UiMetadata };
export function buildSpriteSheet(d: PixelDocument, columns = Math.min(8, frameCount(d)), format:'png'|'svg'='png') {
  if(format!=='png'&&format!=='svg')throw new Error('Sprite sheet format must be png or svg.');
  const count = frameCount(d);
  requireInt(columns, 1, count, 'columns');
  const width = d.width * columns, height = d.height * Math.ceil(count / columns);
  if (width * height > 4_194_304) throw new Error('Sprite sheet exceeds the export pixel limit.');
  const bytes = new Uint8Array(width * height * 4);
  const frames: AtlasFrame[] = [];
  for (let i = 0; i < count; i++) {
    const x = (i % columns) * d.width, y = Math.floor(i / columns) * d.height;
    const source = composite(frameView(d,i));
    for (let row = 0; row < d.height; row++) {
      const offset = ((y + row) * width + x) * 4;
      bytes.set(source.subarray(row * d.width * 4,(row+1)*d.width*4),offset);
    }
    frames.push({index:i,x,y,width:d.width,height:d.height,
      durationMs:Math.round(1000/(d.animation?.fps ?? 8))});
  }
  const atlas: SpriteAtlas = {
    format:'pixel-workshop-atlas/1',image:d.name.replace(/[^a-z0-9_-]/gi,'-')+'-sheet.'+format,
    width,height,frameWidth:d.width,frameHeight:d.height,fps:d.animation?.fps ?? 8,frames,
    ...(d.animation?.clips?.length?{clips:d.animation.clips.map(clip=>({...clip,frames:clipFrameSequence(clip)}))}:{}),
    ...(d.ui?{ui:structuredClone(d.ui)}:{})
  };
  return {width,height,bytes,atlas};
}
