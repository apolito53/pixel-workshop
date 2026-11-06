import {z} from 'zod';

/** Keep stdio validation faithful to the same nested schemas served over HTTP. */
export function toolFieldSchema(raw:Record<string,unknown>):z.ZodTypeAny{
 if(Array.isArray(raw.type)){
  const choices=raw.type.map(type=>toolFieldSchema({...raw,type}));
  return z.union(choices as [z.ZodTypeAny,z.ZodTypeAny,...z.ZodTypeAny[]]);
 }
 if(Array.isArray(raw.enum)&&raw.enum.length&&raw.enum.every(v=>typeof v==='string'))return z.enum(raw.enum as [string,...string[]]);
 let value:z.ZodTypeAny;
 if(raw.type==='object'){
  const required=Array.isArray(raw.required)?raw.required:[],fields:Record<string,z.ZodTypeAny>={};
  for(const [key,property] of Object.entries((raw.properties??{}) as Record<string,Record<string,unknown>>)){
   const field=toolFieldSchema(property);fields[key]=required.includes(key)?field:field.optional();
  }
  const object=z.object(fields);value=raw.additionalProperties===false?object.strict():object.passthrough();
 }else if(raw.type==='array'){
  let array=z.array(toolFieldSchema((raw.items??{}) as Record<string,unknown>));
  if(typeof raw.minItems==='number')array=array.min(raw.minItems);
  if(typeof raw.maxItems==='number')array=array.max(raw.maxItems);
  value=array;
 }else if(raw.type==='integer'||raw.type==='number'){
  let number=z.number().finite();if(raw.type==='integer')number=number.int();
  if(typeof raw.minimum==='number')number=number.min(raw.minimum);
  if(typeof raw.maximum==='number')number=number.max(raw.maximum);
  value=number;
 }else if(raw.type==='string'){
  let string=z.string();if(typeof raw.maxLength==='number')string=string.max(raw.maxLength);value=string;
 }else if(raw.type==='boolean')value=z.boolean();
 else if(raw.type==='null')value=z.null();
 else value=z.unknown();
 return typeof raw.description==='string'?value.describe(raw.description):value;
}
