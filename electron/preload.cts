import { contextBridge, ipcRenderer } from 'electron';

// CommonJS (.cts → preload.cjs): com `sandbox: true` o Electron não carrega preload ESM.
// O preload roda antes da página; guarda o último snapshot para quem assinar depois (o React
// só registra `onSnapshot` num efeito, possivelmente após o reenvio do main em did-finish-load).
let lastSnapshot: unknown = null;
ipcRenderer.on('enxame:snapshot', (_e, data: unknown) => { lastSnapshot = data; });

// Idem para o pôster (frame) mais recente por identidade.
const lastFrames = new Map<string, unknown>();
ipcRenderer.on('enxame:frame', (_e, f: unknown) => { const id = (f as { id?: unknown })?.id; if (typeof id === 'string') lastFrames.set(id, f); });

// GOP de vídeo por identidade — mesma regra de electron/gop-buffer.ts, copiada aqui porque o
// preload é CommonJS isolado e não pode importar módulos ESM do main.
type Packet = { id: string; key: boolean };
const MAX_GOP = 400;
const gops = new Map<string, Packet[]>();
ipcRenderer.on('enxame:video', (_e, p: Packet) => {
  if (p.key) { gops.set(p.id, [p]); return; }
  const g = gops.get(p.id); if (!g) return;
  if (g.length >= MAX_GOP) { gops.delete(p.id); return; } // GOP truncado não decodifica: descarta até o próximo key
  gops.set(p.id, [...g, p]);
});

contextBridge.exposeInMainWorld('enxame', {
  platform: process.platform,
  version: '0.1.0',
  onSnapshot: (cb: (s: unknown) => void) => {
    const listener = (_e: unknown, data: unknown) => cb(data);
    ipcRenderer.on('enxame:snapshot', listener);
    if (lastSnapshot !== null) cb(lastSnapshot);
    return () => ipcRenderer.removeListener('enxame:snapshot', listener);
  },
  onFrame: (cb: (f: unknown) => void) => {
    const listener = (_e: unknown, data: unknown) => cb(data);
    ipcRenderer.on('enxame:frame', listener);
    for (const f of lastFrames.values()) cb(f);
    return () => ipcRenderer.removeListener('enxame:frame', listener);
  },
  onVideo: (cb: (p: unknown) => void) => {
    const listener = (_e: unknown, data: unknown) => cb(data);
    ipcRenderer.on('enxame:video', listener);
    for (const g of gops.values()) for (const p of g) cb(p);
    return () => ipcRenderer.removeListener('enxame:video', listener);
  },
  startGoal: (text: string) => ipcRenderer.invoke('enxame:startGoal', text),
  kill: () => ipcRenderer.invoke('enxame:kill'),
  resume: () => ipcRenderer.invoke('enxame:resume'),
  api: (method: string, path: string, body?: unknown) => ipcRenderer.invoke('enxame:api', method, path, body),
  setProvider: (role: string, patch: unknown) => ipcRenderer.invoke('enxame:setProvider', role, patch),
  testProvider: (role: string) => ipcRenderer.invoke('enxame:testProvider', role),
  getProviderModels: (role: string) => ipcRenderer.invoke('enxame:getProviderModels', role),
  // Credenciais do login pelo daemon: o status nunca traz a senha.
  credentials: {
    available: () => ipcRenderer.invoke('enxame:credentials:available'),
    status: () => ipcRenderer.invoke('enxame:credentials:status'),
    set: (id: string, username: string, password: string) => ipcRenderer.invoke('enxame:credentials:set', id, username, password),
    clear: (id: string) => ipcRenderer.invoke('enxame:credentials:clear', id),
  },
  login: (id: string) => ipcRenderer.invoke('enxame:login', id),
  // Onboarding (spec onboarding): verificação, instalação com eventos e fim; nada aqui recebe senha além da chave, que vai direto ao main.
  setup: {
    status: () => ipcRenderer.invoke('enxame:setup:status'),
    check: () => ipcRenderer.invoke('enxame:setup:check'),
    install: (req: unknown) => ipcRenderer.invoke('enxame:setup:install', req),
    onJob: (cb: (e: unknown) => void) => {
      const listener = (_e: unknown, data: unknown) => cb(data);
      ipcRenderer.on('enxame:setup:job', listener);
      return () => ipcRenderer.removeListener('enxame:setup:job', listener);
    },
    onLog: (cb: (line: string) => void) => {
      const listener = (_e: unknown, line: unknown) => cb(String(line));
      ipcRenderer.on('enxame:setup:log', listener);
      return () => ipcRenderer.removeListener('enxame:setup:log', listener);
    },
    testKey: (key: string) => ipcRenderer.invoke('enxame:setup:testKey', key),
    finish: (req: unknown) => ipcRenderer.invoke('enxame:setup:finish', req),
  },
});
