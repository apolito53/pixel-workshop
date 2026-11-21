/**
 * Deterministic, browser-safe finishing for ordinary RGBA images.
 *
 * This intentionally does not use PixelDocument: a photograph or illustration
 * retains its source resolution and is always rendered again from its original.
 * Byte storage is straight-alpha sRGB; neighborhood filters work in premultiplied
 * alpha so the invisible colors around a cutout cannot bleed into its edges.
 */
export type FinishingImage = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type FinishingCrop = {x: number; y: number; width: number; height: number};

export type FinishingRenderOptions = {
  /** Preview pixels per original pixel; keeps detail footprints in source units. */
  spatialScale?: number;
};

export type FinishingSettings = {
  exposure: number;
  brightness: number;
  contrast: number;
  highlights: number;
  shadows: number;
  gamma: number;
  saturation: number;
  vibrance: number;
  warmth: number;
  tint: number;
  hue: number;
  sharpen: number;
  blur: number;
};

export type FinishingControl = {
  key: keyof FinishingSettings;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  group: 'light' | 'color' | 'detail';
};

export const MAX_FINISHING_PIXELS = 24_000_000;
export const MAX_FINISHING_DIMENSION = 16_384;

export const FINISHING_CONTROLS: readonly FinishingControl[] = Object.freeze([
  {key: 'exposure', label: 'Exposure', min: -4, max: 4, step: 0.05, defaultValue: 0, group: 'light'},
  {key: 'brightness', label: 'Brightness', min: -100, max: 100, step: 1, defaultValue: 0, group: 'light'},
  {key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1, defaultValue: 0, group: 'light'},
  {key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1, defaultValue: 0, group: 'light'},
  {key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1, defaultValue: 0, group: 'light'},
  {key: 'gamma', label: 'Gamma', min: 0.2, max: 3, step: 0.05, defaultValue: 1, group: 'light'},
  {key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1, defaultValue: 0, group: 'color'},
  {key: 'vibrance', label: 'Vibrance', min: -100, max: 100, step: 1, defaultValue: 0, group: 'color'},
  {key: 'warmth', label: 'Warmth', min: -100, max: 100, step: 1, defaultValue: 0, group: 'color'},
  {key: 'tint', label: 'Tint', min: -100, max: 100, step: 1, defaultValue: 0, group: 'color'},
  {key: 'hue', label: 'Hue', min: -180, max: 180, step: 1, defaultValue: 0, group: 'color'},
  {key: 'sharpen', label: 'Sharpen', min: 0, max: 100, step: 1, defaultValue: 0, group: 'detail'},
  {key: 'blur', label: 'Blur', min: 0, max: 20, step: 0.1, defaultValue: 0, group: 'detail'},
]);

export const DEFAULT_FINISHING_SETTINGS: Readonly<FinishingSettings> = Object.freeze({
  exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, gamma: 1,
  saturation: 0, vibrance: 0, warmth: 0, tint: 0, hue: 0, sharpen: 0, blur: 0,
});

const settingKeys = new Set<string>(FINISHING_CONTROLS.map(control => control.key));

/** Reject mistakes in saved recipes/tool calls instead of silently changing them. */
export function normalizeFinishingSettings(input: unknown = {}): FinishingSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Image adjustments must be an object.');
  }
  const values = input as Record<string, unknown>;
  for (const key of Object.keys(values)) {
    if (!settingKeys.has(key)) throw new Error(`Unknown image adjustment: ${key}.`);
  }
  const settings = {...DEFAULT_FINISHING_SETTINGS};
  for (const control of FINISHING_CONTROLS) {
    if (!Object.hasOwn(values, control.key)) continue;
    const value = values[control.key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < control.min || value > control.max) {
      throw new Error(`${control.label} must be a finite number from ${control.min} to ${control.max}.`);
    }
    settings[control.key] = value;
  }
  return settings;
}

function validateDimensions(width: unknown, height: unknown): void {
  if (typeof width !== 'number' || typeof height !== 'number' ||
      !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('Image dimensions must be positive integers.');
  }
  if (width > MAX_FINISHING_DIMENSION || height > MAX_FINISHING_DIMENSION ||
      width * height > MAX_FINISHING_PIXELS) {
    throw new Error('Image finishing supports up to 24 million pixels and 16,384 pixels per side. The image was not resized.');
  }
}

export function validateFinishingImage(image: unknown): asserts image is FinishingImage {
  if (!image || typeof image !== 'object') throw new Error('An RGBA image is required.');
  const value = image as FinishingImage;
  validateDimensions(value.width, value.height);
  if (!(value.data instanceof Uint8ClampedArray) || value.data.length !== value.width * value.height * 4) {
    throw new Error('Image data must contain exactly four RGBA bytes per pixel.');
  }
}

