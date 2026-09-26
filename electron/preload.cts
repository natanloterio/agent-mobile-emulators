import { contextBridge, ipcRenderer } from 'electron';

// CommonJS (.cts → preload.cjs): com `sandbox: true` o Electron não carrega preload ESM.
// O preload roda antes da página; guarda o último snapshot para quem assinar depois (o React
// só registra `onSnapshot` num efeito, possivelmente após o reenvio do main em did-finish-load).
let lastSnapshot: unknown = null;
ipcRenderer.on('enxame:snapshot', (_e, data: unknown) => { lastSnapshot = data; });

contextBridge.exposeInMainWorld('enxame', {
  platform: process.platform,
  version: '0.1.0',
  onSnapshot: (cb: (s: unknown) => void) => {
    const listener = (_e: unknown, data: unknown) => cb(data);
    ipcRenderer.on('enxame:snapshot', listener);
    if (lastSnapshot !== null) cb(lastSnapshot);
    return () => ipcRenderer.removeListener('enxame:snapshot', listener);
  },
  startGoal: (text: string) => ipcRenderer.invoke('enxame:startGoal', text),
  kill: () => ipcRenderer.invoke('enxame:kill'),
  setProvider: (role: string, patch: unknown) => ipcRenderer.invoke('enxame:setProvider', role, patch),
  testProvider: (role: string) => ipcRenderer.invoke('enxame:testProvider', role),
  getProviderModels: (role: string) => ipcRenderer.invoke('enxame:getProviderModels', role),
});
