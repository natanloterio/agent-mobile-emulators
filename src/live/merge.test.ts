import { describe, expect, it } from 'vitest';
import { IDENTITIES } from '../data/identities';
import { liveLogFor, mergeLive } from './merge';

const live = {
  killed: false, updatedAt: 'x',
  identities: [{ id: 'conta1', name: 'conta1', handle: '@p1t41a.meta.test', state: 'needs-human', task: 'Levantar comentários', steps: 12, budget: 30, costUsd: 0.07, error: 'checkpoint', lastTools: [] }],
};

describe('mergeLive', () => {
  it('sem snapshot devolve o mock intacto', () => {
    expect(mergeLive(IDENTITIES, null)).toBe(IDENTITIES);
  });
  it('sobrepõe só a identidade 0 e traduz needs-human → needs', () => {
    const out = mergeLive(IDENTITIES, live);
    expect(out[0]).toMatchObject({ handle: '@p1t41a.meta.test', state: 'needs', steps: 12, budget: 30, error: 'checkpoint' });
    expect(out[1]).toBe(IDENTITIES[1]);
    expect(IDENTITIES[0].handle).toBe('@aurora.moda');
  });
  it('traduz offline e idle/running/logged-in', () => {
    const st = (s: string) => mergeLive(IDENTITIES, { ...live, identities: [{ ...live.identities[0], state: s }] })[0].state;
    expect(st('offline')).toBe('offline'); expect(st('running')).toBe('running'); expect(st('logged-in')).toBe('idle'); expect(st('idle')).toBe('idle');
  });
});

describe('mergeLive — incremento 3', () => {
  it('aplica degraded, genMs e earlyStopRemaining na identidade viva e o sufixo na task', () => {
    const out = mergeLive(IDENTITIES, { ...live, identities: [{ ...live.identities[0], degraded: true, genMs: 33900, earlyStopRemaining: 13 }] });
    expect(out[0]).toMatchObject({ degraded: true, genMs: 33900, earlyStopRemaining: 13 });
    expect(out[0].task).toMatch(/· degradada$/);
  });
  it('copia o estado do stream de vídeo (valores desconhecidos viram undefined)', () => {
    const v = (video: string | undefined) => mergeLive(IDENTITIES, { ...live, identities: [{ ...live.identities[0], video }] })[0].video;
    expect(v('streaming')).toBe('streaming'); expect(v('retrying')).toBe('retrying'); expect(v(undefined)).toBeUndefined(); expect(v('lixo')).toBeUndefined();
  });
  it('liveLogFor mostra o provedor curto por linha', () => {
    const rows = liveLogFor({ ...live, identities: [{ ...live.identities[0], lastTools: [{ idx: 1, tool: 't', excerpt: 'x', tokens: 1000, gate: false, provider: 'local:gpt-oss:20b' }] }] }, 'conta1');
    expect(rows?.[0].desc).toMatch(/^\[local\] /);
  });
});

import { liveRoles } from './merge';
import type { RoleVM } from '../state/selectors';

const roles: readonly RoleVM[] = [
  { key: 'lider', name: 'Líder', volume: 'v', tone: 'grey', mode: 'nuvem', model: 'Claude Sonnet', endpoint: 'api.anthropic.com', testLabel: 'Testar conexão', testing: false, result: null, models: [], error: null, putError: null },
  { key: 'worker', name: 'Worker', volume: 'v', tone: 'green', mode: 'local', model: 'mock', endpoint: 'mock', testLabel: 'Testar conexão', testing: false, result: null, models: [], error: null, putError: null },
  { key: 'esc', name: 'Esc', volume: 'v', tone: 'dark', mode: 'nuvem', model: 'mock', endpoint: 'mock', testLabel: 'Testar conexão', testing: false, result: null, models: [], error: null, putError: null },
];
const snap = { ...live, providers: {
  lider: { role: 'lider', mode: 'nuvem', model: 'claude-sonnet-5', endpoint: 'anthropic', lastTest: null },
  worker: { role: 'worker', mode: 'local', model: 'qwen3.5:27b', endpoint: 'http://127.0.0.1:11434/v1', lastTest: { role: 'worker', model: 'qwen3.5:27b', latencyMs: 812, tokensPerSec: 41.3, argsValid: true, warning: null, error: null, at: 'x' } },
  esc: { role: 'esc', mode: 'nuvem', model: 'claude-haiku-4-5', endpoint: 'anthropic', lastTest: { role: 'esc', model: 'claude-haiku-4-5', latencyMs: 0, tokensPerSec: null, argsValid: false, warning: null, error: 'auth: ANTHROPIC_API_KEY ausente', at: 'x' } },
} } as const;

