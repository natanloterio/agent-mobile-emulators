import { useEffect, useState } from 'react';

/** Relógio que re-renderiza a cada `intervalMs` (idade do quadro sem acoplar ao ritmo do vídeo). */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), intervalMs); return () => window.clearInterval(id); }, [intervalMs]);
  return now;
}
