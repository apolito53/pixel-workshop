import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyCommands,createDocument} from '../lib/pixels.ts';
import {buildTileAtlas,buildTilesetPack} from '../lib/tileset.ts';

test('tile atlas preserves row-major IDs and alpha-aware empty cell detection',()=>{
 const d=applyCommands(createDocument('Tiles',8,8),[
  {op:'rect',x:0,y:0,width:4,height:4,color:'#00ff00'},
  {op:'pixel',x:7,y:7,color:'#0000ff80'},
 ]);
 const atlas=buildTileAtlas(d,4);
 assert.equal(atlas.format,'pixel-workshop-tileset/1');
 assert.equal(atlas.columns,2);assert.equal(atlas.rows,2);
 assert.deepEqual(atlas.tiles.map(t=>({id:t.id,x:t.x,y:t.y,empty:t.empty})),[
  {id:0,x:0,y:0,empty:false},{id:1,x:4,y:0,empty:true},
  {id:2,x:0,y:4,empty:true},{id:3,x:4,y:4,empty:false},
 ]);
 const {bytes}=buildTilesetPack(d,4);
 assert.equal(new DataView(bytes.buffer).getUint32(0,true),0x04034b50);
});
test('tileset export rejects uneven dimensions or impossible sizes',()=>{
 const d=createDocument('Uneven',10,13);
 assert.throws(()=>buildTileAtlas(d,4),/divide evenly/);
 assert.throws(()=>buildTileAtlas(d,0),/tile width/);
 assert.throws(()=>buildTileAtlas(d,16),/divide evenly/);
});
test('tileset ZIP includes SVG for the selected frame with matching tile coordinates',()=>{
 const doc=applyCommands(createDocument('Tiles',4,4),[
  {op:'frame_add',blank:true},{op:'pixel',frame:1,x:3,y:3,color:'#abcdef80'},
 ]);
 const {bytes,atlas}=buildTilesetPack(doc,2,2,1);
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),text=new TextDecoder();
 const files:Record<string,string>={};let offset=0;
 while(view.getUint32(offset,true)===0x04034b50){
  const length=view.getUint32(offset+18,true),nameSize=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true);
  const start=offset+30+nameSize+extra;
  files[text.decode(bytes.subarray(offset+30,offset+30+nameSize))]=text.decode(bytes.subarray(start,start+length));
  offset=start+length;
 }
 assert.equal(Object.keys(files).length,5);
 assert.match(files['Tiles-tiles.svg'],/<rect x="3" y="3" width="1" height="1" fill="#abcdef" fill-opacity=/);
 assert.deepEqual(JSON.parse(files['Tiles-tileset-svg.json']),{...atlas,image:'Tiles-tiles.svg'});
 assert.equal(atlas.frame,1);
});