/** Crop coordinates always refer to the original image, never the previous crop. */
export function normalizeFinishingCrop(crop: unknown, width: number, height: number): FinishingCrop {
  validateDimensions(width, height);
  if (crop === undefined || crop === null) return {x: 0, y: 0, width, height};
  if (typeof crop !== 'object' || Array.isArray(crop)) throw new Error('Crop must be an image rectangle.');
  const rect = crop as Record<string, unknown>;
  for (const key of Object.keys(rect)) {
    if (!['x', 'y', 'width', 'height'].includes(key)) throw new Error(`Unknown crop field: ${key}.`);
  }
  for (const key of ['x', 'y', 'width', 'height']) {
    if (!Object.hasOwn(rect, key) || typeof rect[key] !== 'number' || !Number.isInteger(rect[key])) {
      throw new Error('Crop coordinates and dimensions must be integers.');
    }
  }
  const {x, y, width: cropWidth, height: cropHeight} = rect as FinishingCrop;
  if (x < 0 || y < 0 || cropWidth < 1 || cropHeight < 1 ||
      x + cropWidth > width || y + cropHeight > height) {
    throw new Error('Crop must be a non-empty rectangle inside the original image.');
  }
  return {x, y, width: cropWidth, height: cropHeight};
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const srgbToLinear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
const linearToSrgb = (value: number) => value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;

function adjustColors(data: Uint8ClampedArray, settings: FinishingSettings): void {
  const exposure = 2 ** settings.exposure;
  const warmth = settings.warmth / 100;
  const tint = settings.tint / 100;
  // These are relative color grades, not a claim to reconstruct a camera's
  // original illuminant or temperature in Kelvin.
  const gains = [exposure * 2 ** (warmth * 0.65 + tint * 0.25),
    exposure * 2 ** (-tint * 0.4), exposure * 2 ** (-warmth * 0.65 + tint * 0.25)];
  const maps = gains.map(gain => Float64Array.from({length: 256}, (_, byte) =>
    gain === 1 ? byte / 255 : linearToSrgb(srgbToLinear(byte / 255) * gain)));
  const brightness = settings.brightness / 100;
  const contrast = 1 + settings.contrast / 100;
  const highlights = settings.highlights / 100;
  const shadows = settings.shadows / 100;
  const saturation = 1 + settings.saturation / 100;
  const vibrance = settings.vibrance / 100;
  const inverseGamma = 1 / settings.gamma;
  const angle = settings.hue * Math.PI / 180;
  const cosine = Math.cos(angle), sine = Math.sin(angle);

  for (let offset = 0; offset < data.length; offset += 4) {
    // Preserve invisible RGB for reversible neutral/crop output. Filters below
    // explicitly ignore that hidden color when neighboring alpha is zero.
    if (data[offset + 3] === 0) continue;
    let red = maps[0][data[offset]], green = maps[1][data[offset + 1]], blue = maps[2][data[offset + 2]];
    if (highlights !== 0 || shadows !== 0) {
      const light = clamp01(0.2126 * red + 0.7152 * green + 0.0722 * blue);
      const dark = 1 - light;
      const change = 2.4 * light * dark * (shadows * dark + highlights * light);
      red += change; green += change; blue += change;
    }
    red = (red + brightness - 0.5) * contrast + 0.5;
    green = (green + brightness - 0.5) * contrast + 0.5;
    blue = (blue + brightness - 0.5) * contrast + 0.5;
    if (inverseGamma !== 1) {
      red = Math.max(0, red) ** inverseGamma;
      green = Math.max(0, green) ** inverseGamma;
      blue = Math.max(0, blue) ** inverseGamma;
    }
    if (settings.hue !== 0) {
      const light = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      const u = (blue - light) * 0.5389, v = (red - light) * 0.635;
      const rotatedU = u * cosine - v * sine, rotatedV = u * sine + v * cosine;
      red = light + rotatedV / 0.635;
      blue = light + rotatedU / 0.5389;
      green = (light - 0.2126 * red - 0.0722 * blue) / 0.7152;
    }
    if (saturation !== 1 || vibrance !== 0) {
      const light = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      const chroma = clamp01(Math.max(red, green, blue) - Math.min(red, green, blue));
      // Positive vibrance favors restrained colors. Negative vibrance can still
      // remove all chroma; neutral gray remains neutral in either direction.
      const boost = 1 + vibrance * (vibrance > 0 ? 1 - chroma : 1);
      const scale = saturation * boost;
      red = light + (red - light) * scale;
      green = light + (green - light) * scale;
      blue = light + (blue - light) * scale;
    }
    data[offset] = clamp01(red) * 255;
    data[offset + 1] = clamp01(green) * 255;
    data[offset + 2] = clamp01(blue) * 255;
  }
}

/**
 * Separable box convolution with fractional outer samples and clamped edges.
 * Only a small row ring stores floating-point premultiplied color, rather than
 * allocating a four-channel floating-point copy of a 24-megapixel photograph.
 */
function boxBlur(source: Uint8ClampedArray, target: Uint8ClampedArray,
  width: number, height: number, radius: number): void {
  const whole = Math.floor(radius), fraction = radius - whole;
  const reach = whole + (fraction > 0 ? 1 : 0);
  const divisor = 2 * radius + 1;
  const rowSize = width * 4;
  const ringSize = Math.min(height, 2 * reach + 1);
  const rows = Array.from({length: ringSize}, () => new Float64Array(rowSize));
  const rowNumbers = new Int32Array(ringSize).fill(-1);
  const sums = new Float64Array(rowSize);
  const clampX = (x: number) => Math.min(width - 1, Math.max(0, x));
  const clampY = (y: number) => Math.min(height - 1, Math.max(0, y));

  const horizontalRow = (requestedY: number): Float64Array => {
    const y = clampY(requestedY), slot = y % ringSize;
    if (rowNumbers[slot] === y) return rows[slot];
    const row = rows[slot], start = y * rowSize;
    let red = 0, green = 0, blue = 0, alpha = 0;
    const add = (x: number, weight: number) => {
      const offset = start + clampX(x) * 4, a = source[offset + 3] * weight;
      red += source[offset] * a; green += source[offset + 1] * a;
      blue += source[offset + 2] * a; alpha += a;
    };
    for (let x = -whole; x <= whole; x++) add(x, 1);
    if (fraction) {add(-reach, fraction); add(reach, fraction);}
    for (let x = 0; x < width; x++) {
      const offset = x * 4;
      row[offset] = red / divisor; row[offset + 1] = green / divisor;
      row[offset + 2] = blue / divisor; row[offset + 3] = alpha / divisor;
      if (x === width - 1) break;
      add(x - whole, -1); add(x + whole + 1, 1);
      if (fraction) {
        add(x - reach, -fraction); add(x + 1 - reach, fraction);
        add(x + reach, -fraction); add(x + 1 + reach, fraction);
      }
    }
    rowNumbers[slot] = y;
    return row;
  };
  const addRow = (y: number, weight: number) => {
    const row = horizontalRow(y);
    for (let i = 0; i < rowSize; i++) sums[i] += row[i] * weight;
  };
  for (let y = -whole; y <= whole; y++) addRow(y, 1);
  if (fraction) {addRow(-reach, fraction); addRow(reach, fraction);}
  for (let y = 0; y < height; y++) {
    const start = y * rowSize;
    for (let offset = 0; offset < rowSize; offset += 4) {
      const alpha = Math.max(0, sums[offset + 3] / divisor), destination = start + offset;
      if (alpha > 1e-8) {
        target[destination] = sums[offset] / (divisor * alpha);
        target[destination + 1] = sums[offset + 1] / (divisor * alpha);
        target[destination + 2] = sums[offset + 2] / (divisor * alpha);
      } else {
        target[destination] = target[destination + 1] = target[destination + 2] = 0;
      }
      target[destination + 3] = alpha;
    }
    if (y === height - 1) break;
    addRow(y - whole, -1); addRow(y + whole + 1, 1);
    if (fraction) {
      addRow(y - reach, -fraction); addRow(y + 1 - reach, fraction);
      addRow(y + reach, -fraction); addRow(y + 1 + reach, fraction);
    }
  }
}

/** Render in a fixed order: crop, light/color, sharpen, then blur. */
export function renderFinishedImage(image: FinishingImage,
  inputSettings: Partial<FinishingSettings> = {}, inputCrop?: FinishingCrop | null,
  options: FinishingRenderOptions = {}): FinishingImage {
  validateFinishingImage(image);
  const settings = normalizeFinishingSettings(inputSettings);
  const crop = normalizeFinishingCrop(inputCrop, image.width, image.height);
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => key !== 'spatialScale')) {
    throw new Error('Invalid image rendering options.');
  }
  const spatialScale = options.spatialScale === undefined ? 1 : options.spatialScale;
  if (typeof spatialScale !== 'number' || !Number.isFinite(spatialScale) || spatialScale <= 0 || spatialScale > 1) {
    throw new Error('Preview spatial scale must be greater than zero and at most one.');
  }
  const {width, height} = crop;
  let data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const start = ((crop.y + y) * image.width + crop.x) * 4;
    data.set(image.data.subarray(start, start + width * 4), y * width * 4);
  }
  if (FINISHING_CONTROLS.some(control => control.group !== 'detail' && settings[control.key] !== control.defaultValue)) {
    adjustColors(data, settings);
  }
  if (settings.sharpen > 0 || settings.blur > 0) {
    let scratch = new Uint8ClampedArray(data.length);
    if (settings.sharpen > 0) {
      boxBlur(data, scratch, width, height, spatialScale);
      const amount = settings.sharpen / 50;
      for (let offset = 0; offset < data.length; offset += 4) {
        if (data[offset + 3] === 0) continue;
        for (let channel = 0; channel < 3; channel++) {
          const i = offset + channel;
          data[i] = data[i] + amount * (data[i] - scratch[i]);
        }
      }
    }
    if (settings.blur > 0) {
      // Three compact boxes approximate a soft Gaussian without a radius-sized
      // loop at every pixel. The fractional radius keeps low settings smooth.
      const radius = Math.max(0, (Math.sqrt(1 + 4 * (settings.blur * spatialScale) ** 2) - 1) / 2);
      for (let pass = 0; pass < 3; pass++) {
        boxBlur(data, scratch, width, height, radius);
        [data, scratch] = [scratch, data];
      }
    }
  }
  return {width, height, data};
}
