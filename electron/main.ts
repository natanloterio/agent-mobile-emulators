import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectSnapshots, ensureDaemon, post, request, waitForInfo } from './daemon-bridge.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const devServerUrl = process.env.VITE_DEV_SERVER_URL;

// Wayland + NVIDIA nesta máquina é instável para decode acelerado (ver spec §4.2).
// Deixamos o Chromium escolher a plataforma; o spike de 10 decoders decide o resto.
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');

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
      preload: path.join(here, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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

  const projectRoot = path.join(here, '..');
  ensureDaemon(projectRoot);
  waitForInfo().then((info) => {
    connectSnapshots(info, (data) => { for (const w of BrowserWindow.getAllWindows()) w.webContents.send('enxame:snapshot', data); });
    ipcMain.handle('enxame:startGoal', (_e, text: string) => post(info, '/goals', { text }));
    ipcMain.handle('enxame:kill', () => post(info, '/kill'));
    ipcMain.handle('enxame:setProvider', (_e, role: string, patch: unknown) => request(info, 'PUT', `/providers/${role}`, patch));
    ipcMain.handle('enxame:testProvider', (_e, role: string) => request(info, 'POST', `/providers/${role}/test`));
  }).catch((e) => console.error('[enxame] sem daemon:', e.message));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
