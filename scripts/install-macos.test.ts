import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./install-macos.sh', import.meta.url));

// Trecho real de GET /repos/natanloterio/agent-mobile-emulators/releases?per_page=1 (v0.1.0).
const RELEASES_JSON = `[
  {
    "tag_name": "v0.1.0",
    "name": "Enxame 0.1.0 (pré-lançamento)",
    "assets": [
      {
        "name": "Enxame-0.1.0-arm64.dmg",
        "digest": "sha256:31e1ee1f4417bec7882f0ba8d7783ce24bc329e0c6680e627a4bc1d68cb64208",
        "browser_download_url": "https://github.com/natanloterio/agent-mobile-emulators/releases/download/v0.1.0/Enxame-0.1.0-arm64.dmg"
      },
      {
        "name": "Enxame-0.1.0.dmg",
        "digest": "sha256:7f586bb74015391a8d1f22610933035f40fe01f19006d0f74394203c989e708d",
        "browser_download_url": "https://github.com/natanloterio/agent-mobile-emulators/releases/download/v0.1.0/Enxame-0.1.0.dmg"
      },
      {
        "name": "Enxame.Setup.0.1.0.exe",
        "browser_download_url": "https://github.com/natanloterio/agent-mobile-emulators/releases/download/v0.1.0/Enxame.Setup.0.1.0.exe"
      }
    ]
  }
]`;

// Carrega as funções do script sem rodar main e executa `body` num bash.
function run(body: string, stdin = '') {
  const result = spawnSync('bash', ['-c', `source "$0"; ${body}`, SCRIPT], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, TAPFLOCK_INSTALL_SOURCED: '1' },
  });
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

// O CI de Windows também roda `npm test`, e lá `bash` não é garantido.
describe.skipIf(process.platform === 'win32')('install-macos.sh', () => {
  it('monta o nome do DMG de cada arquitetura como o electron-builder gera', () => {
    expect(run('asset_name 0.2.0 arm64').stdout).toBe('Tapflock-0.2.0-arm64.dmg');
    expect(run('asset_name 0.2.0 x86_64').stdout).toBe('Tapflock-0.2.0.dmg');
    expect(run('asset_name 0.1.0 arm64 Enxame').stdout).toBe('Enxame-0.1.0-arm64.dmg');
    expect(run('asset_name 0.1.0 ppc').status).not.toBe(0);
  });

  it('acha o app no DMG montado, com o nome atual ou o de antes da troca', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'tapflock-install-test-'));
    try {
      expect(run(`app_in "${dir}"`).status).not.toBe(0);
      mkdirSync(path.join(dir, 'Enxame.app'));
      expect(run(`app_in "${dir}"`).stdout).toBe('Enxame.app');
      mkdirSync(path.join(dir, 'Tapflock.app'));
      expect(run(`app_in "${dir}"`).stdout).toBe('Tapflock.app');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('aceita a versão com ou sem v e recusa lixo', () => {
    expect(run('normalize_version v0.1.0').stdout).toBe('0.1.0');
    expect(run('normalize_version 1.2.3-beta.1').stdout).toBe('1.2.3-beta.1');
    const bad = run('normalize_version "0.1; rm -rf ~"');
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain('versão inválida');
  });

  it('lê a tag da release mais recente', () => {
    expect(run('release_tag', RELEASES_JSON).stdout).toBe('v0.1.0');
    expect(run('release_tag', '[]').stdout).toBe('');
  });

  it('pega o SHA-256 do asset pelo nome exato', () => {
    expect(run('asset_digest Enxame-0.1.0.dmg', RELEASES_JSON).stdout).toBe(
      '7f586bb74015391a8d1f22610933035f40fe01f19006d0f74394203c989e708d',
    );
    expect(run('asset_digest Enxame-0.1.0-arm64.dmg', RELEASES_JSON).stdout).toBe(
      '31e1ee1f4417bec7882f0ba8d7783ce24bc329e0c6680e627a4bc1d68cb64208',
    );
  });

  it('falha quando o asset não existe ou não tem SHA-256', () => {
    expect(run('asset_digest Enxame-9.9.9.dmg', RELEASES_JSON).status).not.toBe(0);
    // Sem digest, não pode herdar o do asset seguinte.
    expect(run('asset_digest Enxame.Setup.0.1.0.exe', RELEASES_JSON).status).not.toBe(0);
  });

  it.skipIf(process.platform === 'darwin')('recusa rodar fora do macOS', () => {
    const result = spawnSync('bash', [SCRIPT, '--no-open'], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('só roda no macOS');
  });

  it('recusa opção desconhecida', () => {
    const result = spawnSync('bash', [SCRIPT, '--nope'], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('opção desconhecida');
  });
});
