import { mkdirSync, writeFileSync } from 'node:fs';
import { CONFIG, loadEnv } from '../config.js';
import { createAdb } from '../device/adb.js';
import { openDb } from '../db/open.js';
import { getIdentity } from '../db/identities.js';
import { ensureIdentityReady } from '../fleet/identity.js';
import { daemonAlive } from '../fleet/lock.js';
import { runTask } from '../worker/run.js';

const env = loadEnv();
const living = daemonAlive(CONFIG.daemonInfoPath);
if (living) { console.error(`daemon vivo (PID ${living.pid}) disputa device e Ollama; pare-o ou use a API`); process.exit(4); }
mkdirSync(CONFIG.dataDir, { recursive: true });
const db = openDb(CONFIG.dbPath);
const id = getIdentity(db, 'conta1');
if (!id) throw new Error('rode o daemon uma vez para registrar conta1');

const t0 = Date.now();
const probe = await ensureIdentityReady(db, id, { adb: createAdb() });
if (!probe.ready) { console.error('sonda falhou:', probe.details); process.exit(2); }

const result = await runTask({ db, identity: getIdentity(db, 'conta1')!, goalText: 'Levantar comentários recentes sem resposta e propor rascunhos (não enviar)', apiKey: env.anthropicApiKey, isKilled: () => false, onStep: () => {} });
const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
const steps = db.prepare('select idx, tool, result_excerpt, input_tokens, output_tokens, cache_read_tokens, latency_ms from step where task_id=? order by idx').all(result.taskId) as Record<string, unknown>[];
const ledger = (db.prepare('select count(*) as n from ledger where identity_id=?').get('conta1') as { n: number }).n;
const lines = [
  `# Incremento 1 — execução real (${new Date().toISOString()})`, '',
  `- Sonda: ${JSON.stringify(probe.signals)}`,
  `- Resultado: **${result.outcome}** · ${steps.length} passos em ${elapsed} s · custo **US$ ${result.costUsd.toFixed(4)}**`,
  `- Tokens: in ${result.usage.inputTokens} · out ${result.usage.outputTokens} · cache read ${result.usage.cacheReadTokens}`,
  `- Itens no ledger: ${ledger} · bloqueio de plataforma: ${result.platformBlock ?? 'nenhum'}`, '',
  '| # | tool | tokens | ms | resultado |', '|---|---|---|---|---|',
  ...steps.map((s) => `| ${s.idx} | ${s.tool ?? '—'} | ${(Number(s.input_tokens) || 0) + (Number(s.output_tokens) || 0)} | ${s.latency_ms ?? ''} | ${String(s.result_excerpt ?? '').slice(0, 80).replace(/\|/g, '/')} |`),
  '', '## Resumo do agente', '', String(result.summary),
];
mkdirSync('docs/superpowers/reports', { recursive: true });
const out = `docs/superpowers/reports/2026-09-26-incremento-1.md`;
writeFileSync(out, lines.join('\n'));
console.log(`relatório em ${out}`);
