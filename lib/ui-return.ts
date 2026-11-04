export const UI_RETURN_KEY='pixel-workshop-ui-return-v1';
export const UI_SECTIONS=['panel','states','text','kit'] as const;
export type UiSection=typeof UI_SECTIONS[number];
export type UiReturn={format:'pixel-workshop-ui-return/1';workspaceId:string;projectId:string;frame:number;layer:string;sections:UiSection[]};

/** An opaque, same-tab return point; the editor checks workspace membership. */
export function parseUiReturn(raw:string|null):UiReturn|null{
 if(!raw||raw.length>4000)return null;
 try{
  const value=JSON.parse(raw) as Partial<UiReturn>;
  if(!value||value.format!=='pixel-workshop-ui-return/1'||typeof value.workspaceId!=='string'||
   !/^[a-z0-9_-]{1,80}$/i.test(value.projectId??'')||!/^[a-z0-9_-]{1,64}$/i.test(value.layer??'')||
   typeof value.frame!=='number'||!Number.isInteger(value.frame)||value.frame<0||value.frame>31||!Array.isArray(value.sections)||
   value.sections.length>UI_SECTIONS.length||value.sections.some(s=>!UI_SECTIONS.includes(s)))return null;
  return {format:value.format,workspaceId:value.workspaceId,projectId:value.projectId!,frame:value.frame!,layer:value.layer!,sections:[...new Set(value.sections)]};
 }catch{return null;}
}
export function matchUiReturn(point:UiReturn|null,workspaceId:string,projectIds:readonly string[]):UiReturn|null{
 return point&&point.workspaceId===workspaceId&&projectIds.includes(point.projectId)?point:null;
}
