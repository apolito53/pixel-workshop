import {applyCommands,createDocument,type PaintCommand,type PixelDocument} from './pixels.ts';

/** All UI artwork is drawn by Pixel Workshop, just like the valley and sprites.
 * No SVGs, CSS-drawn icons, stock art, or external image generator are involved.
 * Slice geometry and state names live here because the native format cannot yet
 * describe UI skins. The production diary records that limitation explicitly. */
export const STARDROP_UI_ASSETS = [
  {key:'uiPanel',label:'Moonstone Frames',role:'2 panel skins · 12 px slices'},
  {key:'uiButton',label:'Twilight Buttons',role:'4 interaction states · 6 px slices'},
  {key:'uiButtonGold',label:'Lantern Buttons',role:'4 interaction states · 6 px slices'},
  {key:'uiIcons',label:'Keeper’s Instruments',role:'16 named interface icons'},
  {key:'uiLogo',label:'Stardrop Lettering',role:'hand-drawn pixel wordmark'},
  {key:'uiMeter',label:'Starlight Meters',role:'track, starlight & moonwave tiles'},
  {key:'uiStardust',label:'Night Sky Paper',role:'seamless 64 px background tile'},
  {key:'uiDivider',label:'Constellation Thread',role:'pixel ornament & section rule'},
] as const;
export type StardropUiArtName=typeof STARDROP_UI_ASSETS[number]['key'];
export type StardropUiArt=Record<StardropUiArtName,PixelDocument>;
export const UI_ICONS=['star','heart','heartEmpty','clock','crown','moon','sound','soundOff','pause','play','left','right','jump','download','back','workshop'] as const;
export type UiIconName=typeof UI_ICONS[number];
export const UI_STATES=['rest','hover','pressed','disabled'] as const;
export const UI_SLICES={uiPanel:12,uiButton:6,uiButtonGold:6} as const;

const P={ink:'#111629',edge:'#39394e',slate:'#60677e',silver:'#a0a7bc',pale:'#e8e4d4',
  gold:'#c29965',light:'#f4d79a',pink:'#dd91ad',rose:'#955571',violet:'#a494d6',deep:'#1c2037',teal:'#80b8af'};
