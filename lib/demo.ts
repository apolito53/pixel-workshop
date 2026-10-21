import { createDocument, applyCommands, type PaintCommand } from './pixels.ts';
export function lanternCommands():PaintCommand[] {
  const ops:PaintCommand[]=[];
  const r=(x:number,y:number,width:number,height:number,color:string)=>ops.push({op:'rect',x,y,width,height,color});
  const p=(x:number,y:number,color:string)=>ops.push({op:'pixel',x,y,color});
  const dark='#2d283b', edge='#5d4660', shade='#89634d', gold='#c69455', light='#f6da92';
  // An original hand-plotted 48px sprite. All details use the same commands as MCP.
  r(19,4,10,2,dark);r(17,6,3,6,dark);r(28,6,3,6,dark);r(19,6,2,4,edge);r(27,6,2,4,edge);
  r(15,12,18,3,dark);r(17,11,14,2,edge);r(18,13,12,1,gold);
  r(13,15,22,3,dark);r(15,15,18,1,gold);r(14,18,3,20,dark);r(31,18,3,20,dark);
  r(17,18,14,20,'#a25e3d');r(18,19,12,17,'#e9a558');r(20,20,9,14,'#f1c572');
  r(22,21,5,11,'#ffe5a0');r(23,23,3,7,'#fff5df');
  r(16,18,2,18,shade);r(30,18,2,18,edge);r(18,18,12,2,gold);
  r(17,35,14,3,shade);r(20,34,8,2,gold);r(22,33,4,2,light);
  r(12,38,24,3,dark);r(14,38,20,1,gold);r(14,41,20,3,dark);r(16,42,16,1,edge);
  r(23,18,2,20,shade);r(23,20,1,13,light);r(17,27,14,2,shade);r(18,27,5,1,gold);r(25,27,5,1,gold);
  p(15,16,light);p(32,16,shade);p(15,39,light);p(18,14,light);
  // Separate sparks remain editable on their own layer.
  ops.push({op:'add_layer',id:'sparks',name:'Fireflies'});
  for(const [x,y] of [[7,18],[38,11],[39,31],[8,35],[35,6]]){ops.push({op:'pixel',layer:'sparks',x,y,color:light});}
  return ops;
}

export function lanternDemo(){return applyCommands(createDocument('The little lantern',48,48,'demo-lantern'),lanternCommands());}
