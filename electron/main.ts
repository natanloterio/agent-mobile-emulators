import { app, BrowserWindow, ipcMain, Menu, safeStorage } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { access, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectSnapshots, daemonLogPath, daemonSpawnSpec, ensureDaemon, post, request, waitForInfo, type DaemonInfo } from './daemon-bridge.js';
import { failedStatus, type DaemonStatus } from './daemon-wait.js';
import { createDaemonGate } from './daemon-gate.js';
import { assertId, createCredentialVault } from './credentials.js';
import { migrateLegacyCredentials, parseCredentialsResponse } from './credentials-migrate.js';
import { createGopBuffer } from './gop-buffer.js';
import { PRODUCT_NAME } from './brand.js';
import { migrateDataDir, migrateUserData } from './legacy-migrate.js';
import { loginViaDaemon } from './login.js';
import { apiRoute } from './api-route.js';
import { providerRoute } from './provider-route.js';
import { testAnthropicKey } from './setup/anthropic-key.js';
import { AnthropicKeySchema, BaseGoogleSchema } from './setup/requests.js';
import { finishSetup } from './setup/finish.js';
import { nodeHardwareDeps } from './setup/hardware.js';
import { registerSetupIpc } from './setup/ipc.js';
import { stopTemporaryOllama } from './setup/ollama-pull.js';
import { resolveSetupPaths } from './setup/paths.js';
import { platformId } from './setup/platform.js';
import { nodeProbeDeps, probeSetup } from './setup/probe.js';
import { createRunners, nodeRunnerDeps } from './setup/runners.js';
import { readSetupFile, readSetupFileSync, writeSetupFile } from './setup/setup-file.js';
import { decideStartup } from './setup/startup.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

// Wayland + NVIDIA nesta máquina é instável para decode acelerado (ver spec §4.2).
// Deixamos o Chromium escolher a plataforma; o spike de 10 decoders decide o resto.
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');

// Troca de nome (Enxame → Tapflock): o perfil do Electron muda antes do ready (depois o Chromium já o abriu) e a pasta
// de dados antes de qualquer leitura dela. Falhou, tudo segue no nome antigo e a próxima subida tenta de novo.
migrateUserData(app.getPath('appData'));
const dataMigration = migrateDataDir(process.env, os.homedir()).catch((e: unknown) => {
  console.error('[tapflock] migração da pasta de dados falhou:', (e as Error).message);
});

// O daemon manda um snapshot ao conectar e depois só em eventos; guardamos o último para
// reenviar a cada carga da janela (did-finish-load), senão a tela fica no mock até o próximo evento.
let lastSnapshot: unknown = null;
// Idem para o pôster (frame) mais recente por identidade e o GOP de vídeo, para não deixar a
// janela recarregada sem miniatura/vídeo até o próximo evento do daemon.
const lastFrames = new Map<string, unknown>();
const gop = createGopBuffer();

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 360,
    minHeight: 640,
    title: PRODUCT_NAME,
    // Linux e Windows usam este ícone na janela e na barra de tarefas; o do instalador vem de build/ (package.json).
    // No macOS vale o do bundle. Em desenvolvimento o Vite serve public/, então o arquivo é lido de lá.
    icon: path.join(here, '..', devServerUrl ? 'public' : 'dist', 'icon.png'),
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.on('did-finish-load', () => {
    if (lastSnapshot !== null) win.webContents.send('tapflock:snapshot', lastSnapshot);
    for (const f of lastFrames.values()) win.webContents.send('tapflock:frame', f);
    for (const p of gop.replay()) win.webContents.send('tapflock:video', p);
  });

  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(path.join(here, '..', 'dist', 'index.html'));
  }
}

