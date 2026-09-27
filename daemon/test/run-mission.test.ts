import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { getIdentity, upsertIdentity } from '../src/db/identities.js';
import { addSubtask, createMission, listMemory, listSubtasks } from '../src/db/missions.js';
import { ProviderError } from '../src/provider/errors.js';
import { createSecretMask, secretEntryId } from '../src/worker/mission-tools.js';
import { runTask, type RunTaskDeps } from '../src/worker/run.js';
import { VaultError, type Vault } from '../src/vault/vault.js';
import { memVault } from './fixtures/mem-vault.js';

const row = { id: 'conta2', name: 'conta2', handle: 'sem conta', avdName: 'x', serial: 's', consolePort: 5556, mcpHostPort: 8081, mcpToken: 't', deviceSlug: 'conta2', appPackage: 'com.instagram.android', appVersionName: '1', state: 'running' as const };
const P = 'android_conta2_';
const CLOUD = { role: 'esc' as const, mode: 'nuvem' as const, model: 'claude-haiku-4-5', endpoint: 'anthropic' };
const PROVIDERS = { lider: { ...CLOUD, role: 'lider' as const, model: 'claude-sonnet-5' }, worker: { ...CLOUD, role: 'worker' as const }, esc: CLOUD };
const screenOf = (pkg: string, labels: readonly string[]) =>
  `screen:1080x2400 density:420 orientation:portrait\n--- window:1 type:APPLICATION pkg:${pkg} title:x layer:0 focused:true ---\nnode_id\tclass\ttext\tdesc\tres_id\tbounds\tflags\n`
  + labels.map((l, i) => `node_${i}\tEditText\t${l}\t-\t-\t0,${i * 10},10,${i * 10 + 10}\ton,ena,edt`).join('\n') + '\n';

/** MCP falso com estado: o que for digitado aparece na próxima leitura de tela e no find_nodes (campo sem máscara). */
function fakeMcp(opts: { pkg?: string; labels?: string[]; fail?: 'device-missing'; typeFails?: boolean } = {}) {
  const typed: string[] = []; const clicked: string[] = [];
  const screen = () => screenOf(opts.pkg ?? 'com.instagram.android', [...(opts.labels ?? ['Confirmar']), ...typed]);
  const connect: RunTaskDeps['connect'] = async () => ({
    tools: async () => ({
      [`${P}get_screen_state`]: { description: 'x', inputSchema: {}, execute: async () => { if (opts.fail) throw new Error("adb: device 'emulator-5556' not found"); return screen(); } },
      [`${P}find_nodes`]: { description: 'x', inputSchema: {}, execute: async () => ({ content: [{ type: 'text', text: `achei: ${typed.join(',')}` }] }) },
      [`${P}click_node`]: { description: 'x', inputSchema: {}, execute: async (i: { node_id: string }) => { clicked.push(i.node_id); return 'ok'; } },
      // erro cru do MCP: ecoa o parâmetro (a senha) — a fixture existe para provar que isso nunca sobe como veio (fix round 1, item 1).
      [`${P}type_append_text`]: { description: 'x', inputSchema: {}, execute: async (i: { text: string }) => { if (opts.typeFails) throw new Error(`falhou digitando ${i.text}`); typed.push(i.text); return 'ok'; } },
    }) as never,
    close: async () => {},
  });
  return { connect, typed, clicked };
}

/** generateText falso que roda um roteiro de tool calls, registra o que o modelo "veria" e respeita halts simples. */
function scripted(script: readonly (readonly [string, unknown])[]) {
  const seen: string[] = []; const opts: { toolApproval?: unknown; instructions?: string; messages?: unknown }[] = [];
  const generate = (async (o: { tools: Record<string, { execute: (i: unknown, x: unknown) => Promise<unknown> }>; onStepFinish?: (s: unknown) => void | Promise<void>; toolApproval?: unknown; instructions?: string; messages?: unknown }) => {
    opts.push({ toolApproval: o.toolApproval, instructions: o.instructions, messages: o.messages });
    let n = 0;
    for (const [name, input] of script) {
      const id = `c${++n}`; let out: unknown; let err: unknown = null;
      try { out = await o.tools[name].execute(input, { toolCallId: id, messages: [] }); } catch (e) { err = e; }
      const text = err ? String((err as Error).message) : typeof out === 'string' ? out : JSON.stringify(out);
      seen.push(text);
      const part = err ? { type: 'tool-error', toolCallId: id, toolName: name, input, error: err } : { type: 'tool-result', toolCallId: id, toolName: name, input, output: out };
      await o.onStepFinish?.({ stepNumber: n - 1, text: '', content: [{ type: 'tool-call', toolCallId: id, toolName: name, input }, part], usage: { inputTokens: 10, outputTokens: 1 } });
    }
    return { text: 'fim', totalUsage: { inputTokens: 10, outputTokens: 1 }, steps: [], response: { messages: [] } };
  }) as unknown as RunTaskDeps['generate'];
  return { generate, seen, opts };
}

