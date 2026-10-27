import {test} from 'node:test';
import assert from 'node:assert/strict';
import { INSPECTOR_TABS, inspectorTabForKey } from '../lib/inspector-tabs.ts';

test('inspector destinations have stable, unique IDs and readable labels',()=>{
  assert.deepEqual(INSPECTOR_TABS.map(t=>t.id),['draw','layers','effects','export']);
  assert.equal(new Set(INSPECTOR_TABS.map(t=>t.id)).size,INSPECTOR_TABS.length);
  assert.ok(INSPECTOR_TABS.every(t=>t.label.length>0));
});
test('inspector tab keyboard navigation wraps in both directions',()=>{
  assert.equal(inspectorTabForKey('draw','ArrowLeft'),'export');
  assert.equal(inspectorTabForKey('export','ArrowRight'),'draw');
  assert.equal(inspectorTabForKey('draw','ArrowRight'),'layers');
  assert.equal(inspectorTabForKey('layers','ArrowRight'),'effects');
  assert.equal(inspectorTabForKey('effects','ArrowLeft'),'layers');
});
test('Home/End jump to extremes; other keys do not steal editor shortcuts',()=>{
  assert.equal(inspectorTabForKey('layers','Home'),'draw');
  assert.equal(inspectorTabForKey('draw','End'),'export');
  assert.equal(inspectorTabForKey('draw','Enter'),null);
  assert.equal(inspectorTabForKey('effects','b'),null);
  assert.equal(inspectorTabForKey('draw','Tab'),null);
});
