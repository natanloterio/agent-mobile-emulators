import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { BRAND } from '../brand.js';
import { CONFIG, currentBaseAvd } from '../config.js';
import { BASE_IDENTITY_ID, getIdentity, upsertIdentity, type IdentityRow } from '../db/identities.js';
import { getMission } from '../db/missions.js';
import type { Adb } from '../device/adb.js';
import { probeIdentity } from '../device/probe.js';
import { bootEmulator, killEmulator, type EmulatorSupervisor } from '../fleet/emulator.js';
import { leasePorts } from '../fleet/ports.js';
import type { MissionRunner } from '../mission/runner.js';
import type { Vault } from '../vault/vault.js';
import { freezeTargetApp, googleAccountOnDevice, packageInstalled, setupMcpApp } from './device-setup.js';
import { baseMissionText, googleAccountEmail, seedGoogleMemory } from './google-account.js';
import { removeGoogleAccount } from './google-remove.js';
import { ensureMcpApk, MCP_APK } from './mcp-apk.js';
import { createBasePreparer } from './prepare.js';
import { avdmanagerPath, avdmanagerSpawn, createAvdCommand, jreHome, systemImageId } from './sdk-tools.js';

const MCP_DEVICE_PORT = 8080;
const MCP_UP_TRIES = 30;
const EMULATOR_EXIT_WAIT_MS = 60_000;

/** `avdmanager create avd` com o JRE do onboarding e o SDK do setup.json; a saída entra no erro quando falha. */
async function runAvdmanager(name: string): Promise<void> {
  const cmd = createAvdCommand(name, systemImageId(process.platform, process.arch));
  const java = jreHome(CONFIG.dataDir, process.platform, existsSync);
  // Pasta ausente (máquina sem Android Studio): o avdmanager ignora ANDROID_AVD_HOME e grava no user.home do Java,
  // que pode não ser a pasta onde o emulador e o daemon procuram.
  mkdirSync(CONFIG.avd.home, { recursive: true });
  const env = {
    ...process.env, ANDROID_HOME: CONFIG.sdkRoot, ANDROID_SDK_ROOT: CONFIG.sdkRoot, ANDROID_AVD_HOME: CONFIG.avd.home,
    ANDROID_USER_HOME: path.dirname(CONFIG.avd.home),
    ...(java ? { JAVA_HOME: java, PATH: `${path.join(java, 'bin')}${path.delimiter}${process.env.PATH ?? ''}` } : {}),
  };
  await new Promise<void>((resolve, reject) => {
    const how = avdmanagerSpawn(avdmanagerPath(CONFIG.sdkRoot, process.platform), cmd.args, process.platform);
    const child = spawn(how.file, [...how.args], { env, windowsHide: true, windowsVerbatimArguments: how.verbatim });
    let out = '';
    child.stdout.on('data', (b: Buffer) => { out += b.toString(); });
    child.stderr.on('data', (b: Buffer) => { out += b.toString(); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`avdmanager falhou (${code}): ${out.trim().slice(-300)}`))));
    child.stdin.end(cmd.stdin);
  });
  if (!existsSync(path.join(CONFIG.avd.home, `${name}.ini`))) throw new Error(`avdmanager terminou, mas ${name} não apareceu em ${CONFIG.avd.home}`);
}

export interface BaseWireDeps {
  readonly db: DatabaseSync; readonly adb: Adb; readonly supervisor: EmulatorSupervisor;
  readonly missions: MissionRunner; readonly vault: Vault; readonly onChange: () => void;
  readonly lang: () => string;
}

