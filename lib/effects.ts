import {blankCel, CelBrush, CelInterner, cropCel, denseCel, type CroppedCel} from './cel-storage.ts';
import { celUses, color, frameCount, MAX_ANIMATION_CELLS, MAX_LAYERS, MAX_BATCH_PIXEL_WORK, PIXEL_EFFECT_KINDS, validateEffectRecipe, type StoredEffectRecipe, type PaintCommand, type PixelDocument } from './pixels.ts';

/** Ordered catalog shared by the editor, procedural renderer and MCP schema. */
export const EFFECT_KINDS = PIXEL_EFFECT_KINDS;
export type EffectKind = typeof EFFECT_KINDS[number];
export type EffectRecipe = { kind: EffectKind; seed: number; ink: string; speed?: number; opacity?: number; drift?: number };
export function normalizeEffectRecipe(recipe:EffectRecipe):StoredEffectRecipe {
  return validateEffectRecipe({...recipe,speed:recipe.speed??1,opacity:recipe.opacity??1,drift:recipe.drift??0});
}
export const EFFECT_GROUPS = ['Particles', 'Elemental', 'Weather', 'Magic'] as const;
type EffectGroup = typeof EFFECT_GROUPS[number];
export const EFFECT_PRESETS: Record<EffectKind, { label: string; group: EffectGroup; description: string; suggestedInk: string }> = {
  embers: { label: 'Embers', group: 'Particles', description: 'Glowing sparks drift upward, flickering as they rise.', suggestedInk: '#ff963d' },
  sparkles: { label: 'Sparkles', group: 'Particles', description: 'Twinkling points pulse into little four-point stars.', suggestedInk: '#ffe29b' },
  bubbles: { label: 'Bubbles', group: 'Particles', description: 'Outlined bubbles wobble and float upward.', suggestedInk: '#81d9f5' },
  leaves: { label: 'Falling leaves', group: 'Particles', description: 'Leaves flutter, rotate and fall in a gentle breeze.', suggestedInk: '#e7a052' },
  fire: { label: 'Fire', group: 'Elemental', description: 'Flickering flame tongues and rising sparks, rooted at the bottom.', suggestedInk: '#ff782d' },
  smoke: { label: 'Smoke', group: 'Elemental', description: 'Soft puffs billow upward and disperse.', suggestedInk: '#9ba1ae' },
  explosion: { label: 'Explosion', group: 'Elemental', description: 'A brief central flash throws fragments in all directions.', suggestedInk: '#ff9f42' },
  shockwave: { label: 'Shockwave', group: 'Elemental', description: 'An expanding circular energy ring fades outward.', suggestedInk: '#87ccff' },
  lightning: { label: 'Lightning', group: 'Elemental', description: 'Branching bolts flicker and re-strike along new paths.', suggestedInk: '#90baff' },
  rain: { label: 'Rain', group: 'Weather', description: 'Fast diagonal streaks fall across the canvas.', suggestedInk: '#80bdf6' },
  snow: { label: 'Snow', group: 'Weather', description: 'Snowflakes drift slowly downward and sway in the wind.', suggestedInk: '#e1efff' },
  arcane: { label: 'Arcane swirl', group: 'Magic', description: 'Glittering motes orbit the center in a luminous spiral.', suggestedInk: '#ba91ff' },
};

/** Keep the renderer and UI consistent about when another effect can fit. */
export function hasFreeEffectLayerSlot(d: PixelDocument | null | undefined): boolean {
  return Boolean(d && d.layers.length < MAX_LAYERS);
}

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

function wrap(n: number, size: number) {
  return ((n % size) + size) % size;
}
function tint(base: number, target: number, strength: number) {
  const channel = (shift: number) => Math.round(
    ((base >>> shift) & 255) * (1 - strength) + ((target >>> shift) & 255) * strength);
  return ((channel(24) << 24) | (channel(16) << 16) | (channel(8) << 8) | 255) >>> 0;
}

