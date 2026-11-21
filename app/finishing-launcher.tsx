'use client';

import { createContext, lazy, Suspense, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import './finishing-launcher.css';

const ImageFinishing = lazy(() => import('./image-finishing.tsx'));

type FinishingContextValue = { finishingOpen: boolean; openFinishing: () => void };
const FinishingContext = createContext<FinishingContextValue | null>(null);

/** One original/recipe survives workspace creation, switching, and panel closing. */
export function FinishingProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const openFinishing = useCallback(() => { setStarted(true); setOpen(true); }, []);
  const value = useMemo(() => ({ finishingOpen: open, openFinishing }), [open, openFinishing]);
  return <FinishingContext.Provider value={value}>
    {children}
    {started && <Suspense fallback={<p role="status">Opening Image Finishing…</p>}>
      <ImageFinishing open={open} onClose={() => setOpen(false)} />
    </Suspense>}
  </FinishingContext.Provider>;
}

export function useImageFinishing(): FinishingContextValue {
  const value = useContext(FinishingContext);
  if (!value) throw new Error('Image Finishing requires the workspace finishing provider.');
  return value;
}

export default function FinishingLauncher({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const shared = useContext(FinishingContext);
  const [open, setOpen] = useState(initiallyOpen);
  const [started, setStarted] = useState(initiallyOpen);
  return <>
    <button type="button" className="finishing-launch-button" onClick={() => {
      if (shared) shared.openFinishing();
      else { setStarted(true); setOpen(true); }
    }}>
      <SlidersHorizontal size={18} /> Finish an image
    </button>
    {!shared && started && <Suspense fallback={<p role="status">Opening Image Finishing…</p>}>
      <ImageFinishing open={open} onClose={() => setOpen(false)} />
    </Suspense>}
  </>;
}
