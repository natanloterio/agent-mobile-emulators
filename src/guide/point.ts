import type { GuideTarget } from './script';

const CLASS = 'guide-pointed';
const LIFETIME_MS = 8000;
let clear: (() => void) | null = null;

/** Destaca o elemento `[data-guide=target]` (spec guia §3.4): some no primeiro clique nele ou após 8 s. */
export function pointAt(target: GuideTarget): void {
  clear?.();
  const el = document.querySelector<HTMLElement>(`[data-guide="${target}"]`);
  if (!el) return;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  el.classList.add(CLASS);
  el.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  const off = () => {
    el.classList.remove(CLASS);
    el.removeEventListener('click', off);
    window.clearTimeout(timer);
    clear = null;
  };
  const timer = window.setTimeout(off, LIFETIME_MS);
  el.addEventListener('click', off);
  clear = off;
}
