import type { DatabaseSync } from 'node:sqlite';
import type { Adb } from '../device/adb.js';
import { probeIdentity, type ProbeResult } from '../device/probe.js';
import { setIdentityState, type IdentityRow } from '../db/identities.js';

const MCP_DEVICE_PORT = 8080;
const ALL_FALSE = { bootCompleted: false, accessibility: false, mcpInitialize: false, toolsPresent: false, versionMatch: false } as const;

/**
 * Garante forward, slug e token, roda a sonda e persiste o estado resultante. Nunca lança.
 * Identidade em needs-human ou banned é recusada sem tocar no device: "nunca retry automático" (spec §6).
 */
export async function ensureIdentityReady(
  db: DatabaseSync, id: IdentityRow,
  deps: { adb: Adb; probe?: typeof probeIdentity },
): Promise<ProbeResult> {
  if (id.state === 'needs-human' || id.state === 'banned') {
    return { ready: false, signals: ALL_FALSE, details: [`identidade em ${id.state}: exige ação humana antes de qualquer tarefa`], failureClass: 'blocked' };
  }
  const probe = deps.probe ?? probeIdentity;
  try {
    await deps.adb.forward(id.serial, id.mcpHostPort, MCP_DEVICE_PORT);
    await deps.adb.broadcastConfigure(id.serial, { bearer_token: id.mcpToken, bearer_token_enabled: true, device_slug: id.deviceSlug });
    const result = await probe(id, { adb: deps.adb });
    if (result.ready) setIdentityState(db, id.id, 'idle', { lastError: null });
    else setIdentityState(db, id.id, 'offline', { lastError: result.details.join(' · ') || `sonda falhou (${result.failureClass})` });
    return result;
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    setIdentityState(db, id.id, 'offline', { lastError: msg.slice(0, 300) });
    return { ready: false, signals: ALL_FALSE, details: [msg], failureClass: 'infra' };
  }
}
