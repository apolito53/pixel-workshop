/** Pointer-event geometry shared by touch navigation and regression tests. */
export type GesturePoint = { x: number; y: number };
export type GestureSize = { width: number; height: number };
export type GestureViewport = GestureSize & { center: GesturePoint };
export type PinchStart = { zoom: number; distance: number; anchor: GesturePoint };
export type PinchView = { scale: number; midpoint: GesturePoint; pan: GesturePoint };

export const MIN_CANVAS_ZOOM = 1;
export const MAX_CANVAS_ZOOM = 24;

export function touchMidpoint(a: GesturePoint, b: GesturePoint): GesturePoint {
  return { x: (a.x + b.x)/2, y: (a.y + b.y)/2 };
}

export function touchDistance(a: GesturePoint, b: GesturePoint) {
  return Math.hypot(b.x-a.x,b.y-a.y);
}

const clamp = (n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));

/**
 * Capture the canvas pixel under the fingers. The mobile canvas is centered
 * inside the viewport with a CSS translation, so panning works even when
 * the entire image fits within the viewport (no scrollbars required).
 */
export function beginPinch(
  a: GesturePoint,b: GesturePoint, viewport: GestureViewport,
  canvas: GestureSize,zoom: number,pan: GesturePoint
): PinchStart {
  const mid=touchMidpoint(a,b);
  return {
    zoom,
    distance:Math.max(12,touchDistance(a,b)),
    anchor:{
      x:canvas.width/2+(mid.x-viewport.center.x-pan.x)/zoom,
      y:canvas.height/2+(mid.y-viewport.center.y-pan.y)/zoom
    }
  };
}

function keepSomeCanvasVisible(pan:GesturePoint,viewport:GestureViewport,canvas:GestureSize,scale:number):GesturePoint {
  const width=canvas.width*scale,height=canvas.height*scale;
  const minVisibleX=Math.min(width/2,28),minVisibleY=Math.min(height/2,28);
  const maxX=Math.max(0,(viewport.width+width)/2-minVisibleX);
  const maxY=Math.max(0,(viewport.height+height)/2-minVisibleY);
  return {x:clamp(pan.x,-maxX,maxX),y:clamp(pan.y,-maxY,maxY)};
}

function anchorPan(anchor:GesturePoint,mid:GesturePoint,viewport:GestureViewport,canvas:GestureSize,zoom:number):GesturePoint {
  return keepSomeCanvasVisible({
    x:mid.x-viewport.center.x-(anchor.x-canvas.width/2)*zoom,
    y:mid.y-viewport.center.y-(anchor.y-canvas.height/2)*zoom
  },viewport,canvas,zoom);
}

/** Continuous CSS-only zoom while the gesture is active; raster pixels stay crisp. */
export function movePinch(start:PinchStart,a:GesturePoint,b:GesturePoint,
  viewport:GestureViewport,canvas:GestureSize):PinchView {
  const midpoint=touchMidpoint(a,b);
  const scale=clamp(touchDistance(a,b)/start.distance,
    MIN_CANVAS_ZOOM/start.zoom,MAX_CANVAS_ZOOM/start.zoom);
  return {scale,midpoint,pan:anchorPan(start.anchor,midpoint,viewport,canvas,start.zoom*scale)};
}

/** Snap back to exact pixel-grid zoom when the last gesture finger lifts. */
export function finishPinch(start:PinchStart,last:PinchView,viewport:GestureViewport,canvas:GestureSize) {
  const zoom=clamp(Math.round(start.zoom*last.scale),MIN_CANVAS_ZOOM,MAX_CANVAS_ZOOM);
  return {zoom,pan:anchorPan(start.anchor,last.midpoint,viewport,canvas,zoom)};
}
