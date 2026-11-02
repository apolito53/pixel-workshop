'use client';

import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,BookOpen,Check,Film,KeyRound,Package,Paintbrush,Play, Rocket, Sparkles,X} from 'lucide-react';
import {GUIDE_CHAPTERS,guideSteps,type GuideScope,type GuideStep} from '../lib/workshop-guide.ts';
import {placeGuideCard,type GuideRect} from '../lib/workshop-tour-position.ts';
import './workshop-tour.css';

type GuideProps={
 mode:'menu'|'tour';scope:GuideScope;index:number;
 onStart:(scope:GuideScope)=>void;onMove:(direction:-1|1)=>void;
 onClose:()=>void;onMenu:()=>void;
};
const chapterIcon={rocket:Rocket,paint:Paintbrush,film:Film,sparkles:Sparkles,package:Package,key:KeyRound};
function GuideMenu({onStart,onClose}:{onStart:(scope:GuideScope)=>void;onClose:()=>void}){
 const ref=useRef<HTMLElement>(null);
 useEffect(()=>{
  const before=document.activeElement instanceof HTMLElement?document.activeElement:null;
  ref.current?.focus();
  const onKey=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();onClose();return;}
   if(e.key==='Tab'&&ref.current){
    const focusable=Array.from(ref.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],[tabindex="0"]'))
     .filter(el=>el.getClientRects().length>0);
    if(!focusable.length)return;
    const first=focusable[0],last=focusable[focusable.length-1];
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
   }
  };
  window.addEventListener('keydown',onKey,true);
  return()=>{window.removeEventListener('keydown',onKey,true);if(before?.isConnected)before.focus();};
 },[onClose]);
 return <div className="workshop-guide-menu-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
  <section ref={ref} tabIndex={-1} className="workshop-guide-menu" role="dialog" aria-modal="true"
   aria-labelledby="guide-menu-heading" aria-describedby="guide-menu-description">
   <header className="guide-menu-header">
    <span className="guide-eyebrow"><BookOpen size={15}/> THE WORKSHOP FIELD GUIDE</span>
    <button className="guide-close" type="button" aria-label="Close guide" onClick={onClose}><X size={19}/></button>
   </header>
   <div className="guide-menu-scroll">
    <div className="guide-menu-welcome">
     <span className="guide-moon" aria-hidden="true">✦</span>
     <h2 id="guide-menu-heading">Make something wonderful.</h2>
     <p id="guide-menu-description">New around here? I&apos;ll show you exactly where things live, how to make an animated sprite, and how to take it into a game. The tour doesn&apos;t modify your artwork or make you complete a practice task.</p>
     <button type="button" className="guide-start-all" onClick={()=>onStart('all')}>
      <Play size={15} fill="currentColor"/> Take the complete tour <ArrowRight size={17}/>
     </button>
     <span className="guide-readtime">{guideSteps('all').length} stops · take it all at once, or pick a chapter</span>
    </div>
    <div className="guide-chapters-header"><span>EXPLORE A CHAPTER</span><span>JUMP IN ANYWHERE</span></div>
    <div className="guide-chapter-grid">
     {GUIDE_CHAPTERS.map(chapter=>{
      const Icon=chapterIcon[chapter.icon];
      return <button key={chapter.id} type="button" className="guide-chapter" onClick={()=>onStart(chapter.id)}
       aria-label={'Start '+chapter.title+' guide, '+guideSteps(chapter.id).length+' steps'}>
       <span className="guide-chapter-icon"><Icon size={19}/></span>
       <span className="guide-chapter-description"><b>{chapter.title}</b><small>{chapter.subtitle}</small></span>
       <span className="guide-chapter-count">{guideSteps(chapter.id).length} <ArrowRight size={14}/></span>
      </button>;
     })}
    </div>
    <p className="guide-menu-footnote">Every highlighted control is real. You can experiment while the guide is open, use Back or Next, or leave at any time. No practice steps are mandatory.</p>
   </div>
  </section>
 </div>;
}
function GuideWalkthrough({step,scope,index,count,onMove,onClose,onMenu}:{
 step:GuideStep;scope:GuideScope;index:number;count:number;
 onMove:(direction:-1|1)=>void;onClose:()=>void;onMenu:()=>void;
}){
 const card=useRef<HTMLElement>(null);
 const [rect,setRect]=useState<GuideRect|null>(null);
 const [position,setPosition]=useState({left:16,top:88,width:340});
 const [compact,setCompact]=useState(false);
 const chapter=GUIDE_CHAPTERS.find(item=>item.id===step.chapter)!;
 const isFinal=index===count-1;

 useEffect(()=>{
  const focus=()=>card.current?.focus();
  const id=requestAnimationFrame(focus);
  return()=>cancelAnimationFrame(id);
 },[step.id]);
 useEffect(()=>{
  let active=true,frame=0,delayed=0;
  let target:HTMLElement|null=null,observer:ResizeObserver|null=null;
  const viewport=()=>({width:window.innerWidth,height:window.innerHeight});
  const measure=()=>{
   if(!active)return;
   const current=document.querySelector<HTMLElement>('[data-guide="'+step.target+'"]');
   const fallback=step.target==='effects-recipe'?document.querySelector<HTMLElement>('[data-guide="effects"]'):null;
   const element=current&&current.getClientRects().length?current:fallback;
   if(element!==target){
    observer?.disconnect();observer=null;target=element;
    if(target && 'ResizeObserver' in window){
     observer=new ResizeObserver(()=>schedule());observer.observe(target);
     if(card.current)observer.observe(card.current);
    }
   }
   const box=target?.getBoundingClientRect();
   const next=box&&box.width>0&&box.height>0?
    {left:box.left,top:box.top,right:box.right,bottom:box.bottom,width:box.width,height:box.height}:null;
   setRect(old=>(old?.left===next?.left&&old?.top===next?.top&&
     old?.width===next?.width&&old?.height===next?.height)?old:next);
   const size=viewport(),isCompact=size.width<740;
   const cardSize={width:Math.min(344,size.width-24),height:Math.min(card.current?.offsetHeight||255,size.height*.72)};
   const result=placeGuideCard(next,size,cardSize,isCompact);
   setCompact(isCompact);
   setPosition(old=>old.left===result.left&&old.top===result.top&&old.width===result.width?old:result);
  };
  const schedule=()=>{
   if(frame)cancelAnimationFrame(frame);
   frame=requestAnimationFrame(measure);
  };
  // Two frames allow the editor to open the correct inspector/drawer on step entry.
  delayed=requestAnimationFrame(()=>{delayed=requestAnimationFrame(()=>{
   const element=document.querySelector<HTMLElement>('[data-guide="'+step.target+'"]');
   if(element?.getClientRects().length)element.scrollIntoView({block:'nearest',inline:'nearest',behavior:'auto'});
   measure();
  });});
  window.addEventListener('resize',schedule);
  window.addEventListener('scroll',schedule,true);
  return()=>{
   active=false;if(frame)cancelAnimationFrame(frame);if(delayed)cancelAnimationFrame(delayed);
   observer?.disconnect();window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);
  };
 },[step.id]);
 useEffect(()=>{
  const handle=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();onClose();return;}
   if(!card.current?.contains(document.activeElement))return;
   if(e.key==='ArrowRight'){e.preventDefault();e.stopImmediatePropagation();onMove(1);}
   if(e.key==='ArrowLeft'){e.preventDefault();e.stopImmediatePropagation();onMove(-1);}
  };
  window.addEventListener('keydown',handle,true);
  return()=>window.removeEventListener('keydown',handle,true);
 },[onClose,onMove]);
 return <>
  <div className="workshop-guide-shade" aria-hidden="true"/>
  {rect&&<div className="workshop-guide-spotlight" aria-hidden="true" style={{
    left:Math.max(0,rect.left-5),top:Math.max(0,rect.top-5),width:rect.width+10,height:rect.height+10,
   }}/>}
  <section ref={card} tabIndex={-1} className={'workshop-guide-card'+(compact?' guide-compact':'')}
   style={{left:position.left,top:position.top,width:position.width}}
   role="dialog" aria-modal="false" aria-labelledby="guide-step-heading" aria-describedby="guide-step-description">
   <div className="guide-card-top">
    <span className="guide-eyebrow"><BookOpen size={13}/>{chapter.title.toUpperCase()}</span>
    <button type="button" className="guide-close" onClick={onClose} aria-label="Close guided tour"><X size={18}/></button>
   </div>
   <div className="guide-progress" role="progressbar" aria-label="Guide progress"
    aria-valuemin={0} aria-valuemax={count} aria-valuenow={index+1}>
    <span style={{width:((index+1)/count)*100+'%'}}/>
   </div>
   <div className="guide-card-scroll">
    <div className="guide-card-count">STOP {index+1} OF {count}</div>
    <h2 id="guide-step-heading">{step.title}</h2>
    <p id="guide-step-description">{step.body}</p>
    <div className="guide-practice"><Sparkles size={15}/><span>{step.tryIt}</span></div>
    {!rect&&<p className="guide-fallback">This control isn&apos;t visible in the current layout. Follow the instructions here, or move to the next stop.</p>}
   </div>
   <div className="guide-card-actions">
    <button type="button" className="guide-link" onClick={onMenu}>Chapters</button>
    <span className="guide-card-spacer"/>
    <button type="button" className="guide-nav guide-back" onClick={()=>onMove(-1)} disabled={index===0}><ArrowLeft size={16}/> Back</button>
    <button type="button" className="guide-nav guide-next" onClick={()=>isFinal?onClose():onMove(1)}>
     {isFinal?'Finish':'Next'} {isFinal?<Check size={16}/>:<ArrowRight size={16}/>}
    </button>
   </div>
   {scope==='all'&&<div className="guide-card-footnote">Full workshop tour · your artwork stays yours</div>}
  </section>
 </>;
}
export default function WorkshopGuide({mode,scope,index,onStart,onMove,onClose,onMenu}:GuideProps){
 if(mode==='menu')return <GuideMenu onStart={onStart} onClose={onClose}/>;
 const steps=guideSteps(scope);
 const step=steps[index];
 if(!step)return null;
 return <GuideWalkthrough step={step} scope={scope} index={index} count={steps.length}
  onMove={onMove} onClose={onClose} onMenu={onMenu}/>;
}
