import { describe, expect, it } from 'vitest';
import { finishSetup } from './finish';
import { resolveSetupPaths } from './paths';
import type { SetupFileT } from './setup-file';

const KEY = 'sk-ant-' + 'x'.repeat(30);

function deps() {
  const log: string[] = [];
  const writes: SetupFileT[] = [];
  return {
    log, writes,
    d: {
      paths: resolveSetupPaths({}, '/home/u'),
      writeSetup: async (f: SetupFileT) => { writes.push(f); log.push(`write completed=${f.completedAt !== null}`); },
      startDaemon: async () => { log.push('start'); },
      daemon: async (method: 'PUT', p: string, body: unknown) => { log.push(`${method} ${p} ${JSON.stringify(body)}`); return null; },
      now: () => '2026-09-27T12:00:00.000Z',
      readSetup: async (): Promise<SetupFileT | null> => null,
    },
  };
}

describe('finishSetup', () => {
  it('grava caminhos, sobe o daemon, grava a chave, aplica os papéis e só então marca concluído', async () => {
    const { d, log, writes } = deps();
    await finishSetup({ mode: 'misto', localModel: 'gpt-oss:20b', anthropicKey: KEY, applyRoles: true }, '/opt/ollama', d);
    expect(log).toEqual([
      'write completed=false', 'start',
      `PUT /settings/anthropic-key {"key":"${KEY}"}`,
      'PUT /providers/lider {"mode":"nuvem","model":"claude-sonnet-5"}',
      'PUT /providers/worker {"mode":"local","model":"gpt-oss:20b","endpoint":"http://127.0.0.1:11434/v1","runtime":"ollama"}',
      'PUT /providers/esc {"mode":"nuvem","model":"claude-haiku-4-5"}',
      'write completed=true',
    ]);
    expect(writes[1]).toEqual({ version: 1, completedAt: '2026-09-27T12:00:00.000Z', paths: { sdkRoot: '/home/u/Android/Sdk', ollamaBin: '/opt/ollama' } });
  });
  it('sem chave não chama a rota da chave', async () => {
    const { d, log } = deps();
    await finishSetup({ mode: 'local', localModel: 'qwen3:14b', anthropicKey: null, applyRoles: true }, null, d);
    expect(log.some((l) => l.includes('anthropic-key'))).toBe(false);
  });
  it('se um papel falha, não marca concluído (a próxima abertura mostra o onboarding de novo)', async () => {
    const { d, writes } = deps();
    const failing = { ...d, daemon: async () => { throw new Error('/providers/worker → 409'); } };
    await expect(finishSetup({ mode: 'nuvem', localModel: 'gpt-oss:20b', anthropicKey: null, applyRoles: true }, null, failing)).rejects.toThrow(/409/);
    expect(writes.map((w) => w.completedAt)).toEqual([null]);
  });
  it('applyRoles=false (reabertura sem mexer em modo nem modelo): não toca nos papéis, mas grava a chave', async () => {
    const { d, log } = deps();
    await finishSetup({ mode: 'misto', localModel: 'gpt-oss:20b', anthropicKey: KEY, applyRoles: false }, null, d);
    expect(log).toEqual(['write completed=false', 'start', `PUT /settings/anthropic-key {"key":"${KEY}"}`, 'write completed=true']);
    expect(log.some((l) => l.includes('/providers/'))).toBe(false);
  });
  it('reabertura mantém o completedAt anterior na primeira gravação (falha no meio não vira primeira execução)', async () => {
    const { d, writes } = deps();
    const prev: SetupFileT = { version: 1, completedAt: '2026-09-01T00:00:00.000Z', paths: { sdkRoot: '/sdk', ollamaBin: null } };
    const failing = { ...d, readSetup: async () => prev, daemon: async () => { throw new Error('409'); } };
    await expect(finishSetup({ mode: 'nuvem', localModel: 'gpt-oss:20b', anthropicKey: null, applyRoles: true }, null, failing)).rejects.toThrow(/409/);
    expect(writes.map((w) => w.completedAt)).toEqual(['2026-09-01T00:00:00.000Z']);
  });
});
