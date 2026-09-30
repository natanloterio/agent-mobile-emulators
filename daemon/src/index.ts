import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { brandEnv } from './brand.js';
import { CONFIG, currentBaseAvd, loadEnv } from './config.js';
import { findRunningAvd } from './device/running-avd.js';
import { acquireInstanceLock } from './fleet/lock.js';
import { saveGoogleAccount, seedGoogleMemory } from './base/google-account.js';
import { wireBasePreparer } from './base/wire.js';
import { IDLE_PREP, readBasePrep, writeBasePrep } from './db/base-settings.js';
import { getMission, openMissionFor } from './db/missions.js';
import { baseRoutes } from './server/routes-base.js';
import { createAdb } from './device/adb.js';
import { createDeviceInput } from './device/input.js';
import { openDb } from './db/open.js';
import { BASE_IDENTITY_ID, getIdentity, listFleet, type IdentityRow } from './db/identities.js';
import { isFleetIdle } from './db/tasks.js';
import { readLocalParallel, readStepBudgets } from './db/settings.js';
import { createScreenCapture } from './device/screen.js';
import { createVideoStreams } from './device/video.js';
import { cloneAvd, deleteAvd } from './fleet/avd.js';
import { createDiskUsage, startDiskCollector } from './fleet/disk.js';
import { bootEmulator, createEmulatorSupervisor, saveSnapshot } from './fleet/emulator.js';
import { ensureIdentityReady, prepareIdentityDevice } from './fleet/identity.js';
import { pickTestIdentity } from './fleet/pick.js';
import { reconcileOnStart } from './fleet/reconcile.js';
import { clearTargetAccount } from './fleet/account.js';
import { checkIdentitySession, loginIdentity } from './fleet/login-io.js';
import { ensureUnlocked, isValidPin, setDevicePin } from './device/unlock.js';
import { planGoal, type PlanDeps } from './leader/plan.js';
import { leasePorts } from './fleet/ports.js';
import { createHostMetrics } from './host/metrics.js';
import { createGpuSampler } from './host/gpu.js';
import { LOCAL_ENDPOINTS, readProviderConfig } from './provider/config.js';
import { createApiKeyStore } from './provider/api-key.js';
import { createLocalParallelController } from './provider/local-parallel.js';
import { createOllamaSupervisor } from './provider/ollama.js';
import { createLmStudio } from './provider/runtimes/lmstudio.js';
import { createLocalRuntimes } from './provider/runtimes/local.js';
import { recordProviderTest, testProvider } from './provider/probe.js';
import { createMissionRunner } from './mission/runner.js';
import { bindMissionFiles } from './files/mission-files.js';
import { createFileService } from './files/service.js';
import { fileRoutes } from './server/routes-files.js';
import { planNext } from './mission/planner.js';
import { promoteAccounts } from './mission/promote.js';
import { readScreenOnce } from './mission/screen-io.js';
import { startServer } from './server/api.js';
import { anthropicKeyRoutes } from './server/routes-anthropic-key.js';
import { controlRoutes } from './server/routes-control.js';
import { credentialRoutes } from './server/routes-credentials.js';
import { goalsRoutes } from './server/routes-goals.js';
import { localParallelRoutes } from './server/routes-local-parallel.js';
import { missionRoutes } from './server/routes-missions.js';
import { settingsRoutes } from './server/routes-settings.js';
import { getCredential } from './vault/credentials.js';
import { keyringKeySource } from './vault/keyring.js';
import { createVault } from './vault/vault.js';
import { createSecretMask, loadMissionSecrets } from './worker/mission-tools.js';
import { markNotesRead, unreadNotes } from './db/mission-notes.js';
import { subtaskSeq } from './db/missions.js';
import { startGoal, type WorkerJob } from './swarm/scheduler.js';
import { createRuntimeLock } from './swarm/runtime-lock.js';
import { singleFlightOllama } from './swarm/single-flight.js';
import { createIdentityRoutes } from './server/routes-identities.js';
import { runTask } from './worker/run.js';