describe('liveRoles', () => {
  it('sem snapshot devolve o mock intacto', () => { expect(liveRoles(roles, null)).toBe(roles); });
  it('sobrepõe modo/modelo/endpoint e traduz o último teste em linhas', () => {
    const out = liveRoles(roles, snap as never);
    expect(out[1]).toMatchObject({ mode: 'local', model: 'qwen3.5:27b', endpoint: 'http://127.0.0.1:11434/v1' });
    expect(out[1].result).toEqual([{ label: 'Latência', value: '812 ms' }, { label: 'Tokens/s', value: '41,3' }, { label: 'Argumentos', value: 'estruturados e válidos' }, { label: 'Tool', value: 'android_conta1_get_screen_state' }]);
    expect(out[2].result?.[3]).toEqual({ label: 'Erro', value: 'auth: ANTHROPIC_API_KEY ausente' });
    expect(out[0].result).toBeNull();
    expect(roles[1].model).toBe('mock');
  });
  it('enquanto testing=true não sobrepõe o resultado antigo', () => {
    const out = liveRoles(roles.map((r) => ({ ...r, testing: true })), snap as never);
    expect(out[1].result).toBeNull();
  });
});

describe('mergeLive — incremento 4 (várias identidades e posters por id)', () => {
  const two = { ...live, identities: [{ ...live.identities[0], id: 'conta1', name: 'conta1' }, { ...live.identities[0], id: 'conta2', name: 'conta2', handle: '@segunda', state: 'running' }] };
  const frames = { conta2: { id: 'conta2', at: '2026-09-26T00:00:02.000Z', png: 'QkJC' }, conta1: { id: 'conta1', at: '2026-09-26T00:00:01.000Z', png: 'QUFB' } };
  it('sobrepõe a i-ésima identidade viva no i-ésimo tile e casa o poster pelo id, não pela ordem', () => {
    const out = mergeLive(IDENTITIES, two, frames);
    expect(out[0]).toMatchObject({ id: 'conta1', screen: { dataUrl: 'data:image/png;base64,QUFB', at: '2026-09-26T00:00:01.000Z' } });
    expect(out[1]).toMatchObject({ id: 'conta2', handle: '@segunda', state: 'running', screen: { dataUrl: 'data:image/png;base64,QkJC' } });
    expect(out[2]).toBe(IDENTITIES[2]); expect(out).toHaveLength(IDENTITIES.length);
  });
  it('sem poster não põe screen; sem snapshot devolve o mock intacto; identidades vivas extras são acrescentadas', () => {
    expect(mergeLive(IDENTITIES, two, {})[0].screen).toBeUndefined();
    expect(mergeLive(IDENTITIES, null, frames)).toBe(IDENTITIES);
    const many = { ...live, identities: IDENTITIES.map((_, i) => ({ ...live.identities[0], id: `c${i}`, name: `c${i}` })).concat([{ ...live.identities[0], id: 'extra', name: 'extra' }]) };
    expect(mergeLive(IDENTITIES, many, {})).toHaveLength(IDENTITIES.length + 1);
  });
});
