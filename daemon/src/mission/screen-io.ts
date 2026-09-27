import type { DatabaseSync } from 'node:sqlite';
import type { IdentityRow } from '../db/identities.js';
import { connectMcp } from '../device/mcp.js';
import type { ProbeResult } from '../device/probe.js';
import { parseScreen, type ScreenState } from '../screen/parse.js';
import { textOf } from '../worker/record.js';
import { toolPrefix } from '../worker/tools.js';

type Exec = { execute?: (input: unknown, opts: unknown) => Promise<unknown> };
type Connect = (url: string, token: string) => Promise<{ tools(): Promise<Record<string, unknown>>; close(): Promise<void> }>;

/**
 * Uma leitura de tela para o planejador (spec missões §O loop). Destrava e sonda antes; a versão do app não conta
 * (a missão pode instalar ou atualizar apps). Lança quando o MCP não responde.
 */
export async function readScreenOnce(db: DatabaseSync, identity: IdentityRow, deps: { ensureReady: (db: DatabaseSync, i: IdentityRow) => Promise<ProbeResult>; connect?: Connect }): Promise<ScreenState> {
  const probe = await deps.ensureReady(db, identity);
  if (!probe.signals.mcpInitialize || !probe.signals.toolsPresent) throw new Error(probe.details.join(' · ') || `sonda falhou (${probe.failureClass ?? 'infra'})`);
  const client = await (deps.connect ?? (connectMcp as unknown as Connect))(`http://127.0.0.1:${identity.mcpHostPort}/mcp`, identity.mcpToken);
  try {
    const t = (await client.tools())[`${toolPrefix(identity.deviceSlug || null)}get_screen_state`] as Exec | undefined;
    if (!t?.execute) throw new Error('get_screen_state ausente no MCP');
    return parseScreen(textOf(await t.execute({ include_screenshot: false }, { toolCallId: 'mission-screen', messages: [] })));
  } finally { await client.close().catch(() => undefined); }
}
