'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {KeyRound,Copy,LockKeyhole,LogOut,Sparkles,X,Link2} from 'lucide-react';
import Editor from './editor.tsx';

type SessionInfo={authenticated:boolean;id?:string;hasPassword?:boolean};
type SessionResponse=SessionInfo & {error?:string;token?:string};

async function sessionApi(body?:Record<string,unknown>):Promise<SessionResponse>{
  const response=await fetch('/api/pixel/session',{
    method:body?'POST':'GET',
    ...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}),
    credentials:'same-origin',cache:'no-store',
  });
  const data=await response.json() as SessionResponse;
  if(!response.ok)throw new Error(data.error||'Workspace request failed.');
  return data;
}
function copyText(text:string) {
  if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable. Try opening the site over HTTPS.');
  return navigator.clipboard.writeText(text);
}
export default function WorkspaceGate(){
  const [session,setSession]=useState<SessionInfo|null>(null);
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false);
  const [mode,setMode]=useState<'create'|'join'>('create');
  const [password,setPassword]=useState(''),[id,setId]=useState('');
  const [error,setError]=useState(''),[message,setMessage]=useState('');
  const [managing,setManaging]=useState(false);

  useEffect(()=>{let active=true;
    sessionApi().then(result=>{if(active)setSession(result.authenticated?result:null);})
      .catch(e=>{if(active)setError((e as Error).message);})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[]);
  const submit=async(e:FormEvent)=>{
    e.preventDefault();if(busy)return;
    setBusy(true);setError('');setMessage('');
    try{
      const result=await sessionApi(mode==='create'?
        {action:'create',...(password?{password}:{})}:
        {action:'join',id:id.trim(),...(password?{password}:{})});
      if(!result.authenticated||!result.id)throw new Error('Unable to open workspace.');
      setSession(result);setManaging(false);setPassword('');setId('');
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const leave=async()=>{
    if(busy)return;
    setBusy(true);setError('');
    try{
      await sessionApi({action:'leave'});setManaging(false);setSession(null);setMessage('');
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const copyId=async()=>{
    if(!session?.id)return;
    try{await copyText(session.id);setMessage('Workspace ID copied.');setError('');}
    catch(e){setError((e as Error).message);}
  };
  const copyAgent=async()=>{
    if(!session?.id||busy)return;
    setBusy(true);setError('');
    try{
      const result=await sessionApi({action:'agent-token'});
      if(!result.token)throw new Error('Unable to issue an agent connection.');
      const configuration={url:window.location.origin+'/mcp',
        headers:{Authorization:'Bearer '+result.token}};
      await copyText(JSON.stringify(configuration,null,2));
      setMessage('Agent MCP configuration copied. Treat it like a password.');
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  if(loading)return <main className="workspace-entry"><div className="workspace-card">Opening Pixel Workshop…</div></main>;
  if(session?.authenticated && session.id)return <>
    <Editor key={session.id} onManageWorkspace={()=>{setManaging(true);setMessage('');setError('');}}/>
    {managing&&<div className="workspace-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setManaging(false);}}>
      <section className="workspace-card workspace-manage" role="dialog" aria-modal="true" aria-labelledby="workspace-manage-heading">
        <button type="button" className="workspace-close" aria-label="Close workspace settings" onClick={()=>setManaging(false)}><X size={19}/></button>
        <span className="eyebrow">YOUR PIXEL WORKSHOP</span>
        <h1 id="workspace-manage-heading">Workspace</h1>
        <p>Your artwork is saved only in this workspace. Keep the ID handy for another device.</p>
        <label className="workspace-field">Session ID
          <input aria-label="Current workspace ID" readOnly value={session.id} onFocus={e=>e.currentTarget.select()}/>
        </label>
        <div className="workspace-actions">
          <button type="button" className="secondary" onClick={()=>void copyId()}><Copy size={15}/>Copy ID</button>
          <button type="button" className="secondary" disabled={busy} onClick={()=>void copyAgent()}><Link2 size={15}/>Copy MCP connection</button>
        </div>
        <p className="workspace-note">{session.hasPassword?
          'Password protection enabled. Reopening this workspace elsewhere requires both ID and password.':
          'No password: anyone with this unguessable ID can join. Keep it private.'}</p>
        {message&&<p className="workspace-message" role="status">{message}</p>}
        {error&&<p className="workspace-error" role="alert">{error}</p>}
        <button type="button" className="workspace-switch" disabled={busy} onClick={()=>void leave()}><LogOut size={16}/>Switch workspace</button>
      </section>
    </div>}
  </>;
  return <main className="workspace-entry">
    <section className="workspace-card" aria-labelledby="workspace-heading">
      <div className="workspace-symbol"><Sparkles size={26}/></div>
      <span className="eyebrow">A LITTLE ROOM TO MAKE THINGS</span>
      <h1 id="workspace-heading">Your own pixel workshop.</h1>
      <p>Each workspace keeps its sprites, animations, and history separate. No email or account required.</p>
      <div className="workspace-mode" role="group" aria-label="Workspace action">
        <button type="button" aria-pressed={mode==='create'} className={mode==='create'?'active':''}
          onClick={()=>{setMode('create');setError('');setPassword('');}}>Create workspace</button>
        <button type="button" aria-pressed={mode==='join'} className={mode==='join'?'active':''}
          onClick={()=>{setMode('join');setError('');setPassword('');}}>Open existing</button>
      </div>
      <form className="workspace-form" onSubmit={e=>void submit(e)}>
        {mode==='join'&&<label className="workspace-field">Session ID
          <input required autoComplete="off" spellCheck={false} value={id}
            placeholder="pw_…" onChange={e=>setId(e.target.value)} maxLength={30}/>
        </label>}
        <label className="workspace-field">{mode==='create'?'Optional password':'Password (if configured)'}
          <input type="password" autoComplete={mode==='join'?'current-password':'new-password'}
            value={password} maxLength={128} minLength={mode==='create'&&password?8:undefined}
            placeholder={mode==='create'?'Leave empty for ID-only access':'Leave empty if none'}
            onChange={e=>setPassword(e.target.value)}/>
        </label>
        <p className="workspace-note">{mode==='create'?
          'A random session ID is your recovery key. Add a password (8+ characters) for extra protection.':
          'Enter the session ID you saved. Your browser will remember it after you open it.'}</p>
        {error&&<p className="workspace-error" role="alert">{error}</p>}
        <button className="primary full" type="submit" disabled={busy}>
          {mode==='create'?<KeyRound size={16}/>:<LockKeyhole size={16}/>}
          {busy?'Opening…':mode==='create'?'Create my workspace':'Open workspace'}
        </button>
      </form>
    </section>
  </main>;
}
