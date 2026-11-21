import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FINISHING_SETTINGS, FINISHING_CONTROLS, MAX_FINISHING_PIXELS,
  normalizeFinishingCrop, normalizeFinishingSettings, renderFinishedImage,
  validateFinishingImage, type FinishingImage,
} from '../lib/image-finishing.ts';

const image = (pixels: number[], width = pixels.length / 4): FinishingImage => ({
  width, height: pixels.length / 4 / width, data: new Uint8ClampedArray(pixels),
});

test('neutral finishing preserves every byte, including hidden RGB, without sharing source storage', () => {
  const original = image([255, 20, 60, 255, 17, 29, 41, 0, 80, 110, 170, 73]);
  const result = renderFinishedImage(original);
  assert.deepEqual(result, original);
  assert.notStrictEqual(result.data, original.data);
  result.data[0] = 1;
  assert.equal(original.data[0], 255);
  assert.deepEqual(renderFinishedImage(original, DEFAULT_FINISHING_SETTINGS), original);
});

test('crop uses exact original pixels and never resizes the image', () => {
  const original = image([
    1, 2, 3, 255, 11, 12, 13, 255, 21, 22, 23, 255,
    31, 32, 33, 255, 41, 42, 43, 128, 51, 52, 53, 0,
  ], 3);
  const result = renderFinishedImage(original, {}, {x: 1, y: 0, width: 2, height: 2});
  assert.equal(result.width, 2);
  assert.equal(result.height, 2);
  assert.deepEqual([...result.data], [11, 12, 13, 255, 21, 22, 23, 255, 41, 42, 43, 128, 51, 52, 53, 0]);
  assert.deepEqual(normalizeFinishingCrop(null, 3, 2), {x: 0, y: 0, width: 3, height: 2});
  assert.deepEqual(normalizeFinishingCrop(undefined, 3, 2), {x: 0, y: 0, width: 3, height: 2});
});

test('full-size finishing has no pixel-art canvas limit', () => {
  const original = {width: 3072, height: 2048, data: new Uint8ClampedArray(3072 * 2048 * 4)};
  original.data.set([60, 100, 140, 255], original.data.length - 4);
  const result = renderFinishedImage(original, {saturation: -100});
  assert.equal(result.width, 3072);
  assert.equal(result.height, 2048);
  const last = result.data.subarray(-4);
  assert.equal(last[0], last[1]);
  assert.equal(last[1], last[2]);
  assert.equal(last[3], 255);
  assert.deepEqual([...original.data.subarray(-4)], [60, 100, 140, 255]);
});

test('exposure operates in linear light and brightness is a distinct adjustment', () => {
  const original = image([64, 64, 64, 255, 128, 128, 128, 77]);
  const exposed = renderFinishedImage(original, {exposure: 1});
  assert.deepEqual([...exposed.data], [90, 90, 90, 255, 176, 176, 176, 77]);
  assert.notDeepEqual(exposed.data, renderFinishedImage(original, {brightness: 50}).data);
  assert.ok(renderFinishedImage(original, {gamma: 2}).data[0] > original.data[0]);
  assert.equal(renderFinishedImage(original, {contrast: -100}).data[0], 128);
});

test('color controls preserve alpha and protect neutral gray', () => {
  const original = image([120, 90, 70, 123, 80, 80, 80, 255, 230, 40, 20, 0]);
  const saturated = renderFinishedImage(original, {saturation: -100, hue: 120, vibrance: 100});
  assert.equal(saturated.data[0], saturated.data[1]);
  assert.equal(saturated.data[1], saturated.data[2]);
  assert.equal(saturated.data[3], 123);
  assert.deepEqual([...saturated.data.subarray(4, 8)], [80, 80, 80, 255]);
  assert.deepEqual([...saturated.data.subarray(8)], [230, 40, 20, 0]);
  const warmed = renderFinishedImage(image([128, 128, 128, 255]), {warmth: 50}).data;
  assert.ok(warmed[0] > warmed[2]);
  const tinted = renderFinishedImage(image([128, 128, 128, 255]), {tint: 50}).data;
  assert.ok(tinted[0] > tinted[1] && tinted[2] > tinted[1]);
});

test('shadows and highlights concentrate their effect on the corresponding tonal region', () => {
  const original = image([51, 51, 51, 255, 204, 204, 204, 255]);
  const shadow = renderFinishedImage(original, {shadows: 20}).data;
  const highlight = renderFinishedImage(original, {highlights: -20}).data;
  assert.ok(shadow[0] - 51 > shadow[4] - 204);
  assert.ok(204 - highlight[4] > 51 - highlight[0]);
});

test('vibrance boosts restrained color more than already saturated color', () => {
  const original = image([150, 100, 100, 255, 255, 0, 0, 255]);
  const vibrant = renderFinishedImage(original, {vibrance: 100}).data;
  assert.ok(vibrant[0] - vibrant[1] > 50);
  assert.deepEqual([...vibrant.subarray(4)], [255, 0, 0, 255]);
});

test('blur averages premultiplied alpha so invisible colors do not make colored fringes', () => {
  const original = image([255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 0]);
  const blurred = renderFinishedImage(original, {blur: 0.8}).data;
  for (let offset = 0; offset < blurred.length; offset += 4) {
    assert.equal(blurred[offset], 255);
    assert.equal(blurred[offset + 1], 0);
    assert.equal(blurred[offset + 2], 0);
  }
  assert.ok(blurred[3] < 255 && blurred[3] > 0);
  assert.ok(blurred[7] > 0);
  assert.deepEqual([...original.data], [255, 0, 0, 255, 0, 255, 0, 0, 0, 0, 255, 0]);
});

