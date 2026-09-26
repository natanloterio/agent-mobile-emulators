import { describe, expect, it } from 'vitest';
import { clearTargetAccount } from '../src/fleet/account.js';

const fakeShell = (out: Record<string, string | Error>) => {
  const calls: string[] = [];
  return { calls, shell: async (_s: string, cmd: readonly string[]) => { const k = cmd.join(' '); calls.push(k); const v = out[k]; if (v instanceof Error) throw v; return v ?? ''; } };
};

describe('clearTargetAccount', () => {
  it('app instalado: pm clear', async () => {
    const a = fakeShell({ 'pm path com.x': 'package:/data/app/base.apk', 'pm clear com.x': 'Success' });
    expect(await clearTargetAccount(a, 'emulator-5556', 'com.x')).toBe('cleared');
    expect(a.calls).toEqual(['pm path com.x', 'pm clear com.x']);
  });
  it('app ausente (pm path sai com erro ou vazio): nada a limpar', async () => {
    const a = fakeShell({ 'pm path com.x': new Error('') });
    expect(await clearTargetAccount(a, 's', 'com.x')).toBe('absent');
    expect(a.calls).toEqual(['pm path com.x']);
  });
  it('pm clear que não diz Success lança', async () => {
    const a = fakeShell({ 'pm path com.x': 'package:/a.apk', 'pm clear com.x': 'Failed' });
    await expect(clearTargetAccount(a, 's', 'com.x')).rejects.toThrow(/pm clear com.x: Failed/);
  });
});
