'use client';

import {useCallback,useEffect,useRef,useState,type CSSProperties} from 'react';
import Link from 'next/link';
import {composite,frameCount,frameView,type PixelDocument} from '../../../lib/pixels.ts';
import {createStardropArt,STARDROP_ASSETS,type StardropArt,type StardropArtName} from '../../../lib/stardrop-art.ts';
import {STARDROP_UI_ASSETS,UI_ICONS,UI_STATES,UI_SLICES,type UiIconName} from '../../../lib/stardrop-ui-art.ts';
import {applyStardropUiKit,uiFrame} from '../../../lib/stardrop-kit.ts';
import {parseUiReturn,UI_RETURN_KEY} from '../../../lib/ui-return.ts';
import {buildSpriteSheet} from '../../../lib/sprite-sheet.ts';
import {encodeRgbaSvg} from '../../../lib/svg.ts';
import './stardrop.css';
import ReleaseNotes from '../../release-notes.tsx';

const W=384,H=240,FLOOR=201,GOAL=12,ROUND_TIME=75;
type Phase='title'|'running'|'paused'|'won'|'lost';
type Drop={id:number;x:number;y:number;speed:number;wave:number;kind:'star'|'shade'};
type Particle={x:number;y:number;vx:number;vy:number;life:number;maxLife:number;ink:string};
type Burst={x:number;y:number;at:number;kind:'burst'|'pulse'};
type Hero={x:number;y:number;vy:number;facing:number;invulnerable:number;cooldown:number};
type Game={
  phase:Phase;elapsed:number;remaining:number;score:number;caught:number;hp:number;combo:number;
  lastCatch:number;nextStar:number;nextShade:number;serial:number;seed:number;shake:number;
  hero:Hero;drops:Drop[];particles:Particle[];bursts:Burst[];
};
type View={phase:Phase;score:number;caught:number;hp:number;remaining:number;combo:number;cooldown:number;best:number};
type Sprites=Record<StardropArtName,HTMLCanvasElement[]>;
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
const initial=():Game=>({
  phase:'title',elapsed:0,remaining:ROUND_TIME,score:0,caught:0,hp:3,combo:0,lastCatch:-100,
  nextStar:.5,nextShade:3.5,serial:0,seed:117,shake:0,
  hero:{x:191,y:FLOOR,vy:0,facing:1,invulnerable:0,cooldown:0},
  drops:[],particles:[],bursts:[],
});
function view(g:Game,best:number):View{
  return {phase:g.phase,score:g.score,caught:g.caught,hp:g.hp,remaining:Math.ceil(g.remaining),
    combo:g.combo,cooldown:Math.max(0,g.hero.cooldown),best};
}
function rng(g:Game){
  let s=g.seed|0;s^=s<<13;s^=s>>>17;s^=s<<5;g.seed=s;return(s>>>0)/4294967296;
}
function rasterize(doc:PixelDocument):HTMLCanvasElement[]{
  return Array.from({length:frameCount(doc)},(_,f)=>{
    const canvas=document.createElement('canvas');
    canvas.width=doc.width;canvas.height=doc.height;
    const ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('Canvas rendering is unavailable.');
    const rgba=composite(frameView(doc,f));
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba),doc.width,doc.height),0,0);
    return canvas;
  });
}
function particle(g:Game,x:number,y:number,color:string,count=10){
  for(let n=0;n<count;n++){
    const angle=rng(g)*Math.PI*2,speed=15+rng(g)*70,lifetime=.35+rng(g)*.45;
    g.particles.push({x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-18,
      life:lifetime,maxLife:lifetime,ink:color});
  }
}
function spawn(g:Game,kind:'star'|'shade'){
  const fromLeft=38+rng(g)*306;
  g.drops.push({id:++g.serial,x:fromLeft,y:-20,speed:kind==='star'?38+rng(g)*22:47+rng(g)*30,
    wave:rng(g)*Math.PI*2,kind});
}
function burst(g:Game,x:number,y:number,kind:'burst'|'pulse'='burst'){
  g.bursts.push({x,y,at:g.elapsed,kind});
}
function update(g:Game,dt:number,keys:Set<string>,jump:boolean,pulse:boolean,sound:(kind:'star'|'hurt'|'jump'|'pulse'|'win')=>void){
  g.elapsed+=dt;
  g.shake=Math.max(0,g.shake-dt*5);
  g.hero.invulnerable=Math.max(0,g.hero.invulnerable-dt);
  g.hero.cooldown=Math.max(0,g.hero.cooldown-dt);
  if(g.phase!=='running')return;
  g.remaining=Math.max(0,g.remaining-dt);
  const h=g.hero;
  const left=keys.has('ArrowLeft')||keys.has('KeyA');
  const right=keys.has('ArrowRight')||keys.has('KeyD');
  const movement=Number(right)-Number(left);
  if(movement)h.facing=movement;
  h.x=clamp(h.x+movement*125*dt,26,W-26);
  if(jump && h.y>=FLOOR-.01){h.vy=-184;sound('jump');}
  h.vy+=440*dt;
  h.y=Math.min(FLOOR,h.y+h.vy*dt);
  if(h.y>=FLOOR)h.vy=0;

  if(pulse && h.cooldown<=0){
    h.cooldown=6.2;sound('pulse');burst(g,h.x,h.y-22,'pulse');
    particle(g,h.x,h.y-25,'#c5a4ff',20);
    const kept:Drop[]=[];
    for(const drop of g.drops){
      if(drop.kind==='shade'&&Math.hypot(drop.x-h.x,drop.y-(h.y-20))<85){
        g.score+=35;burst(g,drop.x,drop.y);particle(g,drop.x,drop.y,'#b69de2',8);
      }else kept.push(drop);
    }
    g.drops=kept;
  }
  g.nextStar-=dt;g.nextShade-=dt;
  if(g.nextStar<=0){
    spawn(g,'star');
    g.nextStar=1+ rng(g)*.72;
  }
  if(g.nextShade<=0){
    spawn(g,'shade');
    g.nextShade=2.8+ rng(g)*2.1;
  }
  const kept:Drop[]=[];
  for(const drop of g.drops){
    drop.y+=drop.speed*dt;
    drop.x+=Math.sin(g.elapsed*2.6+drop.wave)*6*dt;
    const distance=Math.hypot(drop.x-h.x,drop.y-(h.y-26));
    if(drop.kind==='star'&&distance<20){
      g.combo=(g.elapsed-g.lastCatch<3.6)?Math.min(5,g.combo+1):1;
      g.lastCatch=g.elapsed;g.caught++;g.score+=100*g.combo;
      burst(g,drop.x,drop.y);particle(g,drop.x,drop.y,'#ffda80',15);sound('star');
      if(g.caught>=GOAL){
        g.phase='won';g.score+=Math.ceil(g.remaining)*10;
        for(let i=0;i<8;i++)particle(g,300+rng(g)*46,130+rng(g)*70,'#fff0b0',10);
        sound('win');
      }
    }else if(drop.kind==='shade'&&distance<21&&h.invulnerable===0){
      g.hp--;h.invulnerable=1.8;g.shake=1;
      g.combo=0;particle(g,h.x,h.y-23,'#d59cce',14);sound('hurt');
      if(g.hp<=0)g.phase='lost';
    }else if(drop.y<FLOOR+16){
      kept.push(drop);
    }
  }
  g.drops=kept;
  for(const p of g.particles){
    p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=58*dt;p.life-=dt;
  }
  g.particles=g.particles.filter(p=>p.life>0);
  g.bursts=g.bursts.filter(b=>g.elapsed-b.at<.9);
  if(g.remaining===0&&g.phase==='running')g.phase='lost';
}
function glow(ctx:CanvasRenderingContext2D,x:number,y:number,r:number,inner:string){
  const grad=ctx.createRadialGradient(x,y,2,x,y,r);
  grad.addColorStop(0,inner);grad.addColorStop(1,'#00000000');
  ctx.fillStyle=grad;ctx.fillRect(x-r,y-r,r*2,r*2);
}
function draw(ctx:CanvasRenderingContext2D,g:Game,s:Sprites,keys:Set<string>){
  ctx.imageSmoothingEnabled=false;
  ctx.clearRect(0,0,W,H);
  ctx.save();
  if(g.shake>0)ctx.translate(Math.round(Math.sin(g.elapsed*63)*g.shake*2),Math.round(Math.cos(g.elapsed*71)*g.shake*2));
  ctx.drawImage(s.backdrop[0],0,0,W,H);
  ctx.globalAlpha=.45;
  ctx.drawImage(s.sparkles[Math.floor(g.elapsed*7)%s.sparkles.length],0,0,W,H);
  ctx.globalAlpha=1;
  // A touch of glow makes the moon and falling objects feel alive.
  glow(ctx,310,49,38,'#e2dcff1a');
  glow(ctx,328,145,36+g.caught*1.5,'#ffb65a30');
  ctx.drawImage(s.beacon[Math.floor(g.elapsed*8)%6],291,121,72,84);
  // Giant framing trees are ordinary, layered Pixel Workshop scenery.
  ctx.drawImage(s.tree[0],-20,88,88,128);
  ctx.save();ctx.translate(W+19,0);ctx.scale(-1,1);
  ctx.drawImage(s.tree[0],0,82,88,128);ctx.restore();
  for(let i=0;i<8;i++)ctx.drawImage(s.grass[0],i*51-3,199+(i%3)*2,48,24);
  for(const drop of g.drops){
    const size=drop.kind==='star'?28:36;
    glow(ctx,drop.x,drop.y,drop.kind==='star'?24:18,drop.kind==='star'?'#ffd87872':'#ab72db43');
    const frames=s[drop.kind];
    const f=Math.floor(g.elapsed*(drop.kind==='star'?9:7)+drop.wave)%frames.length;
    ctx.drawImage(frames[f],Math.round(drop.x-size/2),Math.round(drop.y-size/2),size,size);
  }
  const h=g.hero,walking=keys.has('ArrowLeft')||keys.has('ArrowRight')||keys.has('KeyA')||keys.has('KeyD');
  const heroFrame=h.y<FLOOR?3:walking?Math.floor(g.elapsed*9)%6:0;
  ctx.fillStyle='#10182d80';ctx.beginPath();ctx.ellipse(h.x,FLOOR+1,17,4,0,0,Math.PI*2);ctx.fill();
  glow(ctx,h.x+h.facing*11,h.y-21,27,'#ffd28b4b');
  if(h.invulnerable===0||Math.floor(g.elapsed*12)%2===0){
    ctx.save();ctx.translate(Math.round(h.x),Math.round(h.y));
    ctx.scale(h.facing,1);
    ctx.drawImage(s.moonkeeper[heroFrame],-20,-56,40,56);
    ctx.restore();
  }
  for(const fx of g.bursts){
    const sprites=s[fx.kind],progress=(g.elapsed-fx.at)/.9;
    const index=clamp(Math.floor(progress*sprites.length),0,sprites.length-1);
    const size=fx.kind==='pulse'?166:78;
    ctx.globalAlpha=clamp(1-progress,0,1);
    ctx.drawImage(sprites[index],Math.round(fx.x-size/2),Math.round(fx.y-size/2),size,size);
    ctx.globalAlpha=1;
  }
  for(const p of g.particles){
    ctx.globalAlpha=clamp(p.life/p.maxLife,0,1);
    ctx.fillStyle=p.ink;ctx.fillRect(Math.round(p.x),Math.round(p.y),3,3);
  }
  ctx.globalAlpha=1;
  if(g.hero.invulnerable>0){
    ctx.strokeStyle='#efb8ff66';ctx.lineWidth=2;
    ctx.beginPath();ctx.arc(h.x,h.y-28,25,0,Math.PI*2);ctx.stroke();
  }
  // Foreground tufts give the keeper a place in the world.
  ctx.drawImage(s.grass[0],17,219,48,24);
  ctx.drawImage(s.grass[0],320,220,48,24);
  ctx.restore();
  const vignette=ctx.createLinearGradient(0,0,0,H);
  vignette.addColorStop(0,'#0a12251f');vignette.addColorStop(.6,'#00000000');vignette.addColorStop(1,'#0b101746');
  ctx.fillStyle=vignette;ctx.fillRect(0,0,W,H);
}
function saveBlob(name:string,blob:Blob){
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function nameFor(key:StardropArtName){return 'stardrop-'+key;}
function UiIcon({name,className=''}:{name:UiIconName;className?:string}){
  return <span aria-hidden="true" className={'stardrop-icon '+className} style={{backgroundImage:`var(--ui-icon-${name})`}}/>;
}
export default function MoonkeeperGame(){
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const kitFile=useRef<HTMLInputElement>(null);
  const gameRef=useRef<Game>(initial());
  const cacheRef=useRef<Sprites|null>(null);
  const keysRef=useRef(new Set<string>());
  const actionsRef=useRef({jump:false,pulse:false});
  const audioRef=useRef<AudioContext|null>(null);
  const soundOnRef=useRef(true);
  const bestRef=useRef(0);
  const [soundOn,setSoundOn]=useState(true);
  const [art,setArt]=useState<StardropArt|null>(null);
  const [thumbnails,setThumbnails]=useState<Partial<Record<StardropArtName,string>>>({});
  const [skin,setSkin]=useState<CSSProperties>({});
  const [error,setError]=useState('');
  const [packError,setPackError]=useState(''),[downloadingPack,setDownloadingPack]=useState(false);
  const [kitMessage,setKitMessage]=useState('Original Stardrop UI kit'),[customKit,setCustomKit]=useState(false),[canReturnToEditor,setCanReturnToEditor]=useState(false);
  const [ui,setUi]=useState<View>(()=>view(gameRef.current,0));
  const playSound=useCallback((kind:'star'|'hurt'|'jump'|'pulse'|'win')=>{
    if(!soundOnRef.current)return;
    try{
      const audio=audioRef.current??new AudioContext();audioRef.current=audio;
      if(audio.state==='suspended')void audio.resume();
      const notes=kind==='win'?[523,659,784,1046]:kind==='star'?[620,930]:kind==='jump'?[280,370]:kind==='pulse'?[210,340,500]:[220,140];
      for(let i=0;i<notes.length;i++){
        const oscillator=audio.createOscillator(),gain=audio.createGain();
        const at=audio.currentTime+i*(kind==='win'?.105:.045);
        oscillator.type=kind==='hurt'?'sawtooth':'sine';
        oscillator.frequency.setValueAtTime(notes[i],at);
        gain.gain.setValueAtTime(.0001,at);
        gain.gain.exponentialRampToValueAtTime(kind==='hurt'?.038:.065,at+.015);
        gain.gain.exponentialRampToValueAtTime(.0001,at+.19);
        oscillator.connect(gain);gain.connect(audio.destination);
        oscillator.start(at);oscillator.stop(at+.2);
      }
    }catch{/* Audio should never prevent playing. */}
  },[]);
  const installArt=useCallback((a:StardropArt)=>{
      const sprites={} as Sprites;
      const previews:Partial<Record<StardropArtName,string>>={};
      for(const {key} of STARDROP_ASSETS){
        sprites[key]=rasterize(a[key]);
        previews[key]=sprites[key][0].toDataURL('image/png');
        // Show the complete UI family, rather than hiding every state/icon
        // behind the first frame of what the editor calls an animation.
        if(key.startsWith('ui')&&sprites[key].length>1){
          const doc=a[key],frames=sprites[key],columns=key==='uiIcons'?8:Math.min(2,frames.length);
          const board=document.createElement('canvas');
          board.width=(doc.width+4)*columns;board.height=(doc.height+4)*Math.ceil(frames.length/columns);
          const context=board.getContext('2d');
          if(context){frames.forEach((frame,i)=>context.drawImage(frame,(i%columns)*(doc.width+4),Math.floor(i/columns)*(doc.height+4)));
            previews[key]=board.toDataURL('image/png');}
        }
      }
      cacheRef.current=sprites;
      const image=(key:StardropArtName,frame=0)=>`url("${sprites[key][frame].toDataURL('image/png')}")`;
      const named=(key:StardropArtName,name:string,fallback:number)=>image(key,uiFrame(a[key],name,fallback));
      const slice=(key:'uiPanel'|'uiButton'|'uiButtonGold')=>{
        const s=a[key].ui?.slice;if(!s)return String(UI_SLICES[key]);return `${s.top} ${s.right} ${s.bottom} ${s.left}`;
      };
      const uiImages:Record<string,string>={
        '--ui-panel':named('uiPanel','moonstone',0),'--ui-plum-panel':named('uiPanel','plum',1),
        '--ui-panel-slice':slice('uiPanel'),'--ui-button-slice':slice('uiButton'),'--ui-gold-slice':slice('uiButtonGold'),
        '--ui-logo':image('uiLogo'),'--ui-paper':image('uiStardust'),'--ui-divider':image('uiDivider'),
        '--ui-meter-track':named('uiMeter','track',0),'--ui-meter-starlight':named('uiMeter','starlight',1),'--ui-meter-moonwave':named('uiMeter','moonwave',2),
      };
      // Insets beyond the fixed border become extra padding in the menu preview.
      const panelSlice=a.uiPanel.ui?.slice;
      if(panelSlice?.content){
        for(const side of ['top','right','bottom','left'] as const){
          uiImages['--ui-content-'+side]=String(Math.max(0,(panelSlice.content[side]-panelSlice[side])/Math.max(1,panelSlice[side])));
        }
      }
      UI_ICONS.forEach((name,i)=>{uiImages['--ui-icon-'+name]=named('uiIcons',name,i);});
      UI_STATES.forEach((state,i)=>{
        uiImages['--ui-button-'+state]=named('uiButton',state,i);
        uiImages['--ui-gold-'+state]=named('uiButtonGold',state,i);
      });
      setSkin(uiImages as CSSProperties);
      setArt(a);setThumbnails(previews);
  },[]);
  useEffect(()=>{
    try{
      let a=createStardropArt();
      if(new URLSearchParams(window.location.search).get('uiPreview')==='1'){
        try{
          const raw=sessionStorage.getItem('pixel-workshop-ui-preview-v1');
          if(raw){const payload=JSON.parse(raw) as {format?:string;documents?:unknown[]};
            if(payload.format!=='pixel-workshop-ui-preview/1'||!payload.documents)throw new Error('This UI preview is invalid.');
            const merged=applyStardropUiKit(a,payload.documents);a=merged.art;setCustomKit(true);setKitMessage(`Previewing ${merged.count} edited UI assets in this tab`);
            setCanReturnToEditor(!!parseUiReturn(sessionStorage.getItem(UI_RETURN_KEY)));}
        }catch(e){setPackError((e as Error).message+' The original kit is shown.');}
      }
      installArt(a);
      try{bestRef.current=Number(localStorage.getItem('stardrop-best')||0)||0;}catch{/* storage optional */}
      setUi(view(gameRef.current,bestRef.current));
    }catch(e){setError(e instanceof Error?e.message:'Failed to generate game art.');}
    return()=>{void audioRef.current?.close();audioRef.current=null;};
  },[installArt]);
  useEffect(()=>{
    if(!art)return;
    const canvas=canvasRef.current,ctx=canvas?.getContext('2d');
    if(!ctx)return;
    let raf=0,last=0,lastUi=0,oldPhase:Phase='title';
    const tick=(now:number)=>{
      if(!last)last=now;
      const dt=Math.min(.034,Math.max(0,(now-last)/1000));last=now;
      const g=gameRef.current,actions=actionsRef.current;
      const j=actions.jump,p=actions.pulse;actions.jump=false;actions.pulse=false;
      update(g,dt,keysRef.current,j,p,playSound);
      if(oldPhase!==g.phase){
        oldPhase=g.phase;
        if(g.phase==='won'&&g.score>bestRef.current){
          bestRef.current=g.score;
          try{localStorage.setItem('stardrop-best',String(g.score));}catch{}
        }
      }
      if(cacheRef.current)draw(ctx,g,cacheRef.current,keysRef.current);
      if(now-lastUi>120){setUi(view(g,bestRef.current));lastUi=now;}
      raf=requestAnimationFrame(tick);
    };
    raf=requestAnimationFrame(tick);
    const keyDown=(e:KeyboardEvent)=>{
      if((e.target as HTMLElement|null)?.closest('[data-release-notes]'))return;
      const tag=(e.target as HTMLElement|null)?.tagName;
      if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT')return;
      if(['ArrowLeft','ArrowRight','ArrowUp','Space','ShiftLeft','ShiftRight'].includes(e.code))e.preventDefault();
      keysRef.current.add(e.code);
      if(!e.repeat&&['Space','ArrowUp','KeyW'].includes(e.code))actionsRef.current.jump=true;
      if(!e.repeat&&['ShiftLeft','ShiftRight','KeyK'].includes(e.code))actionsRef.current.pulse=true;
      if(!e.repeat&&e.code==='KeyP'){
        const g=gameRef.current;
        g.phase=g.phase==='running'?'paused':g.phase==='paused'?'running':g.phase;
        setUi(view(g,bestRef.current));
      }
      if(!e.repeat&&e.code==='Enter'&&['title','won','lost'].includes(gameRef.current.phase))start();
    };
    const keyUp=(e:KeyboardEvent)=>keysRef.current.delete(e.code);
    const blur=()=>{keysRef.current.clear();const g=gameRef.current;if(g.phase==='running'){g.phase='paused';setUi(view(g,bestRef.current));}};
    document.addEventListener('keydown',keyDown);document.addEventListener('keyup',keyUp);
    window.addEventListener('blur',blur);
    return()=>{cancelAnimationFrame(raf);document.removeEventListener('keydown',keyDown);document.removeEventListener('keyup',keyUp);window.removeEventListener('blur',blur);};
    // Game uses ref-backed state so an animation loop never rebinds to a HUD update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[art,playSound]);
  const start=()=>{
    keysRef.current.clear();actionsRef.current.jump=false;actionsRef.current.pulse=false;
    gameRef.current={...initial(),phase:'running'};
    setUi(view(gameRef.current,bestRef.current));
  };
  const togglePause=()=>{
    const g=gameRef.current;
    g.phase=g.phase==='paused'?'running':g.phase==='running'?'paused':g.phase;
    keysRef.current.clear();setUi(view(g,bestRef.current));
  };
  const toggleSound=()=>{soundOnRef.current=!soundOnRef.current;setSoundOn(soundOnRef.current);};
  const onHold=(key:string,down:boolean)=>{if(down)keysRef.current.add(key);else keysRef.current.delete(key);};
  const project=(key:StardropArtName)=>{
    if(!art)return;
    saveBlob(nameFor(key)+'.pixel.json',new Blob([JSON.stringify(art[key])],{type:'application/json'}));
  };
  const sheet=(key:StardropArtName,format:'png'|'svg'='png')=>{
    if(!art||!cacheRef.current)return;
    if(format==='svg'){
      try{
        const output=buildSpriteSheet(art[key],undefined,'svg');
        saveBlob(nameFor(key)+'-sheet.svg',new Blob([encodeRgbaSvg(output.bytes,output.width,output.height)],{type:'image/svg+xml;charset=utf-8'}));
        setPackError('');
      }catch(e){setPackError(e instanceof Error?e.message:'Unable to export SVG.');}
      return;
    }
    const frames=cacheRef.current[key],doc=art[key],cols=Math.min(8,frames.length),rows=Math.ceil(frames.length/cols);
    const canvas=document.createElement('canvas');canvas.width=doc.width*cols;canvas.height=doc.height*rows;
    const ctx=canvas.getContext('2d');if(!ctx)return;ctx.imageSmoothingEnabled=false;
    frames.forEach((frame,i)=>ctx.drawImage(frame,(i%cols)*doc.width,Math.floor(i/cols)*doc.height));
    canvas.toBlob(blob=>{if(blob)saveBlob(nameFor(key)+'-sheet.png',blob);},'image/png');
  };
  const downloadArtPack=async()=>{
    if(!art||downloadingPack)return;
    setDownloadingPack(true);setPackError('');
    try{
      const {buildGamePack}=await import('../../../lib/game-pack.ts');
      const {bytes}=buildGamePack(STARDROP_ASSETS.map(asset=>art[asset.key]));
      saveBlob('stardrop-game-assets.zip',new Blob([bytes],{type:'application/zip'}));
    }catch(e){setPackError(e instanceof Error?e.message:'Unable to create the game pack.');}
    finally{setDownloadingPack(false);}
  };
  const editUiKit=()=>{
    if(!art)return;
    try{
      const kitId='kit-'+crypto.randomUUID();
      const documents=STARDROP_UI_ASSETS.map(({key})=>art[key]);
      sessionStorage.setItem('pixel-workshop-pending-ui-kit-v1',JSON.stringify({format:'pixel-workshop-ui-kit-import/1',kitId,documents}));
      sessionStorage.removeItem(UI_RETURN_KEY);
      window.location.assign('/');
    }catch(e){setPackError(e instanceof Error?e.message:'Could not open the UI kit.');}
  };
  const loadKit=async(file:File)=>{
    try{
      if(file.size>64*1024*1024)throw new Error('Choose a game pack smaller than 64 MB.');
      const {readGamePack}=await import('../../../lib/read-game-pack.ts');
      const documents=readGamePack(new Uint8Array(await file.arrayBuffer()));
      const merged=applyStardropUiKit(createStardropArt(),documents);
      sessionStorage.setItem('pixel-workshop-ui-preview-v1',JSON.stringify({format:'pixel-workshop-ui-preview/1',documents}));
      sessionStorage.removeItem(UI_RETURN_KEY);setCanReturnToEditor(false);
      window.history.replaceState(null,'','/play/moonkeeper?uiPreview=1');
      if(gameRef.current.phase==='running')gameRef.current.phase='paused';keysRef.current.clear();
      installArt(merged.art);setUi(view(gameRef.current,bestRef.current));setCustomKit(true);setPackError('');setKitMessage(`Previewing ${merged.count} edited UI assets in this tab`);
    }catch(e){setPackError(e instanceof Error?e.message:'Unable to load that UI kit.');}
  };
  const restoreKit=()=>{
    try{sessionStorage.removeItem('pixel-workshop-ui-preview-v1');sessionStorage.removeItem(UI_RETURN_KEY);window.history.replaceState(null,'','/play/moonkeeper');}catch{}
    if(gameRef.current.phase==='running')gameRef.current.phase='paused';keysRef.current.clear();
    installArt(createStardropArt());setUi(view(gameRef.current,bestRef.current));setCustomKit(false);setCanReturnToEditor(false);setKitMessage('Original Stardrop UI kit');setPackError('');
  };
  return <main className="stardrop" style={skin}>
    <header className="stardrop-topbar">
      <Link className="stardrop-back stardrop-button" href={canReturnToEditor?'/?resumeUiKit=1':'/'}><UiIcon name="back"/>{canReturnToEditor?'RETURN TO EDITOR':'PIXEL WORKSHOP'}</Link>
      <span className="stardrop-edition">A LITTLE WORLD, MADE OF PIXELS <span>·</span> BUILD 02</span>
      <button className="stardrop-sound stardrop-button" type="button" onClick={toggleSound} aria-pressed={soundOn}><UiIcon name={soundOn?'sound':'soundOff'}/>{soundOn?'SOUND ON':'SOUND OFF'}</button>
    </header>
    <div className="stardrop-content">
      <div className="stardrop-intro">
        <div className="stardrop-eyebrow">A PIXEL WORKSHOP PLAYABLE EXPERIMENT</div>
        <h1 className="stardrop-logo"><span className="stardrop-sr-only">Stardrop</span></h1>
        <p>A Moonkeeper Tale</p>
        <div className="stardrop-intro-line" aria-hidden="true"/>
        <div className="stardrop-description">The stars have fallen from their places. Gather twelve before the dark finds you.</div>
      </div>
      <section className="stardrop-machine" aria-label="Stardrop arcade game">
        <div className="stardrop-hud">
          <div><UiIcon name="star"/><div><span className="stardrop-hud-label">STARLIGHT</span><strong>{ui.caught}<small> / {GOAL}</small></strong></div></div>
          <div><UiIcon name="crown"/><div><span className="stardrop-hud-label">SCORE</span><strong>{ui.score.toLocaleString()}</strong></div></div>
          <div><div><span className="stardrop-hud-label">LIVES</span><strong className="stardrop-lives" role="img" aria-label={`${ui.hp} of 3 lives remaining`}>{[0,1,2].map(i=><UiIcon key={i} name={i<ui.hp?'heart':'heartEmpty'}/>)}</strong></div></div>
          <div><UiIcon name="clock"/><div><span className="stardrop-hud-label">TIME</span><strong className={ui.remaining<=15?'stardrop-urgent':''}>{ui.remaining}<small>s</small></strong></div></div>
        </div>
        <div className="stardrop-stage">
          <canvas ref={canvasRef} width={W} height={H} aria-label="Moonlit valley. Move to catch falling stars and dodge shades." role="img"/>
          {(!art||error)&&<div className="stardrop-overlay"><div className="stardrop-menu">
            <span className="stardrop-overlay-kicker">PIXEL WORKSHOP</span>
            <h2>{error?'The art generator stumbled':'Painting the valley…'}</h2>
            <p>{error||'Drawing every pixel and animation cel with the shared engine.'}</p>
          </div></div>}
          {art&&ui.phase!=='running'&&<div className="stardrop-overlay"><div className="stardrop-menu">
            <UiIcon name={ui.phase==='won'?'crown':ui.phase==='paused'?'pause':'moon'} className="stardrop-menu-emblem"/>
            <span className="stardrop-overlay-kicker">{ui.phase==='title'?'THE STARS ARE FALLING':ui.phase==='paused'?'A MOMENT OF STILLNESS':ui.phase==='won'?'THE VALLEY IS BRIGHT AGAIN':'THE SHADOWS HAVE GATHERED'}</span>
            <h2>{ui.phase==='title'?'Light the last lantern':ui.phase==='paused'?'Paused':ui.phase==='won'?'The stars are home.':'The night won this time.'}</h2>
            <p>{ui.phase==='title'?'Catch 12 stars. Avoid the drifting shades. A moonwave can save you in a pinch.':ui.phase==='paused'?'Take all the time you need. The stars can wait.':ui.phase==='won'?'Beautifully done. The lantern burns for another night. Final score: '+ui.score.toLocaleString()+'.':'The lantern fades, but there is always another night.'}</p>
            <button type="button" className="stardrop-primary stardrop-button stardrop-button-gold" onClick={ui.phase==='paused'?togglePause:start}><UiIcon name="play"/>{ui.phase==='title'?'BEGIN THE NIGHT':ui.phase==='paused'?'RESUME THE NIGHT':'PLAY AGAIN'}</button>
          </div></div>}
          {ui.phase==='running'&&ui.combo>1&&<div className="stardrop-combo">{ui.combo}× COMBO</div>}
        </div>
        <div className="stardrop-bottom">
          {ui.phase==='title'&&<ReleaseNotes edition="moonkeeper"/>}
          <div className="stardrop-progress" role="progressbar" aria-label="Stars gathered" aria-valuenow={ui.caught} aria-valuemin={0} aria-valuemax={GOAL}><span style={{width:(ui.caught/GOAL)*100+'%'}}/></div>
          <div className="stardrop-status">
            <span className="stardrop-quest"><UiIcon name="star"/>{ui.caught===GOAL?'THE LIGHT HAS RETURNED':'GATHER THE FALLEN STARS'}</span>
            <div className="stardrop-ability"><UiIcon name="moon"/><div><span>MOONWAVE <strong>{ui.cooldown>0?ui.cooldown.toFixed(1)+'s':'READY'}</strong></span><div className="stardrop-cooldown" role="progressbar" aria-label="Moonwave recharge" aria-valuenow={Math.round((1-ui.cooldown/6.2)*100)} aria-valuemin={0} aria-valuemax={100}><span style={{width:(1-ui.cooldown/6.2)*100+'%'}}/></div></div></div>
            <button className="stardrop-button" type="button" onClick={togglePause} disabled={ui.phase!=='running'&&ui.phase!=='paused'}><UiIcon name={ui.phase==='paused'?'play':'pause'}/>{ui.phase==='paused'?'RESUME':'PAUSE'} [P]</button>
          </div>
        </div>
      </section>
      <div className="stardrop-control-row">
        <div className="stardrop-guide"><span><UiIcon name="right"/><b>MOVE</b> A / D or ← →</span><span><UiIcon name="jump"/><b>JUMP</b> Space / ↑</span><span><UiIcon name="moon"/><b>MOONWAVE</b> Shift / K</span></div>
        <div className="stardrop-pad" aria-label="Touch game controls">
          <button className="stardrop-button" aria-label="Move left" onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);onHold('ArrowLeft',true);}} onPointerUp={()=>onHold('ArrowLeft',false)} onPointerCancel={()=>onHold('ArrowLeft',false)} onLostPointerCapture={()=>onHold('ArrowLeft',false)}><UiIcon name="left"/></button>
          <button className="stardrop-button" aria-label="Move right" onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);onHold('ArrowRight',true);}} onPointerUp={()=>onHold('ArrowRight',false)} onPointerCancel={()=>onHold('ArrowRight',false)} onLostPointerCapture={()=>onHold('ArrowRight',false)}><UiIcon name="right"/></button>
          <button className="stardrop-button" aria-label="Jump" onClick={()=>{actionsRef.current.jump=true;}}><UiIcon name="jump"/></button>
          <button className="stardrop-button" aria-label="Moonwave" onClick={()=>{actionsRef.current.pulse=true;}}><UiIcon name="moon"/></button>
        </div>
      </div>
      <div className="stardrop-divider"><span aria-hidden="true"/><span>MADE IN THE WORKSHOP</span><span aria-hidden="true"/></div>
      <section className="stardrop-workbench">
        <div className="stardrop-workbench-title">
          <div><h2>The asset workbench</h2><p>The valley, the keeper, even the buttons. Every piece below is made with Pixel Workshop drawing commands or its seeded effects engine. Download the editable project or its real PNG sheet. Button states and icons are named frames in their source projects.</p></div>
          <div className="stardrop-art-count"><strong>{STARDROP_ASSETS.length}</strong><span>EDITABLE ASSETS</span></div>
        </div>
        <div className="stardrop-kit-tools" aria-label="Stardrop UI kit">
          <div><strong>Make this interface yours</strong><span role="status">{kitMessage}</span></div>
          <div className="stardrop-kit-actions">
            {canReturnToEditor&&<Link className="stardrop-button" href="/?resumeUiKit=1">RETURN TO EDITOR</Link>}
            <button className="stardrop-button" type="button" disabled={!art} onClick={editUiKit}>{canReturnToEditor?'MAKE A NEW KIT COPY':'EDIT UI KIT IN WORKSHOP'}</button>
            <button className="stardrop-button" type="button" onClick={()=>kitFile.current?.click()}>LOAD UI KIT ZIP</button>
            {customKit&&<button className="stardrop-button" type="button" onClick={restoreKit}>RESTORE ORIGINAL</button>}
          </div>
          <input ref={kitFile} type="file" accept=".zip,application/zip" aria-label="Choose a UI kit ZIP" className="stardrop-sr-only" onChange={e=>{const f=e.target.files?.[0];if(f)void loadKit(f);e.target.value='';}}/>
        </div>
        <div className="stardrop-pack-banner">
          <div><strong>Take the whole little world.</strong><span>{STARDROP_ASSETS.length} native projects, PNG sheets, clips and atlases—including the complete interface skin.</span></div>
          <button className="stardrop-button stardrop-button-gold" type="button" onClick={()=>void downloadArtPack()} disabled={!art||downloadingPack}><UiIcon name="download"/>{downloadingPack?'PACKING ASSETS…':'DOWNLOAD ASSET PACK'}</button>
        </div>
        {packError&&<p className="stardrop-pack-error" role="alert">{packError}</p>}
        <div className="stardrop-art-grid">
          {STARDROP_ASSETS.map(asset=><article className="stardrop-art" key={asset.key}>
            <div className="stardrop-art-image">{thumbnails[asset.key]&&<img src={thumbnails[asset.key]} alt={asset.label+' pixel-art preview'}/>}</div>
            <div className="stardrop-art-info"><h3>{asset.label}</h3><span>{asset.role}</span></div>
            <div className="stardrop-art-actions">
              <button className="stardrop-button" disabled={!art} type="button" onClick={()=>project(asset.key)}>EDITABLE .PIXEL.JSON</button>
              <button className="stardrop-button" disabled={!art} type="button" onClick={()=>sheet(asset.key)}>PNG SHEET <UiIcon name="download"/></button>
              <button className="stardrop-button" disabled={!art} type="button" onClick={()=>sheet(asset.key,'svg')}>SVG SHEET <UiIcon name="download"/></button>
            </div>
          </article>)}
        </div>
      </section>
      <footer className="stardrop-footer"><span>STARDROP / A MOONKEEPER TALE</span><span>PAINTED IN CODE. PLAYED IN PIXELS. ✧</span><Link href="/">BACK TO PIXEL WORKSHOP</Link></footer>
    </div>
  </main>;
}
