import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseScreen } from '../src/screen/parse.js';
import { buildToolApproval, decideNodeAction } from '../src/worker/gate.js';

const S = JSON.parse(readFileSync(new URL('./fixtures/screens.json', import.meta.url), 'utf8')) as Record<string, string>;
const play = parseScreen(S.play_store); // tem "I'm in!" e "Not now"
const withSend = parseScreen(S.launcher + '\nnode_ff01\tButton\tEnviar\t-\t-\t0,0,10,10\ton,clk,ena\n');

describe('gate determinístico', () => {
  it('nega toque em nó com rótulo irreversível e explica', () => {
    const d = decideNodeAction('node_ff01', withSend);
    expect(d).toMatchObject({ type: 'denied' });
    expect(String((d as { reason?: string }).reason)).toMatch(/Enviar/);
  });
  it('aprova toque em nó comum', () => {
    expect(decideNodeAction('node_bec469ea', withSend)).toBe('approved'); // ícone do Instagram
  });
  it('sem tela conhecida, nega: não se toca no que não se leu', () => {
    expect(decideNodeAction('node_x', null)).toMatchObject({ type: 'denied' });
  });
  it('buildToolApproval cobre click/tap com o prefixo do slug e nega digitação em modo somente-leitura', () => {
    let screen = play;
    const approvals = buildToolApproval('conta1', () => screen, 'read-only');
    expect(Object.keys(approvals).sort()).toEqual(['android_conta1_click_node', 'android_conta1_tap_node', 'android_conta1_type_append_text']);
    expect(approvals.android_conta1_type_append_text({ node_id: 'n', text: 'oi' })).toMatchObject({ type: 'denied' });
    const notNow = play.windows.flatMap((w) => w.nodes).find((n) => n.text === 'Not now')!;
    expect(approvals.android_conta1_click_node({ node_id: notNow.id })).toBe('approved');
    screen = withSend;
    expect(approvals.android_conta1_tap_node({ node_id: 'node_ff01' })).toMatchObject({ type: 'denied' });
  });
});

describe('gate — revisão final (I2)', () => {
  it('casa por palavra e cobre curtir/like/"seguir de volta"/"publicar agora"', () => {
    const s = parseScreen(S.launcher + '\nnode_a\tButton\tSeguir de volta\t-\t-\t0,0,10,10\ton,clk,ena\nnode_b\tButton\tCurtir\t-\t-\t0,20,10,30\ton,clk,ena\nnode_c\tButton\tLike\t-\t-\t0,40,10,50\ton,clk,ena\nnode_d\tButton\tPublicar agora\t-\t-\t0,60,10,70\ton,clk,ena\n');
    for (const id of ['node_a', 'node_b', 'node_c', 'node_d']) expect(decideNodeAction(id, s), id).toMatchObject({ type: 'denied' });
  });
  it('container clicável sem texto com filho "Seguir" dentro dos bounds é negado', () => {
    const s = parseScreen(S.launcher + '\nnode_box\tFrameLayout\t-\t-\t-\t0,0,100,100\ton,clk,ena\nnode_child\tTextView\tSeguir\t-\t-\t10,10,50,30\ton,ena\n');
    expect(decideNodeAction('node_box', s)).toMatchObject({ type: 'denied' });
  });
  it('palavra neutra que contém o radical continua aprovada ("Seguidores: 120")', () => {
    const s = parseScreen(S.launcher + '\nnode_n\tTextView\tSeguidores: 120\t-\t-\t0,0,10,10\ton,clk,ena\n');
    expect(decideNodeAction('node_n', s)).toBe('approved');
  });
});