function drawing(name:string,width:number,height:number,frames=1){
  const commands:PaintCommand[]=[];
  commands.push({op:'add_layer',id:'details',name:'Highlights & ornament'});
  for(let i=1;i<frames;i++)commands.push({op:'frame_add',id:'state-'+i,blank:true});
  const ink=(frame=0,layer='base')=>({
    r:(x:number,y:number,w:number,h:number,color:string)=>commands.push({op:'rect',x,y,width:w,height:h,color,frame,layer}),
    p:(x:number,y:number,color:string)=>commands.push({op:'pixel',x,y,color,frame,layer}),
    e:(x:number,y:number,w:number,h:number,color:string)=>commands.push({op:'ellipse',x,y,width:w,height:h,color,frame,layer}),
    l:(x:number,y:number,x2:number,y2:number,color:string)=>commands.push({op:'line',x,y,x2,y2,color,frame,layer}),
  });
  return {ink,finish:(names:string[]=[])=>{
    names.forEach((name,i)=>commands.push({op:'clip_set',name,from:i,to:i,fps:8,mode:'once'}));
    commands.push({op:'palette',colors:Object.values(P)});
    return applyCommands(createDocument(name,width,height,'stardrop-ui-'+name.toLowerCase().replace(/[^a-z0-9]+/g,'-')),commands);
  }};
}
type Pen=ReturnType<ReturnType<typeof drawing>['ink']>;
function diamond(p:Pen,x:number,y:number,c:string){p.p(x,y-2,c);p.r(x-1,y-1,3,3,c);p.p(x,y+2,c);p.p(x,y,P.pale);}
function panel(){
  const d=drawing('Moonstone Frames',48,48,2);
  for(let f=0;f<2;f++){
    const p=d.ink(f),g=d.ink(f,'details'),accent=f?P.gold:P.silver;
    // Stepped corners, a dark outside keyline, and moonlit inner bevel.
    p.r(4,0,40,48,P.ink);p.r(0,4,48,40,P.ink);p.r(2,2,44,44,P.ink);
    p.r(5,2,38,44,P.edge);p.r(2,5,44,38,P.edge);p.r(4,4,40,40,P.slate);
    p.r(6,5,36,38,accent);p.r(5,6,38,36,accent);
    p.r(7,7,34,34,P.ink);p.r(8,8,32,32,f?'#282039':P.deep);
    g.l(8,7,39,7,f?'#6d5361':'#40465e');g.l(7,8,7,39,'#484658');
    g.l(9,40,39,40,'#101528');g.l(40,9,40,39,'#101528');
    for(const [x,y] of [[6,6],[41,6],[6,41],[41,41]]){
      g.r(x-2,y-2,5,5,P.ink);diamond(g,x,y,accent);
    }
    g.l(16,3,25,3,P.silver);g.l(3,17,3,24,P.silver);
    g.l(27,44,33,44,P.ink);g.p(44,28,P.ink);
  }
  return d.finish(['moonstone','plum']);
}
function button(gold:boolean){
  const d=drawing(gold?'Lantern Buttons':'Twilight Buttons',48,24,4);
  for(let f=0;f<4;f++){
    const p=d.ink(f),g=d.ink(f,'details'),disabled=f===3,pressed=f===2;
    const rim=disabled?'#555262':gold?f===1?'#fff0c0':P.light:f===1?P.pale:P.silver;
    const body=disabled?'#28283a':gold?f===1?'#ebc287':pressed?'#a27351':'#d3a673':f===1?'#4b4265':pressed?'#24233d':'#343149';
    p.r(3,0,42,24,P.ink);p.r(0,3,48,18,P.ink);p.r(1,2,46,20,P.ink);
    p.r(3,1,42,20,rim);p.r(1,3,46,17,rim);
    p.r(3,3,42,16,body);p.r(2,4,44,14,body);
    p.r(3,19,42,3,disabled?'#191b2b':gold?'#704c49':'#222039');
    p.r(3,3,42,2,pressed?'#654c51':disabled?'#343345':gold?'#f4d59b':'#655a7c');
    g.p(3,3,rim);g.p(44,3,rim);g.p(3,18,disabled?P.edge:gold?P.gold:P.slate);g.p(44,18,rim);
    if(f===1){g.l(9,2,16,2,P.pale);g.p(39,2,P.pale);}
  }
  return d.finish([...UI_STATES]);
}
function icons(){
  const d=drawing('Keeper’s Instruments',16,16,UI_ICONS.length);
  UI_ICONS.forEach((name,f)=>{
    const p=d.ink(f),g=d.ink(f,'details');
    if(name==='star'){
      p.l(8,1,8,14,P.gold);p.l(1,8,14,8,P.gold);p.r(5,5,7,7,P.gold);
      g.l(8,3,8,12,P.light);g.l(3,8,12,8,P.light);g.r(6,6,5,5,P.light);g.r(7,7,2,2,P.pale);
    }else if(name==='heart'||name==='heartEmpty'){
      p.r(2,3,5,2,P.ink);p.r(9,3,5,2,P.ink);p.r(1,5,14,5,P.ink);
      p.r(3,10,10,2,P.ink);p.r(5,12,6,2,P.ink);p.r(7,14,2,1,P.ink);
      const c=name==='heart'?P.pink:'#48435d';
      g.r(3,4,3,2,c);g.r(10,4,3,2,c);g.r(2,6,12,3,c);g.r(4,9,8,2,c);g.r(6,11,4,2,c);g.r(7,13,2,1,c);
      if(name==='heart'){g.r(3,5,3,1,'#ffe0d2');g.p(3,6,'#ffe0d2');g.r(10,7,3,2,P.rose);}
      else{g.r(4,6,8,3,P.deep);g.r(6,9,4,1,P.deep);}
    }else if(name==='clock'){
      p.e(1,1,14,14,P.ink);p.e(2,2,12,12,P.gold);p.e(3,3,10,10,P.deep);
      g.l(8,4,8,8,P.pale);g.l(8,8,11,9,P.light);g.p(4,8,P.silver);g.p(8,12,P.silver);
    }else if(name==='crown'){
      p.r(2,6,12,7,P.gold);p.r(2,4,2,3,P.gold);p.r(7,2,2,5,P.gold);p.r(12,4,2,3,P.gold);
      g.l(3,12,12,12,P.light);g.p(4,9,P.pale);g.p(8,8,P.pink);g.p(11,9,P.pale);
    }else if(name==='moon'){
      p.e(2,1,12,14,P.violet);p.e(6,0,9,11,'transparent');
      g.p(3,6,P.pale);g.p(5,11,P.pale);diamond(g,11,11,P.light);
    }else if(name==='sound'||name==='soundOff'){
      p.r(2,6,3,5,P.pale);p.r(5,4,2,9,P.pale);p.r(7,3,2,11,P.pale);
      if(name==='sound'){g.l(11,5,13,7,P.violet);g.l(13,7,13,9,P.violet);g.l(13,9,11,11,P.violet);}
      else{g.l(11,6,14,10,P.pink);g.l(14,6,11,10,P.pink);}
    }else if(name==='pause'){p.r(3,3,4,11,P.pale);p.r(10,3,4,11,P.pale);g.l(4,4,4,12,P.violet);g.l(11,4,11,12,P.violet);}
    else if(name==='play'||name==='left'||name==='right'){
      for(let i=0;i<6;i++)p.r(name==='left'?10-i:4+i,3+i,1,12-i*2,P.light);
    }else if(name==='jump'){
      p.r(7,4,3,10,P.pale);p.l(3,7,8,2,P.pale);p.l(8,2,13,7,P.pale);g.l(4,7,8,3,P.violet);
    }else if(name==='download'){
      p.r(7,2,2,8,P.light);p.l(4,7,8,11,P.light);p.l(8,11,12,7,P.light);
      g.r(2,12,12,2,P.pale);g.p(2,10,P.pale);g.p(13,10,P.pale);
    }else if(name==='back'){
      p.l(2,8,7,3,P.pale);p.l(2,8,7,13,P.pale);p.r(3,7,11,3,P.pale);g.r(8,8,5,1,P.violet);
    }else{
      p.r(3,3,10,10,P.silver);p.r(5,1,6,2,P.gold);p.r(1,5,2,6,P.gold);p.r(13,5,2,6,P.gold);p.r(5,13,6,2,P.gold);
      g.r(5,5,6,6,P.deep);diamond(g,8,8,P.light);
    }
  });
  return d.finish([...UI_ICONS]);
}

