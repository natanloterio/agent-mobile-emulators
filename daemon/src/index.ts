import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { CONFIG, loadEnv } from './config.js';
import { createAdb } from './device/adb.js';
import { openDb } from './db/open.js';
import { getIdentity, upsertIdentity } from './db/identities.js';
import { ensureIdentityReady } from './fleet/identity.js';
import { startServer } from './server/api.js';
import { runTask } from './worker/run.js';

const env = loadEnv();
mkdirSync(CONFIG.dataDir, { recursive: true });
const db = openDb(CONFIG.dbPath);
const adb = createAdb();

// Identidade 0: o emulador já provisionado. Token vem do arquivo salvo na sessão de setup ou é gerado agora.
const tokenFile = '/tmp/claude-1000/-media-loterio-workspace-workspace-pitaia-research/mcp-token.txt';
const existing = getIdentity(db, 'conta1');
const mcpToken = existing?.mcpToken ?? (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : randomUUID());
upsertIdentity(db, {
  id: 'conta1', name: 'conta1', handle: '@p1t41a.meta.test', avdName: 'mcp_test_playstore', serial: 'emulator-5554',
  consolePort: 5554, mcpHostPort: 8080, mcpToken, deviceSlug: 'conta1',
  appPackage: CONFIG.targetApp.package, appVersionName: CONFIG.targetApp.versionName, state: existing?.state ?? 'logged-in',
});

const daemonToken = randomUUID();
let killed = false;
const server = await startServer({
  db, token: daemonToken,
  onKill: () => { killed = true; server.broadcast(); },
  onGoal: async (text) => {
    killed = false;
    const id = getIdentity(db, 'conta1'); if (!id) return;
    const probe = await ensureIdentityReady(db, id, { adb }); server.broadcast();
    if (!probe.ready) return;
    await runTask({ db, identity: getIdentity(db, 'conta1')!, goalText: text, apiKey: env.anthropicApiKey, isKilled: () => killed, onStep: () => server.broadcast() });
    server.broadcast();
  },
});
writeFileSync(CONFIG.daemonInfoPath, JSON.stringify({ port: server.port, token: daemonToken, pid: process.pid }));
console.log(`[enxame-daemon] http://127.0.0.1:${server.port} · info em ${CONFIG.daemonInfoPath}`);
