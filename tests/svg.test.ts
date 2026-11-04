import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {applyCommands,composite,createDocument,frameView} from '../lib/pixels.ts';
import {encodeSvg,encodeRgbaSvg} from '../lib/svg.ts';
import {buildSpriteSheet} from '../lib/sprite-sheet.ts';
import {ProjectService} from '../lib/project-service.ts';
import {fileStore} from '../server/file-store.ts';
import {pixelApi} from '../lib/http-api.ts';
import {callTool,toolDefinitions} from '../lib/mcp-tools.ts';

// Read the exported vector geometry independently and recover native RGBA cells.
function readSvg(svg:string,width:number,height:number){
  assert.match(svg,new RegExp(`viewBox="0 0 ${width} ${height}"`));
  assert.match(svg,/xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.doesNotMatch(svg,/<image|data:|<script|href=|<foreignObject/);
  const bytes=new Uint8Array(width*height*4),occupied=new Set<number>();
  for(const element of svg.matchAll(/<rect\s+([^>]+)\/>/g)){
    const attrs=Object.fromEntries([...element[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],m[2]]));
    const x=Number(attrs.x),y=Number(attrs.y),w=Number(attrs.width),h=Number(attrs.height);
    assert.ok([x,y,w,h].every(Number.isInteger)&&x>=0&&y>=0&&w>0&&h>0&&x+w<=width&&y+h<=height);
    assert.match(attrs.fill,/^#[0-9a-f]{6}$/);
    const rgb=parseInt(attrs.fill.slice(1),16),alpha=Math.round(Number(attrs['fill-opacity']??1)*255);
    assert.ok(alpha>0&&alpha<=255);
    for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++){
      const i=row*width+col;
      assert.ok(!occupied.has(i),'vector rectangles must not overlap');occupied.add(i);
      bytes.set([rgb>>>16,(rgb>>>8)&255,rgb&255,alpha],i*4);
    }
  }
  return bytes;
}

test('SVG has true vector geometry, transparent margins and a scalable native viewBox',()=>{
  const doc=applyCommands(createDocument('"/><script>alert(1)</script>',7,5),[
    {op:'rect',x:1,y:1,width:4,height:3,color:'#aabbcc80'},
  ]);
  const svg=encodeSvg(doc,4);
  assert.match(svg,/width="28" height="20"/);
  assert.match(svg,/shape-rendering="crispEdges"/);
  assert.equal([...svg.matchAll(/<rect /g)].length,1,'one solid rectangle should stay one shape');
  assert.deepEqual(readSvg(svg,7,5),composite(doc));
  assert.equal(encodeSvg(doc,4),svg);
  assert.doesNotMatch(encodeSvg(createDocument('Empty',1,1)),/<rect/);
});

test('SVG matches PNG compositing for layered colors, hidden layers and every alpha value',()=>{
  let doc=createDocument('Alpha',256,2);
  doc.layers[0].pixels=Array.from({length:512},(_,i)=>(0x49baff00|(i%256))>>>0);
  doc=applyCommands(doc,[
    {op:'add_layer',id:'glow',name:'Glow'},
    {op:'rect',layer:'glow',x:42,y:1,width:97,height:1,color:'#ff004080'},
    {op:'add_layer',id:'hidden',name:'Hidden'},
    {op:'fill',layer:'hidden',x:0,y:0,color:'#00ff00'},
    {op:'visibility',layer:'hidden',visible:false},
  ]);
  assert.deepEqual(readSvg(encodeSvg(doc),256,2),composite(doc));
});

test('SVG merging preserves holes, separated runs and changing row boundaries',()=>{
  let seed=53;
  for(let sample=0;sample<20;sample++){
    const bytes=new Uint8Array(13*9*4);
    for(let i=0;i<bytes.length;i+=4){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      const choices=[[0,0,0,0],[255,0,0,255],[255,0,0,128],[0,100,200,3]];
      bytes.set(choices[(seed>>>16)%choices.length],i);
    }
    assert.deepEqual(readSvg(encodeRgbaSvg(bytes,13,9),13,9),bytes);
  }
});