// All effect pixels live on conventional editable layers; each frame is recreated
// deterministically from the same seed and time index, without a cloud renderer.
function rawEffectCel(width:number,height:number,frame:number,count:number,recipe:EffectRecipe,charge:(area:number)=>void):CroppedCel {
  const { kind, seed } = recipe;
  if (!EFFECT_KINDS.includes(kind)) throw new Error('Unknown effect type.');
  const rgb = color(recipe.ink);
  const brush = new CelBrush(blankCel(),width,height);
  const finish = () => brush.finish(charge) ?? blankCel();
  const rand = randomFromSeed(seed);
  const bright = tint(rgb, 0xffffffff, .43);
  const dim = tint(rgb, 0x000000ff, .25);
  const size = Math.min(width, height), area = width * height;
  const cx = (width - 1) / 2, cy = (height - 1) / 2;
  const t = frame / count, tau = Math.PI * 2;
  const put = (x: number, y: number, alpha: number, radius = 0, shade = 0) => {
    const px = Math.round(x), py = Math.round(y);
    const a = Math.max(0, Math.min(255, Math.round(alpha)));
    if (a === 0) return;
    const ink = shade > 0 ? bright : shade < 0 ? dim : rgb;
    for (let oy = -radius; oy <= radius; oy++) for (let ox = -radius; ox <= radius; ox++) {
      const xx = px + ox, yy = py + oy;
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
      if (a >= (brush.read(xx,yy) & 255)) brush.write(xx,yy,rgba(ink,a));
    }
  };
  const stroke = (x0: number, y0: number, x1: number, y1: number, alpha: number, shade = 0) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let step = 0; step <= steps; step++) {
      const u = step / steps;
      put(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, alpha, 0, shade);
    }
  };

  if (kind === 'shockwave') {
    const maxRadius = Math.hypot(width, height) * .46;
    const r = maxRadius * (.1 + t * .95);
    const thickness = Math.max(.7, size / 70);
    const top=Math.max(0,Math.floor(cy-r-thickness)), bottom=Math.min(height-1,Math.ceil(cy+r+thickness));
    const left=Math.max(0,Math.floor(cx-r-thickness)), right=Math.min(width-1,Math.ceil(cx+r+thickness));
    for (let y=top; y<=bottom; y++) for (let x=left; x<=right; x++) {
      const dist = Math.hypot((x + .5 - width / 2), (y + .5 - height / 2));
      if (Math.abs(dist - r) < thickness) put(x, y, 220 * (1 - t));
    }
    return finish();
  }

  if (kind === 'fire') {
    const tongues = Math.min(30, Math.max(7, Math.round(width / 2.5)));
    for (let i = 0; i < tongues; i++) {
      const rootX = cx + (rand() - .5) * width * .44;
      const length = Math.max(2, Math.round(height * (.12 + rand() * .31)));
      const phase = rand() * tau, bend = (rand() - .5) * .8;
      for (let j = 0; j <= length; j++) {
        const fade = 1 - j / (length + 1);
        const x = rootX + Math.sin(frame * .76 + phase + j * .23) * (1 + j * .055) + bend * j * .12;
        const flicker = .76 + .24 * Math.sin(frame * .9 + phase + j * .14);
        const radius = Math.max(0, Math.round(fade * (size >= 48 ? 2 : size >= 20 ? 1 : 0)));
        put(x, height - 1 - j, (75 + 165 * fade) * flicker, radius, fade > .72 ? 1 : 0);
      }
      if (i % 3 === 0) {
        const y = height - 1 - length - (frame * (1.4 + rand()) + rand() * 8) % Math.max(2, height * .35);
        put(rootX + Math.sin(frame + phase) * 2, y, 115 + 70 * Math.sin(frame + phase) ** 2);
      }
    }
    return finish();
  }

  if (kind === 'smoke') {
    const puffs = Math.min(30, Math.max(8, Math.round(size / 1.7)));
    for (let i = 0; i < puffs; i++) {
      const phase = rand() * count, age = wrap(frame + phase, count) / count;
      const drift = (rand() - .5) * .2;
      const x = cx + Math.sin((frame + phase) * .35) * width * .09 + drift * width * age;
      const y = height - 1 - age * Math.max(1, height * .95);
      const radius = Math.max(1, Math.round(1 + age * Math.min(size / 7, 8)));
      const opacity = (142 - age * 100) * (.8 + rand() * .4);
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const dist = Math.hypot(dx, dy);
        if (dist <= radius + .25) {
          const softness = .22 + .78 * Math.max(0, 1 - dist / (radius + .5));
          put(x + dx, y + dy, opacity * softness, 0, dist > radius * .7 ? -1 : 0);
        }
      }
    }
    return finish();
  }

  if (kind === 'explosion') {
    const life = frame / Math.max(1, count - 1);
    const strength = Math.pow(1 - life, .8);
    const core = Math.max(0, Math.round(size * (.045 + .17 * life) * (1 - life)));
    if (life < .65) {
      for (let dy = -core; dy <= core; dy++) for (let dx = -core; dx <= core; dx++) {
        if (Math.hypot(dx, dy) <= core + .25) put(cx + dx, cy + dy, 245 * (1 - life), 0, 1);
      }
    }
    const fragments = Math.min(115, Math.max(24, Math.round(area / 75)));
    for (let i = 0; i < fragments; i++) {
      const angle = rand() * tau, velocity = (.16 + rand() * .48) * size;
      const dist = life * velocity, jitter = (rand() - .5) * 2;
      const x = cx + Math.cos(angle) * dist + jitter * life;
      const y = cy + Math.sin(angle) * dist + jitter * life;
      const alpha = (120 + 135 * rand()) * strength;
      put(x, y, alpha, life < .28 && size >= 32 && rand() > .85 ? 1 : 0, rand() > .78 ? 1 : 0);
      if (life > .12) put(x - Math.cos(angle) * Math.min(3, dist * .3),
        y - Math.sin(angle) * Math.min(3, dist * .3), alpha * .35);
    }
    return finish();
  }

  if (kind === 'lightning') {
    const pulse = frame % 4;
    if (pulse === 3) return finish(); // a brief dark frame between strikes
    const bolt = randomFromSeed(seed ^ Math.imul(Math.floor(frame / 4) + 1, 0x9e3779b1));
    const intensity = pulse === 0 ? 255 : pulse === 1 ? 185 : 75;
    const segments = Math.max(3, Math.min(24, Math.ceil(height / 3)));
    let x = cx + (bolt() - .5) * width * .28, y = 0;
    for (let i = 0; i < segments; i++) {
      const nextY = (i + 1) * (height - 1) / segments;
      const nextX = Math.max(0, Math.min(width - 1, x + (bolt() - .5) * width * .23));
      stroke(x, y, nextX, nextY, intensity, 1);
      if (bolt() > .65 && i < segments - 1) {
        const branchX = Math.max(0, Math.min(width - 1, nextX + (bolt() - .5) * width * .4));
        const branchY = Math.min(height - 1, nextY + Math.max(2, height / 6));
        stroke(nextX, nextY, branchX, branchY, intensity * .48);
      }
      x = nextX; y = nextY;
    }
    return finish();
  }

  if (kind === 'rain') {
    const drops = Math.min(140, Math.max(8, Math.round(area / 95)));
    for (let i = 0; i < drops; i++) {
      const x0 = rand() * width, y0 = rand() * height;
      const speed = Math.max(.7, height * (.075 + rand() * .08));
      const wind = .25 + rand() * .7;
      const length = Math.max(1, Math.min(5, Math.round(height / 13)));
      const x = wrap(x0 + frame * wind, width), y = wrap(y0 + frame * speed, height);
      for (let j = 0; j <= length; j++) {
        put(wrap(x - j * .45, width), wrap(y - j, height),
          j === 0 ? 210 : 150 * (1 - j / (length + 1)), 0, j === 0 ? 1 : 0);
      }
    }
    return finish();
  }

  if (kind === 'snow') {
    const flakes = Math.min(100, Math.max(6, Math.round(area / 240)));
    for (let i = 0; i < flakes; i++) {
      const x0 = rand() * width, y0 = rand() * height;
      const phase = rand() * tau, speed = .25 + rand() * Math.max(.5, height / 35);
      const sway = .7 + rand() * 2.3;
      const x = wrap(x0 + Math.sin(frame * .4 + phase) * sway + frame * .12, width);
      const y = wrap(y0 + frame * speed, height);
      const alpha = 155 + 90 * rand();
      put(x, y, alpha, rand() > .89 && size >= 24 ? 1 : 0, 1);
    }
    return finish();
  }

  if (kind === 'bubbles') {
    const bubbles = Math.min(46, Math.max(5, Math.round(area / 310)));
    for (let i = 0; i < bubbles; i++) {
      const x0 = rand() * width, y0 = rand() * height;
      const phase = rand() * tau, speed = .45 + rand() * Math.max(.7, height / 20);
      const radius = Math.max(1, Math.round(1 + rand() * Math.min(3, size / 13)));
      const x = wrap(x0 + Math.sin(frame * .45 + phase) * (1 + radius * .35), width);
      const y = wrap(y0 - frame * speed, height);
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        if (Math.abs(Math.hypot(dx, dy) - radius) < .72) put(x + dx, y + dy, 140, 0);
      }
      put(x - radius * .38, y - radius * .45, 245, 0, 1);
    }
    return finish();
  }

  if (kind === 'leaves') {
    const leaves = Math.min(48, Math.max(6, Math.round(area / 270)));
    for (let i = 0; i < leaves; i++) {
      const x0 = rand() * width, y0 = rand() * height;
      const phase = rand() * tau, sway = 1 + rand() * 3;
      const speed = .45 + rand() * Math.max(.75, height / 24);
      const x = wrap(x0 + Math.sin(frame * .48 + phase) * sway + frame * .18, width);
      const y = wrap(y0 + frame * speed, height);
      const slant = Math.sin(frame * .65 + phase) >= 0 ? 1 : -1;
      put(x, y, 210, 0);
      put(x + slant, y, 185, 0, 1);
      put(x - slant, y + 1, 125);
      if (size >= 32) put(x + slant, y - 1, 105);
    }
    return finish();
  }

  if (kind === 'arcane') {
    const motes = Math.min(75, Math.max(14, Math.round(area / 105)));
    for (let i = 0; i < motes; i++) {
      const offset = rand() * tau, ring = .13 + rand() * .3;
      const speed = (.16 + rand() * .4) * (rand() > .5 ? 1 : -1);
      const angle = offset + frame * speed + ring * 6;
      const radius = ring * size * (.85 + .15 * Math.sin(frame * .35 + offset));
      const x = cx + Math.cos(angle) * radius, y = cy + Math.sin(angle) * radius * .78;
      const pulse = .45 + .55 * Math.sin(frame * .67 + offset) ** 2;
      const alpha = 110 + 145 * pulse;
      put(x, y, alpha, 0, pulse > .88 ? 1 : 0);
      if (pulse > .9 && size >= 16) {
        put(x - 1, y, 90); put(x + 1, y, 90);
        put(x, y - 1, 90); put(x, y + 1, 90);
      }
    }
    return finish();
  }

  // Preserve the original familiar ember and sparkle motion.
  const amount = Math.min(64, Math.max(6, Math.round(area / (kind === 'embers' ? 240 : 340))));
  for (let i = 0; i < amount; i++) {
    const x0 = rand() * width, y0 = rand() * height;
    const speed = .35 + rand() * 1.15, phase = rand() * count;
    const dx = (rand() - .5) * .65, wobble = rand() * 1.8;
    const radius = rand() > .9 && width >= 32 && height >= 32 ? 1 : 0;
    if (kind === 'embers') {
      const y = wrap(y0 - (frame + phase) * speed * 1.8, height);
      const x = x0 + Math.sin(frame * .6 + phase) * wobble + frame * dx;
      const alpha = 85 + 165 * Math.abs(Math.sin((frame + phase) * .35));
      put(x, y, alpha, radius);
    } else {
      const pulse = Math.pow(Math.max(0, Math.sin((frame + phase) * Math.PI * 2 / count)), 3);
      if (pulse > .08) {
        const x = x0 + frame * dx * .25, y = y0 + Math.sin(frame * .25 + phase) * wobble;
        put(x, y, Math.round(255 * pulse), radius);
        if (pulse > .8 && width >= 16 && height >= 16) {
          put(x - 2, y, 105 * pulse); put(x + 2, y, 105 * pulse);
          put(x, y - 2, 105 * pulse); put(x, y + 2, 105 * pulse);
        }
      }
    }
  }
  return finish();
}

