import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(name:string)=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const editor=read('app/editor.tsx'),styles=read('app/globals.css');
const gate=read('app/workspace-gate.tsx');
const stamps=read('app/stamp-workbench.tsx'),fx=read('app/fx-comparison.tsx');
const guide=read('lib/workshop-guide.ts');

test('Stamp is discoverable, starts capture without a clipboard, and uses true ghost preview',()=>{
 assert.ok(editor.includes("if(next==='stamp'&&!activeStamp)setStampCapture(true)"));
 assert.ok(editor.includes("tool==='stamp'&&(stampCapture||!activeStamp)"));
 assert.ok(editor.includes('stampCaptureDrag.current={start:p,region,layer'));
 assert.ok(editor.includes("const stamp=captureStamp("));
 assert.ok(editor.includes("stampCommand(s.doc,activeStamp"));
 assert.ok(editor.includes('className="stamp-cursor-preview"'));
 assert.ok(editor.includes('positionStamp(d!,activeStamp!,hover.x,hover.y,stampSnap)'));
 assert.ok(styles.includes('.stamp-cursor-preview{'));
 assert.ok(styles.includes('pointer-events:none'));
 assert.ok(editor.includes('data-guide="stamp-context"'));
});
test('saved stamps are scoped to the active private workspace and not to shared users',()=>{
 assert.ok(gate.includes('workspaceId={session.id}'));
 assert.ok(editor.includes("'pixel-workshop-stamps-v1-'+(workspaceId||'local')"));
 assert.ok(editor.includes("localStorage.setItem(stampStoreKey,JSON.stringify(items))"));
 assert.ok(stamps.includes('STAMP_LIBRARY_LIMIT'));
 assert.ok(stamps.includes('Capture a new stamp'));
 assert.ok(stamps.includes('onSelect(stamp)'));
 assert.ok(stamps.includes('onDelete(stamp.id)'));
});
test('clip ranges are draggable and visually highlighted, with accessible alternative inputs',()=>{
 assert.ok(editor.includes('data-guide="clip-range"'));
 assert.ok(editor.includes('onPointerDown={e=>beginClipRange(i,e)}'));
 assert.ok(editor.includes('onPointerMove={dragClipRange}'));
 assert.ok(editor.includes('onPointerUp={finishClipRange}'));
 assert.ok(editor.includes("e.currentTarget.parentElement?.setPointerCapture(e.pointerId)"));
 assert.ok(editor.includes("if(e.shiftKey){const range=clipRange("));
 assert.ok(editor.includes('onContextMenu={e=>{e.preventDefault();'));
 assert.ok(editor.includes('className="frame-clip-indicator"'));
 assert.ok(editor.includes('range-selected'));
 assert.ok(editor.includes('aria-label="Clip start frame"'));
 assert.ok(editor.includes('aria-label="Clip end frame"'));
 assert.ok(styles.includes('.frame-clip-indicators{'));
});
test('regeneration requires current preview and an explicit backup/overwrite choice',()=>{
 assert.ok(editor.includes('compareEffectFrame(doc,effectTarget,selected'));
 assert.ok(editor.includes("if(fxPreview?.key!==key)throw new Error('Preview your changes before regenerating.')"));
 assert.ok(editor.includes("op:'duplicate_layer'"));
 assert.ok(editor.includes("setConfirmFxOverwrite("));
 assert.ok(editor.includes('className="fx-backup-choice"'));
 assert.ok(editor.includes('className="fx-overwrite-confirm"'));
 assert.ok(editor.includes('<FxComparisonPanel comparison={validFxPreview}/>'));
 assert.ok(fx.includes('AFTER'));
 assert.ok(styles.includes('.fx-comparison-images{'));
});
test('field guide explains new interactive workflows',()=>{
 assert.ok(guide.includes("id:'stamps'"));
 assert.ok(guide.includes("target:'stamp-workbench'"));
 assert.ok(guide.includes("target:'clip-range'"));
 assert.ok(guide.includes('preserves all original FX'));
});
