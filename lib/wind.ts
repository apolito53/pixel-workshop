import {frameCount, frameView, MAX_ANIMATION_FRAMES, MAX_BATCH_PIXEL_WORK, requireInt, type PaintCommand, type PixelDocument} from './pixels.ts';

export function windAngle(frame:number, frames:number, degrees:number, delay:number) {
  // Quantize numerical noise so mirrored phases share the exact same pose.
  return Math.round(Math.sin(2 * Math.PI * (frame - delay) / frames) * degrees * 10000) / 10000 || 0;
}

/** Inverse-sample pixel centers around an integer pivot. Out-of-bounds samples are transparent. */
export function windPose(source:number[], width:number, height:number, pivotX:number, pivotY:number, degrees:number) {
  if (degrees === 0) return source;
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians), sin = Math.sin(radians);
  const pixels = Array<number>(width * height);
  for (let y = 0; y < height; y++) {
    const dy = y - pivotY;
    for (let x = 0; x < width; x++) {
      const dx = x - pivotX;
      const sx = Math.round(pivotX + dx * cos + dy * sin);
      const sy = Math.round(pivotY - dx * sin + dy * cos);
      pixels[y * width + x] = sx >= 0 && sx < width && sy >= 0 && sy < height ? source[sy * width + sx] : 0;
    }
  }
  return pixels;
}

/** The browser and both MCP transports send the small recipe. The engine bakes it in one edit. */
export function planWindBake(doc:PixelDocument, cmd:PaintCommand):PaintCommand[] {
  const current = frameCount(doc);
  const count = requireInt(cmd.frames ?? (current === 1 ? 12 : current), 2, MAX_ANIMATION_FRAMES, 'wind frames');
  if (current > 1 && count !== current) throw new Error('Use the existing timeline length for this wind loop.');
  const sourceFrame = requireInt(cmd.source_frame ?? 0, 0, current - 1, 'source frame');
  const target = frameView(doc, sourceFrame).layers.find(l => l.id === cmd.layer);
  if (!target) throw new Error('Choose a layer to animate.');
  const pivotX = requireInt(cmd.pivot_x, 0, doc.width - 1, 'pivot x');
  const pivotY = requireInt(cmd.pivot_y, 0, doc.height - 1, 'pivot y');
  const degrees = Number(cmd.degrees ?? 6);
  if (typeof (cmd.degrees ?? 6) !== 'number' || !Number.isFinite(degrees) || degrees <= 0 || degrees > 30)
    throw new Error('Wind sway must be greater than 0 and at most 30 degrees.');
  const delay = requireInt(cmd.delay ?? 0, 0, count - 1, 'delay');
  if (!target.pixels.some(pixel => pixel & 255)) throw new Error('Choose a layer with visible pixels on the source frame.');
  const angles = Array.from({length:count}, (_, i) => windAngle(i, count, degrees, delay));
  const uniqueAngles = new Set(angles);
  // The rest pose is already in the project. Bound all new raster allocations before generating one.
  const area = doc.width * doc.height;
  if ((uniqueAngles.size - Number(uniqueAngles.has(0))) * area > MAX_BATCH_PIXEL_WORK)
    throw new Error('This loop has too many full-size poses to bake in one edit. Use fewer frames or a smaller canvas.');

  const layer = target.id;
  const commands:PaintCommand[] = [];
  for (let i = current; i < count; i++) commands.push({op:'frame_add', source_frame:sourceFrame});
  // Capture a rest frame before replacing the selected source frame, including a delayed source pose.
  const rest = angles.indexOf(0);
  if (rest !== sourceFrame) commands.push({op:'hold_cel', layer, frame:rest, source_frame:sourceFrame});
  // Release superseded poses first. A full project can reuse that space during the bake.
  for (let i = 0; i < current; i++) {
    if (i !== rest && frameView(doc, i).layers.find(l => l.id === layer)!.pixels !== target.pixels)
      commands.push({op:'hold_cel', layer, frame:i, source_frame:rest});
  }
  const firstAtAngle = new Map<number, number>([[0, rest]]);
  for (let i = 0; i < count; i++) {
    if (angles[i] === 0) continue;
    const angle = angles[i], first = firstAtAngle.get(angle);
    if (first !== undefined) {
      commands.push({op:'hold_cel', layer, frame:i, source_frame:first});
    } else {
      const pose = windPose(target.pixels, doc.width, doc.height, pivotX, pivotY, angle);
      commands.push({op:'paste', layer, frame:i, x:0, y:0, width:doc.width, height:doc.height, pixels:pose});
      firstAtAngle.set(angle, i);
    }
  }
  if (target.effect) commands.push({op:'effect_detach', layer});
  if (target.text) commands.push({op:'text_detach', layer});
  return commands;
}
