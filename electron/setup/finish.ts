import { providerRoute } from '../provider-route.js';
import { providerPatches, type Role } from './apply.js';
import type { SetupPaths } from './paths.js';
import type { FinishRequest } from './requests.js';
import type { SetupFileT } from './setup-file.js';

export interface FinishDeps {
  readonly paths: SetupPaths;
  readonly writeSetup: (f: SetupFileT) => Promise<void>;
  /** Sobe o daemon (se ainda não subiu) e espera o gate abrir. */
  readonly startDaemon: () => Promise<void>;
  readonly daemon: (method: 'PUT', path: string, body: unknown) => Promise<unknown>;
  readonly now: () => string;
  /** setup.json atual (numa reabertura traz o `completedAt` anterior). */
  readonly readSetup: () => Promise<SetupFileT | null>;
}

const ROLES: readonly Role[] = ['lider', 'worker', 'esc'];

/**
 * Fim do onboarding. Os caminhos vão para o setup.json antes de o daemon subir (ele os lê na subida); `completedAt`
 * só é gravado depois que chave e papéis foram aceitos, para uma falha no meio mostrar o onboarding de novo.
 * Numa reabertura o `completedAt` anterior fica na primeira gravação: uma falha ali não volta a ser primeira execução.
 * Com `applyRoles` false os papéis não são tocados (a chave, se veio, é gravada).
 */
export async function finishSetup(req: FinishRequest, ollamaBin: string | null, d: FinishDeps): Promise<void> {
  const paths = { sdkRoot: d.paths.sdkRoot, ollamaBin };
  const previous = (await d.readSetup())?.completedAt ?? null;
  await d.writeSetup({ version: 1, completedAt: previous, paths });
  await d.startDaemon();
  if (req.anthropicKey) await d.daemon('PUT', '/settings/anthropic-key', { key: req.anthropicKey });
  if (req.applyRoles) {
    const patches = providerPatches(req.mode, req.localModel);
    for (const role of ROLES) await d.daemon('PUT', providerRoute(role, 'put'), patches[role]);
  }
  await d.writeSetup({ version: 1, completedAt: d.now(), paths });
}
