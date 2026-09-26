import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('enxame', {
  platform: process.platform,
  version: '0.1.0',
  onSnapshot: (cb: (s: unknown) => void) => {
    const listener = (_e: unknown, data: unknown) => cb(data);
    ipcRenderer.on('enxame:snapshot', listener);
    return () => ipcRenderer.removeListener('enxame:snapshot', listener);
  },
  startGoal: (text: string) => ipcRenderer.invoke('enxame:startGoal', text),
  kill: () => ipcRenderer.invoke('enxame:kill'),
});
