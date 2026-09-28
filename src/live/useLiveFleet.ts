import { useEffect, useMemo, useState } from 'react';
import type { FleetSnapshot, LiveFrame } from './types';
import { createVideoBus, type VideoBus } from './videoBus';

export interface LiveFleet { readonly snap: FleetSnapshot | null; readonly frames: Readonly<Record<string, LiveFrame>>; readonly bus: VideoBus | null }

/** Assina snapshot, posters e vídeo do daemon via preload. Fora do Electron devolve tudo vazio e a tela segue mock. */
export function useLiveFleet(): LiveFleet {
  const [snap, setSnap] = useState<FleetSnapshot | null>(null);
  const [frames, setFrames] = useState<Readonly<Record<string, LiveFrame>>>({});
  const bus = useMemo(() => (window.tapflock?.onVideo ? createVideoBus() : null), []);
  useEffect(() => {
    const bridge = window.tapflock; if (!bridge?.onSnapshot) return;
    const offSnap = bridge.onSnapshot(setSnap);
    const offFrame = bridge.onFrame?.((f) => setFrames((prev) => ({ ...prev, [f.id]: f })));
    const offVideo = bus && bridge.onVideo ? bridge.onVideo((p) => bus.publish(p)) : undefined;
    return () => { offSnap(); offFrame?.(); offVideo?.(); };
  }, [bus]);
  return { snap, frames, bus };
}
