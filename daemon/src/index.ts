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
import { bootEmulator, createEmulatorSupervisor, saveSnapshot } from './fleet/emulator.js';
import { ensureIdentityReady } from './fleet/identity.js';
import { pickTestIdentity } from './fleet/pick.js';
import { reconcileOnStart } from './fleet/reconcile.js';
import { clearTargetAccount } from './fleet/account.js';
import { loginIdentity } from './fleet/login-io.js';
import { ensureUnlocked, isValidPin, setDevicePin } from './device/unlock.js';
import { planGoal, type PlanDeps } from './leader/plan.js';
import { leasePorts } from './fleet/ports.js';
import { createHostMetrics } from './host/metrics.js';
import { createGpuSampler } from './host/gpu.js';
import { readProviderConfig } from './provider/config.js';
import { createOllamaSupervisor } from './provider/ollama.js';
import { createLmStudio } from './provider/runtimes/lmstudio.js';
import { createLocalRuntimes } from './provider/runtimes/local.js';
import { recordProviderTest, testProvider } from './provider/probe.js';
import { createMissionRunner } from './mission/runner.js';
import { planNext } from './mission/planner.js';
import { promoteAccounts } from './mission/promote.js';
import { readScreenOnce } from './mission/screen-io.js';
import { startServer } from './server/api.js';
import { controlRoutes } from './server/routes-control.js';
import { credentialRoutes } from './server/routes-credentials.js';
import { goalsRoutes } from './server/routes-goals.js';
import { missionRoutes } from './server/routes-missions.js';
import { getCredential } from './vault/credentials.js';
import { keyringKeySource } from './vault/keyring.js';
import { createVault } from './vault/vault.js';
import { createSecretMask, loadMissionSecrets } from './worker/mission-tools.js';
import { startGoal, type WorkerJob } from './swarm/scheduler.js';
import { singleFlightOllama } from './swarm/single-flight.js';
import { createIdentityRoutes } from './server/routes-identities.js';
import { runTask } from './worker/run.js';

const env = loadEnv();
if (!env.anthropicApiKey) console.log('[enxame-daemon] sem ANTHROPIC_API_KEY: papéis na nuvem ficam indisponíveis; use modelos locais em Provedores');
mkdirSync(CONFIG.dataDir, { recursive: true });
const db = openDb(CONFIG.dbPath);
// Nada em voo é retomado sozinho depois de uma queda (spec §4.3).
const reconciled = reconcileOnStart(db);
if (reconciled.tasks + reconciled.goals + reconciled.identities + reconciled.subtasks > 0) console.log('[enxame-daemon] reconciliação na subida:', reconciled);
const adb = createAdb();
// Cofre do daemon (spec missões §Cofre): senhas geradas por missões e credenciais de login; chave no chaveiro do SO.
const vault = createVault({ file: CONFIG.vaultPath, keys: keyringKeySource() });
// Supervisor do Ollama: só mata o processo que ele mesmo subiu (spec §4.3).
// Single-flight: workers do enxame pedem o Ollama quase juntos; só um `ollama serve` sobe.
// Runtimes locais (Ollama e LM Studio) atrás da mesma cara; single-flight: workers pedem o runtime quase juntos.
const localRuntimes = createLocalRuntimes({ ollama: createOllamaSupervisor(), lmstudio: createLmStudio() });
const ollama = singleFlightOllama(localRuntimes);

// Emuladores que o daemon subiu (boot pela UI); só esses morrem no SIGINT — nunca um aberto por fora (spec inc. 5 §2).
const emulators = createEmulatorSupervisor();
const host = createHostMetrics({ gpu: createGpuSampler() });
const disk = createDiskUsage();

// Identidade 0: o emulador já provisionado. Token, estado, handle e portas vêm do banco quando existem (as portas podem
// ter sido re-alocadas por lease); num banco novo o token é gerado e a sonda o aplica no device por broadcast.
const existing = getIdentity(db, 'conta1');
const seed = {
  // AVD próprio da conta1, independente de `CONFIG.avd.base` (a base de clonagem pode ser trocada por ENXAME_AVD_BASE).
  id: 'conta1', name: 'conta1', handle: '@p1t41a.meta.test', avdName: 'mcp_test_playstore', serial: 'emulator-5554',
  consolePort: 5554, mcpHostPort: 8080, mcpToken: randomUUID(), deviceSlug: 'conta1',
  appPackage: CONFIG.targetApp.package, appVersionName: CONFIG.targetApp.versionName, state: 'logged-in' as const,
};
upsertIdentity(db, existing ? {
  ...seed, avdName: existing.avdName, handle: existing.handle, serial: existing.serial, consolePort: existing.consolePort, mcpHostPort: existing.mcpHostPort,
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
  unlock: (identity) => ensureUnlocked(adb, identity.serial, identity.lockPin),
  login: (identity, creds) => loginIdentity(db, identity, creds, { ensureReady: (d, i) => ensureIdentityReady(d, i, { adb }) }),
  setPin: (identity, pin) => setDevicePin(adb, identity.serial, pin),
  defaultPin: process.env.ENXAME_DEFAULT_PIN && isValidPin(process.env.ENXAME_DEFAULT_PIN) ? process.env.ENXAME_DEFAULT_PIN : null,
  clearAccount: async (identity) => { await clearTargetAccount(adb, identity.serial, identity.appPackage); },
  credentials: (id) => getCredential(vault, id),
});

