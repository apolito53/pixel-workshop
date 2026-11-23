import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommands, composite, createStackDocument, frameView, type PixelDocument } from '../lib/pixels.ts';
import { createSpriteStackRenderer, resolveStackView, type StackRenderFrame } from '../lib/sprite-stack-renderer.ts';

const center = (frame: StackRenderFrame) => {
  const x = Math.floor(frame.width / 2), y = Math.floor(frame.height / 2);
  const index = 4 * (y * frame.width + x);
  return { color: [...frame.rgba.subarray(index, index + 4)], hit: frame.pick(x, y) };
};

test('top and underside picks respect slice order, native layer order and alpha', () => {
  const doc = applyCommands(createStackDocument('Glass', 3, 3, 2), [
    { op: 'pixel', x: 1, y: 1, color: '#0000ff', frame: 0 },
    { op: 'pixel', x: 1, y: 1, color: '#ff000080', frame: 1 },
    { op: 'add_layer', id: 'ink' }, { op: 'pixel', x: 1, y: 1, color: '#00ff0080', layer: 'ink', frame: 1 },
    { op: 'add_layer', id: 'dust' }, { op: 'pixel', x: 1, y: 1, color: '#ff103800', layer: 'dust', frame: 1 },
  ]);
  const renderer = createSpriteStackRenderer();
  const options = { width: 65, height: 65, pitch: 90, yaw: 0 };
  const top = renderer.render(doc, options), front = center(top);
  assert.deepEqual(front.hit, { frameIndex: 1, sliceIndex: 1, frameId: doc.animation!.frames[0].id, x: 1, y: 1, layerId: 'ink' });
  const native = composite(frameView(doc, 1)).slice(16, 20), alpha = native[3] / 255;
  assert.deepEqual(front.color, [Math.round(native[0] * alpha), Math.round(native[1] * alpha), Math.round(native[2] * alpha + 255 * (1 - alpha)), 255]);
  const bottom = center(renderer.render(doc, { ...options, pitch: -90 }));
  assert.deepEqual(bottom.color, [0, 0, 255, 255]);
  assert.deepEqual(bottom.hit, { frameIndex: 0, sliceIndex: 0, frameId: null, x: 1, y: 1, layerId: 'base' });
  const hidden = applyCommands(doc, [{ op: 'visibility', layer: 'ink', visible: false }]);
  assert.deepEqual(center(renderer.render(hidden, options)).color, [128, 0, 127, 255]);
  assert.equal(center(renderer.render(hidden, options)).hit?.layerId, 'base');
  assert.equal(center(top).hit?.layerId, 'ink', 'an earlier returned frame retains its picks after edits');
  for (const [x, y] of [[0, 0], [-1, 5], [65, 12], [45, Infinity]]) assert.equal(top.pick(x, y), null);
});

test('edge-on views pick the nearest painted cell and ignore exploded gaps', () => {
  const doc = applyCommands(createStackDocument('Faces', 3, 3, 2), [
    { op: 'pixel', x: 1, y: 2, color: '#ff0000' }, { op: 'pixel', x: 1, y: 0, color: '#0000ff' },
    { op: 'hold_cel', layer: 'base', frame: 1, source_frame: 0 },
  ]);
  const renderer = createSpriteStackRenderer(), o = { width: 65, height: 65, pitch: 0, spread: 0, yaw: 0 };
  assert.equal(center(renderer.render(doc, o)).hit?.y, 2);
  assert.equal(center(renderer.render(doc, { ...o, yaw: 180 })).hit?.y, 0);
  const exploded = renderer.render(doc, { ...o, spread: 1 });
  assert.equal(center(exploded).hit, null);
  assert(exploded.rgba.some((v, i) => i % 4 === 3 && v > 0));
});

test('camera-only changes and one changed slice reuse immutable cropped source tiles', () => {
  const doc = createStackDocument('Sparse volume', 1024, 1024, 512);
  let reads = 0;
  const observed = { x: 512, y: 512, width: 1, height: 1, get data() { reads++; return [0x558899ff]; } };
  doc.layers[0].pixels = observed;
  doc.animation!.frames[510].pixels.base = observed;
  doc.stack!.view = { yaw: 79, pitch: 90, zoom: 4, spread: 0 };
  const renderer = createSpriteStackRenderer(), options = { width: 81, height: 81 };
  const first = renderer.render(doc, options); assert(reads > 0); reads = 0;
  assert.equal(renderer.render(doc, options), first);
  renderer.render(doc, { ...options, yaw: -281 });
  renderer.render(doc, { ...options, yaw: 9, pitch: 14 });
  const frames = doc.animation!.frames.slice();
  frames[255] = { ...frames[255], pixels: { base: { x: 512, y: 512, width: 1, height: 1, data: [0xff1133ff] } } };
  const next = { ...doc, revision: doc.revision + 1, animation: { ...doc.animation!, frames } };
  renderer.render(next, options);
  assert.equal(reads, 0);
  renderer.invalidate(); renderer.render(next, options); assert(reads > 0);
  assert.deepEqual(resolveStackView(doc, { yaw: -281 }), { yaw: 79, pitch: 90, zoom: 4, spread: 0 });
  for (const opts of [{ width: 0 }, { height: 1025 }, { zoom: Infinity }, { pitch: -91 }, { spread: 1.1 }]) {
    assert.throws(() => renderer.render(doc, opts));
  }
});

