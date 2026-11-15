export const MAX_CANVAS_SIDE = 1024;
export const MAX_SOURCE_SIDE = 4096;
export const MAX_SOURCE_PIXELS = 4_194_304;
export const MAX_REFERENCE_PNG_BYTES = 8_000_000;

/** Fit both axes with one scale, then round once to whole pixel cells. */
export function fitCanvasDimensions(width:number,height:number,maxWidth=MAX_CANVAS_SIDE) {
  const scale = Math.min(maxWidth / width, MAX_CANVAS_SIDE / height);
  return {width:Math.max(1,Math.round(width*scale)), height:Math.max(1,Math.round(height*scale))};
}
