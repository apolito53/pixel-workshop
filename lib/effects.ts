import { color, frameCount, MAX_ANIMATION_CELLS, type PaintCommand, type PixelDocument } from './pixels.ts';

export type EffectKind = 'embers' | 'sparkles' | 'shockwave';
export const EFFECT_KINDS: EffectKind[] = ['embers', 'sparkles', 'shockwave'];
export type EffectRecipe = { kind: EffectKind; seed: number; ink: string };

function randomFromSeed(seed: number) {
  let state = (seed | 0) || 1;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}
function rgba(ink: number, alpha: number) {
  return ((ink & 0xffffff00) | Math.max(0, Math.min(255, Math.round(alpha)))) >>> 0;
}

// All effect pixels live on their own conventional editable layer; no cloud renderer.
export function effectPixels(width: number, height: number, frame: number, count: number, recipe: EffectRecipe): number[] {
  const { kind, seed } = recipe;
  const rgb = color(recipe.ink);
  const output = Array<number>(width * height).fill(0);
  const rand = randomFromSeed(seed);
  const put = (x: number, y: number, alpha: number, radius = 0) => {
    const cx = Math.round(x), cy = Math.round(y);
    for (let py = cy-radius; py <= cy+radius; py++)
      for (let px = cx-radius; px <= cx+radius; px++)
        if (px >= 0 && py >= 0 && px < width && py < height)
          output[py * width + px] = rgba(rgb, Math.max(alpha, output[py * width + px] & 255));
  };
  const t = frame / count;
  if (kind === 'shockwave') {
    const maxRadius = Math.hypot(width, height) * 0.46;
    const r = maxRadius * (0.1 + t * 0.95);
    const thickness = Math.max(0.7, Math.min(width,height)/70);
    for (let y = 0; y < height; y++)for (let x = 0; x < width; x++) {
      const dist = Math.hypot((x + .5-width/2), (y + .5-height/2));
      if (Math.abs(dist-r) < thickness)
        put(x, y, 220 * (1 - t));
    }
    return output;
  }
  const amount = Math.min(64, Math.max(6, Math.round(width * height / (kind === 'embers' ? 240 : 340))));
  for (let i = 0; i < amount; i++) {
    const x0 = rand() * width, y0 = rand() * height;
    const speed = 0.35 + rand() * 1.15, phase = rand() * count;
    const dx = (rand() - .5) * 0.65, wobble = rand() * 1.8;
    const radius = rand() > .9 && width >= 32 && height >= 32 ? 1 : 0;
    if (kind === 'embers') {
      const y = ((y0 - (frame + phase) * speed * 1.8) % height + height) % height;
      const x = x0 + Math.sin(frame * .6 + phase) * wobble + frame * dx;
      const alpha = 85 + 165 * Math.abs(Math.sin((frame + phase) * .35));
      put(x,y,alpha,radius);
    } else {
      const pulse = Math.pow(Math.max(0, Math.sin((frame + phase) * Math.PI * 2 / count)), 3);
      if (pulse > .08) {
        const x = x0 + frame * dx * .25, y = y0 + Math.sin(frame * .25 + phase) * wobble;
        put(x,y,Math.round(255*pulse),radius);
        if (pulse > .8 && width >= 16 && height >= 16) {
          put(x - 2,y,105*pulse);put(x+2,y,105*pulse);
          put(x,y-2,105*pulse);put(x,y+2,105*pulse);
        }
      }
    }
  }
  return output;
}

// Return ordinary paint commands so browser edits, undo, and MCP use one engine.
export function generateEffectCommands(d: PixelDocument, recipe: EffectRecipe): PaintCommand[] {
  if (!EFFECT_KINDS.includes(recipe.kind)) throw new Error('Unknown effect type.');
  if (!Number.isInteger(recipe.seed) || recipe.seed < 0 || recipe.seed > 2147483647)
    throw new Error('Effect seed must be an integer between 0 and 2147483647.');
  color(recipe.ink);
  if (d.layers.length >= 8) throw new Error('The effect needs a free layer (maximum eight).');
  const area = d.width * d.height, currentFrames = frameCount(d);
  const capacity = Math.min(8, Math.floor(MAX_ANIMATION_CELLS / (area * (d.layers.length + 1))),
    Math.floor(1_800_000 / (area * (d.layers.length + 3))));
  const totalFrames = currentFrames === 1 ? capacity : currentFrames;
  if (totalFrames < 2 || totalFrames > 32 ||
    totalFrames * (d.layers.length+1) * area > MAX_ANIMATION_CELLS ||
    area * (totalFrames * 3 + (totalFrames-currentFrames) * (d.layers.length+1)) > 1_950_000)
    throw new Error('This animation is too large for a new effect. Use fewer frames or layers.');
  const layer = 'fx-' + crypto.randomUUID().slice(0,8);
  const commands: PaintCommand[] = [{op:'add_layer',id:layer,name:recipe.kind[0].toUpperCase()+recipe.kind.slice(1)+' FX'}];
  for (let i = currentFrames; i < totalFrames; i++)
    commands.push({op:'frame_add',source_frame:0});
  for (let i = 0; i < totalFrames; i++)
    commands.push({op:'paste',frame:i,layer,x:0,y:0,width:d.width,height:d.height,
      pixels:effectPixels(d.width,d.height,i,totalFrames,recipe)});
  return commands;
}