/** Preparador com as dependências reais (daemon/src/index.ts). */
export function wireBasePreparer(w: BaseWireDeps) {
  const pkg = CONFIG.targetApp.package;
  const baseIdentity = async (): Promise<IdentityRow> => {
    const name = currentBaseAvd().name;
    const existing = getIdentity(w.db, BASE_IDENTITY_ID);
    if (existing && existing.avdName === name) return existing;
    // Identidade de verdade chamada "base" (provisionada antes do nome ficar reservado): nunca é sobrescrita.
    if (existing && existing.avdName === `${BRAND}_${BASE_IDENTITY_ID}`) {
      throw new Error(`já existe uma identidade sua chamada ${BASE_IDENTITY_ID}; descarte-a em Identidades para preparar o celular-base`);
    }
    const ports = existing ?? await leasePorts(w.db);
    upsertIdentity(w.db, {
      id: BASE_IDENTITY_ID, name: BASE_IDENTITY_ID, handle: '', avdName: name, serial: `emulator-${ports.consolePort}`,
      consolePort: ports.consolePort, mcpHostPort: ports.mcpHostPort, mcpToken: existing?.mcpToken ?? randomUUID(),
      deviceSlug: BASE_IDENTITY_ID, appPackage: pkg, appVersionName: '', state: 'provisioned',
    });
    return getIdentity(w.db, BASE_IDENTITY_ID)!;
  };
  const setupMcp = async (id: IdentityRow, onProgress: (pct: number) => void) => {
    await setupMcpApp(w.adb, id.serial, {
      pkg: CONFIG.mcpAppPackage,
      apk: () => ensureMcpApk(path.join(CONFIG.dataDir, 'cache'), {
        fetch: (url, init) => fetch(url, init) as never, onProgress,
      }, MCP_APK),
    });
    // Servidor MCP de pé com o token e o slug da base: a missão lê a tela por ele.
    await w.adb.forward(id.serial, id.mcpHostPort, `tcp:${MCP_DEVICE_PORT}`);
    await w.adb.broadcastConfigure(id.serial, { bearer_token: id.mcpToken, bearer_token_enabled: true, device_slug: id.deviceSlug });
    await w.adb.startTrampoline(id.serial, 'start');
    for (let i = 0; i < MCP_UP_TRIES; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const probe = await probeIdentity(id, { adb: w.adb });
      if (probe.signals.mcpInitialize && probe.signals.toolsPresent) return;
    }
    throw new Error('o servidor MCP do celular-base não respondeu');
  };
  return createBasePreparer({
    db: w.db, onChange: w.onChange,
    baseExists: () => currentBaseAvd().found,
    createAvd: () => runAvdmanager(currentBaseAvd().name),
    baseIdentity,
    // Com janela: se o Google pedir uma verificação, a pessoa resolve direto no celular.
    boot: async (id) => {
      // Chave do adb diferente da que o emulador conhece: o Android pede "Permitir depuração USB?" e o boot nunca é
      // visto. Observado durante a espera, porque no timeout o emulador é derrubado e o estado some do `adb devices`.
      let unauthorized = false;
      const watch = setInterval(() => {
        void w.adb.deviceState(id.serial).then((st) => { if (st === 'unauthorized') unauthorized = true; }, () => undefined);
      }, 5000);
      try { return await bootEmulator(w.db, id, { window: true }, { adb: w.adb, supervisor: w.supervisor }); } catch (e) {
        if (unauthorized) throw new Error('o celular-base recusou o adb (pedido de "Permitir depuração USB"); aceite na janela do emulador e tente de novo');
        throw e;
      } finally { clearInterval(watch); }
    },
    setupMcp,
    targetVersion: async (id) => ((await packageInstalled(w.adb, id.serial, pkg)) ? w.adb.versionName(id.serial, pkg) : null),
    googleEmail: () => googleAccountEmail(w.vault),
    googleOnDevice: (id) => googleAccountOnDevice(w.adb, id.serial),
    startMission: (id, email) => w.missions.start(id.id, baseMissionText(w.lang(), pkg), w.lang(), (missionId) => seedGoogleMemory(w.db, missionId, email)),
    mission: (missionId) => getMission(w.db, missionId),
    // Já encerrada (o humano abandonou, ou terminou no mesmo instante): nada a fazer.
    endMission: (missionId) => { try { w.missions.abandon(missionId); } catch { /* já fechada */ } },
    removeGoogle: async (id) => removeGoogleAccount(w.adb, id.serial, await googleAccountEmail(w.vault)),
    finish: async (id) => {
      await freezeTargetApp(w.adb, id.serial);
      await killEmulator(w.adb, id.serial);
      // O serial sai do adb antes de o qemu terminar de gravar disco e snapshot; liberar o clone antes disso copiaria
      // imagens pela metade. Espera o processo que o supervisor subiu acabar de fato.
      for (let waited = 0; w.supervisor.has(id.id) && waited < EMULATOR_EXIT_WAIT_MS; waited += 500) await new Promise((r) => setTimeout(r, 500));
      if (w.supervisor.has(id.id)) { w.supervisor.stop(id.id); throw new Error('o emulador do celular-base não fechou; tente de novo'); }
    },
  });
}