const defaultPinEnv = brandEnv(process.env, 'DEFAULT_PIN');
const portEnv = brandEnv(process.env, 'PORT');

// Só o daemon roda como Node dentro do Electron; adb, emulador, Ollama e LM Studio não podem herdar a flag.
delete process.env.ELECTRON_RUN_AS_NODE;
const env = loadEnv();
mkdirSync(CONFIG.dataDir, { recursive: true });
// Um daemon por pasta de dados. O código de saída é o que o Electron entende como "já tem um rodando, espere o dele"
// (electron/daemon-wait.ts EXIT_ALREADY_RUNNING).
const instance = acquireInstanceLock(path.join(CONFIG.dataDir, 'daemon.lock'));
if (!instance.ok) {
  console.error(`[tapflock-daemon] outro daemon (pid ${instance.pid}) já usa ${CONFIG.dataDir}; saindo`);
  process.exit(3);
}
process.on('exit', instance.release);
const db = openDb(CONFIG.dbPath);
// Nada em voo é retomado sozinho depois de uma queda (spec §4.3).
const reconciled = reconcileOnStart(db);
if (reconciled.tasks + reconciled.goals + reconciled.identities + reconciled.subtasks > 0) console.log('[tapflock-daemon] reconciliação na subida:', reconciled);
const adb = createAdb();
// Cofre do daemon (spec missões §Cofre): senhas geradas por missões e credenciais de login; chave no chaveiro do SO.
const vault = createVault({ file: CONFIG.vaultPath, keys: keyringKeySource() });
// Chave da Anthropic: ambiente vence; sem ele, a que o onboarding gravou no cofre (spec onboarding).
const apiKeys = createApiKeyStore({ envKey: env.anthropicApiKey, vault });
await apiKeys.load().catch((e: unknown) => console.warn('[tapflock-daemon] chave da Anthropic do cofre ilegível:', (e as Error).message));
if (!apiKeys.current()) console.log('[tapflock-daemon] sem chave da Anthropic: papéis na nuvem ficam indisponíveis; use modelos locais em Provedores');
// Supervisor do Ollama: só mata o processo que ele mesmo subiu (spec §4.3).
// Paralelismo local configurável (spec paralelismo §UI): lido do banco a cada spawn/load, nunca cacheado.
const ollamaSupervisor = createOllamaSupervisor({ parallel: () => readLocalParallel(db) });
const lmStudio = createLmStudio({ parallel: () => readLocalParallel(db) });
// Single-flight: workers do enxame pedem o Ollama quase juntos; só um `ollama serve` sobe.
// Runtimes locais (Ollama e LM Studio) atrás da mesma cara; single-flight: workers pedem o runtime quase juntos.
const localRuntimes = createLocalRuntimes({ ollama: ollamaSupervisor, lmstudio: lmStudio });
// Trava única entre todo ensure() (via single-flight) e a troca de paralelismo (spec paralelismo §Ocioso): os dois
// mexem no mesmo processo/modelo e nunca podem correr ao mesmo tempo — um espera a vez do outro.
const runtimeLock = createRuntimeLock();
const ollama = singleFlightOllama(localRuntimes, runtimeLock);
// Troca efetiva de paralelismo: só com a frota ociosa (recheca dentro da trava), no PUT /settings/local e no
// fim de cada tarefa/subtarefa (via onFleetChange, abaixo) se ficou pendente.
const localParallelController = createLocalParallelController({
  db, ollama: ollamaSupervisor, lmstudio: lmStudio, lmstudioEndpoint: LOCAL_ENDPOINTS.lmstudio, isIdle: () => isFleetIdle(db),
  lock: runtimeLock,
});

// Emuladores que o daemon subiu (boot pela UI); só esses morrem no SIGINT — nunca um aberto por fora (spec inc. 5 §2).
const emulators = createEmulatorSupervisor();
const host = createHostMetrics({ gpu: createGpuSampler() });
const disk = createDiskUsage();

