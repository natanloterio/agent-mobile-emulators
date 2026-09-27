import { describe, expect, it } from 'vitest';
import { parseNvidiaGpu, readHardware } from './hardware.js';

describe('parseNvidiaGpu', () => {
  it('nome sem o prefixo da marca e memória em GiB', () => {
    expect(parseNvidiaGpu('NVIDIA GeForce RTX 4090, 24564\n')).toEqual({ name: 'RTX 4090', totalGiB: 24 });
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
    });
    expect(hw).toEqual({ ramGiB: 64, threads: 32, cpuModel: 'AMD Ryzen 9 7950X 16-Core Processor', gpu: { name: 'RTX 4090', totalGiB: 24 }, diskFreeGiB: 412 });
  });
  it('máquina sem GPU NVIDIA e disco ilegível não quebram', async () => {
    const hw = await readHardware('/home/u', {
      totalMemBytes: () => 16 * 2 ** 30, cpus: () => [], exec: async () => null,
      freeDiskBytes: async () => { throw new Error('EACCES'); },
    });
    expect(hw).toEqual({ ramGiB: 16, threads: 0, cpuModel: '?', gpu: null, diskFreeGiB: 0 });
  });
});
