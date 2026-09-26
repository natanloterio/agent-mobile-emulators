/** H.264 Annex B do scrcpy-server em `raw_stream=true` (spec inc. 4 §4.1): separação de NAL e montagem de access units. */
export const NAL = { NON_IDR: 1, IDR: 5, SEI: 6, SPS: 7, PPS: 8, AUD: 9 } as const;
export interface AccessUnit { readonly key: boolean; readonly data: Buffer }

const START = Buffer.from([0, 0, 0, 1]);

/** Devolve as unidades completas (cada uma começando em 00 00 00 01) e o resto — que começa no último start code visto, ou é vazio/lixo descartável. */
export function splitAnnexB(buf: Buffer): { readonly units: readonly Buffer[]; readonly rest: Buffer } {
  const starts: number[] = [];
  for (let i = buf.indexOf(START); i !== -1; i = buf.indexOf(START, i + 4)) starts.push(i);
  if (starts.length === 0) return { units: [], rest: buf.length >= 3 ? buf.subarray(buf.length - 3) : buf }; // guarda um possível 00 00 00 partido
  const units = starts.slice(0, -1).map((s, i) => buf.subarray(s, starts[i + 1]));
  return { units, rest: buf.subarray(starts[starts.length - 1]) };
}

export const nalType = (unit: Buffer): number => (unit.length > 4 ? unit[4] & 0x1f : 0);

export function createAccessUnitAssembler(): { push(bytes: Buffer): readonly AccessUnit[]; reset(): void } {
  let rest = Buffer.alloc(0); let sps: Buffer | null = null; let pps: Buffer | null = null;
  const emit = (unit: Buffer): AccessUnit | null => {
    const t = nalType(unit);
    if (t === NAL.SPS) { sps = unit; return null; }
    if (t === NAL.PPS) { pps = unit; return null; }
    if (t === NAL.IDR) return sps && pps ? { key: true, data: Buffer.concat([sps, pps, unit]) } : null;
    if (t === NAL.NON_IDR) return { key: false, data: unit };
    return null; // SEI, AUD e outros não-VCL
  };
  return {
    push: (bytes) => {
      const r = splitAnnexB(Buffer.concat([rest, bytes])); rest = Buffer.from(r.rest);
      return r.units.map(emit).filter((u): u is AccessUnit => u !== null);
    },
    reset: () => { rest = Buffer.alloc(0); sps = null; pps = null; },
  };
}
