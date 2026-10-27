import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const editor = readFileSync(new URL('../app/editor.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

test('Undo and Redo are uniquely located below the drawing tools, not in the document bar', () => {
  const barStart = editor.indexOf('<div className="document-bar">');
  const railStart = editor.indexOf('<aside className="tool-rail"');
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
