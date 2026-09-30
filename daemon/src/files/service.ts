import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { deleteFileRow, getFile, insertFile, type FleetFile } from '../db/files.js';
import type { IdentityRow } from '../db/identities.js';
import { AdbError, type Adb } from '../device/adb.js';
import { cropPng, type Bounds } from './png.js';
import { deviceDirFor, existsOnDevice, listSharedFiles, mediaScan, normalizeDevicePath, shq, statFileSize, type DeviceFile } from './device-files.js';
import { safeFileName, SNIFF_BYTES, sniffMime, withExtension } from './sniff.js';

export type FileErrorKind = 'bad-path' | 'bad-label' | 'not-found' | 'too-large' | 'none' | 'device';
/** Falha de arquivo com o motivo que a rota traduz em status e a tool devolve ao modelo. */
export class FileError extends Error {
  constructor(readonly kind: FileErrorKind, message: string) { super(message); this.name = 'FileError'; }
}

/** Nome pelo qual missões e a tela se referem a um arquivo (mesmo formato das chaves da memória da missão). */
export const FILE_LABEL = /^[A-Za-z0-9_.-]{1,80}$/;

export interface FileService {
  /** Arquivos das pastas compartilhadas do device, mais novo primeiro. */
  recent(identity: IdentityRow, sinceSec?: number): Promise<readonly DeviceFile[]>;
  exportFile(o: { identity: IdentityRow; devicePath: string; label: string; missionId: string | null }): Promise<FleetFile>;
  /** O arquivo mais novo das pastas compartilhadas modificado desde `sinceSec` (o que a missão acabou de baixar). */
  exportNewest(o: { identity: IdentityRow; sinceSec: number; label: string; missionId: string | null }): Promise<FleetFile>;
  importFile(o: { file: FleetFile; identity: IdentityRow }): Promise<{ devicePath: string }>;
  /** Captura a tela pelo adb (não pela pessoa), recortada pelos bounds se vierem, e guarda como PNG com o label. */
  captureScreen(o: { identity: IdentityRow; label: string; missionId: string | null; crop?: Bounds }): Promise<FleetFile>;
  remove(id: string): Promise<FleetFile | null>;
}
export interface FileServiceDeps {
  readonly db: DatabaseSync; readonly adb: Pick<Adb, 'shell' | 'pull' | 'push'> & Partial<Pick<Adb, 'screencap'>>;
  readonly dir: string; readonly maxBytes: number; readonly recentLimit: number;
  /** Destrava a tela com o PIN da identidade: com o armazenamento criptografado travado, `/sdcard` nem existe. */
  readonly unlock?: (identity: IdentityRow) => Promise<unknown>;
}

const mb = (n: number) => `${Math.round(n / (1024 * 1024))} MB`;

/** Erro do adb vira FileError('device'); o resto sobe como veio. */
async function onDevice<T>(f: () => Promise<T>): Promise<T> {
  try { return await f(); }
  catch (e) { if (e instanceof AdbError) throw new FileError('device', `device indisponível: ${e.message.slice(0, 160)}`); throw e; }
}

async function digest(file: string): Promise<{ sha256: string; head: Buffer }> {
  const hash = createHash('sha256');
  let head = Buffer.alloc(0);
  for await (const chunk of fs.createReadStream(file)) {
    const b = chunk as Buffer;
    if (head.length < SNIFF_BYTES) head = Buffer.concat([head, b.subarray(0, SNIFF_BYTES - head.length)]);
    hash.update(b);
  }
  return { sha256: hash.digest('hex'), head };
}

/**
 * Arquivos entre aparelhos (spec arquivos): `adb pull` para `<dir>/<id>/<nome>`, `adb push` para a pasta do tipo no
 * outro device. O conteúdo nunca é executado nem aberto no host; o tipo sai dos bytes, não da extensão.
 */
