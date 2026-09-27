import { describe, expect, it } from 'vitest';
import { parseNvidiaGpu, readHardware } from './hardware.js';

describe('parseNvidiaGpu', () => {
  it('nome sem o prefixo da marca e memória em GiB', () => {
    expect(parseNvidiaGpu('NVIDIA GeForce RTX 4090, 24564\n')).toEqual({ name: 'RTX 4090', totalGiB: 24, unified: false });
  });
  it('sem nvidia-smi ou saída estranha: null', () => {
    expect(parseNvidiaGpu(null)).toBeNull();
    expect(parseNvidiaGpu('')).toBeNull();
    expect(parseNvidiaGpu('No devices were found')).toBeNull();
  });
});

describe('readHardware', () => {
  it('junta RAM, threads, modelo da CPU, GPU e disco livre do home', async () => {
    const hw = await readHardware('/home/u', {
      totalMemBytes: () => 64 * 2 ** 30,
      cpus: () => Array.from({ length: 32 }, () => ({ model: ' AMD Ryzen 9 7950X 16-Core Processor ' })),
      exec: async () => 'NVIDIA GeForce RTX 4090, 24564',
      freeDiskBytes: async (p) => (p === '/home/u' ? 412 * 2 ** 30 : 0),
    }, 'linux-x64');
    expect(hw).toEqual({ ramGiB: 64, threads: 32, cpuModel: 'AMD Ryzen 9 7950X 16-Core Processor', gpu: { name: 'RTX 4090', totalGiB: 24, unified: false }, diskFreeGiB: 412 });
  });
  it('máquina sem GPU NVIDIA e disco ilegível não quebram', async () => {
    const hw = await readHardware('/home/u', {
      totalMemBytes: () => 16 * 2 ** 30, cpus: () => [], exec: async () => null,
      freeDiskBytes: async () => { throw new Error('EACCES'); },
    }, 'linux-x64');
    expect(hw).toEqual({ ramGiB: 16, threads: 0, cpuModel: '?', gpu: null, diskFreeGiB: 0 });
  });
});

describe('Apple Silicon', () => {
  it('memória unificada: GPU = 2/3 da RAM, unified=true, sem nvidia-smi', async () => {
    const hw = await readHardware('/Users/u', {
      totalMemBytes: () => 36 * 2 ** 30, cpus: () => Array.from({ length: 12 }, () => ({ model: 'Apple M3 Pro' })),
      exec: async () => { throw new Error('não chama nvidia-smi'); }, freeDiskBytes: async () => 100 * 2 ** 30,
    }, 'darwin-arm64');
    expect(hw.gpu).toEqual({ name: 'Apple Silicon', totalGiB: 24, unified: true });
  });
  it('NVIDIA traz unified=false', async () => {
    const hw = await readHardware('/home/u', {
      totalMemBytes: () => 64 * 2 ** 30, cpus: () => [{ model: 'x' }], exec: async () => 'NVIDIA GeForce RTX 4090, 24564', freeDiskBytes: async () => 0,
    }, 'linux-x64');
    expect(hw.gpu).toEqual({ name: 'RTX 4090', totalGiB: 24, unified: false });
  });
});
