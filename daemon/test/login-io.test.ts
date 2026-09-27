import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import type { IdentityRow } from '../src/db/identities.js';
import type { ProbeResult } from '../src/device/probe.js';
import { loginIdentity } from '../src/fleet/login-io.js';

const id: IdentityRow = { id: 'conta2', name: 'conta2', handle: 'sem conta', avdName: 'a', serial: 'emulator-5556', consolePort: 5556, mcpHostPort: 8081, mcpToken: 't', deviceSlug: 'conta2', appPackage: 'com.instagram.android', appVersionName: 'v', state: 'provisioned' };
const READY: ProbeResult = { ready: true, signals: { bootCompleted: true, accessibility: true, mcpInitialize: true, toolsPresent: true, versionMatch: true }, details: [], failureClass: null };
const FEED = 'screen:1080x2400 density:420 orientation:portrait\n--- window:1 type:APPLICATION pkg:com.instagram.android title:Instagram layer:0 focused:true ---\nnode_id\tclass\ttext\tdesc\tres_id\tbounds\tflags\nnode_h\tButton\t-\tHome\t-\t0,0,10,10\ton,clk,ena\n';

describe('loginIdentity', () => {
  it('usa as ferramentas com o prefixo da identidade e fecha o cliente', async () => {
    const called: string[] = []; let closed = false;
    const tool = (name: string, out: unknown) => ({ execute: async () => { called.push(name); return out; } });
    const connect = async () => ({
      tools: async () => ({ android_conta2_open_app: tool('open_app', { content: [] }), android_conta2_get_screen_state: tool('get_screen_state', { content: [{ type: 'text', text: FEED }] }) }),
      close: async () => { closed = true; },
    });
    const r = await loginIdentity(openDb(':memory:'), id, { username: 'u', password: 'p' }, { ensureReady: async () => READY, connect });
    expect(r.outcome).toBe('already-logged-in');
    expect(called).toEqual(['open_app', 'get_screen_state']); expect(closed).toBe(true);
  });
  it('device sem MCP pronto: erro sem tocar no app; erro de ferramenta não carrega o texto', async () => {
    await expect(loginIdentity(openDb(':memory:'), id, { username: 'u', password: 'p' }, { ensureReady: async () => ({ ...READY, ready: false, signals: { ...READY.signals, mcpInitialize: false }, details: ['MCP: 401'] }) })).rejects.toThrow(/não pronto/);
    const connect = async () => ({ tools: async () => ({ android_conta2_open_app: { execute: async () => ({ isError: true, content: [{ type: 'text', text: 'erro com segredo-123' }] }) } }), close: async () => {} });
    await expect(loginIdentity(openDb(':memory:'), id, { username: 'u', password: 'segredo-123' }, { ensureReady: async () => READY, connect })).rejects.toThrow(/^open_app falhou no device$/);
  });
});