const liveTargets = () => listFleet(db).filter((i) => !i.discardedAt).map(({ id, serial }) => ({ id, serial }));
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
  clone: (avdName) => cloneAvd(currentBaseAvd().name, avdName),
  deleteAvd: (avdName) => deleteAvd(avdName),
  boot: (identity, opts) => bootEmulator(db, identity, opts, { adb, supervisor: emulators }),
  leasePorts: (d) => leasePorts(d),
  ensureReady: (d, identity) => ensureIdentityReady(d, identity, { adb }),
  // Boot/descarte mudam quem tem device: vídeo e miniatura recomeçam com a lista nova (serial pode ter mudado por lease).
  onIdentitiesChanged: () => { const t = liveTargets(); screen.start(t); video.start(t); },
  unlock: (identity) => ensureUnlocked(adb, identity.serial, identity.lockPin),
  // Pedidos explícitos da pessoa: preparam o device sem a trava de needs-human e sem gravar estado (a rota decide o estado).
  login: (identity, creds) => loginIdentity(db, identity, creds, { ensureReady: (_d, i) => prepareIdentityDevice(i, { adb }) }),
  checkSession: (identity) => checkIdentitySession(db, identity, { ensureReady: (_d, i) => prepareIdentityDevice(i, { adb }) }),
  setPin: (identity, pin) => setDevicePin(adb, identity.serial, pin),
  defaultPin: defaultPinEnv && isValidPin(defaultPinEnv) ? defaultPinEnv : null,
  clearAccount: async (identity) => { await clearTargetAccount(adb, identity.serial, identity.appPackage); },
  credentials: (id) => getCredential(vault, id),
});

/**
 * Broadcast do snapshot + gatilho (b) do apply de paralelismo (spec paralelismo §Ocioso): fim de tarefa/subtarefa
 * (e outras mudanças da frota) — só mexe de verdade se ficou `pending` de um PUT anterior feito com a frota ocupada.
 */
const onFleetChange = () => {
  server.broadcast();
  if (localParallelController.status().pending) {
    void localParallelController.apply()
      .then(() => server.broadcast())
      .catch((e: unknown) => console.error('[tapflock-daemon] apply do paralelismo local falhou:', (e as Error).message));
  }
};

// Enxame de identidades (spec inc. 5 §3.2): líder planeja sobre a frota; scheduler roda um worker por identidade pronta, com pacing.
const ensureReady = (id: IdentityRow) => ensureIdentityReady(db, id, { adb });
const planDeps = (): PlanDeps => ({ db, ensureReady, apiKey: apiKeys.current(), ollama });
// Limite lido do banco no início de cada tarefa (spec limites §UI): a tela muda o valor sem reiniciar o daemon.
const runWorker = (j: WorkerJob) => runTask({
  db, identity: j.identity, goalText: j.goalText, goalId: j.goalId, taskId: j.taskId, instruction: j.instruction,
  apiKey: apiKeys.current(), isKilled: () => server.isKilled(), onStep: () => server.broadcast(), pacing: CONFIG.swarm,
  stepBudget: readStepBudgets(db).goal,
}, { ollama });

// Arquivos entre aparelhos (spec arquivos): adb pull/push para <dataDir>/files; missões encadeadas entregam por aqui.
const fileService = createFileService({
  db, adb, dir: CONFIG.files.dir, maxBytes: CONFIG.files.maxBytes, recentLimit: CONFIG.files.recentLimit,
  // Armazenamento criptografado só existe com a tela destravada (reboot, restore, tela apagada).
  unlock: (i) => ensureUnlocked(adb, i.serial, i.lockPin),
});

