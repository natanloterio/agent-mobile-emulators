import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { CONFIG, loadEnv } from './config.js';
import { createAdb } from './device/adb.js';
import { createDeviceInput } from './device/input.js';
import { openDb } from './db/open.js';
import { getIdentity, listIdentities, upsertIdentity, type IdentityRow } from './db/identities.js';
import { createScreenCapture } from './device/screen.js';
import { createVideoStreams } from './device/video.js';
import { cloneAvd, deleteAvd } from './fleet/avd.js';
import { createDiskUsage, startDiskCollector } from './fleet/disk.js';
import { bootEmulator, createEmulatorSupervisor } from './fleet/emulator.js';
import { ensureIdentityReady } from './fleet/identity.js';
import { pickTestIdentity } from './fleet/pick.js';
import { reconcileOnStart } from './fleet/reconcile.js';
import { planGoal, type PlanDeps } from './leader/plan.js';
import { leasePorts } from './fleet/ports.js';
import { createHostMetrics } from './host/metrics.js';
import { readProviderConfig } from './provider/config.js';
import { createOllamaSupervisor } from './provider/ollama.js';
import { recordProviderTest, testProvider } from './provider/probe.js';
import { startServer } from './server/api.js';
import { controlRoutes } from './server/routes-control.js';
import { goalsRoutes } from './server/routes-goals.js';
import { startGoal, type WorkerJob } from './swarm/scheduler.js';
import { singleFlightOllama } from './swarm/single-flight.js';
import { createIdentityRoutes } from './server/routes-identities.js';
import { runTask } from './worker/run.js';

const env = loadEnv();
mkdirSync(CONFIG.dataDir, { recursive: true });
const db = openDb(CONFIG.dbPath);
// Nada em voo é retomado sozinho depois de uma queda (spec §4.3).
const reconciled = reconcileOnStart(db);
if (reconciled.tasks + reconciled.goals + reconciled.identities > 0) console.log('[enxame-daemon] reconciliação na subida:', reconciled);
const adb = createAdb();
// Supervisor do Ollama: só mata o processo que ele mesmo subiu (spec §4.3).
// Single-flight: workers do enxame pedem o Ollama quase juntos; só um `ollama serve` sobe.
const ollama = singleFlightOllama(createOllamaSupervisor());

// Emuladores que o daemon subiu (boot pela UI); só esses morrem no SIGINT — nunca um aberto por fora (spec inc. 5 §2).
const emulators = createEmulatorSupervisor();
const host = createHostMetrics();
const disk = createDiskUsage();

// Identidade 0: o emulador já provisionado. Token, estado, handle e portas vêm do banco quando existem (as portas podem
// ter sido re-alocadas por lease); num banco novo o token é gerado e a sonda o aplica no device por broadcast.
const existing = getIdentity(db, 'conta1');
const seed = {
  id: 'conta1', name: 'conta1', handle: '@p1t41a.meta.test', avdName: CONFIG.avd.base, serial: 'emulator-5554',
  consolePort: 5554, mcpHostPort: 8080, mcpToken: randomUUID(), deviceSlug: 'conta1',
  appPackage: CONFIG.targetApp.package, appVersionName: CONFIG.targetApp.versionName, state: 'logged-in' as const,
};
upsertIdentity(db, existing ? {
  ...seed, handle: existing.handle, serial: existing.serial, consolePort: existing.consolePort, mcpHostPort: existing.mcpHostPort,
  mcpToken: existing.mcpToken, state: existing.state,
} : seed);

const liveTargets = () => listIdentities(db).filter((i) => !i.discardedAt).map(({ id, serial }) => ({ id, serial }));
const targets = liveTargets();
const screen = createScreenCapture({ adb }); screen.start(targets);
// Vídeo é a fonte principal; o screencap só corre enquanto o vídeo daquela identidade não está no ar (poster/fallback).
// O servidor nasce depois do vídeo: mudança de estado antes dele existir só pula o broadcast.
let broadcast: (() => void) | null = null;
const video = createVideoStreams({ adb, onState: (id, s) => {
  if (s === 'streaming') screen.pause(id); else screen.resume(id);
  broadcast?.(); // o snapshot carrega o estado do stream ("ao vivo" na UI)
} });
video.start(targets);
let stopDisk: () => void = () => undefined;
const shutdown = () => { video.stop(); screen.stop(); ollama.stop(); host.stop(); stopDisk(); emulators.stopAll(); };
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { shutdown(); process.exit(0); });
process.on('exit', shutdown);

