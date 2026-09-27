import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { upsertIdentity } from '../src/db/identities.js';
import { createMission, listMemory } from '../src/db/missions.js';
import type { SubtaskReport } from '../src/db/missions.js';
import { createSecretMask, generatePassword, loadMissionSecrets, missionTools } from '../src/worker/mission-tools.js';
import { memVault } from './fixtures/mem-vault.js';

const row = {
  id: 'conta2',
  name: 'conta2',
  handle: 'sem conta',
  avdName: 'x',
  serial: 's',
  consolePort: 5556,
  mcpHostPort: 8081,
  mcpToken: 't',
  deviceSlug: 'conta2',
  appPackage: 'com.instagram.android',
  appVersionName: '1',
  state: 'running' as const,
};
const exec = (tools: Record<string, unknown>, name: string, input: unknown) =>
  (tools[name] as { execute: (i: unknown, o: unknown) => Promise<unknown> }).execute(input, {
    toolCallId: 'c',
    messages: [],
  });

function setup() {
  const db = openDb(':memory:');
  upsertIdentity(db, row);
  const missionId = createMission(db, 'conta2', 'missão', 'pt');
  const vault = memVault();
  const mask = createSecretMask();
  const typed: { nodeId: string; text: string }[] = [];
  const finished: SubtaskReport[] = [];
  const human: string[] = [];
  const tools = missionTools({
    db,
    missionId,
    vault,
    mask,
    typeText: async (nodeId, text) => {
      typed.push({ nodeId, text });
    },
    onFinish: (r) => finished.push(r),
    onHuman: (r) => human.push(r),
  });
  return { db, missionId, vault, mask, typed, finished, human, tools };
}

describe('ferramentas da missão', () => {
  it('generatePassword: 20 chars com minúscula, maiúscula, dígito e símbolo; aleatória', () => {
    const a = generatePassword();
    const b = generatePassword();
    expect(a).toHaveLength(20);
    expect(a).not.toBe(b);
    expect(a).toMatch(/[a-z]/);
    expect(a).toMatch(/[A-Z]/);
    expect(a).toMatch(/\d/);
    expect(a).toMatch(/[!@#$%*_-]/);
  });
  it('mask troca toda ocorrência do segredo por •••; ignora valores curtos', () => {
    const m = createSecretMask(['abc']);
    m.add('Segredo#123456');
    expect(m.mask('x Segredo#123456 y Segredo#123456 abc')).toBe('x ••• y ••• abc');
  });
  it('memory_put grava fato comum e recusa sobrescrever segredo', async () => {
    const s = setup();
    expect(await exec(s.tools, 'memory_put', { key: 'email.address', value: 'x@y.z' })).toEqual({ saved: true });
    await exec(s.tools, 'secret_new', { key: 'email.password' });
    await expect(exec(s.tools, 'memory_put', { key: 'email.password', value: 'x' })).rejects.toThrow(/segredo/);
  });
  it('secret_new guarda no cofre e na memória só a referência; type_secret digita o valor sem devolvê-lo', async () => {
    const s = setup();
    const out = await exec(s.tools, 'secret_new', { key: 'account.com.instagram.android.password' });
    expect(out).toEqual({ key: 'account.com.instagram.android.password', created: true });
    const mem = listMemory(s.db, s.missionId);
    expect(mem).toEqual([
      {
        key: 'account.com.instagram.android.password',
        value: `mission:${s.missionId}:account.com.instagram.android.password`,
        secret: true,
      },
    ]);
    const pwd = await s.vault.get(mem[0].value);
    expect(pwd).toHaveLength(20);
    const typedOut = await exec(s.tools, 'type_secret', { node_id: 'node_7', key: 'account.com.instagram.android.password' });
    expect(typedOut).toEqual({ typed: true, length: 20 });
    expect(s.typed).toEqual([{ nodeId: 'node_7', text: pwd }]);
    expect(s.mask.mask(`campo: ${pwd}`)).toBe('campo: •••');
    expect(JSON.stringify(out) + JSON.stringify(typedOut)).not.toContain(pwd!);
  });
  it('secret_new numa chave existente não troca a senha', async () => {
    const s = setup();
    await exec(s.tools, 'secret_new', { key: 'k.password' });
    const first = await s.vault.get(`mission:${s.missionId}:k.password`);
    expect(await exec(s.tools, 'secret_new', { key: 'k.password' })).toEqual({ key: 'k.password', created: false });
    expect(await s.vault.get(`mission:${s.missionId}:k.password`)).toBe(first);
  });
  it('type_secret de chave desconhecida → erro sem digitar', async () => {
    const s = setup();
    await expect(exec(s.tools, 'type_secret', { node_id: 'node_1', key: 'nada' })).rejects.toThrow(/segredo desconhecido/);
    expect(s.typed).toEqual([]);
  });
  it('finish_subtask e request_human chamam os callbacks', async () => {
    const s = setup();
    await exec(s.tools, 'finish_subtask', { ok: true, did: 'criou a caixa', blockers: '' });
    await exec(s.tools, 'request_human', { reason: 'o provedor pediu número de telefone' });
    expect(s.finished).toEqual([{ ok: true, did: 'criou a caixa', blockers: '' }]);
    expect(s.human).toEqual(['o provedor pediu número de telefone']);
  });
  it('loadMissionSecrets devolve os valores dos segredos da missão', async () => {
    const s = setup();
    await exec(s.tools, 'secret_new', { key: 'a.password' });
    const vals = await loadMissionSecrets(s.db, s.vault, s.missionId);
    expect(vals).toHaveLength(1);
    expect(vals[0]).toHaveLength(20);
  });
});
