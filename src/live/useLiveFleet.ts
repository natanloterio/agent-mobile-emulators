import { useEffect, useState } from 'react';
import type { FleetSnapshot } from './types';

/** Assina o daemon via preload. Fora do Electron (Vite no browser) devolve null e tudo segue mock. */
export function useLiveFleet(): FleetSnapshot | null {
  const [snap, setSnap] = useState<FleetSnapshot | null>(null);
  useEffect(() => {
    const bridge = window.enxame;
    if (!bridge?.onSnapshot) return;
    return bridge.onSnapshot(setSnap);
  }, []);
  return snap;
}
