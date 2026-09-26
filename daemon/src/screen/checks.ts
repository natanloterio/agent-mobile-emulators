import type { ScreenNode, ScreenState, ScreenWindow } from './parse.js';

export function focusedWindow(s: ScreenState): ScreenWindow | null {
  return s.windows.find((w) => w.focused) ?? s.windows.find((w) => w.type === 'APPLICATION') ?? null;
}

export function allNodes(s: ScreenState): readonly ScreenNode[] {
  return s.windows.flatMap((w) => w.nodes);
}

export function nodeById(s: ScreenState, id: string): ScreenNode | null {
  return allNodes(s).find((n) => n.id === id) ?? null;
}

/** Nó editável de fato (flag `edt`), não "parece campo". Ver spec §4.5, lição 2. */
export function editableNodes(s: ScreenState): readonly ScreenNode[] {
  return allNodes(s).filter((n) => n.flags.has('edt'));
}

export function findNodes(s: ScreenState, re: RegExp): readonly ScreenNode[] {
  return allNodes(s).filter((n) => re.test(n.text) || re.test(n.desc));
}

const BLOCK_PATTERNS: readonly RegExp[] = [
  /confirme que é você/i, /confirm it's you/i, /suspicious login/i, /atividade incomum/i,
  /ajude-nos a confirmar/i, /help us confirm/i, /we suspended your account/i, /sua conta foi suspensa/i,
  /insira o código/i, /enter the code we sent/i, /captcha/i,
];

/** Texto do bloqueio de plataforma, ou null. Uma vez detectado, a identidade para (spec §6). */
export function detectPlatformBlock(s: ScreenState): string | null {
  const w = focusedWindow(s);
  if (!w || !w.pkg.startsWith('com.instagram')) return null;
  for (const n of w.nodes) {
    const hay = `${n.text} ${n.desc}`;
    if (BLOCK_PATTERNS.some((re) => re.test(hay))) return (n.text || n.desc).slice(0, 200);
  }
  return null;
}
