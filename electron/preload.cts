import { contextBridge, ipcRenderer } from 'electron';

// CommonJS (.cts → preload.cjs): com `sandbox: true` o Electron não carrega preload ESM.
// O preload roda antes da página; guarda o último snapshot para quem assinar depois (o React
// só registra `onSnapshot` num efeito, possivelmente após o reenvio do main em did-finish-load).
let lastSnapshot: unknown = null;
ipcRenderer.on('tapflock:snapshot', (_e, data: unknown) => { lastSnapshot = data; });

// Idem para o pôster (frame) mais recente por identidade.
const lastFrames = new Map<string, unknown>();
ipcRenderer.on('tapflock:frame', (_e, f: unknown) => { const id = (f as { id?: unknown })?.id; if (typeof id === 'string') lastFrames.set(id, f); });

// GOP de vídeo por identidade — mesma regra de electron/gop-buffer.ts, copiada aqui porque o
// preload é CommonJS isolado e não pode importar módulos ESM do main.
type Packet = { id: string; key: boolean };
const MAX_GOP = 400;
const gops = new Map<string, Packet[]>();
ipcRenderer.on('tapflock:video', (_e, p: Packet) => {
  if (p.key) { gops.set(p.id, [p]); return; }
  const g = gops.get(p.id); if (!g) return;
  if (g.length >= MAX_GOP) { gops.delete(p.id); return; } // GOP truncado não decodifica: descarta até o próximo key
  gops.set(p.id, [...g, p]);
});

// Estado do daemon (subindo / pronto / falhou): a tela pode assinar depois da primeira transmissão.
let lastDaemon: unknown = null;
ipcRenderer.on('tapflock:daemon', (_e, s: unknown) => { lastDaemon = s; });

contextBridge.exposeInMainWorld('tapflock', {
  platform: process.platform,
  version: '0.1.0',
  onSnapshot: (cb: (s: unknown) => void) => {
    const listener = (_e: unknown, data: unknown) => cb(data);
    ipcRenderer.on('tapflock:snapshot', listener);
    if (lastSnapshot !== null) cb(lastSnapshot);
    return () => ipcRenderer.removeListener('tapflock:snapshot', listener);
  },
  onFrame: (cb: (f: unknown) => void) => {
    const listener = (_e: unknown, data: unknown) => cb(data);
    ipcRenderer.on('tapflock:frame', listener);
    for (const f of lastFrames.values()) cb(f);
    return () => ipcRenderer.removeListener('tapflock:frame', listener);
  },
  onVideo: (cb: (p: unknown) => void) => {
    const listener = (_e: unknown, data: unknown) => cb(data);
    ipcRenderer.on('tapflock:video', listener);
    for (const g of gops.values()) for (const p of g) cb(p);
    return () => ipcRenderer.removeListener('tapflock:video', listener);
  },
  daemon: {
    status: () => ipcRenderer.invoke('tapflock:daemon:status'),
    retry: () => ipcRenderer.invoke('tapflock:daemon:retry'),
    onStatus: (cb: (s: unknown) => void) => {
      const listener = (_e: unknown, data: unknown) => cb(data);
      ipcRenderer.on('tapflock:daemon', listener);
      if (lastDaemon !== null) cb(lastDaemon);
      return () => ipcRenderer.removeListener('tapflock:daemon', listener);
    },
  },
  startGoal: (text: string) => ipcRenderer.invoke('tapflock:startGoal', text),
  kill: () => ipcRenderer.invoke('tapflock:kill'),
  resume: () => ipcRenderer.invoke('tapflock:resume'),
  api: (method: string, path: string, body?: unknown) => ipcRenderer.invoke('tapflock:api', method, path, body),
  setProvider: (role: string, patch: unknown) => ipcRenderer.invoke('tapflock:setProvider', role, patch),
  testProvider: (role: string) => ipcRenderer.invoke('tapflock:testProvider', role),
  getProviderModels: (role: string) => ipcRenderer.invoke('tapflock:getProviderModels', role),
  // Credenciais do login pelo daemon: o status nunca traz a senha.
  credentials: {
    available: () => ipcRenderer.invoke('tapflock:credentials:available'),
    status: () => ipcRenderer.invoke('tapflock:credentials:status'),
    set: (id: string, username: string, password: string) => ipcRenderer.invoke('tapflock:credentials:set', id, username, password),
    clear: (id: string) => ipcRenderer.invoke('tapflock:credentials:clear', id),
  },
  login: (id: string) => ipcRenderer.invoke('tapflock:login', id),
  // Chave da Anthropic em Provedores: status diz só se há chave e de onde veio.
  anthropicKey: {
    status: () => ipcRenderer.invoke('tapflock:anthropicKey:status'),
    set: (key: string) => ipcRenderer.invoke('tapflock:anthropicKey:set', key),
  },
  // Onboarding (spec onboarding): verificação, instalação com eventos e fim; nada aqui recebe senha além da chave, que vai direto ao main.
  setup: {
    status: () => ipcRenderer.invoke('tapflock:setup:status'),
    check: () => ipcRenderer.invoke('tapflock:setup:check'),
    install: (req: unknown) => ipcRenderer.invoke('tapflock:setup:install', req),
    onJob: (cb: (e: unknown) => void) => {
      const listener = (_e: unknown, data: unknown) => cb(data);
      ipcRenderer.on('tapflock:setup:job', listener);
      return () => ipcRenderer.removeListener('tapflock:setup:job', listener);
    },
    onLog: (cb: (line: string) => void) => {
      const listener = (_e: unknown, line: unknown) => cb(String(line));
      ipcRenderer.on('tapflock:setup:log', listener);
      return () => ipcRenderer.removeListener('tapflock:setup:log', listener);
    },
    testKey: (key: string) => ipcRenderer.invoke('tapflock:setup:testKey', key),
    finish: (req: unknown) => ipcRenderer.invoke('tapflock:setup:finish', req),
  },
});
