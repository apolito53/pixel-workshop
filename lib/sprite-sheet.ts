import { clipFrameSequence, composite, frameCount, frameView, requireInt, type AnimationClip, type PixelDocument } from './pixels.ts';
import type {Cel} from './cel-storage.ts';
import type {UiMetadata} from './ui-metadata.ts';

export type AtlasFrame = { index: number; x: number; y: number; width: number; height: number; durationMs: number };
export type AtlasClip = AnimationClip & { frames: number[] };
export type SpriteAtlas = { format: 'pixel-workshop-atlas/1'; image: string; width: number; height: number; frameWidth: number; frameHeight: number; fps: number; frames: AtlasFrame[]; clips?: AtlasClip[];ui?:UiMetadata };
const MAX_SHEET_PIXELS = 4_194_304;

function defaultColumns(d: PixelDocument, count: number) {
  const preferred = Math.min(8, count);
  const frameArea = d.width * d.height;
  // Padding in the final row also consumes export pixels. A single column
  // always fits when the unpadded animation fits.
  for (let columns = preferred; columns > 1; columns--) {
    if (columns * Math.ceil(count / columns) * frameArea <= MAX_SHEET_PIXELS) return columns;
  }
  return 1;
}

export function buildSpriteSheet(d: PixelDocument, columns?: number, format:'png'|'svg'='png') {
  if(format!=='png'&&format!=='svg')throw new Error('Sprite sheet format must be png or svg.');
  const count = frameCount(d);
  if (columns !== undefined) requireInt(columns, 1, count, 'columns');
  const maxPoses = Math.floor(MAX_SHEET_PIXELS / (d.width * d.height));
  const compact = count > maxPoses;
  const sources:number[] = [];
  const positions:number[] = [];
  const slotByPose = new Map<string, number>();
  const celIds = new Map<Cel, number>();
  const visible = d.layers.filter(layer => layer.visible);
  for (let i = 0; i < count; i++) {
    // Keep the familiar frame-by-frame layout whenever it fits. Oversize timelines
    // can share atlas rectangles when every visible layer holds the same drawing.
    let slot:number|undefined;
    if (compact) {
      const key = visible.map(layer => {
        const pixels = i === 0 ? layer.pixels : d.animation!.frames[i-1].pixels[layer.id];
        let id = celIds.get(pixels);
        if (id === undefined) { id = celIds.size; celIds.set(pixels,id); }
        return id;
      }).join(',');
      slot = slotByPose.get(key);
      if (slot === undefined) slotByPose.set(key,sources.length);
    }
    if (slot === undefined) {slot = sources.length; sources.push(i);}
    positions.push(slot);
  }
  if (sources.length > maxPoses)
    throw new Error(`Sprite sheet exceeds the export pixel limit. This canvas fits ${maxPoses} distinct poses per sheet and the timeline uses ${sources.length}.`);
  columns = Math.min(columns ?? defaultColumns(d,sources.length), sources.length);
  const width = d.width * columns, height = d.height * Math.ceil(sources.length / columns);
  if (width * height > MAX_SHEET_PIXELS) throw new Error('Sprite sheet exceeds the export pixel limit with this column count. Use the default layout.');
  const bytes = new Uint8Array(width * height * 4);
  for (let slot = 0; slot < sources.length; slot++) {
    const x = (slot % columns) * d.width, y = Math.floor(slot / columns) * d.height;
    const source = composite(frameView(d,sources[slot]));
    for (let row = 0; row < d.height; row++) {
      const offset = ((y + row) * width + x) * 4;
      bytes.set(source.subarray(row * d.width * 4,(row+1)*d.width*4),offset);
    }
  }
  const frames:AtlasFrame[] = positions.map((slot,index)=>({
    index,x:(slot % columns)*d.width,y:Math.floor(slot / columns)*d.height,width:d.width,height:d.height,
    durationMs:Math.round(1000/(d.animation?.fps ?? 8))
  }));
  const atlas: SpriteAtlas = {
    format:'pixel-workshop-atlas/1',image:d.name.replace(/[^a-z0-9_-]/gi,'-')+'-sheet.'+format,
    width,height,frameWidth:d.width,frameHeight:d.height,fps:d.animation?.fps ?? 8,frames,
    ...(d.animation?.clips?.length?{clips:d.animation.clips.map(clip=>({...clip,frames:clipFrameSequence(clip)}))}:{}),
    ...(d.ui?{ui:structuredClone(d.ui)}:{})
  };
  return {width,height,bytes,atlas};
}
