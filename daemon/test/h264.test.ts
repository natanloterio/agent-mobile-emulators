import { describe, expect, it } from 'vitest';
import { createAccessUnitAssembler, NAL, nalType, splitAnnexB } from '../src/device/h264.js';

const nal = (type: number, ...body: number[]) => Buffer.from([0, 0, 0, 1, type, ...body]);
const nal3 = (type: number, ...body: number[]) => Buffer.from([0, 0, 1, type, ...body]); // start code de 3 bytes (sem o zero_byte opcional)
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
  it('start codes de 3 e 4 bytes misturados: cada unidade sai completa com o nalType certo (revisão)', () => {
    const sps4 = nal(0x67, 0x42, 0xc0, 0x29), pps3 = nal3(0x68, 0xce, 0x01), idr3 = nal3(0x65, 0xb8, 0x00, 0x04);
    const { units, rest } = splitAnnexB(Buffer.concat([sps4, pps3, idr3]));
    expect(units.map(nalType)).toEqual([NAL.SPS, NAL.PPS]);
    expect(units[0].equals(sps4)).toBe(true); expect(units[1].equals(pps3)).toBe(true); expect(rest.equals(idr3)).toBe(true);
  });
  it('start code de 3 bytes partido entre chunks: nada se perde nem duplica (revisão)', () => {
    const Q1 = nal3(0x41, 0x9a, 0x01), Q2 = nal3(0x41, 0x9a, 0x02);
    const all = Buffer.concat([Q1, Q2, Q1]);
    const a = all.subarray(0, Q1.length + 1), b = all.subarray(Q1.length + 1);   // corta no meio do 00 00 01 (após 1 zero)
    const r1 = splitAnnexB(a); const r2 = splitAnnexB(Buffer.concat([r1.rest, b]));
    expect([...r1.units, ...r2.units].map((u) => u.length)).toEqual([Q1.length, Q2.length]); expect(r2.rest.equals(Q1)).toBe(true);
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
  it('IDR sai corretamente com SPS de 4 bytes e PPS/IDR de 3 bytes (revisão)', () => {
    const sps4 = nal(0x67, 0x42, 0xc0, 0x29), pps3 = nal3(0x68, 0xce, 0x01), idr3 = nal3(0x65, 0xb8, 0x00, 0x04);
    const a = createAccessUnitAssembler();
    expect(a.push(Buffer.concat([sps4, pps3, idr3]))).toEqual([]);            // IDR ainda pendente (espera o próximo start code)
    const [au] = a.push(Buffer.from([0, 0, 1]));                              // fecha com um start code de 3 bytes
    expect(au.key).toBe(true); expect(au.data.equals(Buffer.concat([sps4, pps3, idr3]))).toBe(true);
  });
  it('mutar o buffer de origem depois do push não corrompe a unidade já emitida (revisão)', () => {
    const src = Buffer.concat([P1, P2]);                                      // P1 fecha (não-IDR), P2 fica pendente
    const a = createAccessUnitAssembler();
    const [au] = a.push(src);
    expect(au.key).toBe(false);
    const before = Buffer.from(au.data);
    src.fill(0xff);                                                           // simula o chamador reciclando o buffer de leitura
    expect(au.data.equals(before)).toBe(true);
  });
  it('unidade não-IDR não prende o buffer inteiro do push na memória (revisão)', () => {
    const filler = Buffer.alloc(200_000, 0x00);                               // simula um read buffer grande com várias unidades
    const src = Buffer.concat([filler, P1, P2]);                              // P1 fecha (não-IDR), P2 fica pendente
    const a = createAccessUnitAssembler();
    const [au] = a.push(src);
    expect(au.key).toBe(false); expect(au.data.equals(P1)).toBe(true);
    // a unidade emitida deve ter seu próprio backing store, do tamanho da unidade — não do buffer grande de origem.
    expect(au.data.buffer.byteLength).toBeLessThan(src.length);
  });
});