/** Re-render a recipe using its saved speed, opacity and horizontal drift.
 * Default values produce the original exact pixels for backward compatibility.
 */
export function effectCel(width:number,height:number,frame:number,count:number,recipe:StoredEffectRecipe,charge:(area:number)=>void=()=>{}):CroppedCel {
  const base=rawEffectCel(width,height,frame*recipe.speed,count,recipe,charge);
  const shift=Math.round(recipe.drift*frame);
  if(!base.width || (!shift&&recipe.opacity===1))return base;
  const left=Math.max(0,base.x+shift),right=Math.min(width,base.x+shift+base.width);
  if(right<=left)return blankCel();
  const outWidth=right-left, data=new Array<number>(outWidth*base.height);
  for(let y=0;y<base.height;y++)for(let x=0;x<outWidth;x++){
    const packed=base.data[y*base.width+x+left-base.x-shift];
    const alpha=Math.round((packed&255)*recipe.opacity);
    data[y*outWidth+x]=alpha ? ((packed&0xffffff00)|alpha)>>>0 : 0;
  }
  return cropCel({x:left,y:base.y,width:outWidth,height:base.height,data},width,height);
}

export function effectPixels(width:number,height:number,frame:number,count:number,recipe:EffectRecipe):number[] {
  return denseCel(effectCel(width,height,frame,count,normalizeEffectRecipe(recipe)),width,height);
}

