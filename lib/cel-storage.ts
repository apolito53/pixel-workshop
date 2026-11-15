/** Packed RGBA in row order. Dense arrays remain valid input for legacy projects. */
export type CroppedCel = { x:number; y:number; width:number; height:number; data:number[] };
export type Cel = number[] | CroppedCel;

export function blankCel():CroppedCel {return {x:0,y:0,width:0,height:0,data:[]};}
export function celData(cel:Cel):number[] {return Array.isArray(cel)?cel:cel.data;}
export function celArea(cel:Cel):number {return celData(cel).length;}
export function celRect(cel:Cel,width:number,height:number):CroppedCel {
  return Array.isArray(cel)?{x:0,y:0,width,height,data:cel}:cel;
}
export function celPixel(cel:Cel,x:number,y:number,canvasWidth:number):number {
  if(Array.isArray(cel))return cel[y*canvasWidth+x];
  const dx=x-cel.x,dy=y-cel.y;
  return dx<0||dy<0||dx>=cel.width||dy>=cel.height?0:cel.data[dy*cel.width+dx];
}
export function denseCel(cel:Cel,canvasWidth:number,canvasHeight:number):number[] {
  if(Array.isArray(cel))return cel;
  if(cel.width===canvasWidth&&cel.height===canvasHeight)return cel.data;
  const data=new Array<number>(canvasWidth*canvasHeight).fill(0);
  for(let y=0;y<cel.height;y++)for(let x=0;x<cel.width;x++)data[(cel.y+y)*canvasWidth+cel.x+x]=cel.data[y*cel.width+x];
  return data;
}
/** Tight bounds include any nonzero word, including RGB hidden beneath zero alpha. */
export function cropCel(cel:Cel,canvasWidth:number,canvasHeight:number):CroppedCel {
  const rect=celRect(cel,canvasWidth,canvasHeight);
  let left=rect.width,top=rect.height,right=-1,bottom=-1;
  for(let y=0;y<rect.height;y++)for(let x=0;x<rect.width;x++){
    if(rect.data[y*rect.width+x]===0)continue;
    left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=y;
  }
  if(right<0)return rect.width===0&&rect.height===0&&rect.x===0&&rect.y===0?rect:blankCel();
  const width=right-left+1,height=bottom-top+1;
  if(width===rect.width&&height===rect.height)return rect;
  const data=new Array<number>(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data[y*width+x]=rect.data[(top+y)*rect.width+left+x];
  return {x:rect.x+left,y:rect.y+top,width,height,data};
}

/** Canonicalize read-only cels. Position participates in equality for cropped cels. */
export class CelInterner<T extends Cel=number[]> {
  private identities = new WeakMap<T,T>();
  private buckets = new Map<number,T[]>();
  private hashes?:WeakMap<Cel,number>;
  size=0;
  cells=0;

  constructor(hashes?:WeakMap<Cel,number>) {
    this.hashes=hashes;
  }

  intern(cel:T):T {
    const known=this.identities.get(cel);
    if(known)return known;
    const data=celData(cel);
    let hash=this.hashes?.get(cel);
    if(hash===undefined){
      hash=data.length;
      if(!Array.isArray(cel))for(const n of [cel.x,cel.y,cel.width,cel.height])hash=Math.imul(hash^n,16777619);
      for(let i=0;i<data.length;i++)hash=Math.imul(hash^data[i],16777619);
      if(!Array.isArray(cel))this.hashes?.set(cel,hash);
    }
    const bucket=this.buckets.get(hash);
    if(bucket){
      for(const candidate of bucket){
        if(Array.isArray(candidate)!==Array.isArray(cel))continue;
        if(!Array.isArray(candidate)&&!Array.isArray(cel)&&
          (candidate.x!==cel.x||candidate.y!==cel.y||candidate.width!==cel.width||candidate.height!==cel.height))continue;
        const values=celData(candidate);
        if(values.length===data.length&&values.every((p,i)=>p===data[i])){
          this.identities.set(cel,candidate);
          return candidate;
        }
      }
      bucket.push(cel);
    } else this.buckets.set(hash,[cel]);
    this.identities.set(cel,cel);
    this.size++;this.cells+=data.length;
    return cel;
  }
}

/** A single active drawing uses copy-on-write 16×16 tiles. Consecutive brush
 * samples can grow in any direction without repeatedly resizing a rectangle. */
const TILE=16;
export class CelBrush {
  private base:CroppedCel;
  private canvasWidth:number;
  private tilesAcross:number;
  private tiles=new Map<number,Uint32Array>();
  private left:number;
  private top:number;
  private right:number;
  private bottom:number;

  constructor(cel:Cel,width:number,height:number) {
    this.base=celRect(cel,width,height);
    this.canvasWidth=width;
    this.tilesAcross=Math.ceil(width/TILE);
    this.left=this.base.width?this.base.x:width;
    this.top=this.base.height?this.base.y:height;
    this.right=this.base.x+this.base.width-1;
    this.bottom=this.base.y+this.base.height-1;
  }
  private key(x:number,y:number){return (y>>4)*this.tilesAcross+(x>>4);}
  read(x:number,y:number):number {
    const tile=this.tiles.get(this.key(x,y));
    return tile?tile[(y&15)*TILE+(x&15)]:celPixel(this.base,x,y,this.canvasWidth);
  }
  write(x:number,y:number,pixel:number) {
    const key=this.key(x,y),offset=(y&15)*TILE+(x&15);
    let tile=this.tiles.get(key);
    if((tile?tile[offset]:celPixel(this.base,x,y,this.canvasWidth))===pixel)return;
    if(!tile){
      tile=new Uint32Array(TILE*TILE);
      const bx=x&~15,by=y&~15;
      const x0=Math.max(bx,this.base.x),x1=Math.min(bx+TILE,this.base.x+this.base.width);
      const y0=Math.max(by,this.base.y),y1=Math.min(by+TILE,this.base.y+this.base.height);
      for(let yy=y0;yy<y1;yy++)for(let xx=x0;xx<x1;xx++)
        tile[(yy-by)*TILE+xx-bx]=this.base.data[(yy-this.base.y)*this.base.width+xx-this.base.x];
      this.tiles.set(key,tile);
    }
    tile[offset]=pixel;
    if(pixel!==0){
      this.left=Math.min(this.left,x);this.right=Math.max(this.right,x);
      this.top=Math.min(this.top,y);this.bottom=Math.max(this.bottom,y);
    }
  }
  finish(charge:(area:number)=>void):CroppedCel|undefined {
    if(!this.tiles.size)return;
    const width=this.right-this.left+1,height=this.bottom-this.top+1;
    charge(width*height);
    const base=this.base;
    const sameBounds=this.left===base.x&&this.top===base.y&&width===base.width&&height===base.height;
    const data=sameBounds?base.data.slice():new Array<number>(width*height).fill(0);
    if(!sameBounds){
      for(let y=0;y<base.height;y++){
        const start=(base.y-this.top+y)*width+base.x-this.left;
        for(let x=0;x<base.width;x++)data[start+x]=base.data[y*base.width+x];
      }
    }
    for(const [key,tile] of this.tiles){
      const bx=(key%this.tilesAcross)*TILE,by=Math.floor(key/this.tilesAcross)*TILE;
      const x0=Math.max(bx,this.left),x1=Math.min(bx+TILE,this.right+1);
      const y0=Math.max(by,this.top),y1=Math.min(by+TILE,this.bottom+1);
      for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)
        data[(y-this.top)*width+x-this.left]=tile[(y-by)*TILE+x-bx];
    }
    return cropCel({x:this.left,y:this.top,width,height,data},width,height);
  }
}