// Missões (spec missões): loop planejador → executor por identidade, fora do lock de objetivo.
const missionMask = async (missionId: string) => createSecretMask(await loadMissionSecrets(db, vault, missionId)).mask;
const missions = createMissionRunner({
  db, isKilled: () => server.isKilled(), onChange: onFleetChange, files: fileService,
  plan: (input) => planNext(input, { providers: readProviderConfig(db), apiKey: apiKeys.current(), ollama }),
  readScreen: (identity) => readScreenOnce(db, identity, { ensureReady: (d, i) => ensureIdentityReady(d, i, { adb }) }),
  mask: missionMask,
  runSubtask: async (j) => {
    const mask = createSecretMask(await loadMissionSecrets(db, vault, j.missionId));
    const seq = subtaskSeq(db, j.taskId);
    // Instruções do operador (spec instruções): ainda não lidas quando o executor pede o próximo passo; marcadas com o seq desta subtarefa.
    const takeNotes = () => {
      const pending = unreadNotes(db, j.missionId);
      if (!pending.length) return [];
      markNotesRead(db, pending.map((n) => n.id), seq);
      return pending.map((n) => n.text);
    };
    const r = await runTask({
      db, identity: j.identity, goalText: j.instruction, goalId: j.missionId, taskId: j.taskId, instruction: j.instruction,
      apiKey: apiKeys.current(), isKilled: j.shouldStop, onStep: () => server.broadcast(),
      stepBudget: readStepBudgets(db).mission, pacing: CONFIG.swarm, mission: { missionId: j.missionId, vault, mask, takeNotes, files: bindMissionFiles(fileService, db, j.identity, j.missionId) },
    }, { ollama });
    return { humanReason: r.humanReason, summary: r.platformBlock ?? r.summary };
  },
  promote: (missionId) => promoteAccounts(missionId, { db, vault, snapshot: (i) => saveSnapshot(adb, i.serial) }),
});

// Celular-base sem Android Studio (daemon/src/base): o idioma é o da tela que pediu (a missão fala com o modelo nele).
let baseLang = 'pt';
const basePrep = wireBasePreparer({ db, adb, supervisor: emulators, missions, vault, onChange: () => broadcast?.(), lang: () => baseLang });
// Preparo que estava rodando quando o daemon caiu: fica como falha retomável ("Tentar de novo" continua de onde parou).
// Também o que esperava uma verificação: sem o loop do preparo vivo, ninguém mais gravaria a versão nem desligaria a base.
if (['running', 'needs-human'].includes(readBasePrep(db).state)) writeBasePrep(db, { ...readBasePrep(db), state: 'failed', error: 'o preparo foi interrompido; tente de novo' });

// Quem está no adb agora: a tela mostra Desligar/Boot pelo aparelho de fato, não pelo ciclo de vida gravado.
let onlineSerials: ReadonlySet<string> = new Set();

