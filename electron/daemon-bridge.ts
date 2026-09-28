import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import WebSocket from 'ws';
import { dataDirFrom } from './brand.js';
import { dispatchWsMessage, type WsHandlers } from './ws-dispatch.js';

// Mesmo diretório do daemon (TAPFLOCK_DATA_DIR): permite uma segunda instância isolada para verificação. Resolvido a
// cada uso, não no import: o main migra a pasta do nome antigo (electron/legacy-migrate.ts) depois dos imports.
const dataDir = () => dataDirFrom(process.env);
const infoFile = () => path.join(dataDir(), 'daemon.json');
export type DaemonInfo = { port: number; token: string; pid: number };
type Info = DaemonInfo;

function readInfo(): Info | null {
  const file = infoFile();
  try { return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Info) : null; } catch { return null; }
}
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }

export interface DaemonSpawn { readonly cmd: string; readonly args: string[]; readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly isPackaged: boolean }

/**
 * O daemon roda no próprio binário do Electron (ELECTRON_RUN_AS_NODE; Electron 44 = Node 24, com node:sqlite).
 * Empacotado, o código está em `<resources>/app.asar/dist-daemon`; em desenvolvimento, no projeto, com o `.env` do
 * projeto somado ao ambiente (o ambiente vence).
 */
export function daemonSpawnSpec(o: {
  readonly isPackaged: boolean; readonly appPath: string; readonly resourcesPath: string; readonly execPath: string;
  readonly env: NodeJS.ProcessEnv; readonly dotenv: string | null;
}): DaemonSpawn {
  const fromFile = !o.isPackaged && o.dotenv ? parseEnv(o.dotenv) : {};
  return {
    cmd: o.execPath,
    args: [path.join(o.appPath, 'dist-daemon', 'index.js')],
    cwd: o.isPackaged ? o.resourcesPath : o.appPath,
    env: { ...fromFile, ...o.env, ELECTRON_RUN_AS_NODE: '1' },
    isPackaged: o.isPackaged,
  };
}

/**
 * Sobe o daemon se não houver um vivo. `windowsHide`: no Windows, sem ele o daemon abre uma janela de console.
 * Empacotado, stdio vai para `daemon.log` (não `inherit`): o daemon é feito para sobreviver ao app (fica
 * rodando entre reaberturas), então não faz sentido ele ficar preso ao stdout/stderr do processo Electron que
 * o subiu — mesma convenção usada para o `ollama serve` e o emulador (daemon/src/provider/ollama.ts,
 * daemon/src/fleet/emulator.ts). Em desenvolvimento mantém `inherit`: `dataDir()` sem `TAPFLOCK_DATA_DIR` cai no
 * `~/.local/share/tapflock` de verdade, e cada `npm start` não pode ficar escrevendo log ali.
 */
export function ensureDaemon(spec: DaemonSpawn): ChildProcess | null {
  const info = readInfo();
  if (info && alive(info.pid)) return null;
  if (!spec.isPackaged) {
    const child = spawn(spec.cmd, spec.args, { cwd: spec.cwd, stdio: 'inherit', env: spec.env, windowsHide: true });
    // Sem este ouvinte um erro de spawn derrubaria o main; o waitForInfo expira e a tela mostra o erro.
    child.on('error', (e) => console.error('[tapflock] não deu para subir o daemon:', e.message));
    return child;
  }
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const log = openSync(path.join(dir, 'daemon.log'), 'a');
  try {
    const child = spawn(spec.cmd, spec.args, { cwd: spec.cwd, stdio: ['ignore', log, log], env: spec.env, windowsHide: true });
    child.on('error', (e) => console.error('[tapflock] não deu para subir o daemon:', e.message));
    return child;
  } finally {
    closeSync(log);
  }
}

export async function waitForInfo(timeoutMs = 15000): Promise<Info> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const info = readInfo();
    if (info && alive(info.pid)) return info;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('daemon não respondeu em 15 s');
}

export function connectSnapshots(info: Info, h: WsHandlers): () => void {
  const ws = new WebSocket(`ws://127.0.0.1:${info.port}/ws?token=${info.token}`);
  ws.on('message', (m) => dispatchWsMessage(String(m), h));
  return () => ws.close();
}

export async function post(info: Info, pathname: string, body?: unknown): Promise<void> {
  const r = await fetch(`http://127.0.0.1:${info.port}${pathname}`, {
    method: 'POST', headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${pathname} → ${r.status}`);
}

export async function request(info: Info, method: 'GET' | 'PUT' | 'POST' | 'DELETE', pathname: string, body?: unknown): Promise<unknown> {
  const r = await fetch(`http://127.0.0.1:${info.port}${pathname}`, { method, headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${pathname} → ${r.status}: ${JSON.stringify(json)}`);
  return json;
}
