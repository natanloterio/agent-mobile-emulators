import { describe, expect, it } from 'vitest';
import { createDeviceInput, InputError, InputGestureSchema, parseWmSize, quoteSh, textChunks } from '../src/device/input.js';

const fakeAdb = (wm = 'Physical size: 1080x2400') => {
  const calls: string[][] = [];
  const adb = { shell: async (_s: string, cmd: readonly string[]) => { calls.push([...cmd]); return cmd[0] === 'wm' ? wm : ''; } };
  return { adb, calls };
};

describe('parseWmSize', () => {
  it('lê Physical size', () => { expect(parseWmSize('Physical size: 1080x2400')).toEqual({ width: 1080, height: 2400 }); });
  it('prefere Override size quando existe', () => {
    expect(parseWmSize('Physical size: 1080x2400\nOverride size: 720x1600')).toEqual({ width: 720, height: 1600 });
  });
  it('saída sem tamanho → null', () => { expect(parseWmSize('')).toBeNull(); expect(parseWmSize('Physical size: 0x0')).toBeNull(); });
});

describe('quoteSh', () => {
  it('envolve em aspas simples e escapa aspas simples', () => {
    expect(quoteSh('a b')).toBe("'a b'");
    expect(quoteSh("it's")).toBe(`'it'\\''s'`);
  });
});

describe('textChunks', () => {
  it('espaço vira %s', () => { expect(textChunks('oi mundo')).toEqual(['oi%smundo']); });
  it('"%s" literal é cortado depois do % para o input não o transformar em espaço', () => {
    expect(textChunks('a%sb')).toEqual(['a%', 'sb']);
    expect(textChunks('50% sim')).toEqual(['50%%ssim']);
  });
  it('rejeita vazio, > 500 caracteres, não ASCII e controle', () => {
    expect(() => textChunks('')).toThrow(InputError);
    expect(() => textChunks('x'.repeat(501))).toThrow(/500/);
    expect(() => textChunks('ação')).toThrow(/ASCII/);
    expect(() => textChunks('a\nb')).toThrow(/ASCII/);
    expect(textChunks('x'.repeat(500))).toHaveLength(1);
  });
});

describe('InputGestureSchema', () => {
  it('aceita os quatro tipos e rejeita lixo', () => {
    expect(InputGestureSchema.safeParse({ kind: 'tap', x: 0.5, y: 0.5 }).success).toBe(true);
    expect(InputGestureSchema.safeParse({ kind: 'swipe', x: 0, y: 0, x2: 1, y2: 1, durationMs: 300 }).success).toBe(true);
    expect(InputGestureSchema.safeParse({ kind: 'text', text: 'oi' }).success).toBe(true);
    expect(InputGestureSchema.safeParse({ kind: 'key', key: 'recents' }).success).toBe(true);
    expect(InputGestureSchema.safeParse({ kind: 'key', key: 'power' }).success).toBe(false);
    expect(InputGestureSchema.safeParse({ kind: 'tap', x: 'a', y: 0 }).success).toBe(false);
    expect(InputGestureSchema.safeParse({ kind: 'tap', x: Number.NaN, y: 0 }).success).toBe(false);
    expect(InputGestureSchema.safeParse({ kind: 'text', text: 'x'.repeat(501) }).success).toBe(false);
  });
});

describe('createDeviceInput', () => {
  it('tap converte 0–1 em pixels pelo wm size, com clamp', async () => {
    const { adb, calls } = fakeAdb();
    const input = createDeviceInput(adb);
    await input.send('emulator-5554', { kind: 'tap', x: 0.5, y: 0.25 });
    await input.send('emulator-5554', { kind: 'tap', x: -1, y: 2 });
    expect(calls).toEqual([['wm', 'size'], ['input', 'tap', '540', '600'], ['input', 'tap', '0', '2399']]);
  });
  it('wm size é cacheado por serial', async () => {
    const { adb, calls } = fakeAdb();
    const input = createDeviceInput(adb);
    await input.send('a', { kind: 'tap', x: 0, y: 0 }); await input.send('a', { kind: 'tap', x: 0, y: 0 }); await input.send('b', { kind: 'tap', x: 0, y: 0 });
    expect(calls.filter((c) => c[0] === 'wm')).toHaveLength(2);
  });
  it('usa Override size', async () => {
    const { adb, calls } = fakeAdb('Physical size: 1080x2400\nOverride size: 720x1600');
    await createDeviceInput(adb).send('s', { kind: 'tap', x: 1, y: 1 });
    expect(calls[1]).toEqual(['input', 'tap', '719', '1599']);
  });
  it('swipe com duração arredondada e clamp 1–5000', async () => {
    const { adb, calls } = fakeAdb();
    const input = createDeviceInput(adb);
    await input.send('s', { kind: 'swipe', x: 0.5, y: 0.75, x2: 0.5, y2: 0.25, durationMs: 250.4 });
    await input.send('s', { kind: 'swipe', x: 0, y: 0, x2: 0, y2: 0, durationMs: 99_999 });
    await input.send('s', { kind: 'swipe', x: 0, y: 0, x2: 0, y2: 0, durationMs: 0 });
    expect(calls.slice(1)).toEqual([
      ['input', 'swipe', '540', '1799', '540', '600', '250'],
      ['input', 'swipe', '0', '0', '0', '0', '5000'],
      ['input', 'swipe', '0', '0', '0', '0', '1'],
    ]);
  });
  it('text escapa para o sh e manda um input text por pedaço; não consulta wm size', async () => {
    const { adb, calls } = fakeAdb();
    await createDeviceInput(adb).send('s', { kind: 'text', text: "it's a%s $HOME" });
    expect(calls).toEqual([['input', 'text', "'it'\\''s%sa%'"], ['input', 'text', "'s%s$HOME'"]]);
  });
  it('text inválido lança InputError sem chamar o adb', async () => {
    const { adb, calls } = fakeAdb();
    await expect(createDeviceInput(adb).send('s', { kind: 'text', text: 'olá' })).rejects.toBeInstanceOf(InputError);
    expect(calls).toEqual([]);
  });
  it('key usa o mapa de keycodes', async () => {
    const { adb, calls } = fakeAdb();
    const input = createDeviceInput(adb);
    for (const key of ['back', 'home', 'recents', 'enter', 'del'] as const) await input.send('s', { kind: 'key', key });
    expect(calls.map((c) => c.join(' '))).toEqual(['input keyevent 4', 'input keyevent 3', 'input keyevent 187', 'input keyevent 66', 'input keyevent 67']);
  });
  it('wm size ilegível → InputError screen; falha não fica no cache', async () => {
    let wm = 'lixo';
    const calls: string[][] = [];
    const adb = { shell: async (_s: string, cmd: readonly string[]) => { calls.push([...cmd]); return cmd[0] === 'wm' ? wm : ''; } };
    const input = createDeviceInput(adb);
    await expect(input.send('s', { kind: 'tap', x: 0, y: 0 })).rejects.toMatchObject({ kind: 'screen' });
    wm = 'Physical size: 100x200';
    await input.send('s', { kind: 'tap', x: 1, y: 1 });
    expect(calls.at(-1)).toEqual(['input', 'tap', '99', '199']);
  });
});
