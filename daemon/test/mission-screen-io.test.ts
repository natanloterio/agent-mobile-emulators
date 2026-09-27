import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { upsertIdentity } from '../src/db/identities.js';
import type { ProbeResult } from '../src/device/probe.js';
import { readScreenOnce } from '../src/mission/screen-io.js';

const row = { id: 'conta2', name: 'conta2', handle: 'sem conta', avdName: 'x', serial: 's', consolePort: 5556, mcpHostPort: 8081, mcpToken: 't', deviceSlug: 'conta2', appPackage: 'com.instagram.android', appVersionName: '1', state: 'idle' as const };
const OK = { bootCompleted: true, accessibility: true, mcpInitialize: true, toolsPresent: true, versionMatch: false };
const TEXT = 'screen:1080x2400 density:420 orientation:portrait\n--- window:1 type:APPLICATION pkg:com.android.chrome title:x layer:0 focused:true ---\nnode_id\tclass\ttext\tdesc\tres_id\tbounds\tflags\nnode_1\tTextView\tOi\t-\t-\t0,0,10,10\ton,ena\n';

describe('readScreenOnce', () => {
  it('lê a tela pelo MCP (versão do app não importa) e fecha a conexão', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row); let closed = false;
    const s = await readScreenOnce(db, row, {
      ensureReady: async () => ({ ready: false, signals: OK, details: [], failureClass: 'version' }) as ProbeResult,
      connect: async () => ({ tools: async () => ({ android_conta2_get_screen_state: { execute: async () => TEXT } }), close: async () => { closed = true; } }),
    });
    expect(s.windows[0].pkg).toBe('com.android.chrome'); expect(closed).toBe(true);
  });
  it('MCP fora → lança com o detalhe da sonda', async () => {
    const db = openDb(':memory:'); upsertIdentity(db, row);
    await expect(readScreenOnce(db, row, { ensureReady: async () => ({ ready: false, signals: { ...OK, mcpInitialize: false }, details: ['MCP: recusado'], failureClass: 'infra' }) as ProbeResult })).rejects.toThrow(/MCP: recusado/);
  });
});
