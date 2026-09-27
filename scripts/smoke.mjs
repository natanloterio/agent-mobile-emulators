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

/**
 * `rm` que nunca lança: no Windows um handle pode ser liberado só um pouco depois do processo terminar
 * (TerminateProcess, antivírus com o arquivo aberto) — `EBUSY`/`EPERM` transitórios, por isso `maxRetries`.
 * Limpeza é best-effort e não pode mascarar o resultado real do teste (nem transformar um passe em falha).
 */
async function safeRm(dir) {
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    .catch((e) => console.warn('[smoke] limpeza:', e.message));
}

/**
 * Isola da máquina: sem isto, o onboarding depende do que já está instalado onde quem roda o teste mora
 * (SDK/AVDs/modelos do Ollama) — nesta máquina, e em runners do GitHub para macOS/Windows, o SDK e o JDK já
 * vêm prontos, e o onboarding é pulado (nenhuma etapa do `.onb` aparece). `ANDROID_HOME`/`ANDROID_SDK_ROOT`
 * apontando pra um dir novo e vazio faz `sdkmanager` "não existir", o que garante que o onboarding sempre
 * apareça em `onboardingAppears`. `daemonStarts` já grava um setup.json concluído, então não é afetado por
 * nada disto (decideStartup nem chega a probar).
 */
async function launch(dataDir) {
  const androidHome = await mkdtemp(path.join(os.tmpdir(), 'enxame-smoke-sdk-'));
  const avdHome = await mkdtemp(path.join(os.tmpdir(), 'enxame-smoke-avd-'));
  const ollamaModels = await mkdtemp(path.join(os.tmpdir(), 'enxame-smoke-ollama-'));
  const cleanup = () => Promise.all([androidHome, avdHome, ollamaModels].map(safeRm));
  try {
    const app = await electron.launch({
      executablePath: exe,
      args,
      env: {
        ...process.env,
        ENXAME_DATA_DIR: dataDir,
        ENXAME_PORT: port,
        ELECTRON_ENABLE_LOGGING: '1',
        ANDROID_HOME: androidHome,
        ANDROID_SDK_ROOT: androidHome,
        ANDROID_AVD_HOME: avdHome,
        OLLAMA_MODELS: ollamaModels,
      },
      timeout: 60_000,
    });
    return { app, cleanup };
  } catch (e) {
    // Se o launch falhar (ex.: executável inexistente) os três dirs acima ficariam órfãos.
    await cleanup();
    throw e;
  }
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
 * O timer do prazo é limpo (e marcado `unref`) pra não manter o event loop vivo à toa quando o close()
 * ganha a corrida.
 */
async function closeApp(app) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), 15_000);
    timer.unref?.();
  });
  const closed = await Promise.race([app.close().then(() => true), timeout]);
  clearTimeout(timer);
  if (!closed) { try { app.process().kill('SIGKILL'); } catch { /* já saiu */ } }
}

async function onboardingAppears() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'enxame-smoke-'));
  let app;
  let cleanup;
  try {
    ({ app, cleanup } = await launch(dataDir));
    const win = await app.firstWindow();
    await win.waitForSelector('.onb', { timeout: 60_000 });
    await win.waitForSelector('.onb-dep', { timeout: 120_000 });
    const rows = await win.locator('.onb-dep').count();
    if (rows < 6) throw new Error(`onboarding com ${rows} itens (esperado ≥ 6)`);
    console.log(`[smoke] onboarding ok com ${rows} itens`);
    // Imagem certa para o runner: arm64-v8a só no Apple Silicon (spec lançamento §5).
    const abi = process.platform === 'darwin' && process.arch === 'arm64' ? 'arm64-v8a' : 'x86_64';
    const img = (await win.locator('[data-dep="img"]').first().textContent({ timeout: 10_000 })) ?? '';
    if (!img.includes(abi)) throw new Error(`linha da imagem sem ${abi}: "${img.trim()}"`);
    console.log(`[smoke] image-abi ok (${abi})`);
    if ((await win.locator('[data-dep="kvm"]').count()) !== 1) throw new Error('linha de aceleração (kvm) ausente');
    console.log('[smoke] kvm ok');
  } finally {
    if (app) {
      // Numa máquina onde toda dependência já está ok, o onboarding é pulado e o daemon sobe mesmo assim
      // (o `.onb` acima já teria falhado); mata-lo aqui evita travar o close() e o teste falha limpo.
      killPid(await daemonPid(dataDir));
      await closeApp(app);
    }
    if (cleanup) await cleanup();
    await safeRm(dataDir);
  }
}

async function daemonStarts() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'enxame-smoke-'));
  await writeFile(path.join(dataDir, 'setup.json'), JSON.stringify({ version: 1, completedAt: '2026-01-01T00:00:00.000Z', paths: { sdkRoot: path.join(dataDir, 'sdk'), ollamaBin: null } }));
  let app;
  let cleanup;
  let pid = null;
  try {
    ({ app, cleanup } = await launch(dataDir));
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
    if (app) {
      // Mata o daemon ANTES do close(): vivo, ele herda pipes do Playwright e o close() nunca resolve.
      killPid(pid);
      await closeApp(app);
    }
    if (cleanup) await cleanup();
    await safeRm(dataDir);
  }
}

try {
  await onboardingAppears();
  await daemonStarts();
  console.log('[smoke] tudo ok');
  process.exit(0);
} catch (e) {
  console.error(`[smoke] FALHOU: ${e.message}`);
  process.exit(1);
}
