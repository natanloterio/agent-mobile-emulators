// Smoke test do app empacotado (spec lançamento §5): 1) sem setup.json o onboarding aparece;
// 2) com setup.json concluído o daemon sobe pelo binário do Electron e GET /state responde.
// Uso: node scripts/smoke.mjs <executável do app empacotado>
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const exe = process.argv[2];
if (!exe) { console.error('uso: node scripts/smoke.mjs <executável>'); process.exit(2); }
const args = process.platform === 'linux' ? ['--no-sandbox'] : [];
const port = '47899';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch(dataDir) {
  return electron.launch({ executablePath: exe, args, env: { ...process.env, ENXAME_DATA_DIR: dataDir, ENXAME_PORT: port, ELECTRON_ENABLE_LOGGING: '1' }, timeout: 60_000 });
}

/** PID do `daemon.json` do dataDir, se existir. */
async function daemonPid(dataDir) {
  try { return JSON.parse(await readFile(path.join(dataDir, 'daemon.json'), 'utf8')).pid ?? null; } catch { return null; }
}

function killPid(pid) { if (pid) { try { process.kill(pid); } catch { /* já saiu */ } } }

/**
 * Fecha a app com prazo: o daemon empacotado sobrevive à app e, se ainda estiver vivo, herda pipes extras
 * do Playwright (fds sem CLOEXEC) — o `app.close()` nunca resolve enquanto ele estiver de pé. Quem chama
 * já deve ter matado o daemon antes; ainda assim, com limite de 15s, e SIGKILL no processo se não bastar.
 */
async function closeApp(app) {
  const closed = await Promise.race([app.close().then(() => true), sleep(15_000).then(() => false)]);
  if (!closed) { try { app.process().kill('SIGKILL'); } catch { /* já saiu */ } }
}

async function onboardingAppears() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'enxame-smoke-'));
  const app = await launch(dataDir);
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('.onb', { timeout: 60_000 });
    await win.waitForSelector('.onb-dep', { timeout: 120_000 });
    const rows = await win.locator('.onb-dep').count();
    if (rows < 6) throw new Error(`onboarding com ${rows} itens (esperado ≥ 6)`);
    console.log(`[smoke] onboarding ok com ${rows} itens`);
  } finally {
    // Numa máquina onde toda dependência já está ok, o onboarding é pulado e o daemon sobe mesmo assim
    // (o `.onb` acima já teria falhado); mata-lo aqui evita travar o close() e o teste falha limpo.
    killPid(await daemonPid(dataDir));
    await closeApp(app);
    await rm(dataDir, { recursive: true, force: true });
  }
}

async function daemonStarts() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'enxame-smoke-'));
  await writeFile(path.join(dataDir, 'setup.json'), JSON.stringify({ version: 1, completedAt: '2026-01-01T00:00:00.000Z', paths: { sdkRoot: path.join(dataDir, 'sdk'), ollamaBin: null } }));
  const app = await launch(dataDir);
  let pid = null;
  try {
    await app.firstWindow();
    let info = null;
    for (let i = 0; i < 80 && !info; i++) {
      try { info = JSON.parse(await readFile(path.join(dataDir, 'daemon.json'), 'utf8')); } catch { await sleep(250); }
    }
    if (!info) throw new Error('daemon.json não apareceu em 20 s');
    pid = info.pid;
    const r = await fetch(`http://127.0.0.1:${info.port}/state`, { headers: { authorization: `Bearer ${info.token}` } });
    if (r.status !== 200) throw new Error(`GET /state respondeu ${r.status}`);
    console.log('[smoke] daemon ok');
  } finally {
    // Mata o daemon ANTES do close(): vivo, ele herda pipes do Playwright e o close() nunca resolve.
    killPid(pid);
    await closeApp(app);
    await rm(dataDir, { recursive: true, force: true });
  }
}

await onboardingAppears();
await daemonStarts();
console.log('[smoke] tudo ok');
