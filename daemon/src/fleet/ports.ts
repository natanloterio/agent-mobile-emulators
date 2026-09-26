import net from 'node:net';
import type { DatabaseSync } from 'node:sqlite';
import { CONFIG } from '../config.js';

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

function usedPorts(db: DatabaseSync): { console: ReadonlySet<number>; mcp: ReadonlySet<number> } {
  const rows = db.prepare('select console_port, mcp_host_port from identity').all() as { console_port: number; mcp_host_port: number }[];
  return { console: new Set(rows.map((r) => r.console_port)), mcp: new Set(rows.map((r) => r.mcp_host_port)) };
}

/** Lease real: pula portas registradas E portas presas no SO (TIME_WAIT, qemu zumbi). Teto: 16 slots (adb varre 5555–5585). */
export async function leasePorts(
  db: DatabaseSync,
  opts: { consoleFrom?: number; consoleMax?: number; mcpHostFrom?: number } = {},
): Promise<{ consolePort: number; mcpHostPort: number }> {
  const from = opts.consoleFrom ?? CONFIG.ports.consoleFrom;
  const max = opts.consoleMax ?? CONFIG.ports.consoleMax;
  const used = usedPorts(db);
  let consolePort = -1;
  for (let p = from; p <= max; p += 2) {
    if (used.console.has(p)) continue;
    if ((await isPortFree(p)) && (await isPortFree(p + 1))) { consolePort = p; break; }
  }
  if (consolePort < 0) throw new Error(`sem porta de console livre: os 16 slots (${from}–${max}) estão ocupados ou presos`);
  let mcpHostPort = opts.mcpHostFrom ?? CONFIG.ports.mcpHostFrom;
  while (used.mcp.has(mcpHostPort) || !(await isPortFree(mcpHostPort))) mcpHostPort += 1;
  return { consolePort, mcpHostPort };
}
