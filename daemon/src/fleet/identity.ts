import type { DatabaseSync } from 'node:sqlite';
import type { Adb } from '../device/adb.js';
import { probeIdentity, type ProbeResult } from '../device/probe.js';
import { setIdentityState, type IdentityRow } from '../db/identities.js';

const MCP_DEVICE_PORT = 8080;
const RESTART_SETTLE_MS = 1500;
const MCP_UP_TRIES = 20;
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Servidor respondeu mas as tools com o prefixo do slug não existem: o prefixo é fixado na subida do servidor. */
const needsServerRestart = (r: ProbeResult) => !r.ready && r.signals.mcpInitialize && !r.signals.toolsPresent;

async function restartMcpServer(
  id: IdentityRow, adb: Adb, probe: typeof probeIdentity, sleep: (ms: number) => Promise<void>,
): Promise<ProbeResult> {
  await adb.startTrampoline(id.serial, 'stop');
  await sleep(RESTART_SETTLE_MS);
  await adb.startTrampoline(id.serial, 'start');
  let last: ProbeResult | null = null;
  for (let i = 0; i < MCP_UP_TRIES; i++) {
    await sleep(1000);
    last = await probe(id, { adb });
    if (last.signals.mcpInitialize) return last;
  }
  return last ?? probe(id, { adb });
}
const ALL_FALSE = { bootCompleted: false, accessibility: false, mcpInitialize: false, toolsPresent: false, versionMatch: false } as const;

/**
 * Garante forward, slug e token, roda a sonda e persiste o estado resultante. Nunca lança.
 * Identidade em needs-human ou banned é recusada sem tocar no device: "nunca retry automático" (spec §6).
 */
export async function ensureIdentityReady(
  db: DatabaseSync, id: IdentityRow,
  deps: { adb: Adb; probe?: typeof probeIdentity; sleep?: (ms: number) => Promise<void> },
): Promise<ProbeResult> {
  const sleep = deps.sleep ?? defaultSleep;
  if (id.state === 'needs-human' || id.state === 'banned') {
    return { ready: false, signals: ALL_FALSE, details: [`identidade em ${id.state}: exige ação humana antes de qualquer tarefa`], failureClass: 'blocked' };
  }
  const probe = deps.probe ?? probeIdentity;
  try {
    await deps.adb.forward(id.serial, id.mcpHostPort, `tcp:${MCP_DEVICE_PORT}`);
    await deps.adb.broadcastConfigure(id.serial, { bearer_token: id.mcpToken, bearer_token_enabled: true, device_slug: id.deviceSlug });
    let result = await probe(id, { adb: deps.adb });
    if (needsServerRestart(result)) result = await restartMcpServer(id, deps.adb, probe, sleep);
    if (result.ready) setIdentityState(db, id.id, 'idle', { lastError: null });
    else setIdentityState(db, id.id, 'offline', { lastError: result.details.join(' · ') || `sonda falhou (${result.failureClass})` });
    return result;
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    setIdentityState(db, id.id, 'offline', { lastError: msg.slice(0, 300) });
    return { ready: false, signals: ALL_FALSE, details: [msg], failureClass: 'infra' };
  }
}
