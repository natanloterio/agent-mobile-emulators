import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cloneAvd, deleteAvd, isValidAvdName } from '../src/fleet/avd.js';
import { parseIni, serializeIni, setIniKeys } from '../src/fleet/ini.js';

describe('ini puro', () => {
  const text = 'avd.ini.encoding=UTF-8\n# comentário\nAvdId=base\nhw.ramSize=2G\navd.ini.displayname=Base X \n';
  it('parse/serialize é identidade (ordem, comentários, espaços)', () => {
    expect(serializeIni(parseIni(text))).toBe(text);
    expect(parseIni(text).filter((l) => l.key).map((l) => l.key)).toEqual(['avd.ini.encoding', 'AvdId', 'hw.ramSize', 'avd.ini.displayname']);
  });
  it('setIniKeys troca no lugar, acrescenta ausentes no fim e não muta a entrada', () => {
    const lines = parseIni(text);
    const out = setIniKeys(text, { AvdId: 'novo', 'avd.ini.displayname': 'novo', 'x.y': '1' });
    expect(out).toBe('avd.ini.encoding=UTF-8\n# comentário\nAvdId=novo\nhw.ramSize=2G\navd.ini.displayname=novo\nx.y=1\n');
    expect(serializeIni(lines)).toBe(text);
  });
  it('texto sem \\n final: acrescenta com separador correto', () => {
    expect(setIniKeys('a=1', { b: '2' })).toBe('a=1\nb=2\n');
    expect(setIniKeys('a=1', { a: '3' })).toBe('a=3');
  });
});

describe('cloneAvd/deleteAvd em diretório temporário', () => {
  let home = '';
  afterEach(() => { if (home) rmSync(home, { recursive: true, force: true }); home = ''; });
  function fakeBase() {
    home = mkdtempSync(path.join(os.tmpdir(), 'enxame-avd-'));
    const dir = path.join(home, 'base.avd');
    mkdirSync(path.join(dir, 'snapshots', 'default_boot'), { recursive: true });
    mkdirSync(path.join(dir, 'data', 'misc'), { recursive: true });
    writeFileSync(path.join(dir, 'config.ini'), 'PlayStore.enabled=no\navd.id=<build>\nhw.ramSize=2G\n');
    writeFileSync(path.join(dir, 'userdata-qemu.img.qcow2'), 'QFI userdata-qemu.img');
    writeFileSync(path.join(dir, 'data', 'misc', 'x'), 'dado');
    writeFileSync(path.join(dir, 'snapshots', 'default_boot', 'ram.img'), 'ram');
    for (const f of ['multiinstance.lock', 'hardware-qemu.ini.lock', 'hardware-qemu.ini', 'emu-launch-params.txt']) writeFileSync(path.join(dir, f), 'x');
    writeFileSync(path.join(home, 'base.ini'), `avd.ini.encoding=UTF-8\npath=${dir}\npath.rel=avd/base.avd\ntarget=android-34\n`);
    return dir;
  }

  it('nome válido: [A-Za-z0-9_]{1,40}', () => {
    expect(isValidAvdName('enxame_conta2')).toBe(true);
    for (const bad of ['', 'a b', '../x', 'a'.repeat(41), 'x.avd']) expect(isValidAvdName(bad)).toBe(false);
  });

  it('clona: copia dados, pula locks/snapshots/estado de execução, reescreve .ini e config.ini', async () => {
    fakeBase();
    const r = await cloneAvd('base', 'novo_1', { home });
    const dir = path.join(home, 'novo_1.avd');
    expect(r).toEqual({ avdDir: dir, iniPath: path.join(home, 'novo_1.ini') });
    expect(readFileSync(path.join(dir, 'data', 'misc', 'x'), 'utf8')).toBe('dado');
    expect(existsSync(path.join(dir, 'userdata-qemu.img.qcow2'))).toBe(true);
    for (const f of ['snapshots', 'multiinstance.lock', 'hardware-qemu.ini.lock', 'hardware-qemu.ini', 'emu-launch-params.txt']) expect(existsSync(path.join(dir, f))).toBe(false);
    expect(readFileSync(path.join(home, 'novo_1.ini'), 'utf8')).toBe(`avd.ini.encoding=UTF-8\npath=${dir}\npath.rel=avd/novo_1.avd\ntarget=android-34\n`);
    expect(readFileSync(path.join(dir, 'config.ini'), 'utf8')).toBe('PlayStore.enabled=no\navd.id=<build>\nhw.ramSize=2G\nAvdId=novo_1\navd.ini.displayname=novo_1\n');
    // a base fica intacta
    expect(existsSync(path.join(home, 'base.avd', 'snapshots', 'default_boot', 'ram.img'))).toBe(true);
  });

  it('recusa nome inválido, destino existente e base ausente', async () => {
    fakeBase();
    await expect(cloneAvd('base', 'a b', { home })).rejects.toThrow(/nome de AVD inválido/);
    await expect(cloneAvd('base', 'base', { home })).rejects.toThrow(/já existe/);
    await expect(cloneAvd('nada', 'x', { home })).rejects.toThrow(/AVD-base .* não encontrado/);
    writeFileSync(path.join(home, 'solto.ini'), 'x');
    await expect(cloneAvd('base', 'solto', { home })).rejects.toThrow(/já existe/);
  });

  it('falha no meio apaga a cópia parcial', async () => {
    fakeBase();
    rmSync(path.join(home, 'base.ini'));
    await expect(cloneAvd('base', 'meio', { home })).rejects.toThrow();
    expect(existsSync(path.join(home, 'meio.avd'))).toBe(false);
    expect(existsSync(path.join(home, 'meio.ini'))).toBe(false);
  });

  it('deleteAvd remove diretório e .ini; recusa base e nome inválido', async () => {
    fakeBase();
    await cloneAvd('base', 'lixo', { home });
    await deleteAvd('lixo', { home, base: 'base' });
    expect(existsSync(path.join(home, 'lixo.avd'))).toBe(false);
    expect(existsSync(path.join(home, 'lixo.ini'))).toBe(false);
    await expect(deleteAvd('base', { home, base: 'base' })).rejects.toThrow(/AVD-base/);
    await expect(deleteAvd('../base', { home, base: 'base' })).rejects.toThrow(/inválido/);
    expect(existsSync(path.join(home, 'base.avd'))).toBe(true);
  });

  it('base ausente: diz como criar a enxame_golden', async () => {
    home = mkdtempSync(path.join(os.tmpdir(), 'enxame-avd-'));
    await expect(cloneAvd('enxame_golden', 'enxame_conta2', { home })).rejects.toThrow(/enxame_golden.*Android Studio|ENXAME_AVD_BASE/);
  });
});