export function effectCapacity(d:PixelDocument) {
  if(!hasFreeEffectLayerSlot(d))return {frames:0,reason:`The effect needs a free layer. All ${MAX_LAYERS} slots are occupied.`};
  return {frames:frameCount(d)===1?8:frameCount(d),reason:''};
}

class EffectCapacityError extends Error {}

function effectDrawingCommands(d:PixelDocument,layer:string,count:number,recipe:StoredEffectRecipe,held?:CelInterner<CroppedCel>):PaintCommand[]{
  const commands:PaintCommand[]=[];
  let work=0;
  const charge=(area:number)=>{
    work+=area;
    if(work>MAX_BATCH_PIXEL_WORK)throw new EffectCapacityError('These effect drawings are too large to generate in one edit. Reduce the frame count or canvas size.');
  };
  for(let frame=0;frame<count;frame++){
    const pose=effectCel(d.width,d.height,frame,count,recipe,charge);
    if(held){
      held.intern(pose);
      if(held.cells+(d.reference?.pixels.length??0)>MAX_ANIMATION_CELLS)
        throw new EffectCapacityError('These effect drawings exceed the available project pixels. Reduce the frame count or trim existing artwork.');
    }
    commands.push({op:'replace_cel',layer,frame,x:pose.x,y:pose.y,width:pose.width,height:pose.height,pixels:pose.data});
  }
  return commands;
}

