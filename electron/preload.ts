import { contextBridge } from 'electron';

// Superfície mínima e explícita. A ponte para o daemon (fase 2 do spec) entra aqui,
// nunca via nodeIntegration no renderer.
contextBridge.exposeInMainWorld('enxame', {
  platform: process.platform,
  version: '0.1.0',
});
