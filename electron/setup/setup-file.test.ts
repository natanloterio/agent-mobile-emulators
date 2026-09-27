import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSetupFile, readSetupFileSync, writeSetupFile } from './setup-file.js';

const data = { version: 1 as const, completedAt: '2026-09-27T12:00:00.000Z', paths: { sdkRoot: '/sdk', ollamaBin: null } };

describe('setup.json', () => {
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
  it('recusa gravar formato errado', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'enxame-setup-'));
    await expect(writeSetupFile(path.join(dir, 's.json'), { ...data, paths: { sdkRoot: '', ollamaBin: null } })).rejects.toThrow();
  });
});
