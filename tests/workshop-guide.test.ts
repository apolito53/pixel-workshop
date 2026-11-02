import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GUIDE_CHAPTERS,GUIDE_STEPS,guideSteps,validateGuide} from '../lib/workshop-guide.ts';
import {placeGuideCard} from '../lib/workshop-tour-position.ts';

const editor=readFileSync(new URL('../app/editor.tsx',import.meta.url),'utf8');
const component=readFileSync(new URL('../app/workshop-tour.tsx',import.meta.url),'utf8');
const css=readFileSync(new URL('../app/workshop-tour.css',import.meta.url),'utf8');

test('field guide covers each major workstream with an unambiguous task and optional practice',()=>{
 assert.doesNotThrow(validateGuide);
 assert.equal(GUIDE_CHAPTERS.length,6);
 assert.ok(GUIDE_STEPS.length>=18);
 for(const chapter of GUIDE_CHAPTERS){
  const chapterSteps=guideSteps(chapter.id);
  assert.ok(chapterSteps.length>=2,chapter.id);
  assert.ok(chapterSteps.every(step=>step.chapter===chapter.id));
  assert.equal(new Set(chapterSteps.map(step=>step.id)).size,chapterSteps.length);
 }
 assert.deepEqual(guideSteps('all'),GUIDE_STEPS);
});
test('every guide target maps to an actual reachable editor control',()=>{
 for(const step of GUIDE_STEPS){
  assert.ok(
   editor.includes('data-guide="'+step.target+'"')||
   editor.includes("'"+step.target+"'"),
   step.id+' is missing data-guide target '+step.target
  );
 }
 assert.ok(editor.includes("if(guideStep.panel==='drawing')"));
 assert.ok(editor.includes("setInspectorTab(guideStep.panel)"));
 assert.ok(editor.includes("setInspectorOpen(mobileLayout)"));
 assert.ok(editor.includes("setDrawToolsOpen(compactDrawTools)"));
 assert.ok(editor.includes("guide.mode!=='off'&&!modal&&!packModal&&<WorkshopGuide"));
});
test('guide never alters artwork or discloses workspace credentials',()=>{
 assert.ok(!component.includes("fetch("));
 assert.ok(!component.includes("applyCommands("));
 assert.ok(!component.includes("issueWorkspaceToken("));
 assert.ok(!component.includes("localStorage.setItem"));
 assert.ok(editor.includes("if(e.key==='Escape'&&(modal||packModal))"));
 assert.ok(editor.includes("localStorage.setItem('pixel-workshop-guide-seen-v1','1')"));
 assert.ok(component.includes("onClose={onClose}"));
});
test('guided tour can be skipped, navigated by keyboard and reopened in chapters',()=>{
 assert.ok(editor.includes('aria-label="Open Pixel Workshop guide"'));
 assert.ok(component.includes("onStart('all')"));
 assert.ok(component.includes('onStart(chapter.id)'));
 assert.ok(component.includes("if(e.key==='Escape')"));
 assert.ok(component.includes("if(e.key==='ArrowLeft')"));
 assert.ok(component.includes("if(e.key==='ArrowRight')"));
 assert.ok(component.includes('aria-valuenow={index+1}'));
 assert.ok(component.includes('aria-modal="false"'));
 assert.ok(component.includes('aria-modal="true"'));
 assert.ok(component.includes('onMenu={onMenu}'));
 assert.ok(css.includes('@media(max-width:620px)'));
 assert.ok(css.includes('prefers-reduced-motion'));
});
test('desktop guide placement avoids covering its anchor when there is room',()=>{
 const viewport={width:1440,height:900},card={width:344,height:270};
 const target={left:50,top:200,right:115,bottom:260,width:65,height:60};
 const placed=placeGuideCard(target,viewport,card,false);
 assert.ok(placed.left>target.right,'card should appear to the right of the left rail');
 assert.ok(placed.left+placed.width<=viewport.width-12);
 const rightTarget={left:1220,top:200,right:1370,bottom:450,width:150,height:250};
 const placedRight=placeGuideCard(rightTarget,viewport,card,false);
 assert.ok(placedRight.left+placedRight.width<rightTarget.left,'inspector card goes to the left');
});
test('compact guide card docks in visible space and never clips its width',()=>{
 const vp={width:375,height:667},card={width:344,height:270};
 const high={left:8,top:55,right:365,bottom:100,width:357,height:45};
 const low={left:8,top:480,right:365,bottom:540,width:357,height:60};
 const a=placeGuideCard(high,vp,card,true),b=placeGuideCard(low,vp,card,true);
 assert.ok(a.top>high.bottom,'top anchor should get bottom card');
 assert.equal(b.top,12,'bottom anchor should get top card');
 for(const value of [a,b]){
  assert.ok(value.left>=12&&value.left+value.width<=vp.width-12);
  assert.ok(value.top>=12&&value.top+card.height<=vp.height-12);
 }
});
test('missing guide anchor gets predictable corner placement',()=>{
 const pos=placeGuideCard(null,{width:320,height:480},{width:344,height:250},true);
 assert.deepEqual(pos,{left:12,top:218,width:296});
});
