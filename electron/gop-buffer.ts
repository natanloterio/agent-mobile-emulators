interface Packet { readonly id: string; readonly key: boolean }
const DEFAULT_MAX_GOP = 400;   // ~13 s a 30 fps; IDR pedido a 2 s, medido ~4 s (~120 pacotes) neste emulador, o limite é só rede de segurança

/**
 * Guarda, por identidade, o quadro-chave mais recente e tudo depois dele, para reenviar numa recarga da janela (spec inc. 4 §2).
 * GOP que passaria do limite é descartado inteiro (um GOP truncado não decodifica); volta no próximo key.
 */
export function createGopBuffer(maxGop = DEFAULT_MAX_GOP): { push(p: Packet): void; replay(): readonly Packet[] } {
  const gops = new Map<string, Packet[]>();
  return {
    push: (p) => {
      if (p.key) { gops.set(p.id, [p]); return; }
      const g = gops.get(p.id); if (!g) return;
      if (g.length >= maxGop) { gops.delete(p.id); return; }
      gops.set(p.id, [...g, p]);
    },
    replay: () => [...gops.values()].flat(),
  };
}
