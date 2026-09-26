/** Rótulo de idade do quadro exibido: vídeo ao vivo (< 2 s), segundos ou minutos. */
export function frameAgeLabel(at: string | number, nowMs: number): string {
  const t = typeof at === 'number' ? at : Date.parse(at);
  if (Number.isNaN(t)) return 'vídeo';
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 2) return 'vídeo · ao vivo';
  if (s < 60) return `há ${s} s`;
  return `há ${Math.floor(s / 60)} min`;
}
