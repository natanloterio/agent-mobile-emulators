import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../../src/config.js';
import { createAdb } from '../../src/device/adb.js';
import { openDb } from '../../src/db/open.js';
import { getIdentity } from '../../src/db/identities.js';
import { daemonAlive } from '../../src/fleet/lock.js';
import { ensureIdentityReady } from '../../src/fleet/identity.js';
import { readProviderConfig, updateProvider } from '../../src/provider/config.js';
import { createOllamaSupervisor, type ChildLike } from '../../src/provider/ollama.js';
import { testProvider } from '../../src/provider/probe.js';

const on = !!process.env.ENXAME_INTEGRATION;
const reason = !on ? 'ENXAME_INTEGRATION não definido' : daemonAlive(CONFIG.daemonInfoPath) ? 'daemon vivo disputa device e Ollama' : null;

// O supervisor recusa spawn sob vitest sem injeção (guarda dos testes unitários); aqui o spawn real é explícito.
const realSpawn = (cmd: string, args: readonly string[], opts: { env: NodeJS.ProcessEnv; stdio: unknown }): ChildLike =>
  spawn(cmd, args, { env: opts.env, stdio: opts.stdio as never, detached: false }) as unknown as ChildLike;

const ownProcesses = () => readdirSync('/proc').filter((d) => /^\d+$/.test(d)).filter((p) => {
  try { return /ollama\0serve/.test(readFileSync(`/proc/${p}/cmdline`, 'utf8')) && readFileSync(`/proc/${p}/environ`, 'utf8').includes('OLLAMA_CONTEXT_LENGTH=32768'); } catch { return false; }
});

describe.skipIf(!!reason)(`Ollama real (ENXAME_INTEGRATION=1)${reason ? ` — pulado: ${reason}` : ''}`, () => {
  it('ensure → running e nosso; testProvider(worker) real → args válidos sem aviso; stop() limpa', async () => {
    const db = openDb(CONFIG.dbPath); const adb = createAdb(); const sup = createOllamaSupervisor({ spawn: realSpawn });
    const id = getIdentity(db, 'conta1'); expect(id).toBeTruthy();
    const probe = await ensureIdentityReady(db, id!, { adb }); expect(probe.ready, probe.details.join('; ')).toBe(true);
    const before = readProviderConfig(db).worker;
    try {
      updateProvider(db, 'worker', { mode: 'local', model: 'gpt-oss:20b', endpoint: 'http://127.0.0.1:11434/v1' });
      const st = await sup.ensure('http://127.0.0.1:11434/v1', 'gpt-oss:20b');
      expect(st.running).toBe(true); expect(st.spawnedByUs || st.adopted).toBe(true);
      const t = await testProvider(db, readProviderConfig(db).worker, getIdentity(db, 'conta1')!, { anthropicApiKey: process.env.ANTHROPIC_API_KEY }, { ollama: sup });
      expect(t).toMatchObject({ argsValid: true, warning: null, error: null });
      sup.stop(); await new Promise((r) => setTimeout(r, 1500));
      expect(ownProcesses()).toEqual([]);
    } finally { updateProvider(db, 'worker', { mode: before.mode, model: before.model, endpoint: before.endpoint === 'anthropic' ? undefined : before.endpoint }); }
  }, 180_000);
});
