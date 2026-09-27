import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSetupFile, readSetupFileSync, writeSetupFile } from './setup-file.js';

const data = { version: 1 as const, completedAt: '2026-09-27T12:00:00.000Z', paths: { sdkRoot: '/sdk', ollamaBin: null } };

describe('setup.json', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it('grava e lê de volta; cria o diretório', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'enxame-setup-'));
    const file = path.join(dir, 'sub', 'setup.json');
    await writeSetupFile(file, data);
    expect(await readSetupFile(file)).toEqual(data);
    expect(readSetupFileSync(file)).toEqual(data);
    expect(JSON.parse(await readFile(file, 'utf8')).version).toBe(1);
  });
  it('ausente ou inválido devolve null', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'enxame-setup-'));
    expect(await readSetupFile(path.join(dir, 'nada.json'))).toBeNull();
    await writeFile(path.join(dir, 'ruim.json'), '{"version":2}');
    expect(await readSetupFile(path.join(dir, 'ruim.json'))).toBeNull();
    expect(readSetupFileSync(path.join(dir, 'nada.json'))).toBeNull();
  });
  it('avisa no console quando o arquivo existe mas é inválido; ausente fica em silêncio', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dir = await mkdtemp(path.join(os.tmpdir(), 'enxame-setup-'));
    await readSetupFile(path.join(dir, 'nada.json'));
    readSetupFileSync(path.join(dir, 'nada.json'));
    expect(warn).not.toHaveBeenCalled();
    await writeFile(path.join(dir, 'ruim.json'), '{"version":2}');
    await writeFile(path.join(dir, 'quebrado.json'), '{');
    await readSetupFile(path.join(dir, 'ruim.json'));
    readSetupFileSync(path.join(dir, 'quebrado.json'));
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0][0])).toContain('setup.json');
  });
  it('recusa gravar formato errado', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'enxame-setup-'));
    await expect(writeSetupFile(path.join(dir, 's.json'), { ...data, paths: { sdkRoot: '', ollamaBin: null } })).rejects.toThrow();
  });
});