// Return ordinary paint commands so browser edits, undo, and MCP use one engine.
export function generateEffectCommands(d: PixelDocument, recipe: EffectRecipe): PaintCommand[] {
  const full=normalizeEffectRecipe(recipe), currentFrames=frameCount(d);
  const {frames,reason}=effectCapacity(d);
  if(reason)throw new Error(reason);
  const layer='fx-'+crypto.randomUUID().slice(0,8);
  const existing=[...celUses(d).keys()].map(cel=>Array.isArray(cel)?cropCel(cel,d.width,d.height):cel);
  for(let count=frames;;count--){
    const held=new CelInterner<CroppedCel>();
    for(const cel of existing)held.intern(cel);
    try{
      const drawings=effectDrawingCommands(d,layer,count,full,held);
      const commands:PaintCommand[]=[{op:'add_layer',id:layer,name:EFFECT_PRESETS[recipe.kind].label+' FX'}];
      for(let i=currentFrames;i<count;i++)commands.push({op:'frame_add',source_frame:0});
      return [...commands,...drawings,{op:'effect_recipe',layer,recipe:full}];
    }catch(error){
      if(!(error instanceof EffectCapacityError)||currentFrames>1||count<=2)throw error;
    }
  }
}

/** Regeneration updates only the designated FX layer, preserving the whole document,
 * other layers, frame count, edit history and any named clips.
 * Manually painted pixels inside the selected effect layer are replaced on regenerate.
 */
export function regenerateEffectCommands(d:PixelDocument,layer:string,recipe:EffectRecipe):PaintCommand[]{
 const target=d.layers.find(l=>l.id===layer);
 if(!target?.effect)throw new Error('Choose a generated effect layer to regenerate.');
 const full=normalizeEffectRecipe(recipe),count=frameCount(d);
 const ops:PaintCommand[]=[{op:'rename_layer',layer,name:EFFECT_PRESETS[full.kind].label+' FX'}];
 // Some old poses can be held into later frames. Release every slot before
 // installing replacements so the peak budget matches the final artwork.
 for(let frame=0;frame<count;frame++)ops.push({op:'clear',layer,frame});
 ops.push(...effectDrawingCommands(d,layer,count,full));
 ops.push({op:'effect_recipe',layer,recipe:full});
 return ops;
}
