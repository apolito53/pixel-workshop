import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const editor=readFileSync(new URL('../app/editor.tsx',import.meta.url),'utf8');
const ui=readFileSync(new URL('../app/color-workbench.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/color-workbench.css',import.meta.url),'utf8');
const gate=readFileSync(new URL('../app/workspace-gate.tsx',import.meta.url),'utf8');
const guide=readFileSync(new URL('../lib/workshop-guide.ts',import.meta.url),'utf8');
test('Current Color and an accessible full picker live directly beside the canvas',()=>{
 assert.ok(editor.includes('<ColorWorkbench {...paletteProps}/>'));
 assert.ok(editor.includes('className="pw-color-toolbar-slot" data-guide="palette"'));
 assert.ok(ui.includes('Open color picker'));

 assert.ok(ui.includes('aria-label="Choose any RGB color"'));
 assert.ok(ui.includes('aria-label="Selected color hex or RGBA"'));
 assert.ok(ui.includes('aria-label="Color opacity"'));
 assert.ok(css.includes('.pw-color-trigger-swatch'));
 assert.ok(css.includes('@media(max-width:800px)'));
 assert.ok(css.includes('.pw-color-popover{position:fixed'));
});
test('color groups are meaningful, intentional, reversible and not a surprise saved palette',()=>{
 assert.ok(ui.includes('Recently chosen'));
 assert.ok(ui.includes('Suggested colors'));
 assert.ok(ui.includes('From this artwork'));
 assert.ok(ui.includes('Saved palette'));
 assert.ok(ui.includes('Original starter swatches'));
 assert.ok(ui.includes('New canvases no longer start with them'));
 assert.ok(ui.includes('Current color saved'));
 assert.ok(editor.includes("commit([{op:'palette',colors}])"));
 assert.ok(editor.includes('removeSavedColor(doc.palette,hex)'));
 assert.ok(!editor.includes('WORKSHOP PALETTE'));
});
test('color selection history stays isolated to the private browser workspace',()=>{
 assert.ok(gate.includes('workspaceId={session.id}'));
 assert.ok(editor.includes("crypto.subtle.digest('SHA-256'"),'workspace secret must be hashed');
 assert.ok(editor.includes("setRecentKey('pixel-workshop-recent-v1:'"));
 assert.ok(editor.includes('localStorage.setItem(recentKey,JSON.stringify(recentColors))'));
 assert.ok(editor.includes('contextualColors(d,activeFrame,ink)'));
 assert.ok(guide.includes("target:'palette',panel:'none'"));
});