const daemonToken = randomUUID();
const server = await startServer({
  db, token: daemonToken, screen, video, port: portEnv ? Number(portEnv) : undefined, videoState: (id) => video.state(id),
  host: () => host.read(),
  localParallel: () => localParallelController.status(),
  baseAvd: () => ({ ...currentBaseAvd(), running: baseRunning, prep: readBasePrep(db) }),
  booting: () => identityRoutes.booting(),
  online: () => onlineSerials,
  listLocal: (current) => localRuntimes.listAll(current),
  // Pela trava (ollama = single-flight + lock): descarregar não pode correr junto com um restart/reload em andamento.
  unloadLocal: (row) => ollama.unload(row.endpoint, row.model, row.runtime),
  // Kill switch derruba o Ollama que é nosso (spec §4.3); /resume + próximo objetivo o sobem de novo.
  onKill: () => { ollama.stop(); server.broadcast(); },
  // Kill switch já é recusado na rota (409). Plano do cliente é re-sondado no start de cada identidade.
  onGoal: async (text, planIn) => {
    const plan = planIn ? { ...planIn, text } : await planGoal(text, planDeps());
    server.broadcast();
    const started = startGoal(plan, { db, isKilled: () => server.isKilled(), runWorker, ensureReady, onChange: onFleetChange });
    return { goalId: started.goalId, done: started.done };
  },
  // Rotas das frentes do incremento 5: objetivos, ciclo de vida da identidade, controle humano (input via `adb shell input`);
  // missões e credenciais do cofre (spec missões) não usam o lock de objetivo.
  routes: [
    goalsRoutes({ plan: (text, lang) => planGoal(text, planDeps(), lang) }), identityRoutes.route, controlRoutes({ input: createDeviceInput(adb) }),
    missionRoutes({ runner: missions, mask: missionMask }), fileRoutes({ service: fileService }), credentialRoutes({ vault }), settingsRoutes(), anthropicKeyRoutes({ store: apiKeys }),
    localParallelRoutes({ controller: localParallelController }),
    baseRoutes({
      prepare: (lang) => { baseLang = lang; void basePrep.start(); },
      // Conta trocada com a missão aberta: a senha já vem do cofre (atualizado); o e-mail da memória também muda.
      saveGoogle: async (email, password) => {
        await saveGoogleAccount(vault, email, password);
        const open = openMissionFor(db, BASE_IDENTITY_ID);
        if (open) seedGoogleMemory(db, open.id, email);
      },
      // Pausada (erro do modelo, kill switch, janela fechada) retoma; esperando humano continua. Depois o preparo volta a
      // acompanhar (idempotente: se ele já está esperando a missão, é o mesmo).
      continueMission: (missionId) => {
        const m = getMission(db, missionId);
        if (m?.state === 'paused') missions.resume(missionId); else missions.continue(missionId);
        void basePrep.start();
      },
      reset: () => {
        const open = openMissionFor(db, BASE_IDENTITY_ID);
        if (open) missions.abandon(open.id);
        writeBasePrep(db, IDLE_PREP);
      },
    }),
  ],
  onProviderTest: async (role) => {
    const model = readProviderConfig(db)[role].model;
    const fail = (error: string) => recordProviderTest(db, { role, model, latencyMs: 0, tokensPerSec: null, argsValid: false, warning: null, error, at: new Date().toISOString() });
    const id = pickTestIdentity(listFleet(db));
    if (!id) return fail('nenhuma identidade livre para o tool-call canônico (todas rodando, pausadas, controladas ou sem conta)');
    const probe = await ensureIdentityReady(db, id, { adb }); server.broadcast();
    if (!probe.ready) return fail(`${id.name} não pronta: ${probe.details.join('; ')}`);
    const t = await testProvider(db, readProviderConfig(db)[role], getIdentity(db, id.id)!, { anthropicApiKey: apiKeys.current() }, { ollama });
    server.broadcast(); return t;
  },
});
broadcast = () => server.broadcast();
host.start(() => server.broadcast());
// A base costuma ser criada no Android Studio com o app aberto: quando ela aparece, some, liga ou desliga, a tela
// fica sabendo. Ligada, o provisionamento recusa (clone de disco em uso sai inconsistente) e o guia pede para fechar.
const pollOnline = async () => {
  const now = new Set(await adb.devices().catch(() => [] as readonly string[]));
  const changed = now.size !== onlineSerials.size || [...now].some((s) => !onlineSerials.has(s));
  onlineSerials = now;
  if (changed) server.broadcast();
};
setInterval(() => { void pollOnline(); }, 5000).unref();
void pollOnline();
let baseRunning = false;
let baseKey = '';
const pollBase = async () => {
  const b = currentBaseAvd();
  baseRunning = b.found ? !!(await findRunningAvd(adb, await adb.devices().catch(() => []), b.name)) : false;
  const key = `${b.name}:${b.found}:${baseRunning}`;
  if (key !== baseKey) { baseKey = key; server.broadcast(); }
};
setInterval(() => { void pollBase().catch(() => undefined); }, 5000).unref(); // só em mudança relevante (RAM ±0,5 GiB, CPU ±5 pts, VRAM ±256 MiB)
stopDisk = startDiskCollector(db, disk, () => server.broadcast());
writeFileSync(CONFIG.daemonInfoPath, JSON.stringify({ port: server.port, token: daemonToken, pid: process.pid }));
console.log(`[tapflock-daemon] http://127.0.0.1:${server.port} · info em ${CONFIG.daemonInfoPath}`);

const resumed = missions.resumeAllOnStart();
if (resumed > 0) console.log(`[tapflock-daemon] ${resumed} missão(ões) retomada(s)`);