test('oblique picks and transparent color match independent per-cell ray intersections', () => {
  const doc: PixelDocument = applyCommands(createStackDocument('Small cluster', 12, 11, 10, { origin: [5, 4], zMin: -3, sliceHeight: .65 }), [
    ...[[1, 1, 0, '#3a4d77'], [3, 4, 2, '#774dbb90'], [4, 3, 3, '#ff654e60'], [5, 3, 4, '#77aa8850'], [5, 4, 4, '#447799'], [4, 4, 5, '#bbaaddb0'], [9, 8, 8, '#ff4779'], [5, 4, 9, '#4858aa']].map(
      ([x, y, frame, color]) => ({ op: 'pixel', x, y, frame, color })),
  ]);
  const W = doc.width, H = doc.height, D = 10, pixels: { x: number; y: number; z: number; rgba: number[] }[] = [];
  for (let z = 0; z < D; z++) {
    const plane = composite(frameView(doc, z));
    for (let i = 0; i < W * H; i++) {
      if (plane[i * 4 + 3]) pixels.push({ x: i % W, y: Math.floor(i / W), z, rgba: [...plane.slice(i * 4, i * 4 + 4)] });
    }
  }
  const renderer = createSpriteStackRenderer();
  const width = 51, height = 43, [cx, cy] = doc.stack!.origin, thick = doc.stack!.sliceHeight;
  for (const [yawDeg, pitchDeg, spread] of [[28, 22, 0], [169, -31, .59], [204, 8, 1], [310, 54, 0]]) {
    const frame = renderer.render(doc, { width, height, yaw: yawDeg, pitch: pitchDeg, spread });
    const yaw = yawDeg * Math.PI / 180, pitch = pitchDeg * Math.PI / 180;
    const sy = Math.sin(yaw), co = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch), step = thick * (1 + 2 * spread);
    const radius = Math.hypot(Math.max(cx + .5, W - cx - .5), Math.max(cy + .5, H - cy - .5));
    const halfZ = ((D - 1) * step + thick) / 2;
    const scale = .92 * Math.min(width / (2 * radius), height / (2 * (radius * Math.abs(sp) + halfZ * cp)));
    const direction = [-sy * cp, -co * cp, -sp];
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const h = (x + .5 - width / 2) / scale, v = (height / 2 - y - .5) / scale;
      const origin = [cx + h * co - v * sy * sp, cy - h * sy - v * co * sp, (D - 1) * step / 2 + v * cp];
      const intersected = pixels.flatMap(pixel => {
        const center = [pixel.x, pixel.y, pixel.z * step], extents = [.5, .5, thick / 2];
        let enter = -Infinity, leave = Infinity;
        for (let axis = 0; axis < 3; axis++) {
          const a = (center[axis] - extents[axis] - origin[axis]) / direction[axis];
          const b = (center[axis] + extents[axis] - origin[axis]) / direction[axis];
          enter = Math.max(enter, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
        }
        return enter < leave - 1e-8 ? [{ pixel, enter }] : [];
      }).sort((a, b) => a.enter - b.enter);
      const first = intersected[0]?.pixel, hit = frame.pick(x, y);
      assert.deepEqual(hit && [hit.x, hit.y, hit.sliceIndex], first ? [first.x, first.y, first.z] : null);
      const expected = [0, 0, 0, 0];
      for (const { pixel } of intersected) {
        const weight = pixel.rgba[3] / 255 * (1 - expected[3]);
        for (let j = 0; j < 3; j++) expected[j] += pixel.rgba[j] * weight;
        expected[3] += weight;
      }
      const out = expected.map((n, i) => i === 3 ? Math.round(n * 255) : expected[3] ? Math.round(n / expected[3]) : 0);
      assert.deepEqual([...frame.rgba.slice((y * width + x) * 4, (y * width + x + 1) * 4)], out);
    }
  }
});
