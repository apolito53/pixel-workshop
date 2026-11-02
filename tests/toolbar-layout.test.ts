import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const editor = readFileSync(new URL('../app/editor.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

test('Undo and Redo are uniquely located below the drawing tools, not in the document bar', () => {
  const barStart = editor.indexOf('<div className="document-bar">');
  const railStart = editor.indexOf('<aside id="pixel-drawing-tools" className="tool-rail"');
  const railEnd = editor.indexOf('</aside>', railStart);
  assert.ok(barStart !== -1 && railStart > barStart && railEnd > railStart);
  const bar = editor.slice(barStart, railStart);
  const rail = editor.slice(railStart, railEnd);

  for (const action of ['Undo', 'Redo']) {
    assert.equal((editor.match(new RegExp('aria-label="' + action + '"', 'g')) || []).length, 1);
    assert.ok(!bar.includes('aria-label="' + action + '"'));
    assert.ok(rail.includes('aria-label="' + action + '"'));
  }
  assert.ok(rail.indexOf('aria-label="Toggle grid"') < rail.indexOf('className="rail-history"'));
  assert.ok(rail.indexOf('aria-label="Undo"') < rail.indexOf('aria-label="Redo"'));
});

test('history rail retains existing enablement, callbacks and keyboard shortcuts', () => {
  for (const [name, enabled, command] of [
    ['Undo', 'canUndo', 'undo'],
    ['Redo', 'canRedo', 'redo'],
  ] as const) {
    const start = editor.indexOf('aria-label="' + name + '"', editor.indexOf('className="rail-history"'));
    assert.ok(start >= 0, name + ' button exists');
    const railButton = editor.slice(start, editor.indexOf('</button>', start));
    assert.ok(railButton.includes('disabled={!snap?.' + enabled + '||busy}'));
    assert.ok(railButton.includes("commit([],undefined,'" + command + "')"));
  }
  assert.ok(editor.includes("e.shiftKey?'redo':'undo'"));
  assert.ok(css.includes('.rail-paint-tools{') && css.includes('overflow-y:auto'));
  assert.ok(css.includes('.rail-history{'));
});

test('draw tool drawer is adaptive, scrollable, and keeps history and color accessible', () => {
  assert.ok(editor.includes('data-draw-open={compactDrawTools&&drawToolsOpen}'));
  assert.ok(editor.includes("window.matchMedia('(max-width: 800px), (max-height: 860px)')"));
  assert.ok(css.includes('@media(max-width:800px), (max-height:860px)'));
  assert.ok(css.includes('.work-area[data-draw-open="true"] .tool-rail'));
  assert.ok(css.includes('grid-template-columns:repeat(3,minmax(0,1fr))'));
  assert.ok(css.includes('overflow-y:auto'));
  assert.ok(css.includes('.rail-history{display:grid'));
  assert.ok(css.includes('.rail-color-picker{justify-content:flex-start'));
  assert.ok(editor.includes('aria-label="Choose quick drawing color"'));
  assert.ok(editor.includes('role={compactDrawTools&&drawToolsOpen?\'dialog\':undefined}'));
  assert.ok(editor.includes('inert={compactDrawTools&&!drawToolsOpen}'));
});

test('drawing drawer and inspector cannot cover one another', () => {
  assert.ok(editor.includes('setInspectorOpen(false);setDrawToolsOpen(v=>!v);'));
  assert.ok(editor.includes('setDrawToolsOpen(false);setInspectorOpen(v=>!v);'));
  assert.ok(editor.includes('className="draw-tools-backdrop"'));
  assert.ok(editor.includes('aria-label="Close drawing tools"'));
  assert.ok(editor.includes('drawToolsToggleRef.current?.focus()'));
  assert.ok(editor.includes("if(e.key==='Escape')"));
  assert.ok(editor.includes("if(e.key==='Tab')"));
  assert.ok(editor.includes("if(compactDrawTools)closeDrawTools()"));
});

test('desktop toolbar keeps all shortcuts and the compact drawer lets the canvas expand', () => {
  assert.ok(editor.includes("['stamp',Stamp,'Stamp copied pixels','S']"));
  assert.ok(editor.includes('ref={drawToolsCloseRef}'));
  assert.ok(editor.includes('ref={drawToolsToggleRef}'));
  assert.ok(editor.includes('aria-controls="pixel-drawing-tools"'));
  assert.ok(css.includes('.canvas-area{width:0;flex:1 1 0;min-width:0}'));
  assert.ok(css.includes('.rail-tool-label{display:block'));
});

test('drawer uses concise tile labels and never ellipsizes tool names', () => {
  assert.ok(editor.includes("drawerToolLabels:Partial<Record<Tool,string>>={stamp:'Stamp'}"));
  assert.ok(editor.includes('aria-label={label} aria-pressed={tool===id}'));
  assert.ok(editor.includes('title={`${label} (${key})`}'));
  assert.ok(editor.includes('{drawerToolLabels[id]??label}'));
  const start=css.indexOf('.rail-tool-label{display:block');
  assert.ok(start>=0, 'drawer label rule exists');
  const labelStyle=css.slice(start,css.indexOf('}',start));
  assert.ok(labelStyle.includes('white-space:normal'), 'labels wrap if necessary');
  assert.ok(labelStyle.includes('overflow:visible'), 'labels are not clipped');
  assert.ok(!labelStyle.includes('text-overflow:ellipsis'), 'ellipsis is disallowed');
});
