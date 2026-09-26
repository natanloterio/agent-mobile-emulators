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
