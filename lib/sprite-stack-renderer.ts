import { celRect, type Cel } from './cel-storage.ts';
import { frameCount, type PixelDocument } from './pixels.ts';
import { rgbaOver } from './rgba-over.ts';
import { stackDefaults, type StackView } from './stack-domain.ts';

export const DEFAULT_STACK_VIEW: Readonly<StackView> = { yaw: 28, pitch: 20, zoom: 1, spread: 0 };
export type StackRenderOptions = Partial<StackView> & { width?: number; height?: number };
export type StackHit = { sliceIndex: number; frameIndex: number; frameId: string | null; x: number; y: number; layerId: string };
export type StackRenderFrame = {
  width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer>;
  pick(x: number, y: number): StackHit | null;
};

function ranged(value: number, min: number, max: number, label: string) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Stack ${label} must be between ${min} and ${max}.`);
  return value;
}
export function resolveStackView(doc: PixelDocument, options: Partial<StackView> = {}): StackView {
  const saved = doc.stack?.view ?? DEFAULT_STACK_VIEW;
  const yaw = options.yaw ?? saved.yaw;
  if (!Number.isFinite(yaw)) throw new Error('Stack yaw must be finite.');
  return { yaw: (yaw % 360 + 360) % 360, pitch: ranged(options.pitch ?? saved.pitch, -90, 90, 'pitch'),
    zoom: ranged(options.zoom ?? saved.zoom, .1, 8, 'zoom'), spread: ranged(options.spread ?? saved.spread, 0, 1, 'spread') };
}

// Every occupied 8×8 tile carries exact source colors and ownership. Held cels,
// disjoint upper layers and repeated layer combinations share the same tiles.
const SHIFT = 3, EDGE = 1 << SHIFT, MASK = EDGE - 1, TILE_AREA = EDGE * EDGE;
type Tile = { colors: Uint32Array; owners: number | Uint8Array; opaque: boolean };
type RawTile = { colors: Uint32Array; opaque: boolean };
// A slice can hold a whole lower layer and alter just one tile. Copy only the
// 64-entry tile page that contains the change, even across hundreds of slices.
const PAGE_SHIFT = 6, PAGE_SIZE = 1 << PAGE_SHIFT, PAGE_MASK = PAGE_SIZE - 1;
type TilePage = (Tile | undefined)[];
type Plane = { pages: (TilePage | undefined)[]; left: number; right: number; top: number; bottom: number };
type CelKey = { next: WeakMap<Cel, CelKey>; plane?: Plane };

class TileStore {
  width: number;
  height: number;
  columns: number;
  private raw = new WeakMap<Cel, Map<number, RawTile>>();
  private materials: WeakMap<RawTile, Tile>[] = [];
  private blended = new WeakMap<Tile, WeakMap<Tile, Tile>>();
  private combinations: CelKey;

  constructor(width: number, height: number) {
    this.width = width; this.height = height; this.columns = Math.ceil(width / EDGE);
    this.combinations = { next: new WeakMap(), plane: { pages: [], left: width, right: 0, top: height, bottom: 0 } };
  }

  private readCel(cel: Cel) {
    const existing = this.raw.get(cel);
    if (existing) return existing;
    const result = new Map<number, RawTile>();
    const rect = celRect(cel, this.width, this.height);
    const endX = rect.x + rect.width, endY = rect.y + rect.height;
    for (let by = rect.y >> SHIFT; by * EDGE < endY; by++) {
      for (let bx = rect.x >> SHIFT; bx * EDGE < endX; bx++) {
        let colors: Uint32Array | undefined, opaque = 0;
        const x0 = Math.max(rect.x, bx * EDGE), x1 = Math.min(endX, (bx + 1) * EDGE);
        const y0 = Math.max(rect.y, by * EDGE), y1 = Math.min(endY, (by + 1) * EDGE);
        for (let y = y0; y < y1; y++) {
          let offset = (y - rect.y) * rect.width + x0 - rect.x;
          for (let x = x0; x < x1; x++, offset++) {
            const color = rect.data[offset] >>> 0;
            if (!(color & 255)) continue;
            colors ??= new Uint32Array(TILE_AREA);
            colors[(y & MASK) * EDGE + (x & MASK)] = color;
            if ((color & 255) === 255) opaque++;
          }
        }
        if (colors) result.set(by * this.columns + bx, { colors, opaque: opaque === TILE_AREA });
      }
    }
    this.raw.set(cel, result);
    return result;
  }

  private material(raw: RawTile, layer: number) {
    const cache = this.materials[layer] ??= new WeakMap();
    let tile = cache.get(raw);
    if (!tile) { tile = { ...raw, owners: layer }; cache.set(raw, tile); }
    return tile;
  }

  private overlay(bottom: Tile, source: Tile) {
    if (source.opaque) return source;
    let cache = this.blended.get(bottom);
    if (!cache) { cache = new WeakMap(); this.blended.set(bottom, cache); }
    const previous = cache.get(source);
    if (previous) return previous;
    const colors = new Uint32Array(TILE_AREA), owners = new Uint8Array(TILE_AREA);
    let opaque = true;
    for (let i = 0; i < TILE_AREA; i++) {
      colors[i] = rgbaOver(bottom.colors[i], source.colors[i]);
      if ((colors[i] & 255) !== 255) opaque = false;
      const owner = (source.colors[i] & 255) ? source.owners : bottom.owners;
      owners[i] = typeof owner === 'number' ? owner : owner[i];
    }
    const tile = { colors, owners, opaque };
    cache.set(source, tile);
    return tile;
  }

  private addLayer(base: Plane, cel: Cel, layer: number): Plane {
    const ink = this.readCel(cel);
    if (!ink.size) return base;
    const pages = base.pages.slice();
    let { left, right, top, bottom } = base;
    for (const [index, raw] of ink) {
      const group = index >> PAGE_SHIFT, at = index & PAGE_MASK;
      if (pages[group] === base.pages[group]) pages[group] = base.pages[group]?.slice() ?? [];
      const page = pages[group]!, source = this.material(raw, layer), under = page[at];
      page[at] = under ? this.overlay(under, source) : source;
      const x = (index % this.columns) * EDGE, y = Math.floor(index / this.columns) * EDGE;
      left = Math.min(left, x); right = Math.max(right, Math.min(this.width, x + EDGE));
      top = Math.min(top, y); bottom = Math.max(bottom, Math.min(this.height, y + EDGE));
    }
    return { pages, left, right, top, bottom };
  }

  plane(cels: Cel[]): Plane {
    let key = this.combinations;
    for (let layer = 0; layer < cels.length; layer++) {
      const cel = cels[layer];
      let next = key.next.get(cel);
      if (!next) {
        next = { next: new WeakMap(), plane: this.addLayer(key.plane!, cel, layer) };
        key.next.set(cel, next);
      }
      key = next;
    }
    return key.plane!;
  }
}

class StackVolume {
  store: TileStore;
  depth: number;
  blockArea: number;
  blocks: Uint8Array;
  planes: Plane[] = [];
  layerIds: string[] = [];
  frameIds: (string | null)[] = [];
  bounds = [0, 0, 0, 0, 0, 0];

  constructor(store: TileStore, depth: number) {
    this.store = store; this.depth = depth;
    this.blockArea = store.columns * Math.ceil(store.height / EDGE);
    this.blocks = new Uint8Array(this.blockArea * Math.ceil(depth / EDGE));
  }

  sync(doc: PixelDocument) {
    const layers = doc.layers.filter(layer => layer.visible);
    this.layerIds = layers.map(layer => layer.id);
    this.frameIds = [null, ...(doc.animation?.frames.map(frame => frame.id) ?? [])];
    let x0 = this.store.width, y0 = this.store.height, z0 = this.depth, x1 = 0, y1 = 0, z1 = 0;
    for (let z = 0; z < this.depth; z++) {
      const pixels = z ? doc.animation!.frames[z - 1].pixels : null;
      const plane = this.store.plane(layers.map(layer => pixels ? pixels[layer.id] : layer.pixels));
      const old = this.planes[z];
      if (old !== plane) {
        const base = (z >> SHIFT) * this.blockArea;
        const groups = Math.max(old?.pages.length ?? 0, plane.pages.length);
        for (let g = 0; g < groups; g++) {
          const before = old?.pages[g], after = plane.pages[g];
          if (before === after) continue;
          const length = Math.max(before?.length ?? 0, after?.length ?? 0);
          for (let k = 0; k < length; k++) {
            const difference = Number(Boolean(after?.[k])) - Number(Boolean(before?.[k]));
            this.blocks[base + (g << PAGE_SHIFT) + k] += difference;
          }
        }
        this.planes[z] = plane;
      }
      if (plane.pages.length) {
        x0 = Math.min(x0, plane.left); y0 = Math.min(y0, plane.top); z0 = Math.min(z0, z);
        x1 = Math.max(x1, plane.right); y1 = Math.max(y1, plane.bottom); z1 = z + 1;
      }
    }
    this.bounds = [x0, x1, y0, y1, z0, z1];
  }
}

function imageSize(value: number) {
  if (!Number.isInteger(value)) throw new Error('Stack preview dimensions must be integers.');
  return ranged(value, 1, 1024, 'preview dimension');
}
const cleanAxis = (n: number) => Math.abs(n) < 1e-12 ? 0 : n;

function project(volume: StackVolume, doc: PixelDocument, camera: StackView, width: number, height: number): StackRenderFrame {
  const settings = doc.stack ?? stackDefaults(doc.width, doc.height);
  const W = doc.width, H = doc.height, depth = volume.depth, area = W * H;
  const [originX, originY] = settings.origin;
  const step = settings.sliceHeight * (1 + 2 * camera.spread);
  const gap = (1 - settings.sliceHeight / step) * 0.5;
  const yaw = camera.yaw * Math.PI / 180, pitch = camera.pitch * Math.PI / 180;
  const sy = cleanAxis(Math.sin(yaw)), cy = cleanAxis(Math.cos(yaw));
  const sp = cleanAxis(Math.sin(pitch)), cp = cleanAxis(Math.cos(pitch));
  const radius = Math.hypot(Math.max(Math.abs(originX + .5), Math.abs(W - originX - .5)),
                            Math.max(Math.abs(originY + .5), Math.abs(H - originY - .5)));
  const halfZ = ((depth - 1) * step + settings.sliceHeight) * .5;
  const scale = .92 * camera.zoom * Math.min(width / (2 * radius), height / (2 * (radius * Math.abs(sp) + halfZ * cp)));
  const rgba = new Uint8ClampedArray(width * height * 4);
  const hits = new Uint32Array(width * height);
  const columns = volume.store.columns, blockArea = volume.blockArea, blocks = volume.blocks;
  // Frames remain independently pickable after a subsequent edit, move or deletion.
  const planes = volume.planes.slice(), layers = volume.layerIds, frames = volume.frameIds;
  const [xMin, xMax, yMin, yMax, zMin, zMax] = volume.bounds;
  const dx = -sy * cp, dy = -cy * cp, dz = -sp / step;
  const ix = dx ? 1 / dx : 0, iy = dy ? 1 / dy : 0, iz = dz ? 1 / dz : 0;
  const sx = Math.sign(dx), syStep = Math.sign(dy), sz = Math.sign(dz);
  const nearX = dx > 0 ? xMin : xMax, nearY = dy > 0 ? yMin : yMax, nearZ = dz > 0 ? zMin : zMax;
  const farX = dx > 0 ? xMax : xMin, farY = dy > 0 ? yMax : yMin, farZ = dz > 0 ? zMax : zMin;
  const duX = cy / scale, duY = -sy / scale;
  // Numerical nudge is measured in grid cells, including very thin authored slices.
  const epsilon = 1e-7 / Math.max(1, Math.abs(dz));

  if (zMax > zMin) for (let py = 0; py < height; py++) {
    const up = (height / 2 - py - .5) / scale, u0 = (.5 - width / 2) / scale;
    const oz = depth / 2 + up * cp / step;
    if (!dz && (oz < zMin || oz >= zMax)) continue;
    const tz0 = dz ? (nearZ - oz) * iz : -Infinity, tz1 = dz ? (farZ - oz) * iz : Infinity;
    let ox = originX + .5 + u0 * cy - up * sy * sp;
    let oy = originY + .5 - u0 * sy - up * cy * sp;
    for (let px = 0; px < width; px++, ox += duX, oy += duY) {
      if ((!dx && (ox < xMin || ox >= xMax)) || (!dy && (oy < yMin || oy >= yMax))) continue;
      let t = Math.max(tz0, dx ? (nearX - ox) * ix : -Infinity, dy ? (nearY - oy) * iy : -Infinity);
      const far = Math.min(tz1, dx ? (farX - ox) * ix : Infinity, dy ? (farY - oy) * iy : Infinity);
      if (t >= far) continue;
      let x = Math.floor(ox + (t + epsilon) * dx), y = Math.floor(oy + (t + epsilon) * dy), z = Math.floor(oz + (t + epsilon) * dz);
      const output = py * width + px;
      let r = 0, g = 0, b = 0, alpha = 0;
      while (t < far && x >= xMin && x < xMax && y >= yMin && y < yMax && z >= zMin && z < zMax) {
        const bx = x >> SHIFT, by = y >> SHIFT, column = by * columns + bx;
        if (!blocks[(z >> SHIFT) * blockArea + column]) {
          const tx = dx ? ((bx + (dx > 0 ? 1 : 0)) * EDGE - ox) * ix : Infinity;
          const ty = dy ? ((by + (dy > 0 ? 1 : 0)) * EDGE - oy) * iy : Infinity;
          const tz = dz ? (((z >> SHIFT) + (dz > 0 ? 1 : 0)) * EDGE - oz) * iz : Infinity;
          const next = Math.min(tx, ty, tz);
          if (next >= far) break;
          t = next;
          // Set every tied crossing explicitly, including exact edge/corner rays.
          x = tx === next ? (dx > 0 ? (bx + 1) * EDGE : bx * EDGE - 1) : Math.floor(ox + (t + epsilon) * dx);
          y = ty === next ? (dy > 0 ? (by + 1) * EDGE : by * EDGE - 1) : Math.floor(oy + (t + epsilon) * dy);
          z = tz === next ? (dz > 0 ? ((z >> SHIFT) + 1) * EDGE : (z >> SHIFT) * EDGE - 1) : Math.floor(oz + (t + epsilon) * dz);
          continue;
        }
        const tx = dx ? (x + (dx > 0 ? 1 : 0) - ox) * ix : Infinity;
        const ty = dy ? (y + (dy > 0 ? 1 : 0) - oy) * iy : Infinity;
        const tz = dz ? (z + (dz > 0 ? 1 : 0) - oz) * iz : Infinity;
        const end = Math.min(tx, ty, tz, far);
        const tile = planes[z].pages[column >> PAGE_SHIFT]?.[column & PAGE_MASK];
        const color = tile ? tile.colors[(y & MASK) * EDGE + (x & MASK)] : 0;
        if ((color & 255) && end > t + epsilon * .001) {
          // An exploded slice has empty space on either side of its center plane.
          let overlaps = true;
          if (gap) {
            if (dz) {
              const a = (z + gap - oz) * iz, c = (z + 1 - gap - oz) * iz;
              overlaps = Math.max(t, Math.min(a, c)) < Math.min(end, Math.max(a, c));
            } else overlaps = oz >= z + gap && oz < z + 1 - gap;
          }
          if (overlaps) {
            if (!hits[output]) hits[output] = 1 + z * area + y * W + x;
            const weight = (color & 255) / 255 * (1 - alpha);
            r += (color >>> 24) * weight;
            g += ((color >>> 16) & 255) * weight;
            b += ((color >>> 8) & 255) * weight;
            alpha += weight;
            if ((color & 255) === 255 || alpha >= 1) break;
          }
        }
        if (end >= far) break;
        if (tx === end) x += sx;
        if (ty === end) y += syStep;
        if (tz === end) z += sz;
        t = end;
      }
      if (alpha) {
        const j = output * 4;
        rgba[j] = Math.round(r / alpha); rgba[j + 1] = Math.round(g / alpha);
        rgba[j + 2] = Math.round(b / alpha); rgba[j + 3] = Math.round(alpha * 255);
      }
    }
  }

  return { width, height, rgba, pick(px, py) {
    if (!Number.isFinite(px) || !Number.isFinite(py) || px < 0 || py < 0 || px >= width || py >= height) return null;
    const index = hits[Math.floor(py) * width + Math.floor(px)] - 1;
    if (index < 0) return null;
    const z = Math.floor(index / area), within = index - z * area, x = within % W, y = Math.floor(within / W);
    const key = (y >> SHIFT) * columns + (x >> SHIFT);
    const tile = planes[z].pages[key >> PAGE_SHIFT]![key & PAGE_MASK]!;
    const owner = typeof tile.owners === 'number' ? tile.owners : tile.owners[(y & MASK) * EDGE + (x & MASK)];
    return { frameIndex: z, sliceIndex: z, frameId: frames[z], x, y, layerId: layers[owner] };
  } };
}

/** Keep one renderer for an editor surface. Document edits are immutable in Pixel Workshop. */
export function createSpriteStackRenderer() {
  let store: TileStore | undefined, volume: StackVolume | undefined;
  let previous: PixelDocument | undefined, revision = -1, lastKey = '', lastFrame: StackRenderFrame | undefined;
  return {
    render(doc: PixelDocument, options: StackRenderOptions = {}): StackRenderFrame {
      const width = imageSize(options.width ?? 240), height = imageSize(options.height ?? 180), camera = resolveStackView(doc, options);
      if (!store || store.width !== doc.width || store.height !== doc.height) {
        store = new TileStore(doc.width, doc.height); volume = undefined;
      }
      if (!volume || volume.depth !== frameCount(doc)) volume = new StackVolume(store, frameCount(doc));
      if (doc !== previous || doc.revision !== revision) {
        volume.sync(doc); previous = doc; revision = doc.revision; lastFrame = undefined;
      }
      const key = [width, height, camera.yaw, camera.pitch, camera.zoom, camera.spread].join('/');
      if (lastFrame && lastKey === key) return lastFrame;
      lastKey = key;
      lastFrame = project(volume, doc, camera, width, height);
      return lastFrame;
    },
    invalidate() { store = undefined; volume = undefined; previous = undefined; revision = -1; lastFrame = undefined; },
  };
}
