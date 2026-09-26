import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detectPlatformBlock, editableNodes, findNodes, focusedWindow, nodeById } from '../src/screen/checks.js';
import { parseScreen } from '../src/screen/parse.js';

const S = JSON.parse(readFileSync(new URL('./fixtures/screens.json', import.meta.url), 'utf8')) as Record<string, string>;
const CK = readFileSync(new URL('./fixtures/checkpoint.txt', import.meta.url), 'utf8');

describe('parseScreen', () => {
  it('separa janelas e nós com bounds e flags', () => {
    const s = parseScreen(S.launcher);
    expect(s.width).toBe(1080);
    const w = focusedWindow(s);
    expect(w?.pkg).toBe('com.google.android.apps.nexuslauncher');
    const ig = findNodes(s, /^Instagram$/)[0];
    expect(ig?.bounds).toEqual({ l: 57, t: 223, r: 267, b: 495 });
    expect(ig?.flags.has('clk')).toBe(true);
  });
  it('não há nó editável no launcher, embora a busca seja clicável (regra de affordance do spec)', () => {
    const s = parseScreen(S.launcher);
    expect(editableNodes(s)).toHaveLength(0);
    expect(findNodes(s, /Search/).some((n) => n.flags.has('clk'))).toBe(true);
  });
  it('expõe cursor de paginação quando a resposta o traz', () => {
    const paged = S.play_store + '\nnext_cursor:abc123.2\n';
    expect(parseScreen(paged).cursor).toBe('abc123.2');
    expect(parseScreen(S.play_store).cursor).toBeNull();
  });
  it('nodeById acha em qualquer janela', () => {
    const s = parseScreen(S.mcp_app_settings);
    expect(nodeById(s, 'node_72cfd38d')?.text).toBe('Server');
  });
});

describe('detectPlatformBlock', () => {
  it('reconhece checkpoint do Instagram', () => {
    expect(detectPlatformBlock(parseScreen(CK))).toMatch(/Confirme que é você/);
  });
  it('não dispara em tela normal', () => {
    expect(detectPlatformBlock(parseScreen(S.launcher))).toBeNull();
  });
});

describe('parseScreen — paginação no formato real do servidor (I3)', () => {
  it('extrai o cursor da nota "call get_screen_state with cursor \\"<id>.<n>\\""', async () => {
    const { PAGE1, PAGE2 } = await import('./fixtures/paged.js');
    expect(parseScreen(PAGE1).cursor).toBe('k7x9q.2');
    expect(parseScreen(PAGE2).cursor).toBeNull();
  });
  it('deriva o cursor do cabeçalho page:N/total snapshot:<id> mesmo sem a nota', async () => {
    const { PAGE1 } = await import('./fixtures/paged.js');
    const semNota = PAGE1.split('\n').filter((l) => !l.startsWith('note:more nodes')).join('\n');
    expect(parseScreen(semNota).cursor).toBe('k7x9q.2');
  });
});
