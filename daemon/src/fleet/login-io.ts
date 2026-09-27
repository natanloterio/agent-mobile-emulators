import type { DatabaseSync } from 'node:sqlite';
import type { IdentityRow } from '../db/identities.js';
import { connectMcp } from '../device/mcp.js';
import type { ProbeResult } from '../device/probe.js';
import { parseScreen } from '../screen/parse.js';
import { textOf } from '../worker/record.js';
import { toolPrefix } from '../worker/tools.js';
import { runLogin, type Credentials, type LoginIo, type LoginResult } from './login.js';

type Exec = { execute?: (input: unknown, opts: unknown) => Promise<unknown> };
type Connect = (url: string, token: string) => Promise<{ tools(): Promise<Record<string, unknown>>; close(): Promise<void> }>;

export interface LoginDeps {
  /** Forward, token, PIN e MCP de pé (fleet/identity.ts `ensureIdentityReady`). */
  readonly ensureReady: (db: DatabaseSync, identity: IdentityRow) => Promise<ProbeResult>;
  readonly connect?: Connect;
}

const isError = (out: unknown) => !!out && typeof out === 'object' && (out as { isError?: boolean }).isError === true;

/** Login da identidade pelas ferramentas do MCP dela; nenhum passo passa pelo LLM nem vira `step` no banco. */
export async function loginIdentity(db: DatabaseSync, identity: IdentityRow, creds: Credentials, deps: LoginDeps): Promise<LoginResult> {
  const probe = await deps.ensureReady(db, identity);
  if (!probe.signals.mcpInitialize || !probe.signals.toolsPresent) throw new Error(`device não pronto para o login: ${probe.details.join(' · ') || probe.failureClass}`);
  const client = await (deps.connect ?? (connectMcp as unknown as Connect))(`http://127.0.0.1:${identity.mcpHostPort}/mcp`, identity.mcpToken);
  try {
    const tools = await client.tools(); const prefix = toolPrefix(identity.deviceSlug || null); let n = 0;
    const call = async (name: string, input: Record<string, unknown>) => {
      const t = tools[prefix + name] as Exec | undefined;
      if (!t?.execute) throw new Error(`ferramenta ${prefix + name} ausente no MCP`);
      const out = await t.execute(input, { toolCallId: `login-${++n}`, messages: [] });
      // Erro do MCP nunca repete o texto digitado (o servidor loga só o tamanho); mesmo assim só o nome da ferramenta sai daqui.
      if (isError(out)) throw new Error(`${name} falhou no device`);
      return out;
    };
    const io: LoginIo = {
      unlock: async () => undefined, // ensureReady já destravou com o PIN
      openApp: async (pkg) => { await call('open_app', { package_id: pkg }); },
      screen: async () => parseScreen(textOf(await call('get_screen_state', { include_screenshot: false }))),
      tap: async (id) => { await call('tap_node', { node_id: id }); },
      clear: async (id) => { await call('type_clear_text', { node_id: id }); },
      type: async (id, text) => { await call('type_append_text', { node_id: id, text }); },
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    };
    return await runLogin(io, creds);
  } finally { await client.close().catch(() => undefined); }
}
