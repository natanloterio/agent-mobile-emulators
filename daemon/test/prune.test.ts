import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';
import { isScreenTool, PRUNED_PLACEHOLDER, pruneScreens } from '../src/worker/prune.js';

const screenResult = (id: string, text: string): ModelMessage => ({
  role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName: 'android_conta1_get_screen_state', output: { type: 'text', value: text } }],
});
const otherResult = (id: string): ModelMessage => ({
  role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName: 'android_conta1_click_node', output: { type: 'text', value: 'Click performed' } }],
});

describe('pruneScreens', () => {
  it('mantém só os N últimos screen states e substitui os antigos pelo placeholder', () => {
    const msgs: ModelMessage[] = [
      { role: 'user', content: 'objetivo' }, screenResult('a', 'tela 1'), otherResult('b'), screenResult('c', 'tela 2'), screenResult('d', 'tela 3'),
    ];
    const out = pruneScreens(msgs, 2);
    const texts = out.filter((m) => m.role === 'tool').map((m) => (m.content[0] as { output: { value: string } }).output.value);
    expect(texts).toEqual([PRUNED_PLACEHOLDER, 'Click performed', 'tela 2', 'tela 3']);
    expect((msgs[1].content[0] as { output: { value: string } }).output.value).toBe('tela 1'); // entrada não mutada
  });
  it('não toca em nada quando há N ou menos', () => {
    const msgs: ModelMessage[] = [screenResult('a', 'x'), screenResult('b', 'y')];
    expect(pruneScreens(msgs, 2)).toEqual(msgs);
  });
  it('isScreenTool reconhece qualquer prefixo de slug', () => {
    expect(isScreenTool('android_get_screen_state')).toBe(true);
    expect(isScreenTool('android_conta3_get_screen_state')).toBe(true);
    expect(isScreenTool('android_conta3_get_node_details')).toBe(false);
  });
});
