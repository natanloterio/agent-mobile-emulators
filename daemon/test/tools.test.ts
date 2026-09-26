import { describe, expect, it } from 'vitest';
import { missingWorkerTools, pickWorkerTools, toolPrefix, WORKER_TOOL_SUFFIXES } from '../src/worker/tools.js';

const fakeSet = (names: string[]) => Object.fromEntries(names.map((n) => [n, { description: n, inputSchema: {} }])) as never;

describe('subset de tools do worker', () => {
  it('prefixo depende do slug', () => {
    expect(toolPrefix(null)).toBe('android_');
    expect(toolPrefix('conta1')).toBe('android_conta1_');
  });
  it('seleciona exatamente as 11 do workload e ignora o resto', () => {
    const all = fakeSet(['android_conta1_tap_node', 'android_conta1_get_screen_state', 'android_conta1_camera_capture', 'android_conta1_open_app']);
    const picked = pickWorkerTools(all, 'conta1');
    expect(Object.keys(picked).sort()).toEqual(['android_conta1_get_screen_state', 'android_conta1_open_app', 'android_conta1_tap_node']);
  });
  it('lista as tools que faltam (sonda: presença, nunca contagem)', () => {
    const all = fakeSet(WORKER_TOOL_SUFFIXES.filter((s) => s !== 'press_back').map((s) => `android_${s}`));
    expect(missingWorkerTools(all, null)).toEqual(['android_press_back']);
  });
});
