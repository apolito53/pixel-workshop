import { applyCommands, createDocument, type PaintCommand } from './pixels.ts';

// Original 64 × 64 artwork, drawn entirely with the public pixel commands.
export function cottageCommands():PaintCommand[] {
  const ops:PaintCommand[]=[];
  let layer='base';
  const r=(x:number,y:number,width:number,height:number,color:string)=>ops.push({op:'rect',layer,x,y,width,height,color});
  const e=(x:number,y:number,width:number,height:number,color:string)=>ops.push({op:'ellipse',layer,x,y,width,height,color});
  const p=(x:number,y:number,color:string)=>ops.push({op:'pixel',layer,x,y,color});
  const line=(x:number,y:number,x2:number,y2:number,color:string)=>ops.push({op:'line',layer,x,y,x2,y2,color});
  const add=(id:string,name:string)=>{ops.push({op:'add_layer',id,name});layer=id;};
  const c={ink:'#211f36',rock:'#373348',stone:'#665771',litStone:'#8a768b',mortar:'#443b55',roof:'#3e3f68',tile:'#595a88',tileLight:'#797ba1',wood:'#583e4e',woodLight:'#916052',gold:'#d89d69',light:'#f8dca0',white:'#fff0c2',leaf:'#365459',green:'#537665',sage:'#87a179',blue:'#83b0ba'};
  ops.push({op:'palette',colors:Object.values(c)});
  // Moon and a few isolated stars leave the background transparent.
  e(6,4,12,12,c.blue);e(7,4,10,11,'#c4d2c0');e(11,2,10,11,'transparent');
  for(const [x,y] of [[24,5],[36,3],[55,14],[58,32],[4,29],[18,18]])p(x,y,c.light);
  line(54,4,54,8,c.blue);line(52,6,56,6,c.blue);p(54,6,c.white);
  add('island','Moss & stepping stones');
  e(5,50,54,13,c.ink);e(6,48,53,12,c.rock);e(4,47,55,11,c.leaf);e(6,47,51,8,c.green);
  for(const [x,y,w] of [[8,55,5],[18,58,4],[25,59,7],[40,58,4],[49,55,5]]){r(x,y,w,2,c.rock);r(x,y,w-1,1,c.stone);}
  e(26,50,13,4,c.mortar);e(26,49,12,3,c.litStone);r(28,49,7,1,'#b0a091');
  e(24,54,10,3,c.mortar);e(24,53,10,3,c.stone);r(26,53,5,1,c.litStone);
  e(31,57,9,3,c.mortar);e(31,56,9,3,c.stone);r(33,56,4,1,c.litStone);
  for(const [x,y] of [[9,51],[13,48],[44,50],[52,51],[19,55],[43,55],[10,55]]){p(x,y,c.sage);p(x+1,y-1,c.green);}
  add('cottage','Stone cottage');
  r(18,28,32,23,c.ink);r(20,29,28,21,c.stone);r(20,29,3,20,c.litStone);r(45,29,3,20,c.mortar);r(19,49,30,2,c.rock);
  // Offset masonry joints and small lit faces.
  for(let y=33;y<49;y+=5){line(20,y,47,y,c.mortar);for(let x=20+(y%2)*3;x<47;x+=7)line(x,y-3,x,y,c.mortar);}
  for(const [x,y] of [[24,30],[38,31],[24,44],[40,46],[21,39],[38,35]])r(x,y,3,1,c.litStone);
  // A round-topped oak door, with a tiny brass crescent.
  e(29,34,11,12,c.ink);r(29,40,11,10,c.ink);e(31,36,7,9,c.woodLight);r(31,40,7,10,c.wood);r(31,39,2,10,c.woodLight);
  line(34,41,34,49,c.ink);line(37,40,37,48,c.ink);p(36,45,c.gold);p(36,44,c.light);
  e(33,38,3,3,c.gold);p(35,38,c.woodLight);p(35,39,c.woodLight);
  // One window is copied and flipped using the same transforms available in MCP.
  r(21,35,7,9,c.ink);r(22,36,5,6,c.gold);r(23,36,4,5,c.light);r(24,36,1,6,c.wood);r(22,39,5,1,c.wood);r(20,43,9,2,c.wood);r(21,43,7,1,c.woodLight);p(26,36,c.white);
  ops.push({op:'transform',layer,mode:'copy',x:20,y:35,width:9,height:10,x2:40,y2:35},{op:'transform',layer,mode:'flip_horizontal',x:40,y:35,width:9,height:10});
  add('roof','Indigo shingles');
  // Chimney sits behind the stepped roof silhouette.
  r(42,12,6,16,c.ink);r(43,13,4,13,c.stone);r(41,11,8,3,c.rock);r(42,11,6,1,c.litStone);
  for(const y of [16,20,24]){r(43,y,4,1,c.mortar);p(y===20?44:46,y-1,c.mortar);}
  for(let y=13;y<=31;y++){
    const half=Math.floor((y-12)*1.08)+1,left=32-half,right=32+half;
    r(left,y,right-left+1,1,c.ink);
    if(y>14)r(left+2,y,right-left-3,1,y%4===0?c.ink:c.roof);
    if(y>15&&y%4!==0){p(left+2,y,c.tileLight);p(left+3,y,c.tile);}
    if(y>16&&y%4===2)for(let x=left+5+(y%3);x<right-2;x+=5)r(x,y,3,1,c.tile);
  }
  r(12,31,41,2,c.ink);r(14,31,37,1,c.tile);r(16,33,35,2,c.wood);r(18,33,31,1,c.woodLight);
  // Small dormer, curved glass, and metal ridge cap.
  e(28,22,9,9,c.ink);e(30,24,5,5,c.gold);p(31,24,c.light);p(32,24,c.white);r(32,25,1,4,c.wood);r(30,26,5,1,c.wood);
  line(27,23,32,18,c.ink);line(32,18,38,24,c.ink);line(28,23,32,19,c.tileLight);line(32,19,37,24,c.tile);
  p(32,12,c.tileLight);p(31,13,c.tileLight);r(30,14,4,1,c.tile);
  add('garden','Garden & little lights');
  // Curled chimney smoke uses discrete, translucent pixels.
  e(44,7,5,4,'#b6b4d061');e(47,3,5,4,'#b6b4d045');e(45,0,4,3,'#b6b4d02b');
  // Creeping vines, fern clusters, flowers, and spotted mushrooms.
  for(const [x,y] of [[18,36],[17,40],[18,44],[48,36],[49,41],[48,46]]){line(x,y,x,y+4,c.leaf);e(x-2,y,4,2,c.green);p(x-1,y,c.sage);e(x,y+3,3,2,c.leaf);}
  for(const [x,y] of [[11,48],[15,51],[52,47],[47,52]]){line(x,y,x,y-5,c.leaf);line(x,y-1,x-3,y-4,c.green);line(x,y-2,x+3,y-5,c.green);p(x-2,y-4,c.sage);p(x+2,y-5,c.sage);}
  for(const [x,y] of [[8,48],[52,52],[56,48]]){r(x+2,y,1,4,c.gold);e(x,y-2,5,4,'#a35971');r(x+1,y-2,3,1,'#d28b8f');p(x+1,y-1,c.light);p(x+3,y,c.light);}
  for(const [x,y] of [[14,46],[50,48],[43,52],[21,52]]){p(x,y,c.gold);p(x,y-1,c.light);p(x+1,y,c.light);}
  // Hanging sign and warm lantern at the left eave.
  line(13,32,13,40,c.wood);r(10,37,6,5,c.ink);r(11,38,4,3,c.gold);r(12,38,2,2,c.light);r(10,42,6,1,c.woodLight);p(12,36,c.gold);
  for(const [x,y] of [[6,38],[57,42],[40,8],[8,22]]){p(x,y,'#f8dca054');p(x+1,y,c.light);}
  return ops;
}
export function cottageDemo(){return applyCommands(createDocument('Moonkeeper’s cottage',64,64,'demo-cottage'),cottageCommands());}
