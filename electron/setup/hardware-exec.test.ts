import { execFile } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { execOrNull } from './hardware.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_f: string, _a: string[], _o: unknown, cb: (e: Error | null, out: string, err: string) => void) => { cb(null, 'saida', ''); }),
}));

describe('execOrNull', () => {
  it('esconde a janela no Windows e usa 5 s de timeout por padrão', async () => {
    expect(await execOrNull('nvidia-smi', ['-L'])).toContain('saida');
    expect(vi.mocked(execFile).mock.calls[0][2]).toMatchObject({ windowsHide: true, timeout: 5000 });
  });
  it('aceita timeout próprio', async () => {
    await execOrNull('powershell', ['-Command', 'x'], 30_000);
    expect(vi.mocked(execFile).mock.calls.at(-1)?.[2]).toMatchObject({ windowsHide: true, timeout: 30_000 });
  });
});
