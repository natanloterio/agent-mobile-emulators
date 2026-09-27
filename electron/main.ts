import { app, BrowserWindow, ipcMain, Menu, safeStorage } from 'electron';
import { access, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectSnapshots, ensureDaemon, post, request, waitForInfo, type DaemonInfo } from './daemon-bridge.js';
import { createDaemonGate } from './daemon-gate.js';
import { assertId, createCredentialVault } from './credentials.js';
import { migrateLegacyCredentials, parseCredentialsResponse } from './credentials-migrate.js';
import { createGopBuffer } from './gop-buffer.js';
import { loginViaDaemon } from './login.js';
import { apiRoute } from './api-route.js';
import { providerRoute } from './provider-route.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

// Wayland + NVIDIA nesta máquina é instável para decode acelerado (ver spec §4.2).
// Deixamos o Chromium escolher a plataforma; o spike de 10 decoders decide o resto.
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');

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
    title: 'Enxame',
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
    if (lastSnapshot !== null) win.webContents.send('enxame:snapshot', lastSnapshot);
    for (const f of lastFrames.values()) win.webContents.send('enxame:frame', f);
    for (const p of gop.replay()) win.webContents.send('enxame:video', p);
  });

  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(path.join(here, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  // O design não tem barra de menu; atalhos de sistema continuam funcionando.
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Canais registrados já na subida: clique antes do daemon responder recebe "daemon não conectado", não um erro do Electron.
  const gate = createDaemonGate<DaemonInfo>();
  ipcMain.handle('enxame:startGoal', (_e, text: string) => gate.use((info) => post(info, '/goals', { text })));
  ipcMain.handle('enxame:kill', () => gate.use((info) => post(info, '/kill')));
  ipcMain.handle('enxame:resume', () => gate.use((info) => post(info, '/resume')));
  // Canal genérico do incremento 5: só rotas da lista de permissão (electron/api-route.ts).
  ipcMain.handle('enxame:api', (_e, method: string, pathname: string, body?: unknown) => {
    const r = apiRoute(method, pathname);
    return gate.use((info) => request(info, r.method, r.path, body));
  });
  ipcMain.handle('enxame:setProvider', (_e, role: string, patch: unknown) => gate.use((info) => request(info, 'PUT', providerRoute(role, 'put'), patch)));
  ipcMain.handle('enxame:testProvider', (_e, role: string) => gate.use((info) => request(info, 'POST', providerRoute(role, 'test'))));
  // Credenciais no cofre do daemon (spec missões §Cofre): o main só repassa; nenhuma resposta traz senha.
  const legacyFile = path.join(app.getPath('userData'), 'credentials.json');
  const legacy = createCredentialVault({ safeStorage, file: legacyFile });
  const daemon = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', p: string, body?: unknown) => gate.use((info) => request(info, method, p, body));
  // Roda só depois do gate.set (abaixo): antes disso o daemon ainda não respondeu e a migração falharia sem nova tentativa.
  const migrateCredentials = () => migrateLegacyCredentials({
    legacy, post: (p, body) => daemon('POST', p, body),
    exists: () => access(legacyFile).then(() => true, () => false), remove: () => unlink(legacyFile),
  }).then((r) => { if (r.migrated) console.log(`[enxame] ${r.migrated} credencial(is) migrada(s) para o cofre do daemon`); })
    .catch((e: unknown) => console.error('[enxame] migração de credenciais falhou; o arquivo antigo foi mantido:', (e as Error).message));
  const credentials = async () => parseCredentialsResponse(await daemon('GET', '/credentials'));
  ipcMain.handle('enxame:credentials:available', async () => (await credentials()).available);
  ipcMain.handle('enxame:credentials:status', async () => (await credentials()).entries);
  ipcMain.handle('enxame:credentials:set', (_e, id: string, username: string, password: string) => { assertId(id); return daemon('PUT', `/identities/${id}/credentials`, { username, password }); });
  ipcMain.handle('enxame:credentials:clear', (_e, id: string) => { assertId(id); return daemon('DELETE', `/identities/${id}/credentials`); });
  ipcMain.handle('enxame:login', (_e, id: string) => loginViaDaemon(id, { post: (p, body) => daemon('POST', p, body) }));
  ipcMain.handle('enxame:getProviderModels', (_e, role: string) => gate.use((info) => request(info, 'GET', providerRoute(role, 'models'))));

  const projectRoot = path.join(here, '..');
  ensureDaemon(projectRoot);
  waitForInfo().then((info) => {
    gate.set(info);
    void migrateCredentials();
    const broadcast = (ch: string, d: unknown) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send(ch, d); };
    connectSnapshots(info, {
      onSnapshot: (data) => { lastSnapshot = data; broadcast('enxame:snapshot', data); },
      onFrame: (f) => { const id = (f as { id?: unknown })?.id; if (typeof id === 'string') lastFrames.set(id, f); broadcast('enxame:frame', f); },
      onVideo: (p) => { gop.push(p as never); broadcast('enxame:video', p); },
    });
  }).catch((e) => { gate.fail(e.message); console.error('[enxame] sem daemon:', e.message); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
