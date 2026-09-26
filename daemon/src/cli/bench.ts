import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { CONFIG, loadEnv } from '../config.js';
import { createAdb } from '../device/adb.js';
import { openDb } from '../db/open.js';
import { getIdentity } from '../db/identities.js';
import { ensureIdentityReady } from '../fleet/identity.js';
import { daemonAlive } from '../fleet/lock.js';
import { assertDaemonOllama, median, pickWinner, renderBakeoffTable, renderComparison, type BakeoffRow, type RunSummary } from '../bench/stats.js';
import { startVramSampler } from '../bench/vram.js';
import { LOCAL_ENDPOINT_DEFAULT, readProviderConfig, updateProvider } from '../provider/config.js';
import { createOllamaSupervisor } from '../provider/ollama.js';
import { testProvider } from '../provider/probe.js';
import { runTask, type RunTaskResult } from '../worker/run.js';

const GOAL = 'Levantar comentários recentes sem resposta e propor rascunhos (não enviar)';
const MODELS = (process.env.BENCH_MODELS ?? 'qwen3.5:27b,gpt-oss:20b,gemma4:12b,qwen2.5-coder:14b').split(',').map((s) => s.trim()).filter(Boolean);
const RUNS = 3;
const exec = promisify(execFile);
const nvidia = async () => (await exec('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'])).stdout;

const env = loadEnv();
const living = daemonAlive(CONFIG.daemonInfoPath);
if (living) { console.error(`daemon vivo (PID ${living.pid}) disputa device e Ollama; pare-o ou use a API`); process.exit(4); }
mkdirSync(CONFIG.dataDir, { recursive: true });
const db = openDb(CONFIG.dbPath); const adb = createAdb(); const ollama = createOllamaSupervisor();
const id = () => getIdentity(db, 'conta1')!;
const probe = await ensureIdentityReady(db, id(), { adb });
if (!probe.ready) { console.error('sonda falhou:', probe.details); process.exit(2); }
// O bench muta o registro do worker; restaura o que havia antes ao sair por qualquer caminho (revisão final, Important 7).
const before = readProviderConfig(db).worker;
const restore = () => { updateProvider(db, 'worker', { mode: before.mode, model: before.model, endpoint: before.endpoint === 'anthropic' ? undefined : before.endpoint }); };
process.on('exit', restore);

// 1) bake-off (spec §8): 3 testes de conexão por modelo; args válidos em 3/3 é pré-requisito.
const rows: BakeoffRow[] = [];
for (const model of MODELS) {
  updateProvider(db, 'worker', { mode: 'local', model, endpoint: LOCAL_ENDPOINT_DEFAULT });
  const tests = [];
  for (let i = 0; i < RUNS; i++) tests.push(await testProvider(db, readProviderConfig(db).worker, id(), env, { ollama }));
  try { assertDaemonOllama(tests); } catch (e) { console.error(String((e as Error).message)); process.exit(3); }
  const valid = tests.filter((t) => t.argsValid).length; const err = tests.find((t) => t.error)?.error ?? null;
  const tps = tests.map((t) => t.tokensPerSec).filter((x): x is number => x !== null);
  rows.push({ model, latencyMs: median(tests.map((t) => t.latencyMs)), tokensPerSec: tps.length ? median(tps) : null, argsValid: valid, runs: RUNS, eliminated: valid < RUNS, reason: err ?? (valid < RUNS ? 'args inválidos' : null) });
  await ollama.unload(LOCAL_ENDPOINT_DEFAULT, model);
  console.log(`bake-off ${model}: ${valid}/${RUNS} válidos${err ? ` · ${err.slice(0, 80)}` : ''}`);
}
const winner = pickWinner(rows);

// 2) corrida local com o vencedor + 3) controle Haiku
const summarize = (label: string, r: RunTaskResult, elapsedS: number, vram: number | null): RunSummary => {
  const s = db.prepare('select count(*) n, coalesce(sum(gen_ms),0) g from step where task_id=?').get(r.taskId) as { n: number; g: number };
  return { label, outcome: r.outcome, steps: s.n, elapsedS, genS: Math.round(s.g / 100) / 10, inTok: r.usage.inputTokens, outTok: r.usage.outputTokens, cacheRead: r.usage.cacheReadTokens,
    invalidCalls: r.invalidCalls, degraded: r.degraded, escalatedAtStep: r.escalatedAtStep, earlyStopRemaining: r.earlyStopRemaining,
    costUsd: r.costUsd, vramPeakMiB: vram, platformBlock: r.platformBlock, summary: r.summary };
};
const run = async (label: string, local: boolean): Promise<RunSummary> => {
  await ensureIdentityReady(db, id(), { adb });
  const sampler = local ? startVramSampler(nvidia) : null; const t0 = Date.now();
  const r = await runTask({ db, identity: id(), goalText: GOAL, apiKey: env.anthropicApiKey, isKilled: () => false, onStep: () => {}, stepBudget: CONFIG.worker.stepBudget }, { ollama });
  return summarize(label, r, Math.round((Date.now() - t0) / 1000), sampler?.stop() ?? null);
};
let local: RunSummary | null = null;
if (winner) { updateProvider(db, 'worker', { mode: 'local', model: winner.model, endpoint: LOCAL_ENDPOINT_DEFAULT }); local = await run(`local:${winner.model}`, true); }
// Controle na nuvem; o registro original é restaurado no exit.
updateProvider(db, 'worker', { mode: 'nuvem', model: 'claude-haiku-4-5' });
const cloud = process.env.BENCH_SKIP_CLOUD ? null : await run('nuvem:claude-haiku-4-5', false);

// 4) relatório
const date = new Date().toISOString().slice(0, 10);
const out = `docs/superpowers/reports/${date}-incremento-2.md`;
const lines = [`# Incremento 2 — bake-off e benchmark (${new Date().toISOString()})`, '', `- Sonda: ${JSON.stringify(probe.signals)}`, `- Modelos: ${MODELS.join(', ')} · ${RUNS} testes cada`, '', '## Bake-off', '', renderBakeoffTable(rows), '',
  `**Vencedor:** ${winner?.model ?? 'nenhum (todos eliminados)'}`, '', '## Corrida completa (orçamento 30)', '',
  local && cloud ? renderComparison(local, cloud) : local ? renderComparison(local, local) : '_sem corrida local_', '',
  '## Resumo do agente — local', '', local?.summary ?? '—', '', '## Resumo do agente — Haiku', '', cloud?.summary ?? '(controle não repetido: BENCH_SKIP_CLOUD)'];
mkdirSync('docs/superpowers/reports', { recursive: true }); writeFileSync(out, lines.join('\n'));
console.log(`relatório em ${out}`); ollama.stop();