// Deliberately authored with pixel commands: the editor has no text tool yet.
const LETTERS:Record<string,string[]>={
  S:['01111','11000','11000','01110','00011','00011','11110'],
  T:['11111','00100','00100','00100','00100','00100','00100'],
  A:['01110','11011','11011','11111','11011','11011','11011'],
  R:['11110','11011','11011','11110','11100','11010','11011'],
  D:['11110','11011','11011','11011','11011','11011','11110'],
  O:['01110','11011','11011','11011','11011','11011','01110'],
  P:['11110','11011','11011','11110','11000','11000','11000'],
};
function logo(){
  const d=drawing('Stardrop Lettering',128,27),p=d.ink(),g=d.ink(0,'details');
  Array.from('STARDROP').forEach((letter,index)=>{
    LETTERS[letter].forEach((row,y)=>Array.from(row).forEach((pixel,x)=>{
      if(pixel==='0')return;
      const px=14+index*12+x*2,py=4+y*2;
      p.r(px+1,py+3,2,2,P.ink);p.r(px,py,2,2,y<3?P.pale:y<5?P.light:P.gold);
      if(y===0)g.p(px,py,'#fff8db');
    }));
  });
  diamond(g,5,12,P.light);diamond(g,119,9,P.light);
  g.p(114,19,P.silver);g.p(10,4,P.silver);g.l(37,24,90,24,P.gold);g.p(32,24,P.silver);g.p(95,24,P.silver);
  return d.finish();
}
function meter(){
  const d=drawing('Starlight Meters',12,12,3);
  for(let f=0;f<3;f++){
    const p=d.ink(f),g=d.ink(f,'details');
    p.r(0,0,12,12,P.ink);p.r(0,1,12,10,f===0?'#4d465f':f===1?P.gold:'#615382');
    p.r(0,3,12,6,f===0?'#191c30':f===1?'#e5b574':P.violet);
    g.l(0,3,11,3,f===0?'#292c44':f===1?P.light:'#d0c1f2');
    g.l(0,9,11,9,P.ink);
    if(f){g.r(1,5,2,2,f===1?P.light:'#baabe3');g.p(9,7,f===1?P.gold:'#7e6baf');}
  }
  return d.finish(['track','starlight','moonwave']);
}
function stardust(){
  const d=drawing('Night Sky Paper',64,64),p=d.ink(),g=d.ink(0,'details');
  p.r(0,0,64,64,'#151a2d');
  // Discrete dither, no CSS gradients; no edge seams when repeated.
  for(let y=0;y<64;y+=4)for(let x=0;x<64;x+=4)
    if((x*7+y*13)%19<4)p.p(x+(y%3),y,'#191e32');
  for(const [x,y] of [[7,9],[31,47],[57,15],[19,28],[45,61],[2,54],[40,7]])g.p(x,y,'#505067');
  g.p(53,38,P.slate);g.p(52,38,'#2b3048');g.p(54,38,'#2b3048');g.p(53,37,'#2b3048');g.p(53,39,'#2b3048');
  return d.finish();
}
function divider(){
  const d=drawing('Constellation Thread',128,9),p=d.ink(),g=d.ink(0,'details');
  p.l(0,4,54,4,P.edge);p.l(73,4,127,4,P.edge);
  p.l(17,4,50,4,P.gold);p.l(77,4,110,4,P.gold);
  diamond(g,63,4,P.light);g.p(54,4,P.violet);g.p(72,4,P.violet);
  return d.finish();
}
export function createStardropUiArt():StardropUiArt{
  return {uiPanel:panel(),uiButton:button(false),uiButtonGold:button(true),uiIcons:icons(),uiLogo:logo(),uiMeter:meter(),uiStardust:stardust(),uiDivider:divider()};
}
