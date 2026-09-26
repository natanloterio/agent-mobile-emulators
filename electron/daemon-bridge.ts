import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const INFO = path.join(os.homedir(), '.local', 'share', 'enxame', 'daemon.json');
type Info = { port: number; token: string; pid: number };

function readInfo(): Info | null {
  try { return existsSync(INFO) ? (JSON.parse(readFileSync(INFO, 'utf8')) as Info) : null; } catch { return null; }
}
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }

/** Sobe o daemon com o Node do sistema (o do Electron é 20.x, sem node:sqlite) se não houver um vivo. */
export function ensureDaemon(projectRoot: string): ChildProcess | null {
  const info = readInfo();
  if (info && alive(info.pid)) return null;
  const child = spawn('node', ['--env-file=.env', 'dist-daemon/index.js'], { cwd: projectRoot, stdio: 'inherit', env: process.env });
  return child;
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

export function connectSnapshots(info: Info, onSnapshot: (data: unknown) => void): () => void {
  const ws = new WebSocket(`ws://127.0.0.1:${info.port}/ws?token=${info.token}`);
  ws.on('message', (m) => { const msg = JSON.parse(String(m)) as { type: string; data: unknown }; if (msg.type === 'snapshot') onSnapshot(msg.data); });
  return () => ws.close();
}

export async function post(info: Info, pathname: string, body?: unknown): Promise<void> {
  const r = await fetch(`http://127.0.0.1:${info.port}${pathname}`, {
    method: 'POST', headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${pathname} → ${r.status}`);
}

export async function request(info: Info, method: 'GET' | 'PUT' | 'POST', pathname: string, body?: unknown): Promise<unknown> {
  const r = await fetch(`http://127.0.0.1:${info.port}${pathname}`, { method, headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${pathname} → ${r.status}: ${JSON.stringify(json)}`);
  return json;
}
