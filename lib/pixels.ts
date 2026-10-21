export type Layer = { id: string; name: string; visible: boolean; pixels: number[] };
export type PixelDocument = { format: 'pixel-workshop/1'; id: string; name: string; width: number; height: number; revision: number; palette: string[]; layers: Layer[]; updatedAt: string };
export type PaintCommand = { op: string; layer?: string; [key: string]: unknown };
export type PixelRegion = { x:number; y:number; width:number; height:number };
export function readRegion(d:PixelDocument,layer:string,region:PixelRegion):number[] {
  const x=requireInt(region.x,0,d.width-1,'x'),y=requireInt(region.y,0,d.height-1,'y');
  const w=requireInt(region.width,1,d.width-x,'width'),h=requireInt(region.height,1,d.height-y,'height');
  const l=d.layers.find(l=>l.id===layer);if(!l)throw new Error('Layer not found.');
  return Array.from({length:w*h},(_,i)=>l.pixels[(y+Math.floor(i/w))*d.width+x+i%w]);
}
export const DEFAULT_PALETTE = ['#201d2b','#3b3048','#64506b','#99809f','#e4d8d5','#fff5df','#453e35','#75543d','#ac754b','#dbab69','#eed49a','#263e38','#41664a','#719554','#a5bd68','#486b78','#76a2ad','#b6d4cd','#604582','#9671ba','#ccb2e5','#b55066','#e2858a','#edb49b'];
export function requireInt(v: unknown, min: number, max: number, label: string): number {
  if (!Number.isInteger(v) || (v as number) < min || (v as number) > max) throw new Error(`${label} must be an integer from ${min} to ${max}.`);
  return v as number;
}
export function color(value: unknown): number {
  if (value === 'transparent') return 0;
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) throw new Error('Use a color like #rrggbb, #rrggbbaa, or transparent.');
  return parseInt(value.slice(1) + (value.length === 7 ? 'ff' : ''), 16) >>> 0;
}
export function hex(value: number): string { return '#' + (value >>> 0).toString(16).padStart(8, '0'); }
export function createDocument(name: string, width: number, height: number, id = crypto.randomUUID()): PixelDocument {
  requireInt(width, 1, 256, 'Width'); requireInt(height, 1, 256, 'Height');
  return { format:'pixel-workshop/1', id, name: String(name || 'Untitled sprite').slice(0,80), width, height, revision:0, palette:[...DEFAULT_PALETTE], layers:[{id:'base',name:'Base',visible:true,pixels:Array(width*height).fill(0)}], updatedAt:new Date().toISOString() };
}
export function validateDocument(input: unknown): PixelDocument {
  const d = input as PixelDocument;
  if (!d || d.format !== 'pixel-workshop/1') throw new Error('This is not a Pixel Workshop project.');
  requireInt(d.width,1,256,'Width'); requireInt(d.height,1,256,'Height');
  if (typeof d.name !== 'string' || d.name.length > 80) throw new Error('Invalid project name.');
  if (!Array.isArray(d.layers) || !d.layers.length || d.layers.length>8) throw new Error('Projects need 1–8 layers.');
  const ids = new Set<string>();
  for (const l of d.layers) {
    if (!l || typeof l.id !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(l.id) || ids.has(l.id)) throw new Error('Invalid or duplicate layer ID.');
    ids.add(l.id);
    if (typeof l.name !== 'string' || l.name.length>60 || typeof l.visible !== 'boolean' || !Array.isArray(l.pixels) || l.pixels.length !== d.width*d.height || l.pixels.some(p=>!Number.isInteger(p)||p<0||p>0xffffffff)) throw new Error('Invalid layer pixels or metadata.');
  }
  if (!Array.isArray(d.palette) || d.palette.length>128) throw new Error('Palette can contain at most 128 colors.');
  d.palette.forEach(color);
  return structuredClone(d);
}
export function composite(d: PixelDocument): Uint8Array {
  const rgba = new Uint8Array(d.width*d.height*4);
  for (const layer of d.layers) {
    if (!layer.visible) continue;
    for(let i=0;i<layer.pixels.length;i++) {
      const p=layer.pixels[i]>>>0, a=(p&255)/255; if (!a) continue;
      const j=i*4, oldA=rgba[j+3]/255, outA=a+oldA*(1-a);
      rgba[j]=Math.round(((p>>>24)*a+rgba[j]*oldA*(1-a))/outA);
      rgba[j+1]=Math.round((((p>>>16)&255)*a+rgba[j+1]*oldA*(1-a))/outA);
      rgba[j+2]=Math.round((((p>>>8)&255)*a+rgba[j+2]*oldA*(1-a))/outA);
      rgba[j+3]=Math.round(outA*255);
    }
  }
  return rgba;
}
export function applyCommands(source: PixelDocument, commands: PaintCommand[]): PixelDocument {
  if (!Array.isArray(commands)||commands.length<1||commands.length>5000) throw new Error('Send 1–5000 drawing commands in one batch.');
  const d=structuredClone(source); let budget=0;
  const spend=(n:number)=>{budget+=n;if(budget>2000000)throw new Error('Drawing batch is too large; split it into smaller batches.');};
  for(const c of commands) {
    if (!c || typeof c.op!=='string') throw new Error('Every command needs an op.');
    if(c.op==='rename'){if(typeof c.name!=='string'||!c.name.trim())throw new Error('Enter a project name.');d.name=c.name.slice(0,80);continue;}
    if(c.op==='palette'){if(!Array.isArray(c.colors)||c.colors.length>128)throw new Error('Choose up to 128 palette colors.');c.colors.forEach(color);d.palette=c.colors as string[];continue;}
    if(c.op==='add_layer'){
      if(d.layers.length>=8)throw new Error('A project can have up to 8 layers.');
      const id=String(c.id||'layer-'+d.layers.length);
      if(!/^[a-z0-9_-]{1,64}$/i.test(id)||d.layers.some(l=>l.id===id))throw new Error('Choose a unique layer ID.');
      d.layers.push({id,name:String(c.name||'New layer').slice(0,60),visible:true,pixels:Array(d.width*d.height).fill(0)});continue;
    }
    const l=d.layers.find(l=>l.id===(c.layer||d.layers[0].id)); if(!l)throw new Error('Layer not found.');
    if(c.op==='visibility'){if(typeof c.visible!=='boolean')throw new Error('visible must be true or false.');l.visible=c.visible;continue;}
    if(c.op==='rename_layer'){l.name=String(c.name||'Layer').slice(0,60);continue;}
    if(c.op==='delete_layer'){if(d.layers.length===1)throw new Error('Keep at least one layer.');d.layers=d.layers.filter(x=>x.id!==l.id);continue;}
    if(c.op==='clear'){l.pixels.fill(0);spend(l.pixels.length);continue;}
    if(c.op==='transform'||c.op==='paste'){
      const x=requireInt(c.x,0,d.width-1,'x'),y=requireInt(c.y,0,d.height-1,'y');
      const w=requireInt(c.width,1,d.width-x,'width'),h=requireInt(c.height,1,d.height-y,'height');
      spend(w*h*3);
      let pixels:number[],tx=x,ty=y;
      if(c.op==='paste'){
        if(!Array.isArray(c.pixels)||c.pixels.length!==w*h||c.pixels.some(p=>!Number.isInteger(p)||p<0||p>0xffffffff))throw new Error('Paste needs width × height packed RGBA pixels.');
        pixels=c.pixels as number[];
      }else{
        if(!['move','copy','flip_horizontal','flip_vertical'].includes(String(c.mode)))throw new Error('Unknown transform mode.');
        pixels=readRegion(d,l.id,{x,y,width:w,height:h});
        if(c.mode==='move'||c.mode==='copy'){
          tx=requireInt(c.x2,0,d.width-w,'x2');ty=requireInt(c.y2,0,d.height-h,'y2');
        }
        if(c.mode==='move')for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++)l.pixels[(y+yy)*d.width+x+xx]=0;
      }
      for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
        const sx=c.op==='transform'&&c.mode==='flip_horizontal'?w-1-xx:xx,sy=c.op==='transform'&&c.mode==='flip_vertical'?h-1-yy:yy;
        l.pixels[(ty+yy)*d.width+tx+xx]=pixels[sy*w+sx];
      }
      continue;
    }
    const ink=color(c.color), x=requireInt(c.x,0,d.width-1,'x'), y=requireInt(c.y,0,d.height-1,'y');
    const put=(px:number,py:number)=>{spend(1);if(px>=0&&py>=0&&px<d.width&&py<d.height)l.pixels[py*d.width+px]=ink;};
    if(c.op==='pixel'){put(x,y);continue;}
    if(c.op==='line'){
      const x2=requireInt(c.x2,0,d.width-1,'x2'), y2=requireInt(c.y2,0,d.height-1,'y2');
      let px=x,py=y;const dx=Math.abs(x2-x),dy=-Math.abs(y2-y),sx=x<x2?1:-1,sy=y<y2?1:-1;let err=dx+dy;
      while(true){put(px,py);if(px===x2&&py===y2)break;const e=err*2;if(e>=dy){err+=dy;px+=sx;}if(e<=dx){err+=dx;py+=sy;}}continue;
    }
    if(c.op==='rect'||c.op==='ellipse'){
      const w=requireInt(c.width,1,d.width-x,'width'),h=requireInt(c.height,1,d.height-y,'height');spend(w*h);
      for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
        if(c.op==='rect'){if(c.filled!==false||xx===0||yy===0||xx===w-1||yy===h-1)put(x+xx,y+yy);}
        else {const inside=(a:number,b:number)=>((a+.5-w/2)/(w/2))**2+((b+.5-h/2)/(h/2))**2<=1;
          if(inside(xx,yy)&&(c.filled!==false||!inside(xx-1,yy)||!inside(xx+1,yy)||!inside(xx,yy-1)||!inside(xx,yy+1)))put(x+xx,y+yy);}
      }continue;
    }
    if(c.op==='fill'){
      const target=l.pixels[y*d.width+x]; if(target===ink)continue;
      const stack=[y*d.width+x];l.pixels[stack[0]]=ink;
      while(stack.length){const n=stack.pop()!;spend(1);const px=n%d.width,py=Math.floor(n/d.width);for(const k of [px>0?n-1:-1,px<d.width-1?n+1:-1,py>0?n-d.width:-1,py<d.height-1?n+d.width:-1])if(k>=0&&l.pixels[k]===target){l.pixels[k]=ink;stack.push(k);}}continue;
    }
    throw new Error(`Unknown drawing operation: ${c.op}`);
  }
  d.revision=source.revision+1;d.updatedAt=new Date().toISOString();return d;
}