export function createFileService(d: FileServiceDeps): FileService {
  const ready = (identity: IdentityRow) => onDevice(async () => { await d.unlock?.(identity); });
  const exportPath = async (identity: IdentityRow, devicePath: string, label: string, missionId: string | null): Promise<FleetFile> => {
    const p = normalizeDevicePath(devicePath);
    if (!p) throw new FileError('bad-path', 'caminho fora das pastas compartilhadas (Download, DCIM, Pictures, Movies, Documents)');
    if (!FILE_LABEL.test(label)) throw new FileError('bad-label', 'label: letras, dígitos, ponto, _ e -, até 80');
    await ready(identity);
    const size = await onDevice(() => statFileSize(d.adb, identity.serial, p));
    if (size === null) throw new FileError('not-found', `arquivo não encontrado no device (ou é uma pasta): ${p}`);
    if (size > d.maxBytes) throw new FileError('too-large', `arquivo de ${mb(size)} passa do limite de ${mb(d.maxBytes)}`);
    const id = randomUUID();
    const folder = path.join(d.dir, id);
    const hostPath = path.join(folder, safeFileName(p));
    fs.mkdirSync(folder, { recursive: true });
    try {
      await onDevice(() => d.adb.pull(identity.serial, p, hostPath));
      const st = fs.statSync(hostPath);
      if (!st.isFile()) throw new FileError('not-found', `não é um arquivo: ${p}`);
      const local = st.size;
      // O arquivo pode ter crescido entre o stat e o pull (download ainda em curso).
      if (local > d.maxBytes) throw new FileError('too-large', `arquivo de ${mb(local)} passa do limite de ${mb(d.maxBytes)}`);
      const { sha256, head } = await digest(hostPath);
      insertFile(d.db, {
        label, name: path.basename(hostPath), mime: sniffMime(head, hostPath), sizeBytes: local, sha256, hostPath,
        sourceIdentityId: identity.id, sourceMissionId: missionId, sourcePath: p,
      }, id);
      return getFile(d.db, id) as FleetFile;
    } catch (e) {
      fs.rmSync(folder, { recursive: true, force: true });
      throw e;
    }
  };

  return {
    recent: async (identity, sinceSec) => { await ready(identity); return onDevice(() => listSharedFiles(d.adb, identity.serial, { sinceSec, limit: d.recentLimit })); },
    exportFile: (o) => exportPath(o.identity, o.devicePath, o.label, o.missionId),
    exportNewest: async (o) => {
      await ready(o.identity);
      const [newest] = await onDevice(() => listSharedFiles(d.adb, o.identity.serial, { sinceSec: o.sinceSec, limit: 1, excludeImported: true }));
      if (!newest) throw new FileError('none', 'nenhum arquivo novo nas pastas compartilhadas do device');
      return exportPath(o.identity, newest.path, o.label, o.missionId);
    },
    importFile: async ({ file, identity }) => {
      if (!fs.existsSync(file.hostPath)) throw new FileError('not-found', `arquivo ${file.name} não está mais no host`);
      const dir = deviceDirFor(file.mime);
      const name = withExtension(safeFileName(file.name), file.mime);
      await ready(identity);
      const devicePath = await onDevice(async () => {
        await d.adb.shell(identity.serial, [`mkdir -p ${shq(dir)}`]);
        // Nome já usado no destino (outro arquivo com o mesmo nome): sufixo do id, para não sobrescrever o que uma nota cita.
        let target = `${dir}/${name}`;
        if (await existsOnDevice(d.adb, identity.serial, target)) {
          const ext = path.extname(name);
          target = `${dir}/${name.slice(0, name.length - ext.length)}-${file.id.slice(0, 6)}${ext}`;
        }
        await d.adb.push(identity.serial, file.hostPath, target);
        // Aviso ao MediaStore é melhor esforço: no Android 11+ o push pelo FUSE costuma já indexar.
        await mediaScan(d.adb, identity.serial, target).catch((e: unknown) => console.warn('[arquivos] media scan falhou:', String((e as Error)?.message ?? e).slice(0, 160)));
        return target;
      });
      return { devicePath };
    },
    captureScreen: async ({ identity, label, missionId, crop }) => {
      if (!FILE_LABEL.test(label)) throw new FileError('bad-label', 'label: letras, dígitos, ponto, _ e -, até 80');
      const screencap = d.adb.screencap;
      if (!screencap) throw new FileError('device', 'captura de tela indisponível neste daemon');
      await ready(identity);
      const full = await onDevice(() => screencap(identity.serial));
      let bytes: Buffer;
      try { bytes = crop ? cropPng(full, crop) : full; }
      catch (e) { throw new FileError('bad-path', `não deu para recortar a captura: ${(e as Error).message}`); }
      if (bytes.length > d.maxBytes) throw new FileError('too-large', `captura de ${mb(bytes.length)} passa do limite de ${mb(d.maxBytes)}`);
      const id = randomUUID();
      const folder = path.join(d.dir, id);
      const hostPath = path.join(folder, `${label}.png`);
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(hostPath, bytes);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      insertFile(d.db, {
        label, name: path.basename(hostPath), mime: sniffMime(bytes.subarray(0, SNIFF_BYTES), hostPath), sizeBytes: bytes.length, sha256, hostPath,
        sourceIdentityId: identity.id, sourceMissionId: missionId, sourcePath: 'screencap',
      }, id);
      return getFile(d.db, id) as FleetFile;
    },
    remove: async (id) => {
      const f = deleteFileRow(d.db, id);
      const folder = f ? path.dirname(path.resolve(f.hostPath)) : null;
      // Só apaga a pasta do próprio arquivo, dentro de `dir` (linha adulterada no banco não vira rm arbitrário).
      if (folder && path.dirname(folder) === path.resolve(d.dir)) fs.rmSync(folder, { recursive: true, force: true });
      return f;
    },
  };
}
