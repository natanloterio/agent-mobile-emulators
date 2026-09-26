import type { LiveVideoPacket } from './types';

type Sub = (p: LiveVideoPacket) => void;
export interface VideoBus { publish(p: LiveVideoPacket): void; subscribe(id: string, cb: Sub): () => void }

/** ~13 s a 30 fps; com IDR a cada 2 s o GOP tem ~60 pacotes, o limite é só rede de segurança (mesma regra de electron/gop-buffer.ts). */
const DEFAULT_MAX_GOP = 400;

/** Key reinicia o GOP; delta sem key anterior é ignorado; no limite o GOP inteiro é descartado (truncado não decodifica). */
function nextGop(g: readonly LiveVideoPacket[] | undefined, p: LiveVideoPacket, maxGop: number): readonly LiveVideoPacket[] | undefined {
  if (p.key) return [p];
  if (!g) return undefined;
  return g.length >= maxGop ? undefined : [...g, p];
}

/**
 * Pacotes de vídeo não passam pelo estado do React (30 fps): cada canvas assina o seu id (spec inc. 4 §4.3).
 * Guarda o GOP atual por id e o reenvia, síncrono, a quem assina tarde (ex.: navegar Cockpit → Device) para não esperar o próximo IDR.
 */
export function createVideoBus(maxGop = DEFAULT_MAX_GOP): VideoBus {
  const subs = new Map<string, Set<Sub>>();
  const gops = new Map<string, readonly LiveVideoPacket[]>();
  return {
    publish: (p) => {
      const g = nextGop(gops.get(p.id), p, maxGop);
      if (g) gops.set(p.id, g); else gops.delete(p.id);
      for (const cb of subs.get(p.id) ?? []) cb(p);
    },
    subscribe: (id, cb) => {
      const set = subs.get(id) ?? new Set(); set.add(cb); subs.set(id, set);
      for (const p of gops.get(id) ?? []) cb(p);
      return () => { set.delete(cb); if (set.size === 0 && subs.get(id) === set) subs.delete(id); };
    },
  };
}