// Enxame (spec inc. 5 §3.2): líder planeja sobre a frota; scheduler roda um worker por identidade pronta, com pacing.
const ensureReady = (id: IdentityRow) => ensureIdentityReady(db, id, { adb });
const planDeps: PlanDeps = { db, ensureReady, apiKey: env.anthropicApiKey, ollama };
const runWorker = (j: WorkerJob) => runTask({
  db, identity: j.identity, goalText: j.goalText, goalId: j.goalId, taskId: j.taskId, instruction: j.instruction,
  apiKey: env.anthropicApiKey, isKilled: () => server.isKilled(), onStep: () => server.broadcast(), pacing: CONFIG.swarm,
}, { ollama });

// Missões (spec missões): loop planejador → executor por identidade, fora do lock de objetivo.
const missions = createMissionRunner({
  db, isKilled: () => server.isKilled(), onChange: () => server.broadcast(),
  plan: (input) => planNext(input, { providers: readProviderConfig(db), apiKey: env.anthropicApiKey, ollama }),
  readScreen: (identity) => readScreenOnce(db, identity, { ensureReady: (d, i) => ensureIdentityReady(d, i, { adb }) }),
  mask: async (missionId) => createSecretMask(await loadMissionSecrets(db, vault, missionId)).mask,
  runSubtask: async (j) => {
    const mask = createSecretMask(await loadMissionSecrets(db, vault, j.missionId));
    const r = await runTask({
      db, identity: j.identity, goalText: j.instruction, goalId: j.missionId, taskId: j.taskId, instruction: j.instruction,
      apiKey: env.anthropicApiKey, isKilled: j.shouldStop, onStep: () => server.broadcast(),
      stepBudget: CONFIG.mission.subtaskStepBudget, pacing: CONFIG.swarm, mission: { missionId: j.missionId, vault, mask },
    }, { ollama });
    return { humanReason: r.humanReason, summary: r.platformBlock ?? r.summary };
  },
  promote: (missionId) => promoteAccounts(missionId, { db, vault, snapshot: (i) => saveSnapshot(adb, i.serial) }),
});

const daemonToken = randomUUID();
const server = await startServer({
  db, token: daemonToken, screen, video, port: process.env.ENXAME_PORT ? Number(process.env.ENXAME_PORT) : undefined, videoState: (id) => video.state(id),
  host: () => host.read(),
  listLocal: (current) => localRuntimes.listAll(current),
  unloadLocal: (row) => localRuntimes.unload(row.endpoint, row.model, row.runtime),
  // Kill switch derruba o Ollama que é nosso (spec §4.3); /resume + próximo objetivo o sobem de novo.
  onKill: () => { ollama.stop(); server.broadcast(); },
  // Kill switch já é recusado na rota (409). Plano do cliente é re-sondado no start de cada identidade.
  onGoal: async (text, planIn) => {
    const plan = planIn ? { ...planIn, text } : await planGoal(text, planDeps);
    server.broadcast();
    const started = startGoal(plan, { db, isKilled: () => server.isKilled(), runWorker, ensureReady, onChange: () => server.broadcast() });
    return { goalId: started.goalId, done: started.done };
  },
  // Rotas das frentes do incremento 5: objetivos, ciclo de vida da identidade, controle humano (input via `adb shell input`);
  // missões e credenciais do cofre (spec missões) não usam o lock de objetivo.
  routes: [
    goalsRoutes({ plan: (text, lang) => planGoal(text, planDeps, lang) }), identityRoutes.route, controlRoutes({ input: createDeviceInput(adb) }),
    missionRoutes({ runner: missions }), credentialRoutes({ vault }),
  ],
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

const resumed = missions.resumeAllOnStart();
if (resumed > 0) console.log(`[enxame-daemon] ${resumed} missão(ões) retomada(s)`);
