import { describe, expect, it } from 'vitest';
import { SetupReportSchema } from './schema';

const base = { deps: [], hardware: { ramGiB: 16, threads: 8, cpuModel: 'x', gpu: null, diskFreeGiB: 100 }, localModels: [] };

describe('SetupReportSchema', () => {
  it('aceita as duas arquiteturas da imagem do sistema', () => {
    expect(SetupReportSchema.parse({ ...base, imageAbi: 'x86_64' }).imageAbi).toBe('x86_64');
    expect(SetupReportSchema.parse({ ...base, imageAbi: 'arm64-v8a' }).imageAbi).toBe('arm64-v8a');
  });
  it('recusa relatório sem arquitetura ou com uma desconhecida', () => {
    expect(SetupReportSchema.safeParse(base).success).toBe(false);
    expect(SetupReportSchema.safeParse({ ...base, imageAbi: 'armeabi-v7a' }).success).toBe(false);
  });
});
