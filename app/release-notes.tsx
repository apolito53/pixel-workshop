'use client';

import {useId,useRef} from 'react';
import {playerReleaseNotes,type ReleaseNotesEdition} from '../lib/player-release-notes.ts';

export default function ReleaseNotes({edition}:{edition:ReleaseNotesEdition}){
  const dialog=useRef<HTMLDialogElement>(null);
  const titleId=useId();
  return <div className="release-notes-footnote" data-release-notes>
    <button type="button" className="release-notes-trigger" onClick={()=>dialog.current?.showModal()}>What’s new</button>
    <dialog ref={dialog} className={`release-notes-dialog release-notes-dialog--${edition}`} data-release-notes-dialog aria-labelledby={titleId}
      onKeyDown={e=>e.stopPropagation()}>
      <div className="release-notes-heading">
        <div><span>{edition==='workshop'?'PIXEL WORKSHOP':'STARDROP · A MOONKEEPER TALE'}</span><h2 id={titleId}>What’s new</h2></div>
        <button type="button" className="release-notes-close" onClick={()=>dialog.current?.close()} autoFocus>Close</button>
      </div>
      <p className="release-notes-intro">A little look at what’s changed.</p>
      {playerReleaseNotes[edition].map(release=><section className="release-notes-entry" key={release.title}>
        <h3>{release.title}</h3><ul>{release.changes.map(change=><li key={change}>{change}</li>)}</ul>
      </section>)}
    </dialog>
  </div>;
}
