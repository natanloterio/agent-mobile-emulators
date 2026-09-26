import { z } from 'zod';
import type { Adb } from './adb.js';

/**
 * Input humano no modo controle (spec inc. 5 §2): `adb shell input tap/swipe/text/keyevent`.
 * Coordenadas chegam normalizadas 0–1 e viram pixels pelo tamanho lógico da tela (`wm size`).
 */

export const MAX_TEXT = 500;
export const SWIPE_MS = { min: 1, max: 5000 } as const;
export const KEYCODES = { back: 4, home: 3, recents: 187, enter: 66, del: 67 } as const;

const coord = z.number().finite();
/** Contrato `InputGesture` (spec inc. 5 §3.3), validado na fronteira HTTP. */
export const InputGestureSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('tap'), x: coord, y: coord }),
  z.object({ kind: z.literal('swipe'), x: coord, y: coord, x2: coord, y2: coord, durationMs: z.number().finite() }),
  z.object({ kind: z.literal('text'), text: z.string().min(1).max(MAX_TEXT) }),
  z.object({ kind: z.literal('key'), key: z.enum(['back', 'home', 'recents', 'enter', 'del']) }),
]);
export type InputGesture = z.infer<typeof InputGestureSchema>;

/** `invalid` = pedido que o device não sabe executar (400); `screen` = tamanho de tela ilegível (502). */
export class InputError extends Error {
  constructor(readonly kind: 'invalid' | 'screen', message: string) { super(message); this.name = 'InputError'; }
}

export interface ScreenSize { readonly width: number; readonly height: number }

/** Lê a saída de `wm size`; "Override size" (resolução forçada) vence "Physical size", pois é o espaço do `input`. */
export function parseWmSize(out: string): ScreenSize | null {
  const pick = (label: string) => new RegExp(`${label} size:\\s*(\\d+)x(\\d+)`).exec(out);
  const m = pick('Override') ?? pick('Physical');
  if (!m) return null;
  const width = Number(m[1]); const height = Number(m[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const toPx = (n: number, size: number) => String(Math.round(clamp(n, 0, 1) * (size - 1)));

/** Aspas simples para o `sh` do device (o `adb shell` junta os argumentos e entrega ao shell remoto). */
export const quoteSh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Texto → argumentos de `input text` (já sem aspas). O `input` troca "%s" por espaço e não tem escape para um
 * "%s" literal; por isso o texto é cortado logo depois de um "%" seguido de "s" (vira dois comandos) e cada espaço
 * vira "%s". Só ASCII imprimível: o mapa de teclas virtual do `input text` não gera eventos para acentos/emoji,
 * e mandar parte do texto deixaria o campo num estado que o humano não pediu — então o pedido inteiro é recusado.
 */
export function textChunks(text: string): readonly string[] {
  if (text.length === 0) throw new InputError('invalid', 'texto vazio');
  if (text.length > MAX_TEXT) throw new InputError('invalid', `texto com mais de ${MAX_TEXT} caracteres`);
  const bad = [...text].find((c) => c < ' ' || c > '~');
  if (bad !== undefined) {
    throw new InputError('invalid', `caractere ${JSON.stringify(bad)} fora do ASCII imprimível: \`adb shell input text\` só digita ASCII (acentos e emoji não são suportados)`);
  }
  const cuts = [...text.matchAll(/%(?=s)/g)].map((m) => m.index + 1);
  const bounds = [0, ...cuts, text.length];
  return bounds.slice(1).map((end, i) => text.slice(bounds[i], end).replace(/ /g, '%s')).filter((c) => c.length > 0);
}

export interface DeviceInput {
  send(serial: string, g: InputGesture): Promise<void>;
  /** Esquece o tamanho de tela cacheado (ex.: device recriado com outra resolução). */
  forget(serial: string): void;
}

export function createDeviceInput(adb: Pick<Adb, 'shell'>): DeviceInput {
  // Promessa por serial: pedidos simultâneos compartilham um só `wm size`; falha sai do cache.
  const sizes = new Map<string, Promise<ScreenSize>>();
  const size = (serial: string): Promise<ScreenSize> => {
    const hit = sizes.get(serial); if (hit) return hit;
    const p = adb.shell(serial, ['wm', 'size']).then((out) => {
      const s = parseWmSize(out);
      if (!s) throw new InputError('screen', `tamanho de tela ilegível em \`wm size\`: ${JSON.stringify(out.slice(0, 120))}`);
      return s;
    });
    sizes.set(serial, p);
    p.catch(() => { if (sizes.get(serial) === p) sizes.delete(serial); });
    return p;
  };
  const input = async (serial: string, args: readonly string[]) => { await adb.shell(serial, ['input', ...args]); };
  return {
    send: async (serial, g) => {
      switch (g.kind) {
        case 'tap': { const s = await size(serial); return input(serial, ['tap', toPx(g.x, s.width), toPx(g.y, s.height)]); }
        case 'swipe': {
          const s = await size(serial);
          const ms = String(Math.round(clamp(g.durationMs, SWIPE_MS.min, SWIPE_MS.max)));
          return input(serial, ['swipe', toPx(g.x, s.width), toPx(g.y, s.height), toPx(g.x2, s.width), toPx(g.y2, s.height), ms]);
        }
        case 'text': { for (const c of textChunks(g.text)) await input(serial, ['text', quoteSh(c)]); return; }
        case 'key': return input(serial, ['keyevent', String(KEYCODES[g.key])]);
      }
    },
    forget: (serial) => { sizes.delete(serial); },
  };
}
