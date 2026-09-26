interface Packet { readonly id: string; readonly key: boolean }
const DEFAULT_MAX_GOP = 400;   // ~13 s a 30 fps; o servidor manda IDR a cada ~10 s

/** Guarda, por identidade, o quadro-chave mais recente e tudo depois dele, para reenviar numa recarga da janela (spec inc. 4 §2). */
export function createGopBuffer(maxGop = DEFAULT_MAX_GOP): { push(p: Packet): void; replay(): readonly Packet[] } {
  const gops = new Map<string, Packet[]>();
  return {
    push: (p) => {
      if (p.key) { gops.set(p.id, [p]); return; }
      const g = gops.get(p.id); if (!g) return;
      const next = g.length >= maxGop ? [g[0], ...g.slice(2), p] : [...g, p];
      gops.set(p.id, next);
    },
    replay: () => [...gops.values()].flat(),
  };
}
