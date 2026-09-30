import type { DatabaseSync } from 'node:sqlite';
import type { Adb } from '../device/adb.js';
import { probeIdentity, type ProbeResult } from '../device/probe.js';
import { ensureUnlocked } from '../device/unlock.js';
import { setIdentityState, type IdentityRow } from '../db/identities.js';

const MCP_DEVICE_PORT = 8080;
const RESTART_SETTLE_MS = 1500;
const UNLOCK_SETTLE_MS = 4000;
const configureExtras = (id: IdentityRow) => ({ bearer_token: id.mcpToken, bearer_token_enabled: true, device_slug: id.deviceSlug });
const MCP_UP_TRIES = 20;
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Slug e token são lidos na subida do servidor MCP: tools sem o prefixo do slug, ou 401 com o token desta identidade
 * (clone que herdou o token da base; o broadcast já gravou o novo), só se resolvem reiniciando o servidor.
 */
const needsServerRestart = (r: ProbeResult) => !r.ready && (
  (r.signals.mcpInitialize && !r.signals.toolsPresent)
  || (r.signals.bootCompleted && !r.signals.mcpInitialize && r.details.some((d) => /\b401\b|unauthorized/i.test(d))));

async function restartMcpServer(
  id: IdentityRow, adb: Adb, probe: typeof probeIdentity, sleep: (ms: number) => Promise<void>,
): Promise<ProbeResult> {
  // Reenvia slug/token: o broadcast anterior pode ter se perdido (app ainda subindo logo após o desbloqueio).
  await adb.broadcastConfigure(id.serial, configureExtras(id));
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

type ReadyDeps = { adb: Adb; probe?: typeof probeIdentity; sleep?: (ms: number) => Promise<void>; unlock?: (id: IdentityRow) => Promise<unknown> };

/**
 * Destrava com o PIN, refaz forward, aplica slug e token e roda a sonda (reiniciando o servidor MCP se preciso).
 * Não olha o estado nem grava nada: serve a pedidos explícitos da pessoa (login, conferir o login), inclusive em
 * needs-human. Pode lançar (ex.: PIN recusado).
 */
export async function prepareIdentityDevice(id: IdentityRow, deps: ReadyDeps): Promise<ProbeResult> {
  const sleep = deps.sleep ?? defaultSleep;
  const probe = deps.probe ?? probeIdentity;
  // Tela ou armazenamento bloqueados pelo PIN (reboot, restore, tela apagada): destrava com o PIN da identidade antes de tudo.
  const unlocked = await (deps.unlock ?? ((i: IdentityRow) => ensureUnlocked(deps.adb, i.serial, i.lockPin)))(id);
  // Recém-destravado: apps do armazenamento criptografado ainda estão subindo e perderiam o broadcast de configuração.
  if (unlocked === 'unlocked') await sleep(UNLOCK_SETTLE_MS);
  await deps.adb.forward(id.serial, id.mcpHostPort, `tcp:${MCP_DEVICE_PORT}`);
  await deps.adb.broadcastConfigure(id.serial, configureExtras(id));
  const result = await probe(id, { adb: deps.adb });
  return needsServerRestart(result) ? restartMcpServer(id, deps.adb, probe, sleep) : result;
}

/**
 * Garante forward, slug e token, roda a sonda e persiste o estado resultante. Nunca lança.
 * Identidade em needs-human ou banned é recusada sem tocar no device: "nunca retry automático" (spec §6).
 */
export async function ensureIdentityReady(db: DatabaseSync, id: IdentityRow, deps: ReadyDeps): Promise<ProbeResult> {
  if (id.state === 'needs-human' || id.state === 'banned') {
    return { ready: false, signals: ALL_FALSE, details: [`identidade em ${id.state}: exige ação humana antes de qualquer tarefa`], failureClass: 'blocked' };
  }
  try {
    const result = await prepareIdentityDevice(id, deps);
    if (result.ready) setIdentityState(db, id.id, 'idle', { lastError: null });
    else setIdentityState(db, id.id, 'offline', { lastError: result.details.join(' · ') || `sonda falhou (${result.failureClass})` });
    return result;
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    // PIN recusado: nunca tentar de novo sozinho (tentativas erradas bloqueiam o device por tempo) — humano confere o PIN.
    const state = /PIN recusado/.test(msg) ? 'needs-human' : 'offline';
    setIdentityState(db, id.id, state, { lastError: msg.slice(0, 300) });
    return { ready: false, signals: ALL_FALSE, details: [msg], failureClass: 'infra' };
  }
}
