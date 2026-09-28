import { describe, expect, it } from 'vitest';
import { deleteFileRow, getFile, insertFile, latestByLabel, listFiles } from '../src/db/files.js';
import { openDb } from '../src/db/open.js';

const base = { name: 'a.pdf', mime: 'application/pdf', sizeBytes: 10, sha256: 'ff', hostPath: '/h/a.pdf', sourceIdentityId: 'conta1', sourceMissionId: null, sourcePath: '/sdcard/Download/a.pdf' };

describe('fleet_file', () => {
  it('insere, lê e lista do mais novo para o mais velho', () => {
    const db = openDb(':memory:');
    const a = insertFile(db, { ...base, label: 'nota' });
    const b = insertFile(db, { ...base, label: 'foto', name: 'b.jpg', mime: 'image/jpeg' });
    expect(getFile(db, a)?.label).toBe('nota');
    expect(listFiles(db, 10).map((f) => f.id)).toEqual([b, a]);
    expect(getFile(db, 'nada')).toBeNull();
  });
  it('mesmo label: vale o último exportado', () => {
    const db = openDb(':memory:');
    insertFile(db, { ...base, label: 'x', name: 'velho.pdf' });
    const novo = insertFile(db, { ...base, label: 'x', name: 'novo.pdf' });
    expect(latestByLabel(db, 'x')?.id).toBe(novo);
    expect(latestByLabel(db, 'y')).toBeNull();
  });
  it('deleteFileRow devolve a linha apagada', () => {
    const db = openDb(':memory:');
    const id = insertFile(db, { ...base, label: 'x' });
    expect(deleteFileRow(db, id)?.hostPath).toBe('/h/a.pdf');
    expect(getFile(db, id)).toBeNull();
    expect(deleteFileRow(db, id)).toBeNull();
  });
});

describe('describeFile', () => {
  it('label, nome, tipo, tamanho legível e origem', async () => {
    const { describeFile } = await import('../src/db/files.js');
    const f = { id: 'x', label: 'foto', name: 'a.jpg', mime: 'image/jpeg', sizeBytes: 1536 * 1024, sha256: '', hostPath: '', sourceIdentityId: 'conta1', sourceMissionId: null, sourcePath: null, createdAt: '' };
    expect(describeFile(f)).toBe('foto: a.jpg (image/jpeg, 1.5 MB), de conta1');
    expect(describeFile({ ...f, sizeBytes: 300, sourceIdentityId: null })).toBe('foto: a.jpg (image/jpeg, 1 KB)');
  });
});
