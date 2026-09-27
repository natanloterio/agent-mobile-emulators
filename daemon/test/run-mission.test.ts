import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { getIdentity, upsertIdentity } from '../src/db/identities.js';
import { addSubtask, createMission, listMemory, listSubtasks } from '../src/db/missions.js';
import { ProviderError } from '../src/provider/errors.js';
import { createSecretMask, secretEntryId } from '../src/worker/mission-tools.js';
import { PRUNED_PLACEHOLDER } from '../src/worker/prune.js';
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
function fakeMcp(opts: { pkg?: string; labels?: string[]; fail?: 'device-missing'; typeFails?: boolean; typeFailsInfra?: boolean } = {}) {
  const typed: string[] = []; const clicked: string[] = [];
  const screen = () => screenOf(opts.pkg ?? 'com.instagram.android', [...(opts.labels ?? ['Confirmar']), ...typed]);
  const connect: RunTaskDeps['connect'] = async () => ({
    tools: async () => ({
      [`${P}get_screen_state`]: { description: 'x', inputSchema: {}, execute: async () => { if (opts.fail) throw new Error("adb: device 'emulator-5556' not found"); return screen(); } },
      [`${P}find_nodes`]: { description: 'x', inputSchema: {}, execute: async () => ({ content: [{ type: 'text', text: `achei: ${typed.join(',')}` }] }) },
      [`${P}click_node`]: { description: 'x', inputSchema: {}, execute: async (i: { node_id: string }) => { clicked.push(i.node_id); return 'ok'; } },
      // erro cru do MCP: ecoa o parâmetro (a senha) — a fixture existe para provar que isso nunca sobe como veio (fix round 1, item 1).
      // typeFailsInfra: além de ecoar, classifica como infra ("fetch failed") — prova que o halt/summary também não ecoa (achado residual).
      [`${P}type_append_text`]: { description: 'x', inputSchema: {}, execute: async (i: { text: string }) => {
        if (opts.typeFailsInfra) throw new Error(`fetch failed ao digitar ${i.text}`);
        if (opts.typeFails) throw new Error(`falhou digitando ${i.text}`);
        typed.push(i.text); return 'ok';
      } },
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

/** Como scripted(), mas um roteiro (e um texto final) por chamada de generate — simula vários segmentos (spec missões: pedido final). */
function scriptedCalls(scripts: readonly (readonly (readonly [string, unknown])[])[], texts: readonly string[] = []) {
  const seen: string[] = []; const opts: { toolApproval?: unknown; instructions?: string; messages?: unknown; activeTools?: unknown }[] = [];
  let call = 0;
  const generate = (async (o: { tools: Record<string, { execute: (i: unknown, x: unknown) => Promise<unknown> }>; onStepFinish?: (s: unknown) => void | Promise<void>; toolApproval?: unknown; instructions?: string; messages?: unknown; prepareStep?: (a: { messages: unknown[] }) => Promise<{ activeTools?: unknown }> }) => {
    const idx = Math.min(call, scripts.length - 1); const script = scripts[idx]; call++;
    const prepared = await o.prepareStep?.({ messages: [] });
    opts.push({ toolApproval: o.toolApproval, instructions: o.instructions, messages: o.messages, activeTools: prepared?.activeTools });
    let n = 0;
    for (const [name, input] of script) {
      const id = `c${idx}-${++n}`; let out: unknown; let err: unknown = null;
      try { out = await o.tools[name].execute(input, { toolCallId: id, messages: [] }); } catch (e) { err = e; }
      const text = err ? String((err as Error).message) : typeof out === 'string' ? out : JSON.stringify(out);
      seen.push(text);
      const part = err ? { type: 'tool-error', toolCallId: id, toolName: name, input, error: err } : { type: 'tool-result', toolCallId: id, toolName: name, input, output: out };
      await o.onStepFinish?.({ stepNumber: n - 1, text: '', content: [{ type: 'tool-call', toolCallId: id, toolName: name, input }, part], usage: { inputTokens: 10, outputTokens: 1 } });
    }
    return { text: texts[idx] ?? 'fim', totalUsage: { inputTokens: 10, outputTokens: 1 }, steps: [], response: { messages: [] } };
  }) as unknown as RunTaskDeps['generate'];
  return { generate, seen, opts };
}

function setup(vaultIn?: Vault, known: readonly string[] = []) {
  const db = openDb(':memory:'); upsertIdentity(db, row);
  const missionId = createMission(db, 'conta2', 'missão', 'pt');
  const taskId = addSubtask(db, missionId, 'cadastrar', 'conta criada');
  const vault = vaultIn ?? memVault(); const mask = createSecretMask(known);
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
  it('erro ao digitar segredo classificado como infra (ecoa a senha): halt/summary da subtarefa nunca a carregam (achado residual)', async () => {
    const s = setup(); const mcp = fakeMcp({ typeFailsInfra: true }); const key = 'account.com.instagram.android.password';
    const g = scripted([['secret_new', { key }], [`${P}get_screen_state`, {}], ['type_secret', { node_id: 'node_0', key }]]);
    const r = await s.run({ connect: mcp.connect, generate: g.generate });
    const pwd = await s.vault.get(secretEntryId(s.missionId, key));
    expect(pwd).toHaveLength(20);
    expect(taskState(s.db, s.taskId)).toBe('interrupted');
    expect(r.summary).not.toContain(pwd as string);
    expect(r.humanReason ?? '').not.toContain(pwd as string);
    expect(r.platformBlock ?? '').not.toContain(pwd as string);
    expect(JSON.stringify(r.report ?? {})).not.toContain(pwd as string);
    expect(g.seen.join('\n')).not.toContain(pwd as string);
    const dump = JSON.stringify(s.db.prepare('select * from step').all());
    expect(dump).not.toContain(pwd);
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
  it('motivo da verificação humana passa pela máscara de segredos', async () => {
    const s = setup(undefined, ['Segr3do!Forte']);
    const mcp = fakeMcp({ pkg: 'com.android.chrome', labels: ["I'm not a robot Segr3do!Forte"] });
    const r = await s.run({ connect: mcp.connect, generate: scripted([[`${P}get_screen_state`, {}]]).generate });
    expect(r.humanReason).toMatch(/not a robot •••/);
    expect(JSON.stringify(s.db.prepare('select * from task').all())).not.toContain('Segr3do!Forte');
  });
  it('1º segmento termina em texto solto (sem finish_subtask); pedido final chama finish_subtask → done com relatório', async () => {
    const s = setup(); const mcp = fakeMcp();
    const g = scriptedCalls([[], [['finish_subtask', { ok: true, did: 'fechou', blockers: '' }]]], ['pensei alto e esqueci de chamar finish_subtask', 'fim']);
    const r = await s.run({ connect: mcp.connect, generate: g.generate });
    expect(r.report).toEqual({ ok: true, did: 'fechou', blockers: '' });
    expect(taskState(s.db, s.taskId)).toBe('done');
    // pedido final: só finish_subtask e request_human, e a última mensagem é o pedido.
    expect(g.opts[1].activeTools).toEqual(['finish_subtask', 'request_human']);
    expect(JSON.stringify(g.opts[1].messages)).toMatch(/Você encerrou sem chamar finish_subtask/);
  });
  it('pedido final também termina sem finish_subtask → failed com did = último texto do modelo', async () => {
    const s = setup(); const mcp = fakeMcp();
    const g = scriptedCalls([[], []], ['divagou sobre o app', 'ainda sem finish_subtask']);
    const r = await s.run({ connect: mcp.connect, generate: g.generate });
    expect(taskState(s.db, s.taskId)).toBe('failed');
    expect(r.report?.did).toBe('ainda sem finish_subtask');
    expect(r.report?.blockers).toBe('terminou sem finish_subtask');
  });
  it('pedido final consome os últimos passos do orçamento sem relatório → blockers continua "terminou sem finish_subtask" (não orçamento esgotado)', async () => {
    const s = setup(); const mcp = fakeMcp();
    // 1º segmento não usa passos (nenhuma tool call); o gate do pedido final passa (stepsUsed=0 < budget=1). O pedido
    // final então usa 2 passos (get_screen_state x2) sem chamar finish_subtask, estourando o orçamento de 1 por causa
    // dele mesmo — isso não deve virar "orçamento esgotado" (o gate só rodou o pedido porque havia orçamento de sobra).
    const g = scriptedCalls([[], [[`${P}get_screen_state`, {}], [`${P}get_screen_state`, {}]]], ['divagou', 'ainda sem finish_subtask']);
    const r = await s.run({ connect: mcp.connect, generate: g.generate }, 1);
    expect(taskState(s.db, s.taskId)).toBe('failed');
    expect(r.report?.blockers).toBe('terminou sem finish_subtask');
  });
  it('missão poda telas para CONFIG.mission.keepScreens (1): com 3 leituras, só a última fica completa', async () => {
    const s = setup(); const mcp = fakeMcp();
    let prepareStep: ((a: { messages: unknown[] }) => Promise<{ messages: unknown[] }>) | null = null;
    const generate = (async (o: { prepareStep: (a: { messages: unknown[] }) => Promise<{ messages: unknown[] }> }) => {
      prepareStep = o.prepareStep;
      return { text: 'fim', totalUsage: { inputTokens: 1, outputTokens: 1 }, steps: [], response: { messages: [] } };
    }) as unknown as RunTaskDeps['generate'];
    await s.run({ connect: mcp.connect, generate });
    const screenMsg = (id: string) => ({ role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName: `${P}get_screen_state`, output: { type: 'text', value: `tela ${id}` } }] });
    const { messages } = await prepareStep!({ messages: [screenMsg('a'), screenMsg('b'), screenMsg('c')] });
    const texts = (messages as { content: { output: { value: string } }[] }[]).map((m) => m.content[0].output.value);
    expect(texts).toEqual([PRUNED_PLACEHOLDER, PRUNED_PLACEHOLDER, 'tela c']);
  });
});
