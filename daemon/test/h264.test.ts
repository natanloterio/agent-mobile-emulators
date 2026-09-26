import { describe, expect, it } from 'vitest';
import { createAccessUnitAssembler, NAL, nalType, splitAnnexB } from '../src/device/h264.js';

const nal = (type: number, ...body: number[]) => Buffer.from([0, 0, 0, 1, type, ...body]);
const SPS = nal(0x67, 0x42, 0xc0, 0x29), PPS = nal(0x68, 0xce, 0x01), IDR = nal(0x65, 0xb8, 0x00, 0x04), P1 = nal(0x41, 0x9a, 0x01), P2 = nal(0x41, 0x9a, 0x02), SEI = nal(0x06, 0x05, 0x00);

describe('splitAnnexB / nalType', () => {
  it('separa unidades completas e guarda o resto (última unidade sem start code seguinte)', () => {
    const { units, rest } = splitAnnexB(Buffer.concat([SPS, PPS, IDR]));
    expect(units.map(nalType)).toEqual([NAL.SPS, NAL.PPS]); expect(rest.equals(IDR)).toBe(true);
  });
  it('start code partido entre chunks: nada se perde nem duplica', () => {
    const all = Buffer.concat([P1, P2, P1]);
    const a = all.subarray(0, P1.length + 2), b = all.subarray(P1.length + 2);   // corta no meio do 00 00 00 01
    const r1 = splitAnnexB(a); const r2 = splitAnnexB(Buffer.concat([r1.rest, b]));
    expect([...r1.units, ...r2.units].map((u) => u.length)).toEqual([P1.length, P2.length]); expect(r2.rest.equals(P1)).toBe(true);
  });
  it('lixo antes do primeiro start code é descartado', () => {
    const { units, rest } = splitAnnexB(Buffer.concat([Buffer.from([9, 9]), P1, P2]));
    expect(units).toHaveLength(1); expect(units[0].equals(P1)).toBe(true); expect(rest.equals(P2)).toBe(true);
  });
});

describe('createAccessUnitAssembler', () => {
  it('IDR sai com SPS+PPS na frente e key=true; não-IDR key=false; SEI ignorado; o último NAL espera o próximo start code', () => {
    const a = createAccessUnitAssembler();
    expect(a.push(Buffer.concat([SPS, PPS, SEI, IDR]))).toEqual([]);           // IDR ainda pendente
    const [au] = a.push(Buffer.concat([P1, P2]));
    expect(au.key).toBe(true); expect(au.data.equals(Buffer.concat([SPS, PPS, IDR]))).toBe(true);
    const more = a.push(Buffer.from([0, 0, 0, 1]));                           // fecha P2 sem abrir nada útil
    expect(more.map((u) => u.key)).toEqual([false]); expect(more[0].data.equals(P2)).toBe(true);
  });
  it('em chunks arbitrários produz os mesmos quadros; reset() esquece SPS/PPS e o resto', () => {
    const whole = Buffer.concat([SPS, PPS, IDR, P1, P2, Buffer.from([0, 0, 0, 1])]);
    const a = createAccessUnitAssembler(); const out = [];
    for (let i = 0; i < whole.length; i += 3) out.push(...a.push(whole.subarray(i, i + 3)));
    expect(out.map((u) => u.key)).toEqual([true, false, false]);
    a.reset(); expect(a.push(Buffer.concat([IDR, P1]))).toEqual([]);           // sem SPS/PPS o IDR não é emitido
  });
});
