import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {PNG} from 'pngjs';
import {createDocument,applyCommands} from '../lib/pixels.ts';
import {packProject} from '../lib/project-codec.ts';

test('stdio authors a sparse spatial project, picks visible artwork, and exports revision-consistent pages',async()=>{
  const data=await mkdtemp(join(tmpdir(),'workshop-stack-mcp-'));
  const client=new Client({name:'stack-roundtrip',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,args:['server/stdio.ts'],env:{...process.env,PIXEL_DATA_DIR:data} as Record<string,string>});
  try {
    await client.connect(transport);
    const call=async(name:string,args:Record<string,unknown>)=>{
      const result=await client.callTool({name,arguments:args});
      assert.ok(Array.isArray(result.content));
      const first=result.content[0];assert.equal(first.type,'text');assert.ok(!result.isError,first.text);
      const image=result.content.find(item=>item.type==='image');
      return {summary:JSON.parse(first.text),image:image?PNG.sync.read(Buffer.from(image.data,'base64')):null,base64:image?.data};
    };
    const view={yaw:37,pitch:90,zoom:.8,spread:0};
    const {summary:blank}=await call('create_canvas',{name:'Stack',width:4,height:3,slices:105,zMin:-4,sliceHeight:2,view});
    const id=blank.id;
    assert.equal(blank.sliceCount,105);
    assert.deepEqual(blank.stack.view,view);
    assert.equal(blank.animation,undefined);
    const {summary:painted}=await call('paint',{id,revision:0,slice:104,commands:[
      {op:'rect',frame:0,x:0,y:0,width:4,height:3,color:'#418859'},
      {op:'add_layer',id:'ink',name:'Ink'},
      {op:'pixel',layer:'ink',x:2,y:1,color:'#FFAC33'}
    ]});
    assert.equal(painted.preview.slice,104);
    assert.equal(painted.preview.elevation,204);
    const {image:top}=await call('get_canvas',{id,slice:104,scale:1});assert.ok(top);
    assert.deepEqual([...top.data.subarray(24,28)],[255,172,51,255]);
    const {image:blankPlane}=await call('export_png',{id,frame:103});assert.ok(blankPlane);
    assert.ok(blankPlane.data.every(value=>value===0));
    const {summary:angle,image:preview}=await call('preview_stack',{id,width:64,height:64});assert.ok(preview);
    assert.equal(angle.yaw,37);assert.equal(angle.pitch,90);
    let pixel=-1;
    for(let i=0;i<preview.width*preview.height;i++)if(preview.data[4*i]===255&&preview.data[4*i+1]===172){pixel=i;break;}
    assert.ok(pixel>=0,'camera can see the painted slice');
    const {summary:picked}=await call('preview_stack',{id,width:64,height:64,pick:{x:pixel%64,y:Math.floor(pixel/64)}});
    assert.equal(picked.hit.sliceIndex,104);
    assert.deepEqual([picked.hit.x,picked.hit.y,picked.hit.layerId],[2,1,'ink']);

    const settings={id,maxPageWidth:12,maxPageHeight:3};
    const {summary:{revision,manifest},image:manifestImage}=await call('export_stack_pages',settings);
    assert.equal(manifestImage,null);
    assert.equal(manifest.sliceCount,105);assert.equal(manifest.pages.length,35);
    const {summary:page,image:sheet}=await call('export_stack_pages',{...settings,revision,page:34});assert.ok(sheet);
    assert.equal(page.firstSlice,102);
    const at=(sheet.width+2*4+2)*4;
    assert.deepEqual([...sheet.data.subarray(at,at+4)],[255,172,51,255]);
    await call('paint',{id,revision,commands:[{op:'slice_move',from:104,to:103}]});
    const stale=await client.callTool({name:'export_stack_pages',arguments:{...settings,revision,page:34}});
    assert.equal(stale.isError,true);
    await call('undo',{id,revision:2});
    assert.equal((await call('get_canvas',{id,slice:104,scale:1})).image?.data[24],255);

    const compact=await call('export_stack_pages',{id});
    assert.equal(compact.summary.manifest.pages.length,1);
    const {base64,summary:whole}=await call('export_stack_pages',{id,page:0,revision:3});
    const {summary:restored}=await call('import_stack_pages',{manifest:compact.summary.manifest,pages:[{file:whole.file,png_base64:base64}]});
    assert.deepEqual(restored.stack,blank.stack);
    assert.equal(restored.sliceCount,105);
    assert.equal((await call('get_canvas',{id:restored.id,slice:104,scale:1})).image?.data[24],255);

    const base=applyCommands(createDocument('Old frames',4,3),[{op:'frame_add',blank:true},{op:'pixel',frame:1,x:1,y:1,color:'#4411cc'}]);
    const imported=await call('import_project',{project:packProject(base)});
    assert.notEqual(imported.summary.id,id);
    const converted=await call('paint',{id:imported.summary.id,revision:0,commands:[{op:'stack_settings'}]});
    assert.equal(converted.summary.sliceCount,2);
    const old=await call('get_canvas',{id:imported.summary.id,slice:1,scale:1});
    assert.deepEqual([...old.image!.data.subarray(20,24)],[68,17,204,255]);
  } finally {
    await client.close();
    await rm(data,{recursive:true,force:true});
  }
});