test('SVG sprite sheets preserve frame positions, empty cells and clip metadata',()=>{
  const doc=applyCommands(createDocument('Three frames',3,2),[
    {op:'pixel',x:0,y:0,color:'#ff0000'},
    {op:'frame_add',blank:true},
    {op:'pixel',frame:1,x:2,y:1,color:'#00ff0080'},
    {op:'frame_add',blank:true},
    {op:'pixel',frame:2,x:1,y:0,color:'#0000ff'},
    {op:'clip_set',name:'Pulse',from:0,to:2,fps:12,mode:'pingpong'},
  ]);
  const before=JSON.stringify(doc),png=buildSpriteSheet(doc,2),svg=buildSpriteSheet(doc,2,'svg');
  assert.equal(svg.atlas.image,'Three-frames-sheet.svg');
  assert.deepEqual({...svg.atlas,image:png.atlas.image},png.atlas);
  assert.deepEqual(readSvg(encodeRgbaSvg(svg.bytes,svg.width,svg.height),6,4),png.bytes);
  assert.deepEqual(readSvg(encodeSvg(frameView(doc,1)),3,2),composite(frameView(doc,1)));
  assert.equal(JSON.stringify(doc),before,'export must not modify source art');
});

test('SVG rejects invalid buffers, sizes, scale and sheet formats',()=>{
  for(const scale of [0,-1,1.5,17,NaN,Infinity])assert.throws(()=>encodeSvg(createDocument('Small',1,1),scale),/SVG scale/);
  assert.throws(()=>encodeRgbaSvg(new Uint8Array(3),1,1),/Invalid SVG/);
  assert.throws(()=>encodeRgbaSvg(new Uint8Array(),0,1),/Invalid SVG/);
  assert.throws(()=>encodeRgbaSvg(new Uint8Array(),4096,4096),/Invalid SVG/);
  assert.throws(()=>buildSpriteSheet(createDocument('Bad format',1,1),1,'gif' as 'svg'),/format/);
});

test('HTTP and MCP export the selected SVG frame, with matching SVG sheet resources',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'pixel-svg-'));
  try{
    const service=new ProjectService(fileStore(dir));
    let doc=await service.create('SVG test',3,2);
    doc=await service.edit(doc.id,doc.revision,'paint',[
      {op:'pixel',x:0,y:0,color:'#ff0000'},
      {op:'frame_add',blank:true},
      {op:'pixel',frame:1,x:2,y:1,color:'#00ff0080'},
    ]);
    const url=`https://pixel.test/api/pixel/projects/${doc.id}/svg`;
    const response=await pixelApi(new Request(url+'?frame=1&scale=4'),service);
    assert.equal(response.status,200);
    assert.equal(response.headers.get('content-type'),'image/svg+xml; charset=utf-8');
    assert.equal(response.headers.get('content-disposition'),'attachment; filename="SVG-test.svg"');
    assert.equal(response.headers.get('cache-control'),'no-store');
    const svg=await response.text();
    assert.equal(svg,encodeSvg(frameView(doc,1),4));
    for(const query of ['?frame=2','?frame=-1','?scale=0','?scale=NaN'])
      assert.equal((await pixelApi(new Request(url+query),service)).status,400);
    assert.ok(toolDefinitions.some(t=>t.name==='export_svg'&&t.annotations?.readOnlyHint));
    const result=await callTool(service,'export_svg',{id:doc.id,frame:1,scale:4});
    assert.ok(!result.isError);
    const resource=result.content.find(c=>c.type==='resource');
    assert.ok(resource&&resource.type==='resource');
    assert.equal(resource.resource.mimeType,'image/svg+xml');
    assert.equal(resource.resource.text,svg);
    const sheet=await callTool(service,'export_sprite_sheet',{id:doc.id,columns:1,format:'svg'});
    assert.ok(!sheet.isError);
    const atlas=sheet.content.find(c=>c.type==='text');assert.ok(atlas&&atlas.type==='text');
    assert.equal(JSON.parse(atlas.text).image,'SVG-test-sheet.svg');
    const sheetResource=sheet.content.find(c=>c.type==='resource');assert.ok(sheetResource&&sheetResource.type==='resource');
    assert.deepEqual(readSvg(sheetResource.resource.text,3,4),buildSpriteSheet(doc,1).bytes);
    const png=await callTool(service,'export_sprite_sheet',{id:doc.id});
    assert.ok(png.content.some(c=>c.type==='image'&&c.mimeType==='image/png'));
    for(const args of [{frame:5},{scale:0},{scale:1.5}])
      assert.equal((await callTool(service,'export_svg',{id:doc.id,...args})).isError,true);
    assert.equal((await callTool(service,'export_sprite_sheet',{id:doc.id,format:'gif'})).isError,true);
    assert.equal((await service.get(doc.id)).entry.doc.revision,doc.revision);
  }finally{await rm(dir,{recursive:true,force:true});}
});
