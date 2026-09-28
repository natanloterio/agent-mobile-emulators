import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireInstanceLock, daemonAlive } from '../src/fleet/lock.js';

describe('daemonAlive', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'enxame-lock-'));
  it('arquivo ausente → null; PID morto → null; PID vivo → { pid }', () => {
    expect(daemonAlive(path.join(dir, 'nao-existe.json'))).toBeNull();
    const dead = path.join(dir, 'dead.json'); writeFileSync(dead, JSON.stringify({ port: 1, token: 't', pid: 999999 }));
    expect(daemonAlive(dead, () => false)).toBeNull();
    const live = path.join(dir, 'live.json'); writeFileSync(live, JSON.stringify({ port: 1, token: 't', pid: process.pid }));
    expect(daemonAlive(live)).toEqual({ pid: process.pid });
  });
});

describe('acquireInstanceLock', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tapflock-instance-'));
  it('um daemon por pasta de dados: o segundo recusa com o pid do dono; trava de pid morto é retomada', () => {
    const file = path.join(dir, 'daemon.lock');
    const first = acquireInstanceLock(file, 111, (pid) => pid === 111);
    expect(first).toMatchObject({ ok: true });
    expect(acquireInstanceLock(file, 222, (pid) => pid === 111)).toEqual({ ok: false, pid: 111 });
    // O dono morreu sem soltar (queda): o próximo assume.
    expect(acquireInstanceLock(file, 333, () => false)).toMatchObject({ ok: true });
    expect(readFileSync(file, 'utf8')).toBe('333');
  });
  it('release só apaga a trava se ela ainda for deste processo', () => {
    const file = path.join(dir, 'b.lock');
    const a = acquireInstanceLock(file, 1, () => false);
    if (!a.ok) throw new Error('esperava ok');
    writeFileSync(file, '2');
    a.release();
    expect(existsSync(file)).toBe(true);
  });
});