function setup(vaultIn?: Vault) {
  const db = openDb(':memory:'); upsertIdentity(db, row);
  const missionId = createMission(db, 'conta2', 'missão', 'pt');
  const taskId = addSubtask(db, missionId, 'cadastrar', 'conta criada');
  const vault = vaultIn ?? memVault(); const mask = createSecretMask();
  const run = (deps: RunTaskDeps, stepBudget = 60) => runTask({
    db, identity: row, goalText: 'missão', goalId: missionId, taskId, instruction: 'Objetivo: cadastrar', apiKey: 'k',
    isKilled: () => false, onStep: () => {}, providers: PROVIDERS, stepBudget, mission: { missionId, vault, mask },
  }, deps);
  return { db, missionId, taskId, vault, run };
}
const taskState = (db: ReturnType<typeof openDb>, id: string) => (db.prepare('select state from task where id=?').get(id) as { state: string }).state;

describe('runTask em modo missão', () => {
  it('sem gate: toque em "Confirmar" executa; finish_subtask ok → subtarefa done com relatório; identidade intocada', async () => {
    const s = setup(); const mcp = fakeMcp(); const g = scripted([[`${P}get_screen_state`, {}], [`${P}click_node`, { node_id: 'node_0' }], ['finish_subtask', { ok: true, did: 'confirmou', blockers: '' }]]);
    const r = await s.run({ connect: mcp.connect, generate: g.generate });
    expect(g.opts[0].toolApproval).toBeUndefined();
    expect(g.opts[0].instructions).toMatch(/missão/i);
    expect(g.opts[0].messages).toEqual([{ role: 'user', content: 'Objetivo: cadastrar' }]);
    expect(mcp.clicked).toEqual(['node_0']);
    expect(r.report).toEqual({ ok: true, did: 'confirmou', blockers: '' });
    expect(taskState(s.db, s.taskId)).toBe('done');
    expect(listSubtasks(s.db, s.missionId)[0].report).toEqual({ ok: true, did: 'confirmou', blockers: '' });
    expect(getIdentity(s.db, 'conta2')?.state).toBe('running');
  });
  it('segredo: vai ao device, mas nunca ao modelo nem ao banco (tela e find_nodes mascarados)', async () => {
    const s = setup(); const mcp = fakeMcp(); const key = 'account.com.instagram.android.password';
    const g = scripted([['secret_new', { key }], [`${P}get_screen_state`, {}], ['type_secret', { node_id: 'node_0', key }], [`${P}get_screen_state`, {}], [`${P}find_nodes`, { text: 'x' }], ['finish_subtask', { ok: true, did: 'digitou', blockers: '' }]]);
    await s.run({ connect: mcp.connect, generate: g.generate });
    const pwd = mcp.typed[0];
    expect(pwd).toHaveLength(20);
    expect(g.seen.join('\n')).not.toContain(pwd);
    expect(g.seen[3]).toContain('•••');
    const dump = JSON.stringify(s.db.prepare('select * from step').all()) + JSON.stringify(listMemory(s.db, s.missionId)) + JSON.stringify(s.db.prepare('select * from task').all());
    expect(dump).not.toContain(pwd);
  });
  it('captcha no navegador → needs-human com motivo', async () => {
    const s = setup(); const mcp = fakeMcp({ pkg: 'com.android.chrome', labels: ["I'm not a robot"] });
    const r = await s.run({ connect: mcp.connect, generate: scripted([[`${P}get_screen_state`, {}]]).generate });
    expect(taskState(s.db, s.taskId)).toBe('needs-human');
    expect(r.humanReason).toMatch(/not a robot/);
  });
  it('request_human → needs-human com o motivo do agente', async () => {
    const s = setup(); const mcp = fakeMcp();
    const r = await s.run({ connect: mcp.connect, generate: scripted([['request_human', { reason: 'pediu telefone' }]]).generate });
    expect(taskState(s.db, s.taskId)).toBe('needs-human'); expect(r.humanReason).toBe('pediu telefone');
  });
  it('orçamento esgotado sem finish_subtask → failed com bloqueio explicado', async () => {
    const s = setup(); const mcp = fakeMcp();
    const r = await s.run({ connect: mcp.connect, generate: scripted([[`${P}get_screen_state`, {}], [`${P}get_screen_state`, {}]]).generate }, 2);
    expect(taskState(s.db, s.taskId)).toBe('failed');
    expect(r.report?.blockers).toMatch(/orçamento/);
  });
  it('chave da nuvem ausente → interrupted com o motivo (a missão pausa em vez de replanejar)', async () => {
    const s = setup(); const mcp = fakeMcp();
    const r = await s.run({ connect: mcp.connect, generate: (async () => { throw new ProviderError('auth', 'ANTHROPIC_API_KEY ausente'); }) as unknown as RunTaskDeps['generate'] });
    expect(taskState(s.db, s.taskId)).toBe('interrupted');
    expect(r.platformBlock).toBeNull();
  });
  it('device sumiu → interrupted (não failed), sem relatório', async () => {
    const s = setup(); const mcp = fakeMcp({ fail: 'device-missing' });
    const r = await s.run({ connect: mcp.connect, generate: scripted([[`${P}get_screen_state`, {}]]).generate });
    expect(taskState(s.db, s.taskId)).toBe('interrupted'); expect(r.report).toBeNull();
  });
  it('erro ao digitar segredo: a mensagem crua (que pode ecoar a senha) nunca vira step nem chega ao modelo', async () => {
    const s = setup(); const mcp = fakeMcp({ typeFails: true }); const key = 'account.com.instagram.android.password';
    const g = scripted([['secret_new', { key }], [`${P}get_screen_state`, {}], ['type_secret', { node_id: 'node_0', key }]]);
    await s.run({ connect: mcp.connect, generate: g.generate });
    const pwd = await s.vault.get(secretEntryId(s.missionId, key));
    expect(pwd).toHaveLength(20);
    expect(g.seen.join('\n')).not.toContain(pwd as string);
    expect(g.seen.some((x) => x.includes('falhou digitando'))).toBe(false);
    const dump = JSON.stringify(s.db.prepare('select * from step').all());
    expect(dump).not.toContain(pwd);
    expect(dump).not.toContain('falhou digitando');
  });
  it('MCP indisponível antes do loop (connect falha) → interrupted, não failed', async () => {
    const s = setup();
    const connect: RunTaskDeps['connect'] = async () => { throw new Error('fetch failed'); };
    const r = await s.run({ connect, generate: (async () => { throw new Error('não deveria chamar generate'); }) as unknown as RunTaskDeps['generate'] });
    expect(taskState(s.db, s.taskId)).toBe('interrupted');
    expect(r.report).toBeNull();
  });
  it('cofre travado no meio (secret_new) → interrupted com a mensagem do cofre, sem replanejar', async () => {
    const locked: Vault = { ...memVault(), put: async () => { throw new VaultError('chaveiro travado'); }, get: async () => { throw new VaultError('chaveiro travado'); } };
    const s = setup(locked); const mcp = fakeMcp();
    const g = scripted([['secret_new', { key: 'email.password' }], [`${P}get_screen_state`, {}], ['finish_subtask', { ok: false, did: '', blockers: 'cofre' }]]);
    const r = await s.run({ connect: mcp.connect, generate: g.generate });
    expect(taskState(s.db, s.taskId)).toBe('interrupted');
    expect(r.summary).toMatch(/chaveiro travado/);
  });
  it('cofre travado em type_secret → interrupted', async () => {
    const vault = memVault(); const s = setup({ ...vault, get: async () => { throw new VaultError('chaveiro travado'); } });
    const mcp = fakeMcp(); const key = 'email.password';
    const g = scripted([['secret_new', { key }], ['type_secret', { node_id: 'node_0', key }]]);
    await s.run({ connect: mcp.connect, generate: g.generate });
    expect(taskState(s.db, s.taskId)).toBe('interrupted');
    expect(mcp.typed).toEqual([]);
  });
});
