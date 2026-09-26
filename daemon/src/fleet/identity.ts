import type { DatabaseSync } from 'node:sqlite';
import type { Adb } from '../device/adb.js';
import { probeIdentity, type ProbeResult } from '../device/probe.js';
import { setIdentityState, type IdentityRow } from '../db/identities.js';

const MCP_DEVICE_PORT = 8080;

/** Garante forward, slug e token, roda a sonda e persiste o estado resultante. Nunca lança por falha de sonda. */
export async function ensureIdentityReady(
  db: DatabaseSync, id: IdentityRow,
  deps: { adb: Adb; probe?: typeof probeIdentity },
): Promise<ProbeResult> {
  const probe = deps.probe ?? probeIdentity;
  await deps.adb.forward(id.serial, id.mcpHostPort, MCP_DEVICE_PORT);
  await deps.adb.broadcastConfigure(id.serial, { bearer_token: id.mcpToken, bearer_token_enabled: true, device_slug: id.deviceSlug });
  const result = await probe(id, { adb: deps.adb });
  if (result.ready) {
    setIdentityState(db, id.id, 'idle', { lastError: null });
  } else {
    setIdentityState(db, id.id, 'offline', { lastError: result.details.join(' · ') || `sonda falhou (${result.failureClass})` });
  }
  return result;
}
