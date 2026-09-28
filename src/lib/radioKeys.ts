import type { KeyboardEvent } from 'react';

const NEXT = new Set(['ArrowRight', 'ArrowDown']);
const PREV = new Set(['ArrowLeft', 'ArrowUp']);

/** Próxima opção de um grupo de rádios pelas setas (dá a volta e pula as desabilitadas); null para outras teclas. */
export function radioKeyTarget(key: string, current: number, count: number, disabled: (i: number) => boolean = () => false): number | null {
  const step = NEXT.has(key) ? 1 : PREV.has(key) ? -1 : key === 'Home' ? 0 : key === 'End' ? 0 : null;
  if (step === null || count === 0) return null;
  if (key === 'Home' || key === 'End') {
    const order = [...Array(count).keys()];
    return (key === 'Home' ? order : order.reverse()).find((i) => !disabled(i)) ?? null;
  }
  for (let n = 1; n <= count; n++) {
    const i = (current + step * n + count * n) % count;
    if (!disabled(i)) return i;
  }
  return null;
}

/**
 * Teclado de um grupo `role="radiogroup"`: um só ponto de Tab (a opção marcada) e setas escolhem e movem o foco,
 * como um grupo de rádios nativo. Use `tabIndex={checked ? 0 : -1}` nos botões.
 */
export function onRadioKey(e: KeyboardEvent<HTMLElement>, current: number, count: number, select: (i: number) => void, disabled?: (i: number) => boolean): void {
  const to = radioKeyTarget(e.key, current, count, disabled);
  if (to === null) return;
  e.preventDefault();
  select(to);
  const buttons = e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]');
  buttons?.[to]?.focus();
}
