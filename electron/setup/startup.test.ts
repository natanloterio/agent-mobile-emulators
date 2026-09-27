import { describe, expect, it } from 'vitest';
import { resolveSetupPaths } from './paths';
import type { ProbeResult } from './probe';
import { decideStartup } from './startup';
import type { DepStatus } from './types';

const paths = resolveSetupPaths({}, '/home/u');
const hw = { ramGiB: 64, threads: 32, cpuModel: 'x', gpu: null, diskFreeGiB: 100 };
const dep = (id: DepStatus['id'], state: DepStatus['state']): DepStatus => ({ id, state, version: null, sizeMb: null, fix: null });
const ids: DepStatus['id'][] = ['sdk', 'adb', 'emu', 'img', 'kvm', 'ollama', 'keyring'];
const probeWith = (state: (id: DepStatus['id']) => DepStatus['state']) => async (): Promise<ProbeResult> =>
  ({ report: { deps: ids.map((id) => dep(id, state(id))), hardware: hw, localModels: [] }, ollamaBin: 'ollama' });
const now = () => '2026-09-27T12:00:00.000Z';

describe('decideStartup', () => {
  it('plataforma sem suporte: segue direto, sem sondar', async () => {
    const r = await decideStartup({ supported: false, saved: null, paths, probe: async () => { throw new Error('não sonda'); }, now });
    expect(r).toEqual({ completed: true, write: null });
  });
  it('setup.json concluído: segue direto', async () => {
    const saved = { version: 1 as const, completedAt: '2026-09-01T00:00:00.000Z', paths: { sdkRoot: '/sdk', ollamaBin: null } };
    expect(await decideStartup({ supported: true, saved, paths, probe: async () => { throw new Error('não sonda'); }, now })).toEqual({ completed: true, write: null });
  });
  it('instalação existente sem setup.json e tudo ok: conclui sozinho e grava os caminhos', async () => {
    const r = await decideStartup({ supported: true, saved: null, paths, probe: probeWith(() => 'ok'), now });
    expect(r).toEqual({ completed: true, write: { version: 1, completedAt: now(), paths: { sdkRoot: paths.sdkRoot, ollamaBin: 'ollama' } } });
  });
  it('falta algo, sondagem falhou ou setup.json pela metade: mostra o onboarding', async () => {
    expect((await decideStartup({ supported: true, saved: null, paths, probe: probeWith((id) => (id === 'img' ? 'todo' : 'ok')), now })).completed).toBe(false);
    expect((await decideStartup({ supported: true, saved: null, paths, probe: async () => { throw new Error('x'); }, now })).completed).toBe(false);
    const half = { version: 1 as const, completedAt: null, paths: { sdkRoot: '/sdk', ollamaBin: null } };
    expect((await decideStartup({ supported: true, saved: half, paths, probe: probeWith((id) => (id === 'kvm' ? 'user' : 'ok')), now })).completed).toBe(false);
  });
  it('só o Ollama falta (ele é opcional; nuvem funciona sem): conclui sozinho, sem binário do Ollama', async () => {
    const probe = async (): Promise<ProbeResult> => ({ ...(await probeWith((id) => (id === 'ollama' ? 'todo' : 'ok'))()), ollamaBin: null });
    const r = await decideStartup({ supported: true, saved: null, paths, probe, now });
    expect(r).toEqual({ completed: true, write: { version: 1, completedAt: now(), paths: { sdkRoot: paths.sdkRoot, ollamaBin: null } } });
  });
  it('setup.json antigo (Linux, sem plataforma gravada) continua concluído', async () => {
    const saved = { version: 1 as const, completedAt: '2026-09-27T12:00:00.000Z', paths: { sdkRoot: '/home/u/Android/Sdk', ollamaBin: 'ollama' } };
    expect(await decideStartup({ supported: true, saved, paths, probe: async () => { throw new Error('não sonda'); }, now })).toEqual({ completed: true, write: null });
  });
});
