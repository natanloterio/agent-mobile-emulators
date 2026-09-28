import type { DatabaseSync } from 'node:sqlite';
import { IDLE_PREP, readBasePrep, writeBasePrep, writeTargetVersion, type BasePhase, type BasePrep } from '../db/base-settings.js';
import type { IdentityRow } from '../db/identities.js';
import type { MissionRow } from '../db/missions.js';

/** Tudo que o preparo toca de fora (SDK, emulador, adb, cofre, missões); injetado para os testes. */
export interface PrepareDeps {
  readonly db: DatabaseSync;
  readonly baseExists: () => boolean;
  readonly createAvd: () => Promise<void>;
  /** Linha reservada do celular-base (portas e token), criada na primeira vez. */
  readonly baseIdentity: () => Promise<IdentityRow>;
  readonly boot: (id: IdentityRow) => Promise<IdentityRow>;
  /** App MCP instalado, acessibilidade e início automático ligados, servidor MCP respondendo. */
  readonly setupMcp: (id: IdentityRow, onProgress: (pct: number) => void) => Promise<void>;
  /** versionName do app alvo no aparelho, ou null se não está instalado. */
  readonly targetVersion: (id: IdentityRow) => Promise<string | null>;
  readonly googleEmail: () => Promise<string | null>;
  /** Há conta Google no aparelho? Se sim, toda identidade clonada nasceria logada nela. */
  readonly googleOnDevice: (id: IdentityRow) => Promise<boolean>;
  /** Abre a missão do celular-base (com a memória da conta Google) e devolve o id. */
  readonly startMission: (id: IdentityRow, email: string) => string;
  readonly mission: (missionId: string) => MissionRow | null;
  /** Desliga a Play Store da base e o emulador. */
  readonly finish: (id: IdentityRow) => Promise<void>;
  readonly onChange: () => void;
  readonly sleep?: (ms: number) => Promise<void>;
}

const POLL_MS = 2000;
const errText = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);

/**
 * Prepara o celular-base sem Android Studio (spec: o usuário final não tem nada instalado além do Tapflock). Cada fase
 * pula o que já está feito, então chamar de novo retoma de onde parou (erro, reinício do daemon, conta Google recém
 * cadastrada). Só dois momentos pedem gente: cadastrar a conta Google e uma verificação do Google durante a missão.
 */
export function createBasePreparer(d: PrepareDeps) {
  const sleep = d.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let running: Promise<void> | null = null;

  const set = (patch: Partial<BasePrep>) => { writeBasePrep(d.db, { ...readBasePrep(d.db), ...patch }); d.onChange(); };
  const phase = (p: BasePhase) => set({ state: 'running', phase: p, error: null, humanReason: null, progress: null });

  /** Espera a missão acabar; a verificação humana aparece como `needs-human` e volta a `running` com o "Continuar". */
  async function waitMission(missionId: string): Promise<MissionRow> {
    for (;;) {
      const m = d.mission(missionId);
      if (!m) throw new Error('a missão do celular-base sumiu');
      if (m.state === 'done' || m.state === 'abandoned') return m;
      if (m.state === 'awaiting-human' || m.state === 'paused') {
        if (readBasePrep(d.db).state !== 'needs-human') set({ state: 'needs-human', humanReason: m.humanReason });
      } else if (readBasePrep(d.db).state === 'needs-human') set({ state: 'running', humanReason: null });
      await sleep(POLL_MS);
    }
  }

  async function run(): Promise<void> {
    phase('avd');
    if (!d.baseExists()) await d.createAvd();
    phase('boot');
    let id = await d.baseIdentity();
    id = await d.boot(id);
    phase('mcp');
    await d.setupMcp(id, (pct) => set({ progress: pct }));
    let version = await d.targetVersion(id);
    if (!version || await d.googleOnDevice(id)) {
      phase('google');
      const email = await d.googleEmail();
      if (!email) { set({ state: 'needs-google' }); return; }
      phase('app');
      const prev = readBasePrep(d.db).missionId;
      const open = prev ? d.mission(prev) : null;
      const missionId = open && open.state !== 'done' && open.state !== 'abandoned' ? prev! : d.startMission(id, email);
      set({ missionId });
      const m = await waitMission(missionId);
      version = await d.targetVersion(id);
      if (!version) throw new Error(m.state === 'abandoned' ? 'a missão de instalar o app foi abandonada' : 'a missão terminou sem o app instalado');
      if (await d.googleOnDevice(id)) throw new Error('a conta Google continua no celular-base');
    }
    phase('finish');
    writeTargetVersion(d.db, version);
    await d.finish(id);
    set({ ...IDLE_PREP, state: 'done' });
  }

  return {
    /** Começa ou retoma; chamadas durante um preparo em andamento esperam o mesmo. */
    start(): Promise<void> {
      running ??= run()
        .catch((e: unknown) => set({ state: 'failed', error: errText(e) }))
        .finally(() => { running = null; });
      return running;
    },
    busy: () => running !== null,
  };
}
