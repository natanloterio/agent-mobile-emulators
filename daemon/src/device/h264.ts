/** H.264 Annex B do scrcpy-server em `raw_stream=true` (spec inc. 4 §4.1): separação de NAL e montagem de access units. */
export const NAL = { NON_IDR: 1, IDR: 5, SEI: 6, SPS: 7, PPS: 8, AUD: 9 } as const;
export interface AccessUnit { readonly key: boolean; readonly data: Buffer }

/** `start_code_prefix_one_3bytes` (Annex B): 00 00 01. Um `zero_byte` opcional antes dele monta a forma de 4 bytes (00 00 00 01) — ambas válidas e aceitas pelo WebCodecs. */
const PREFIX = Buffer.from([0, 0, 1]);

/** Índices dos start codes em `buf`, cada um apontando para o primeiro byte do prefixo (3 ou 4 bytes, conforme haja um zero_byte antes do 00 00 01). */
function findStarts(buf: Buffer): number[] {
  const starts: number[] = [];
  for (let j = buf.indexOf(PREFIX); j !== -1; j = buf.indexOf(PREFIX, j + 3)) starts.push(j > 0 && buf[j - 1] === 0 ? j - 1 : j);
  return starts;
}

/** Devolve as unidades completas (cada uma começando em 00 00 01 ou 00 00 00 01) e o resto — que começa no último start code visto, ou é vazio/lixo descartável. */
export function splitAnnexB(buf: Buffer): { readonly units: readonly Buffer[]; readonly rest: Buffer } {
  const starts = findStarts(buf);
  if (starts.length === 0) return { units: [], rest: buf.length >= 3 ? buf.subarray(buf.length - 3) : buf }; // guarda um possível 00 00 / 00 00 00 partido
  const units = starts.slice(0, -1).map((s, i) => buf.subarray(s, starts[i + 1]));
  return { units, rest: buf.subarray(starts[starts.length - 1]) };
}

/** Tipo do NAL: 5 bits baixos do byte logo após o start code da unidade, seja ele de 3 ou 4 bytes. */
export function nalType(unit: Buffer): number {
  const fourByte = unit.length >= 4 && unit[0] === 0 && unit[1] === 0 && unit[2] === 0 && unit[3] === 1;
  const headerIdx = fourByte ? 4 : 3;
  return unit.length > headerIdx ? unit[headerIdx] & 0x1f : 0;
}

export function createAccessUnitAssembler(): { push(bytes: Buffer): readonly AccessUnit[]; reset(): void } {
  let rest = Buffer.alloc(0); let sps: Buffer | null = null; let pps: Buffer | null = null;
  const emit = (unit: Buffer): AccessUnit | null => {
    const t = nalType(unit);
    if (t === NAL.SPS) { sps = unit; return null; }
    if (t === NAL.PPS) { pps = unit; return null; }
    if (t === NAL.IDR) return sps && pps ? { key: true, data: Buffer.concat([sps, pps, unit]) } : null;
    // cópia: `unit` é um subarray do buffer concatenado deste push() — reter a unidade sem copiar prenderia
    // o buffer inteiro (possivelmente muito maior) na memória enquanto o chamador segurar este quadro.
    if (t === NAL.NON_IDR) return { key: false, data: Buffer.from(unit) };
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
