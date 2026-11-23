/** Source-over for the project's packed, straight-alpha 0xRRGGBBAA pixels. */
export function rgbaOver(bottom: number, top: number): number {
  const alpha = top & 255;
  if (!alpha) return bottom >>> 0;
  if (alpha === 255 || !(bottom & 255)) return top >>> 0;
  const a = alpha / 255, b = (bottom & 255) / 255, out = a + b * (1 - a);
  const blend = (shift: number) => Math.round((((top >>> shift) & 255) * a + ((bottom >>> shift) & 255) * b * (1 - a)) / out);
  return ((blend(24) << 24) | (blend(16) << 16) | (blend(8) << 8) | Math.round(out * 255)) >>> 0;
}
