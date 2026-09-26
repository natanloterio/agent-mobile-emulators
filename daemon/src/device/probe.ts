import type { ToolSet } from 'ai';
import type { IdentityRow } from '../db/identities.js';
import { missingWorkerTools } from '../worker/tools.js';
import { AdbError, type Adb } from './adb.js';
import { connectMcp } from './mcp.js';

export interface ProbeSignals {
  readonly bootCompleted: boolean; readonly accessibility: boolean; readonly mcpInitialize: boolean;
  readonly toolsPresent: boolean; readonly versionMatch: boolean;
}
export interface ProbeResult {
  readonly ready: boolean; readonly signals: ProbeSignals; readonly details: readonly string[];
  readonly failureClass: 'infra' | 'version' | 'blocked' | null;
}
type McpFactory = (url: string, token: string) => Promise<{ tools(): Promise<ToolSet>; close(): Promise<void> }>;

const ACCESSIBILITY_SERVICE = 'services.accessibility.McpAccessibilityService';

async function mcpSignals(id: IdentityRow, mcp: McpFactory): Promise<{ init: boolean; present: boolean; detail: string | null }> {
  try {
    const client = await mcp(`http://127.0.0.1:${id.mcpHostPort}/mcp`, id.mcpToken);
    try {
      const missing = missingWorkerTools(await client.tools(), id.deviceSlug || null);
      return { init: true, present: missing.length === 0, detail: missing.length ? `tools ausentes: ${missing.join(', ')}` : null };
    } finally { await client.close(); }
  } catch (e) {
    return { init: false, present: false, detail: `MCP: ${(e as Error).message}` };
  }
}

export async function probeIdentity(id: IdentityRow, deps: { adb: Adb; mcp?: McpFactory }): Promise<ProbeResult> {
  const mcp = deps.mcp ?? connectMcp;
  const details: string[] = [];
  let infra = false;
  const safe = async <T,>(f: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await f(); } catch (e) { infra = infra || (e instanceof AdbError && e.kind === 'device-missing'); details.push((e as Error).message); return fallback; }
  };
  const boot = (await safe(() => deps.adb.getprop(id.serial, 'sys.boot_completed'), '')) === '1';
  const acc = (await safe(() => deps.adb.settingsGetSecure(id.serial, 'enabled_accessibility_services'), '')).includes(ACCESSIBILITY_SERVICE);
  const version = await safe(() => deps.adb.versionName(id.serial, id.appPackage), null);
  const versionMatch = version === id.appVersionName;
  if (!versionMatch) details.push(`versionName ${version ?? 'desconhecido'} ≠ ${id.appVersionName} registrado`);
  const m = boot ? await mcpSignals(id, mcp) : { init: false, present: false, detail: 'boot incompleto' };
  if (m.detail) details.push(m.detail);
  const signals: ProbeSignals = { bootCompleted: boot, accessibility: acc, mcpInitialize: m.init, toolsPresent: m.present, versionMatch };
  const ready = Object.values(signals).every(Boolean);
  const failureClass = ready ? null : infra || !boot || !m.init ? 'infra' : !versionMatch ? 'version' : 'infra';
  return { ready, signals, details, failureClass };
}
