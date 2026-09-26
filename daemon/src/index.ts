import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { CONFIG, loadEnv } from './config.js';
import { createAdb } from './device/adb.js';
import { createDeviceInput } from './device/input.js';
import { openDb } from './db/open.js';
import { getIdentity, listIdentities, upsertIdentity, type IdentityRow } from './db/identities.js';
import { createScreenCapture } from './device/screen.js';
import { createVideoStreams } from './device/video.js';
import { ensureIdentityReady } from './fleet/identity.js';
import { planGoal, type PlanDeps } from './leader/plan.js';
import { readProviderConfig } from './provider/config.js';
import { createOllamaSupervisor } from './provider/ollama.js';
import { recordProviderTest, testProvider } from './provider/probe.js';
import { startServer } from './server/api.js';
import { controlRoutes } from './server/routes-control.js';
import { goalsRoutes } from './server/routes-goals.js';
import { startGoal, type WorkerJob } from './swarm/scheduler.js';
import { singleFlightOllama } from './swarm/single-flight.js';
import { runTask } from './worker/run.js';

const env = loadEnv();
mkdirSync(CONFIG.dataDir, { recursive: true });
const db = openDb(CONFIG.dbPath);
const adb = createAdb();
// Supervisor do Ollama: só mata o processo que ele mesmo subiu (spec §4.3).
// Single-flight: workers do enxame pedem o Ollama quase juntos; só um `ollama serve` sobe.
const ollama = singleFlightOllama(createOllamaSupervisor());

// Identidade 0: o emulador já provisionado. Token vem do arquivo salvo na sessão de setup ou é gerado agora.
const tokenFile = '/tmp/claude-1000/-media-loterio-workspace-workspace-pitaia-research/mcp-token.txt';
const existing = getIdentity(db, 'conta1');
const mcpToken = existing?.mcpToken ?? (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : randomUUID());
upsertIdentity(db, {
  id: 'conta1', name: 'conta1', handle: '@p1t41a.meta.test', avdName: 'mcp_test_playstore', serial: 'emulator-5554',
  consolePort: 5554, mcpHostPort: 8080, mcpToken, deviceSlug: 'conta1',
  appPackage: CONFIG.targetApp.package, appVersionName: CONFIG.targetApp.versionName, state: existing?.state ?? 'logged-in',
});

const targets = listIdentities(db).map(({ id, serial }) => ({ id, serial }));
const screen = createScreenCapture({ adb }); screen.start(targets);
// Vídeo é a fonte principal; o screencap só corre enquanto o vídeo daquela identidade não está no ar (poster/fallback).
// O servidor nasce depois do vídeo: mudança de estado antes dele existir só pula o broadcast.
let broadcast: (() => void) | null = null;
const video = createVideoStreams({ adb, onState: (id, s) => {
  if (s === 'streaming') screen.pause(id); else screen.resume(id);
  broadcast?.(); // o snapshot carrega o estado do stream ("ao vivo" na UI)
} });
video.start(targets);
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { video.stop(); screen.stop(); ollama.stop(); process.exit(0); });
process.on('exit', () => { video.stop(); screen.stop(); ollama.stop(); });

// Enxame (spec inc. 5 §3.2): líder planeja sobre a frota; scheduler roda um worker por identidade pronta, com pacing.
const ensureReady = (id: IdentityRow) => ensureIdentityReady(db, id, { adb });
const planDeps: PlanDeps = { db, ensureReady, apiKey: env.anthropicApiKey, ollama };
const runWorker = (j: WorkerJob) => runTask({
  db, identity: j.identity, goalText: j.goalText, goalId: j.goalId, taskId: j.taskId, instruction: j.instruction,
  apiKey: env.anthropicApiKey, isKilled: () => server.isKilled(), onStep: () => server.broadcast(), pacing: CONFIG.swarm,
}, { ollama });

const daemonToken = randomUUID();
const server = await startServer({
  db, token: daemonToken, screen, video, videoState: (id) => video.state(id),
  // Controle humano (spec inc. 5 §3.2): `controlled` no banco para o worker; input via `adb shell input`.
  // Kill switch derruba o Ollama que é nosso (spec §4.3); /resume + próximo objetivo o sobem de novo.
  onKill: () => { ollama.stop(); server.broadcast(); },
  // Kill switch já é recusado na rota (409). Plano do cliente é re-sondado no start de cada identidade.
  onGoal: async (text, planIn) => {
    const plan = planIn ? { ...planIn, text } : await planGoal(text, planDeps);
    server.broadcast();
    const started = startGoal(plan, { db, isKilled: () => server.isKilled(), runWorker, ensureReady, onChange: () => server.broadcast() });
    return { goalId: started.goalId, done: started.done };
  },
  routes: [goalsRoutes({ plan: (text) => planGoal(text, planDeps) }), controlRoutes({ input: createDeviceInput(adb) })],
  onProviderTest: async (role) => {
    const id = getIdentity(db, 'conta1')!;
    const probe = await ensureIdentityReady(db, id, { adb }); server.broadcast();
    if (!probe.ready) return recordProviderTest(db, { role, model: readProviderConfig(db)[role].model, latencyMs: 0, tokensPerSec: null, argsValid: false, warning: null, error: `identidade não pronta: ${probe.details.join('; ')}`, at: new Date().toISOString() });
    const t = await testProvider(db, readProviderConfig(db)[role], getIdentity(db, 'conta1')!, { anthropicApiKey: env.anthropicApiKey }, { ollama });
    server.broadcast(); return t;
  },
});
broadcast = () => server.broadcast();
writeFileSync(CONFIG.daemonInfoPath, JSON.stringify({ port: server.port, token: daemonToken, pid: process.pid }));
console.log(`[enxame-daemon] http://127.0.0.1:${server.port} · info em ${CONFIG.daemonInfoPath}`);
