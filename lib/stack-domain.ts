/** Stack planes are registered in canvas coordinates and ordered from bottom to top. */
export type StackView = {yaw:number; pitch:number; zoom:number; spread:number};
export type StackSettings = {origin:[number,number]; zMin:number; sliceHeight:number; view?:StackView};

// Each slice adds one timeline slot per layer, even when all its cels are held or blank.
export const MAX_STACK_SLICES = 512;
function finite(value:unknown, min:number, max:number, label:string):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)
    throw new Error(`Stack ${label} must be a finite number between ${min} and ${max}.`);
  return value;
}

export function validateStackSettings(value:unknown):StackSettings {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid sprite stack settings.');
  const {origin,zMin,sliceHeight,view}=value as StackSettings;
  if(!Array.isArray(origin)||origin.length!==2)throw new Error('Stack origin must contain an X and Y coordinate.');
  const result:StackSettings={
    origin:[finite(origin[0],-1_000_000,1_000_000,'origin X'),finite(origin[1],-1_000_000,1_000_000,'origin Y')],
    zMin:finite(zMin,-1_000_000,1_000_000,'base elevation'),
    sliceHeight:finite(sliceHeight,1/1024,1024,'slice height'),
  };
  if(view!==undefined){
    if(!view||typeof view!=='object'||Array.isArray(view))throw new Error('Invalid sprite stack camera.');
    const yaw=finite(view.yaw,-360_000,360_000,'yaw');
    result.view={yaw:((yaw%360)+360)%360,pitch:finite(view.pitch,-90,90,'pitch'),
      zoom:finite(view.zoom,.1,8,'zoom'),spread:finite(view.spread,0,1,'slice spread')};
  }
  return result;
}

export function stackDefaults(width:number,height:number):StackSettings {
  return {origin:[Math.floor(width/2),Math.floor(height/2)],zMin:0,sliceHeight:1};
}
