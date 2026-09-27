import { describe, expect, it } from 'vitest';
import { INITIAL_STATE, onboardingReducer } from './reducer';
import type { SetupReport } from './schema';

const report = (gpu: SetupReport['hardware']['gpu']): SetupReport => ({ deps: [], hardware: { ramGiB: 64, threads: 32, cpuModel: 'x', gpu, diskFreeGiB: 100 }, localModels: [] });

describe('onboardingReducer', () => {
  it('check-done escolhe modo e modelo padrão pelo hardware, sem sobrescrever o que a pessoa escolheu', () => {
    const s1 = onboardingReducer(INITIAL_STATE, { type: 'check-done', report: report(null) });
    expect([s1.mode, s1.model, s1.checking]).toEqual(['nuvem', 'gpt-oss:20b', false]);
    const touched = onboardingReducer(onboardingReducer(INITIAL_STATE, { type: 'pick-mode', mode: 'local' }), { type: 'pick-model', model: 'qwen3:14b' });
    const s2 = onboardingReducer(touched, { type: 'check-done', report: report({ name: 'x', totalGiB: 24, unified: false }) });
    expect([s2.mode, s2.model]).toEqual(['local', 'qwen3:14b']);
  });
  it('pick-model ignora modelo que não cabe na placa', () => {
    const s = onboardingReducer(INITIAL_STATE, { type: 'check-done', report: report({ name: 'x', totalGiB: 24, unified: false }) });
    expect(onboardingReducer(s, { type: 'pick-model', model: 'gpt-oss:120b' }).model).toBe('gpt-oss:20b');
  });
  it('trocar a chave zera o teste', () => {
    const tested = onboardingReducer(onboardingReducer(INITIAL_STATE, { type: 'key-test-start' }), { type: 'key-test-done', result: 'ok' });
    expect(tested.keyTest).toBe('ok');
    expect(onboardingReducer(tested, { type: 'set-key', key: 'sk-ant-y' }).keyTest).toBe('idle');
  });
  it('eventos de job substituem o anterior; install-start limpa o erro', () => {
    const e1 = onboardingReducer(INITIAL_STATE, { type: 'job', event: { id: 'img', state: 'err', doneMb: 1, totalMb: 2, error: { kind: 'network', message: 'x' } } });
    const e2 = onboardingReducer({ ...e1, installError: 'y' }, { type: 'install-start' });
    expect([e2.installing, e2.installError]).toEqual([true, null]);
    const e3 = onboardingReducer(e2, { type: 'job', event: { id: 'img', state: 'run', doneMb: 1.5, totalMb: 2, error: null } });
    expect(e3.jobs.img?.state).toBe('run');
  });
  it('log guarda só as últimas 200 linhas', () => {
    let s = INITIAL_STATE;
    for (let i = 0; i < 250; i++) s = onboardingReducer(s, { type: 'log', line: `l${i}` });
    expect(s.log).toHaveLength(200);
    expect(s.log[0]).toBe('l50');
  });
  it('finish-done vai para o passo 4', () => {
    const s = onboardingReducer({ ...INITIAL_STATE, step: 2, finishing: true }, { type: 'finish-done' });
    expect([s.step, s.finishing]).toEqual([3, false]);
  });
});
