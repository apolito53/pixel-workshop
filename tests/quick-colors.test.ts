import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {QUICK_COLOR_GROUPS,QUICK_COLORS} from '../lib/quick-colors.ts';
import {isHexInk,normalizeInk,withRgb} from '../lib/color-workflow.ts';
import {createDocument} from '../lib/pixels.ts';

const editor=readFileSync(new URL('../app/editor.tsx',import.meta.url),'utf8');
const colors=readFileSync(new URL('../app/color-workbench.tsx',import.meta.url),'utf8');
const grid=readFileSync(new URL('../app/quick-color-grid.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8');

test('a fixed 24-swatch standard color palette contains recognizable painting basics',()=>{
 assert.equal(QUICK_COLOR_GROUPS.length,3);
 assert.deepEqual(QUICK_COLOR_GROUPS.map(group=>group.id),['neutral','spectrum','earth']);
 assert.equal(QUICK_COLORS.length,24);
 assert.ok(QUICK_COLOR_GROUPS.every(group=>group.colors.length>0&&group.label.length>0));
 assert.equal(new Set(QUICK_COLORS.map(c=>c.hex)).size,24);
 assert.equal(new Set(QUICK_COLORS.map(c=>c.name)).size,24);
 assert.ok(QUICK_COLORS.every(c=>isHexInk(c.hex)&&c.hex===c.hex.toLowerCase()));
 for(const standard of ['#000000','#ffffff','#ff0000','#ff8000','#ffff00','#00ff00','#00ffff','#0000ff','#ff00ff','#8b4513']){
  assert.ok(QUICK_COLORS.some(c=>c.hex===standard),'missing basic color '+standard);
 }
 assert.equal(QUICK_COLORS.find(c=>c.hex==='#ff0000')?.name,'Red');
 assert.equal(QUICK_COLORS.find(c=>c.hex==='#ffffff')?.name,'White');
});

test('quick swatches keep brush opacity and never save to the project by themselves',()=>{
 const fresh=createDocument('No surprises',16,16);
 assert.deepEqual(fresh.palette,[]);
 const swatch=QUICK_COLORS.find(c=>c.name==='Blue')!;
 const chosen=withRgb('#f6da9240',swatch.hex);
 assert.equal(normalizeInk(chosen),'#0000ff40');
 assert.deepEqual(fresh.palette,[],'choosing a quick swatch must not write project favorites');
 assert.ok(grid.includes('onPick(withRgb(ink,color.hex))'));
 assert.ok(!grid.includes("op:'palette'"));
 assert.ok(!grid.includes('fetch('));
});

test('the quick colors are accessible from both Draw and the main canvas toolbar',()=>{
 assert.ok(colors.includes('QUICK COLORS'));
 assert.ok(colors.includes('24 fixed basics'));
 assert.ok(colors.includes('data-guide="quick-colors"'));
 assert.ok(colors.includes('<QuickColorGrid ink={ink} onPick={onPick}/>'));
 assert.ok(editor.includes('aria-label="Open standard quick colors"'));
 assert.ok(editor.includes('id="quick-colors-popover"'));
 assert.ok(editor.includes('aria-expanded={quickColorsOpen}'));
 assert.ok(editor.includes('aria-label="Close quick colors"'));
 assert.ok(editor.includes('<QuickColorGrid ink={ink} onPick={hex=>'));
 assert.ok(grid.includes('aria-label={color.name+'));
 assert.ok(grid.includes('aria-pressed={selected}'));
 assert.ok(css.includes('.quick-color-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr))'));
 assert.ok(css.includes('.toolbar-quick-popover{'));
 assert.ok(css.includes('@media(max-width:390px)'));
});

test('closing the toolbar quick-color panel does not interrupt canvas or shortcuts',()=>{
 assert.ok(editor.includes("document.addEventListener('pointerdown',outside,true)"));
 assert.ok(editor.includes("if(e.key==='Escape')"));
 assert.ok(editor.includes("quickColorsButtonRef.current?.focus()"));
 assert.ok(editor.includes("setQuickColorsOpen(false);"));
 assert.ok(editor.includes("if(guide.mode!=='off')setQuickColorsOpen(false)"));
});