test('blur keeps solid colors stable, including narrow images and large fractional radii', () => {
  for (const [width, height] of [[1, 1], [1, 7], [7, 1], [9, 8]]) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let offset = 0; offset < data.length; offset += 4) data.set([91, 137, 201, 83], offset);
    const original = {width, height, data};
    for (const blur of [0.1, 0.4, 1, 2.5, 20]) {
      assert.deepEqual(renderFinishedImage(original, {blur}).data, data, `${width}×${height}, radius ${blur}`);
    }
  }
});

test('blur is symmetric across an isolated center pixel and reduces detail', () => {
  const data = new Uint8ClampedArray(9 * 9 * 4);
  for (let offset = 3; offset < data.length; offset += 4) data[offset] = 255;
  data.set([255, 255, 255, 255], (4 * 9 + 4) * 4);
  const original = {width: 9, height: 9, data};
  const result = renderFinishedImage(original, {blur: 1.25}).data;
  assert.ok(result[(4 * 9 + 4) * 4] < 255);
  assert.ok(result[(4 * 9 + 3) * 4] > 0);
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
    assert.equal(result[(y * 9 + x) * 4], result[((8 - y) * 9 + (8 - x)) * 4]);
    assert.ok(Math.abs(result[(y * 9 + x) * 4] - result[(x * 9 + y) * 4]) <= 1);
  }
});

test('sharpen increases an edge contrast while keeping alpha and source intact', () => {
  const original = image([60, 60, 60, 255, 100, 100, 100, 127, 160, 160, 160, 255]);
  const saved = original.data.slice();
  const sharpened = renderFinishedImage(original, {sharpen: 50}).data;
  assert.ok(sharpened[0] < original.data[0]);
  assert.ok(sharpened[8] > original.data[8]);
  assert.deepEqual([sharpened[3], sharpened[7], sharpened[11]], [255, 127, 255]);
  assert.deepEqual(original.data, saved);
});

test('re-rendering the same recipe is deterministic and starts from the source each time', () => {
  const original = image([70, 130, 230, 255, 90, 60, 20, 100, 220, 190, 70, 255]);
  const saved = original.data.slice();
  const settings = {exposure: 0.2, warmth: 15, shadows: 10, hue: 15, vibrance: 10, sharpen: 20, blur: 0.2};
  assert.deepEqual(renderFinishedImage(original, settings), renderFinishedImage(original, settings));
  assert.deepEqual(original.data, saved);
  assert.deepEqual(renderFinishedImage(original, {}), original);
});

test('preview spatial scale shrinks blur and sharpening footprints without changing the recipe', () => {
  const original = image([60, 60, 60, 255, 100, 100, 100, 255, 180, 180, 180, 255]);
  const blurRecipe = {blur: 2};
  assert.deepEqual(renderFinishedImage(original, blurRecipe, null, {spatialScale: 0.25}),
    renderFinishedImage(original, {blur: 0.5}));
  assert.deepEqual(blurRecipe, {blur: 2});
  const full = renderFinishedImage(original, {sharpen: 50}).data;
  const preview = renderFinishedImage(original, {sharpen: 50}, null, {spatialScale: 0.1}).data;
  assert.ok(Math.abs(preview[0] - original.data[0]) < Math.abs(full[0] - original.data[0]));
  assert.deepEqual(renderFinishedImage(original, {}, null, {spatialScale: 0.25}), original);
  for (const spatialScale of [0, -1, 1.1, NaN, Infinity]) {
    assert.throws(() => renderFinishedImage(original, {}, null, {spatialScale}));
  }
});

test('settings reject unknown, nonnumeric and out-of-range fields instead of changing the recipe', () => {
  assert.deepEqual(normalizeFinishingSettings(), DEFAULT_FINISHING_SETTINGS);
  assert.equal(FINISHING_CONTROLS.length, Object.keys(DEFAULT_FINISHING_SETTINGS).length);
  for (const bad of [null, [], 'warm', {saturation: '20'}, {exposure: Infinity}, {gamma: NaN},
    {hue: 181}, {sharpen: -1}, {gamma: 0}, {typo: 10}, {blur: undefined}]) {
    assert.throws(() => normalizeFinishingSettings(bad));
  }
  const inherited = Object.create({exposure: 4});
  assert.equal(normalizeFinishingSettings(inherited).exposure, 0);
});

test('invalid image and crop dimensions are rejected before rendering allocations', () => {
  const original = image([1, 2, 3, 255]);
  for (const bad of [null, {width: 0, height: 1, data: original.data},
    {width: 1.5, height: 1, data: original.data}, {width: 16_385, height: 1, data: original.data},
    {width: 6000, height: MAX_FINISHING_PIXELS / 6000 + 1, data: original.data},
    {width: 1, height: 1, data: new Uint8ClampedArray(3)}, {width: 1, height: 1, data: [1, 2, 3, 4]}]) {
    assert.throws(() => validateFinishingImage(bad));
  }
  for (const crop of [[], 'crop', {x: 0, y: 0, width: 0, height: 1},
    {x: -1, y: 0, width: 1, height: 1}, {x: 0.1, y: 0, width: 1, height: 1},
    {x: 0, y: 0, width: 2, height: 1}, {x: 0, y: 0, width: 1, height: 1, scale: 2}]) {
    assert.throws(() => normalizeFinishingCrop(crop, 1, 1));
  }
});
