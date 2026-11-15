'use client';

import {useEffect, useRef, useState, type MouseEvent} from 'react';
import {Wind} from 'lucide-react';
import './wind.css';
import {frameCount, frameView, MAX_ANIMATION_FRAMES, type PaintCommand, type PixelDocument} from '../lib/pixels.ts';
import {windAngle, windPoseCel} from '../lib/wind.ts';

type Props = {doc:PixelDocument; layer:string; frame:number; busy:boolean; commit:(ops:PaintCommand[])=>Promise<boolean>};

export default function WindPanel({doc, layer, frame, busy, commit}:Props) {
  const current = frameCount(doc);
  const [length,setLength] = useState(12);
  const [x,setX] = useState(Math.floor((doc.width - 1) / 2));
  const [y,setY] = useState(doc.height - 1);
  const [degrees,setDegrees] = useState(6);
  const [delay,setDelay] = useState(0);
  const [previewFrame,setPreviewFrame] = useState(0);
  const [playing,setPlaying] = useState(false);
  const preview = useRef<HTMLCanvasElement>(null);
  const count = current > 1 ? current : length;
  const target = frameView(doc, frame).layers.find(l => l.id === layer);
  const source = target?.pixels;
  const valid = Number.isInteger(count) && count >= 2 && count <= MAX_ANIMATION_FRAMES &&
    Number.isInteger(x) && x >= 0 && x < doc.width && Number.isInteger(y) && y >= 0 && y < doc.height &&
    Number.isFinite(degrees) && degrees > 0 && degrees <= 30 && Number.isInteger(delay) && delay >= 0 && delay < count;
  const displayed = valid ? previewFrame % count : 0;
  useEffect(() => {
    if (!playing || !valid) return;
    const timer = window.setInterval(() => setPreviewFrame(i => (i + 1) % count), 1000 / (doc.animation?.fps ?? 8));
    return () => window.clearInterval(timer);
  },[playing,valid,count,doc.animation?.fps]);
  useEffect(() => {
    const ctx = preview.current?.getContext('2d');
    if (!ctx || !source) return;
    const angle = valid ? windAngle(displayed, count, degrees, delay) : 0;
    const pose = windPoseCel(source, doc.width, doc.height, x, y, angle);
    ctx.clearRect(0, 0, doc.width, doc.height);
    if (!pose.width || !pose.height) return;
    const image = ctx.createImageData(pose.width, pose.height);
    for (let i = 0; i < pose.data.length; i++) {
      const p = pose.data[i];
      image.data[i*4] = p >>> 24; image.data[i*4+1] = (p >>> 16) & 255;
      image.data[i*4+2] = (p >>> 8) & 255; image.data[i*4+3] = p & 255;
    }
    ctx.putImageData(image, pose.x, pose.y);
  },[source,doc.width,doc.height,x,y,displayed,count,degrees,delay,valid]);
  function pickPivot(e:MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setX(Math.min(doc.width - 1, Math.floor((e.clientX - rect.left) * doc.width / rect.width)));
    setY(Math.min(doc.height - 1, Math.floor((e.clientY - rect.top) * doc.height / rect.height)));
  }
  return <section className="inspector-section effects-section wind-section" aria-label="Wind animation">
    <div className="section-heading"><span>WIND ANIMATION</span><Wind size={15}/></div>
    <p>Click the point that stays still. Use a later delay for branches that follow the trunk.</p>
    <div className="wind-preview" style={{aspectRatio:doc.width+'/'+doc.height,width:`min(100%, ${164 * doc.width / doc.height}px)`}}>
      <canvas ref={preview} width={doc.width} height={doc.height} onClick={pickPivot} aria-label="Wind pose preview"/>
      {valid && <span aria-hidden="true" className="wind-pivot" style={{left:(x+.5)*100/doc.width+'%',top:(y+.5)*100/doc.height+'%'}}/>}
    </div>
    <div className="wind-fields">
      <label>Pivot X<input type="number" min={0} max={doc.width-1} value={x} onChange={e=>setX(Number(e.target.value))}/></label>
      <label>Pivot Y<input type="number" min={0} max={doc.height-1} value={y} onChange={e=>setY(Number(e.target.value))}/></label>
      <label>Sway (°)<input type="number" min={0.1} max={30} step={0.1} value={degrees} onChange={e=>setDegrees(Number(e.target.value))}/></label>
      <label>Delay (frames)<input type="number" min={0} max={Math.max(0,count-1)} value={delay} onChange={e=>setDelay(Number(e.target.value))}/></label>
    </div>
    {current === 1 && <label className="effect-field">Loop frames<input type="number" min={2} max={MAX_ANIMATION_FRAMES} value={length} onChange={e=>setLength(Number(e.target.value))}/></label>}
    <button type="button" className="secondary full" disabled={!valid} aria-pressed={playing} onClick={()=>setPlaying(!playing)}>{playing?'Pause wind preview':'Preview wind loop'}</button>
    <p>Bake replaces {target?.name}’s poses across {count} frames using frame {frame+1} as the source. One Undo restores them.</p>
    <button type="button" className="secondary full effect-generate" disabled={busy||!valid||!target} onClick={async()=>{
      if(await commit([{op:'wind_bake',layer,source_frame:frame,pivot_x:x,pivot_y:y,degrees,delay,frames:count}]))setPlaying(false);
    }}><Wind size={14}/>Bake wind loop</button>
  </section>;
}
