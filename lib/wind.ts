import {blankCel, cropCel, denseCel, type Cel, type CroppedCel} from './cel-storage.ts';
import {frameCount, frameView, MAX_ANIMATION_FRAMES, MAX_BATCH_PIXEL_WORK, requireInt, type PaintCommand, type PixelDocument} from './pixels.ts';

export function windAngle(frame:number, frames:number, degrees:number, delay:number) {
  // Quantize numerical noise so mirrored phases share the exact same pose.
  return Math.round(Math.sin(2 * Math.PI * (frame - delay) / frames) * degrees * 10000) / 10000 || 0;
}

/** Rotate the outside edges of the stored pixels so every nearest-neighbor sample is covered. */
function rotatedBounds(source:CroppedCel, width:number, height:number, pivotX:number, pivotY:number, cos:number, sin:number) {
  let left=width, top=height, right=-1, bottom=-1;
  for(const x of [source.x-.5, source.x+source.width-.5]) {
    for(const y of [source.y-.5, source.y+source.height-.5]) {
      const dx=x-pivotX, dy=y-pivotY;
      const xx=pivotX+dx*cos-dy*sin, yy=pivotY+dx*sin+dy*cos;
      left=Math.min(left,xx); right=Math.max(right,xx);
      top=Math.min(top,yy); bottom=Math.max(bottom,yy);
    }
  }
  const x=Math.max(0,Math.floor(left)), y=Math.max(0,Math.floor(top));
  return {x,y,width:Math.max(0,Math.min(width,Math.ceil(right)+1)-x),
    height:Math.max(0,Math.min(height,Math.ceil(bottom)+1)-y)};
}

function rotateCrop(source:CroppedCel,width:number,height:number,pivotX:number,pivotY:number,degrees:number,
  reserve?:(cells:number)=>void):CroppedCel {
  if(!degrees||!source.width)return source;
  const radians=degrees*Math.PI/180, cos=Math.cos(radians), sin=Math.sin(radians);
  const box=rotatedBounds(source,width,height,pivotX,pivotY,cos,sin);
  reserve?.(box.width*box.height);
  if(!box.width||!box.height)return blankCel();
  const data=new Array<number>(box.width*box.height);
  for(let y=0;y<box.height;y++){
    const dy=box.y+y-pivotY;
    for(let x=0;x<box.width;x++){
      const dx=box.x+x-pivotX;
      const sx=Math.round(pivotX+dx*cos+dy*sin)-source.x;
      const sy=Math.round(pivotY-dx*sin+dy*cos)-source.y;
      data[y*box.width+x]=sx>=0&&sx<source.width&&sy>=0&&sy<source.height ? source.data[sy*source.width+sx] : 0;
    }
  }
  return cropCel({...box,data},width,height);
}

export function windPoseCel(source:Cel,width:number,height:number,pivotX:number,pivotY:number,degrees:number) {
  return rotateCrop(cropCel(source,width,height),width,height,pivotX,pivotY,degrees);
}

export function windPose(source:Cel,width:number,height:number,pivotX:number,pivotY:number,degrees:number) {
  return degrees===0 ? denseCel(source,width,height) : denseCel(windPoseCel(source,width,height,pivotX,pivotY,degrees),width,height);
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
  const source = cropCel(target.pixels, doc.width, doc.height);
  if (!source.data.some(pixel => pixel & 255)) throw new Error('Choose a layer with visible pixels on the source frame.');
  const angles = Array.from({length:count}, (_, i) => windAngle(i, count, degrees, delay));
  let poseWork=0;
  const reserve=(area:number)=>{
    poseWork+=area;
    if(poseWork>MAX_BATCH_PIXEL_WORK)throw new Error('These wind poses are too large to bake in one edit. Reduce the source drawing bounds or the frame count.');
  };
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
      const pose = rotateCrop(source, doc.width, doc.height, pivotX, pivotY, angle, reserve);
      commands.push({op:'replace_cel', layer, frame:i, x:pose.x, y:pose.y, width:pose.width, height:pose.height, pixels:pose.data});
      firstAtAngle.set(angle, i);
    }
  }
  if (target.effect) commands.push({op:'effect_detach', layer});
  if (target.text) commands.push({op:'text_detach', layer});
  return commands;
}
