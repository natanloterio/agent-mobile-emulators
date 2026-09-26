import type { LiveVideoPacket } from './types';

export interface VideoBus { publish(p: LiveVideoPacket): void; subscribe(id: string, cb: (p: LiveVideoPacket) => void): () => void }

/** Pacotes de vídeo não passam pelo estado do React (30 fps): cada canvas assina o seu id (spec inc. 4 §4.3). */
export function createVideoBus(): VideoBus {
  const subs = new Map<string, Set<(p: LiveVideoPacket) => void>>();
  return {
    publish: (p) => { for (const cb of subs.get(p.id) ?? []) cb(p); },
    subscribe: (id, cb) => { const set = subs.get(id) ?? new Set(); set.add(cb); subs.set(id, set); return () => { set.delete(cb); }; },
  };
}
