import { z } from 'zod';
import { getFile } from '../db/files.js';
import { getIdentity } from '../db/identities.js';
import { FILE_LABEL, FileError, type FileErrorKind, type FileService } from '../files/service.js';
import type { Route, RouteCtx } from './api.js';
import { IdentityId } from './routes-missions.js';
import { fileViews } from './snapshot-files.js';

const FILE_ID = '([A-Za-z0-9-]{1,64})';
const DEVICE = /^\/files\/device\/([A-Za-z0-9_-]{1,64})$/;
const SEND = new RegExp(`^/files/${FILE_ID}/send$`);
const DELETE = new RegExp(`^/files/${FILE_ID}/delete$`);
const MAX_TARGETS = 50;

const ExportBody = z.object({ identityId: IdentityId, devicePath: z.string().min(1).max(400), label: z.string().regex(FILE_LABEL).optional() }).strict();
const SendBody = z.object({ identityIds: z.array(IdentityId).min(1).max(MAX_TARGETS) }).strict();

const STATUS: Record<FileErrorKind, number> = { 'bad-path': 400, 'bad-label': 400, 'not-found': 404, 'none': 404, 'too-large': 413, device: 409 };

/** Label a partir do nome do arquivo: só os caracteres que missões aceitam, até 80. */
export function defaultLabel(name: string): string {
  const l = name.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80);
  return /[A-Za-z0-9]/.test(l) ? l : 'arquivo';
}

const errorOf = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);

/** FileError vira o status do motivo; o resto sobe (a api responde 500). */
function fail(ctx: RouteCtx, e: unknown): void {
  if (e instanceof FileError) ctx.send(STATUS[e.kind], { error: e.message, kind: e.kind });
  else throw e;
}

/**
 * Arquivos entre aparelhos pela tela (spec arquivos §API). Não usam o lock de objetivo: `adb pull/push` não disputa a
 * tela com o agente. `POST .../delete` em vez de DELETE: o canal do renderer só fala GET/POST/PUT.
 */
export function fileRoutes(o: { readonly service: FileService }): Route {
  return async (ctx) => {
    const p = ctx.url.pathname;
    if (!p.startsWith('/files')) return false;
    if (ctx.method === 'GET' && p === '/files') { ctx.send(200, { files: fileViews(ctx.db) }); return true; }
    const dev = DEVICE.exec(p);
    if (ctx.method === 'GET' && dev) {
      if (!IdentityId.safeParse(dev[1]).success) { ctx.send(400, { error: 'identidade inválida' }); return true; }
      const identity = getIdentity(ctx.db, dev[1]);
      if (!identity) { ctx.send(404, { error: 'identidade desconhecida' }); return true; }
      try { ctx.send(200, { files: await o.service.recent(identity) }); } catch (e) { fail(ctx, e); }
      return true;
    }
    if (ctx.method !== 'POST') return false;
    if (p === '/files/export') {
      const b = ExportBody.safeParse(await ctx.body());
      if (!b.success) { ctx.send(400, { error: b.error.issues.map((i) => i.message) }); return true; }
      const identity = getIdentity(ctx.db, b.data.identityId);
      if (!identity) { ctx.send(404, { error: 'identidade desconhecida' }); return true; }
      const name = b.data.devicePath.slice(b.data.devicePath.lastIndexOf('/') + 1);
      try {
        const f = await o.service.exportFile({ identity, devicePath: b.data.devicePath, label: b.data.label ?? defaultLabel(name), missionId: null });
        ctx.send(201, { file: fileViews(ctx.db).find((v) => v.id === f.id) ?? { id: f.id } });
        ctx.broadcast();
      } catch (e) { fail(ctx, e); }
      return true;
    }
    const send = SEND.exec(p);
    if (send) {
      const b = SendBody.safeParse(await ctx.body());
      if (!b.success) { ctx.send(400, { error: b.error.issues.map((i) => i.message) }); return true; }
      const file = getFile(ctx.db, send[1]);
      if (!file) { ctx.send(404, { error: 'arquivo desconhecido' }); return true; }
      const sent: { identityId: string; devicePath: string }[] = [];
      const failed: { identityId: string; error: string }[] = [];
      // Um device por vez: o `adb push` de vários arquivos grandes em paralelo só disputa o disco.
      for (const identityId of new Set(b.data.identityIds)) {
        const identity = getIdentity(ctx.db, identityId);
        if (!identity) { failed.push({ identityId, error: 'identidade desconhecida' }); continue; }
        try { sent.push({ identityId, devicePath: (await o.service.importFile({ file, identity })).devicePath }); }
        catch (e) { failed.push({ identityId, error: errorOf(e) }); }
      }
      ctx.send(200, { sent, failed });
      return true;
    }
    const del = DELETE.exec(p);
    if (del) {
      const f = await o.service.remove(del[1]);
      if (!f) { ctx.send(404, { error: 'arquivo desconhecido' }); return true; }
      ctx.send(200, { deleted: f.id });
      ctx.broadcast();
      return true;
    }
    return false;
  };
}
