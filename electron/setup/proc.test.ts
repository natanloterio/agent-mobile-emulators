import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { runProcess } from './proc';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

function fakeChild(script: (c: { out: PassThrough; err: PassThrough; close: (code: number) => void; stdin: string[] }) => void) {
  const ev = new EventEmitter();
  const out = new PassThrough(); const err = new PassThrough();
  const stdinChunks: string[] = [];
  const stdin = new PassThrough();
  stdin.on('data', (b) => stdinChunks.push(String(b)));
  const child = Object.assign(ev, { stdout: out, stderr: err, stdin }) as unknown as ChildProcess;
  setTimeout(() => script({ out, err, close: (code) => ev.emit('close', code), stdin: stdinChunks }), 0);
  return { child, stdinChunks };
}

describe('runProcess', () => {
  it('repassa linhas de stdout e stderr, separando \\r e \\n', async () => {
    const lines: string[] = [];
    const { child } = fakeChild(({ out, err, close }) => { out.write('[===    ] 20% Downloading\r[=====  ] 54% Downloading\n'); err.write('aviso\n'); setTimeout(() => close(0), 5); });
    await runProcess('sdkmanager', ['--install', 'emulator'], { onLine: (l) => lines.push(l) }, () => child);
    expect(lines).toEqual(['[===    ] 20% Downloading', '[=====  ] 54% Downloading', 'aviso']);
  });
  it('escreve o stdin (aceitar licenças)', async () => {
    const { child, stdinChunks } = fakeChild(({ close }) => setTimeout(() => close(0), 5));
    await runProcess('sdkmanager', ['--licenses'], { stdin: 'y\ny\n' }, () => child);
    expect(stdinChunks.join('')).toBe('y\ny\n');
  });
  it('código diferente de zero vira erro com as últimas linhas; sem espaço vira disk-full', async () => {
    const a = fakeChild(({ out, close }) => { out.write('Error: falhou feio\n'); setTimeout(() => close(1), 5); });
    await expect(runProcess('/sdk/bin/sdkmanager', [], {}, () => a.child)).rejects.toMatchObject({ kind: 'process', message: expect.stringContaining('sdkmanager saiu com código 1: Error: falhou feio') });
    const b = fakeChild(({ err, close }) => { err.write('java.io.IOException: No space left on device\n'); setTimeout(() => close(1), 5); });
    await expect(runProcess('sdkmanager', [], {}, () => b.child)).rejects.toMatchObject({ kind: 'disk-full' });
  });
  it('comando inexistente (evento error) rejeita em vez de derrubar o main', async () => {
    const ev = new EventEmitter();
    const child = Object.assign(ev, { stdout: null, stderr: null, stdin: null }) as unknown as ChildProcess;
    setTimeout(() => ev.emit('error', Object.assign(new Error('spawn tar ENOENT'), { code: 'ENOENT' })), 0);
    await expect(runProcess('tar', [], {}, () => child)).rejects.toMatchObject({ kind: 'process' });
  });
  it('erro em stdout/stderr rejeita sem derrubar o main', async () => {
    const { child } = fakeChild(({ out }) => setTimeout(() => out.emit('error', new Error('stream broke')), 5));
    await expect(runProcess('cmd', [], {}, () => child)).rejects.toMatchObject({ kind: 'process', message: expect.stringContaining('stream broke') });
  });
  it('verbatim: true chega no spawn padrão como windowsVerbatimArguments: true', async () => {
    const { child } = fakeChild(({ close }) => setTimeout(() => close(0), 5));
    const spawnMock = vi.mocked(spawn);
    spawnMock.mockReturnValue(child);
    await runProcess('cmd', ['/d', '/s', '/c', 'x'], { verbatim: true });
    expect(spawnMock).toHaveBeenCalledWith('cmd', ['/d', '/s', '/c', 'x'], expect.objectContaining({ windowsVerbatimArguments: true }));
  });
  it('spawn padrão esconde a janela de console no Windows', async () => {
    const { child } = fakeChild(({ close }) => setTimeout(() => close(0), 5));
    const spawnMock = vi.mocked(spawn);
    spawnMock.mockReturnValue(child);
    await runProcess('tar', ['-xf', 'a.tar']);
    expect(spawnMock).toHaveBeenLastCalledWith('tar', ['-xf', 'a.tar'], expect.objectContaining({ windowsHide: true }));
  });
});
