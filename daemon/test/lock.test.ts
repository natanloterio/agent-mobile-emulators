import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { daemonAlive } from '../src/fleet/lock.js';

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
