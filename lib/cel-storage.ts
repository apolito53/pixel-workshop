/** Canonicalize read-only RGBA arrays. Hash collisions are resolved by exact comparison. */
export class CelInterner {
  private identities = new WeakMap<number[],number[]>();
  private buckets = new Map<number,number[][]>();
  size = 0;

  intern(pixels:number[]):number[] {
    const known = this.identities.get(pixels);
    if (known) return known;
    let hash = pixels.length;
    for (let i=0;i<pixels.length;i++) hash=Math.imul(hash ^ pixels[i],16777619);
    const bucket=this.buckets.get(hash);
    if (bucket) {
      for (const candidate of bucket) {
        if (candidate.length===pixels.length && candidate.every((p,i)=>p===pixels[i])) {
          this.identities.set(pixels,candidate);
          return candidate;
        }
      }
      bucket.push(pixels);
    } else {
      this.buckets.set(hash,[pixels]);
    }
    this.identities.set(pixels,pixels);
    this.size++;
    return pixels;
  }
}