const identityRoutes = createIdentityRoutes({
  adb, disk, supervisor: emulators,
  clone: (avdName) => cloneAvd(CONFIG.avd.base, avdName),
  deleteAvd: (avdName) => deleteAvd(avdName),
  boot: (identity, opts) => bootEmulator(db, identity, opts, { adb, supervisor: emulators }),
  leasePorts: (d) => leasePorts(d),
  ensureReady: (d, identity) => ensureIdentityReady(d, identity, { adb }),
  // Boot/descarte mudam quem tem device: vídeo e miniatura recomeçam com a lista nova (serial pode ter mudado por lease).
  onIdentitiesChanged: () => { const t = liveTargets(); screen.start(t); video.start(t); },
  clearAccount: async (identity) => { await adb.shell(identity.serial, ['pm', 'clear', identity.appPackage]); },
});

// Enxame (spec inc. 5 §3.2): líder planeja sobre a frota; scheduler roda um worker por identidade pronta, com pacing.
const ensureReady = (id: IdentityRow) => ensureIdentityReady(db, id, { adb });
const planDeps: PlanDeps = { db, ensureReady, apiKey: env.anthropicApiKey, ollama };
const runWorker = (j: WorkerJob) => runTask({
  db, identity: j.identity, goalText: j.goalText, goalId: j.goalId, taskId: j.taskId, instruction: j.instruction,
  apiKey: env.anthropicApiKey, isKilled: () => server.isKilled(), onStep: () => server.broadcast(), pacing: CONFIG.swarm,
}, { ollama });

const daemonToken = randomUUID();
const server = await startServer({
  db, token: daemonToken, screen, video, port: process.env.ENXAME_PORT ? Number(process.env.ENXAME_PORT) : undefined, videoState: (id) => video.state(id),
  host: () => host.read(),
  // Kill switch derruba o Ollama que é nosso (spec §4.3); /resume + próximo objetivo o sobem de novo.
  onKill: () => { ollama.stop(); server.broadcast(); },
  // Kill switch já é recusado na rota (409). Plano do cliente é re-sondado no start de cada identidade.
  onGoal: async (text, planIn) => {
    const plan = planIn ? { ...planIn, text } : await planGoal(text, planDeps);
    server.broadcast();
    const started = startGoal(plan, { db, isKilled: () => server.isKilled(), runWorker, ensureReady, onChange: () => server.broadcast() });
    return { goalId: started.goalId, done: started.done };
  },
  // Rotas das frentes do incremento 5: objetivos, ciclo de vida da identidade, controle humano (input via `adb shell input`).
  routes: [goalsRoutes({ plan: (text) => planGoal(text, planDeps) }), identityRoutes.route, controlRoutes({ input: createDeviceInput(adb) })],
  onProviderTest: async (role) => {
    const model = readProviderConfig(db)[role].model;
    const fail = (error: string) => recordProviderTest(db, { role, model, latencyMs: 0, tokensPerSec: null, argsValid: false, warning: null, error, at: new Date().toISOString() });
    const id = pickTestIdentity(listIdentities(db));
    if (!id) return fail('nenhuma identidade livre para o tool-call canônico (todas rodando, pausadas, controladas ou sem conta)');
    const probe = await ensureIdentityReady(db, id, { adb }); server.broadcast();
    if (!probe.ready) return fail(`${id.name} não pronta: ${probe.details.join('; ')}`);
    const t = await testProvider(db, readProviderConfig(db)[role], getIdentity(db, id.id)!, { anthropicApiKey: env.anthropicApiKey }, { ollama });
    server.broadcast(); return t;
  },
});
broadcast = () => server.broadcast();
host.start(() => server.broadcast()); // só em mudança relevante (RAM ±0,5 GiB, CPU ±5 pts, VRAM ±256 MiB)
stopDisk = startDiskCollector(db, disk, () => server.broadcast());
writeFileSync(CONFIG.daemonInfoPath, JSON.stringify({ port: server.port, token: daemonToken, pid: process.pid }));
console.log(`[enxame-daemon] http://127.0.0.1:${server.port} · info em ${CONFIG.daemonInfoPath}`);