Promise.all([app.whenReady(), dataMigration]).then(() => {
  // O design não tem barra de menu; atalhos de sistema continuam funcionando.
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Canais registrados já na subida: clique antes do daemon responder recebe "daemon não conectado", não um erro do Electron.
  const gate = createDaemonGate<DaemonInfo>();
  ipcMain.handle('tapflock:startGoal', (_e, text: string) => gate.use((info) => post(info, '/goals', { text })));
  ipcMain.handle('tapflock:kill', () => gate.use((info) => post(info, '/kill')));
  ipcMain.handle('tapflock:resume', () => gate.use((info) => post(info, '/resume')));
  // Canal genérico do incremento 5: só rotas da lista de permissão (electron/api-route.ts).
  ipcMain.handle('tapflock:api', (_e, method: string, pathname: string, body?: unknown) => {
    const r = apiRoute(method, pathname);
    return gate.use((info) => request(info, r.method, r.path, body));
  });
  ipcMain.handle('tapflock:setProvider', (_e, role: string, patch: unknown) => gate.use((info) => request(info, 'PUT', providerRoute(role, 'put'), patch)));
  ipcMain.handle('tapflock:testProvider', (_e, role: string) => gate.use((info) => request(info, 'POST', providerRoute(role, 'test'))));
  // Credenciais no cofre do daemon (spec missões §Cofre): o main só repassa; nenhuma resposta traz senha.
  const legacyFile = path.join(app.getPath('userData'), 'credentials.json');
  const legacy = createCredentialVault({ safeStorage, file: legacyFile });
  const daemon = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', p: string, body?: unknown) => gate.use((info) => request(info, method, p, body));
  // Roda só depois do gate.set (abaixo): antes disso o daemon ainda não respondeu e a migração falharia sem nova tentativa.
  const migrateCredentials = () => migrateLegacyCredentials({
    legacy, post: (p, body) => daemon('POST', p, body),
    exists: () => access(legacyFile).then(() => true, () => false), remove: () => unlink(legacyFile),
  }).then((r) => { if (r.migrated) console.log(`[tapflock] ${r.migrated} credencial(is) migrada(s) para o cofre do daemon`); })
    .catch((e: unknown) => console.error('[tapflock] migração de credenciais falhou; o arquivo antigo foi mantido:', (e as Error).message));
  const credentials = async () => parseCredentialsResponse(await daemon('GET', '/credentials'));
  ipcMain.handle('tapflock:credentials:available', async () => (await credentials()).available);
  ipcMain.handle('tapflock:credentials:status', async () => (await credentials()).entries);
  ipcMain.handle('tapflock:credentials:set', (_e, id: string, username: string, password: string) => { assertId(id); return daemon('PUT', `/identities/${id}/credentials`, { username, password }); });
  ipcMain.handle('tapflock:credentials:clear', (_e, id: string) => { assertId(id); return daemon('DELETE', `/identities/${id}/credentials`); });
  ipcMain.handle('tapflock:login', (_e, id: string) => loginViaDaemon(id, { post: (p, body) => daemon('POST', p, body) }));
  // Chave da Anthropic depois do onboarding (tela Provedores): canal próprio, fora do genérico; a resposta nunca traz a chave.
  ipcMain.handle('tapflock:anthropicKey:status', () => daemon('GET', '/settings/anthropic-key'));
  ipcMain.handle('tapflock:anthropicKey:set', (_e, raw: unknown) => daemon('PUT', '/settings/anthropic-key', { key: AnthropicKeySchema.parse(raw) }));
  // Conta Google do preparo do celular-base: a senha vai direto ao cofre do daemon, nunca pelo canal genérico.
  ipcMain.handle('tapflock:base:google', (_e, email: unknown, password: unknown) => {
    const body = BaseGoogleSchema.parse({ email, password });
    return daemon('PUT', '/base/google', body);
  });
  ipcMain.handle('tapflock:getProviderModels', (_e, role: string) => gate.use((info) => request(info, 'GET', providerRoute(role, 'models'))));

  const projectRoot = path.join(here, '..');
  const broadcast = (ch: string, d: unknown) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send(ch, d); };

  // Estado do daemon para a tela: sem isso uma falha na subida deixava "Conectando ao daemon…" para sempre.
  let daemonStatus: DaemonStatus = { state: 'starting' };
  const setDaemonStatus = (s: DaemonStatus) => { daemonStatus = s; broadcast('tapflock:daemon', s); };

  // Sobe o daemon uma vez (idempotente); falhou, a próxima chamada tenta de novo.
  let daemonStart: Promise<void> | null = null;
  const startDaemon = (): Promise<void> => {
    daemonStart ??= (async () => {
      setDaemonStatus({ state: 'starting' });
      const dotenvPath = path.join(projectRoot, '.env');
      const child = ensureDaemon(daemonSpawnSpec({
        isPackaged: app.isPackaged, appPath: app.getAppPath(), resourcesPath: process.resourcesPath, execPath: process.execPath,
        env: process.env, dotenv: !app.isPackaged && existsSync(dotenvPath) ? readFileSync(dotenvPath, 'utf8') : null,
      }));
      const info = await waitForInfo(child);
      gate.set(info);
      setDaemonStatus({ state: 'ok' });
      void migrateCredentials();
      connectSnapshots(info, {
        onSnapshot: (data) => { lastSnapshot = data; broadcast('tapflock:snapshot', data); },
        onFrame: (f) => { const id = (f as { id?: unknown })?.id; if (typeof id === 'string') lastFrames.set(id, f); broadcast('tapflock:frame', f); },
        onVideo: (p) => { gop.push(p as never); broadcast('tapflock:video', p); },
      }, () => {
        // Daemon morreu com o app aberto: sem isso o gate seguia na porta velha e "Tentar de novo" não subia outro.
        daemonStart = null; gate.fail('o daemon parou');
        setDaemonStatus({ state: 'failed', reason: 'stopped', exitCode: null, logPath: daemonLogPath(app.isPackaged), detail: 'o daemon parou' });
      });
    })().catch((e: Error) => {
      gate.fail(e.message); console.error('[tapflock] sem daemon:', e.message); daemonStart = null;
      setDaemonStatus(failedStatus(e, daemonLogPath(app.isPackaged)));
      throw e;
    });
    return daemonStart;
  };
  ipcMain.handle('tapflock:daemon:status', () => daemonStatus);
  ipcMain.handle('tapflock:daemon:retry', () => startDaemon().then(() => true, () => false));

  // Onboarding (spec onboarding): leitura síncrona do setup.json para os canais existirem antes de a janela pedir.
  const platform = platformId();
  const supported = platform !== null;
  const saved = readSetupFileSync(resolveSetupPaths(process.env, os.homedir(), null, platform ?? undefined).setupFile);
  const paths = resolveSetupPaths(process.env, os.homedir(), saved?.paths.sdkRoot ?? null, platform ?? undefined);
  const probe = () => probeSetup(paths, nodeProbeDeps(), nodeHardwareDeps());
  const startupP = decideStartup({ supported, saved, paths, probe, now: () => new Date().toISOString() }).then(async (s) => {
    if (s.write) await writeSetupFile(paths.setupFile, s.write).catch((e: Error) => console.error('[tapflock] setup.json:', e.message));
    return s;
  });
  void startupP.then((s) => { if (s.completed) void startDaemon().catch(() => undefined); });

  registerSetupIpc({
    handle: (ch, fn) => ipcMain.handle(ch, fn),
    send: broadcast,
    paths,
    status: async () => ({ completed: (await startupP).completed, supported }),
    probe,
    runners: (localModel, bin, log) => createRunners(localModel, bin, nodeRunnerDeps(paths, log)),
    testKey: (key) => testAnthropicKey(key),
    finish: (req, bin) => finishSetup(req, bin, {
      paths, writeSetup: (f) => writeSetupFile(paths.setupFile, f), startDaemon,
      daemon: (method, p, body) => daemon(method, p, body), now: () => new Date().toISOString(),
      readSetup: () => readSetupFile(paths.setupFile),
    }),
    // Na primeira execução o daemon ainda não subiu: vale o ambiente; numa reabertura, o cofre dele.
    keyConfigured: async () => !!process.env.ANTHROPIC_API_KEY?.trim()
      || ((await daemon('GET', '/settings/anthropic-key').catch(() => null)) as { configured?: unknown } | null)?.configured === true,
  });
});

// Pull do modelo em andamento ao fechar: o `ollama serve` temporário do onboarding não pode ficar órfão.
app.on('before-quit', () => stopTemporaryOllama());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
