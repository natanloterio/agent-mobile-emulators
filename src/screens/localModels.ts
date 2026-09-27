import type { I18n } from '../i18n/translate';
import type { LocalRuntime, ModelEntry, ProviderPatch, RuntimeInfo } from '../live/types';
import type { LocalCatalog } from '../state/fleetReducer';

/** Ordem dos grupos no seletor e rótulo quando o daemon não manda o runtime na lista. */
const RUNTIME_ORDER: readonly LocalRuntime[] = ['ollama', 'lmstudio'];
const RUNTIME_LABEL: Readonly<Record<LocalRuntime, string>> = { ollama: 'Ollama', lmstudio: 'LM Studio' };
/** Porta default do LM Studio: sem runtime no snapshot, o daemon despacha assim (spec runtimes locais). */
const LMSTUDIO_PORT = /:1234(\/|$)/;

export interface ModelOption { readonly value: string; readonly label: string }
export interface ModelGroup { readonly runtime: LocalRuntime; readonly label: string; readonly options: readonly ModelOption[] }
export interface LocalSelectVM {
  readonly value: string;
  /** Modelo atual que não está entre os baixados: opção "(atual)" antes dos grupos. */
  readonly orphan: ModelOption | null;
  readonly groups: readonly ModelGroup[];
}
export interface RuntimeLine { readonly kind: LocalRuntime; readonly text: string; readonly error: string | null }

export const roleRuntime = (runtime: LocalRuntime | null | undefined, endpoint: string): LocalRuntime =>
  runtime ?? (LMSTUDIO_PORT.test(endpoint) ? 'lmstudio' : 'ollama');

/** O valor da opção carrega o runtime: o mesmo id pode existir nos dois. O runtime não tem '/', o id pode ter. */
const optionValue = (runtime: LocalRuntime, id: string) => `${runtime}/${id}`;

export function parseOptionValue(value: string): { readonly runtime: LocalRuntime; readonly model: string } {
  const cut = value.indexOf('/');
  return { runtime: value.slice(0, cut) as LocalRuntime, model: value.slice(cut + 1) };
}

/** Outro runtime vai junto no PUT (o daemon troca o endpoint para o default dele); o mesmo, só o modelo. */
export function modelChoice(value: string, current: LocalRuntime): Omit<ProviderPatch, 'mode'> {
  const { runtime, model } = parseOptionValue(value);
  return runtime === current ? { model } : { runtime, model };
}

function entryLabel(e: ModelEntry, { t, fmt }: I18n): string {
  const size = e.sizeBytes === null ? [] : [`${fmt.decimal(e.sizeBytes / 1e9)} GB`];
  const loaded = e.loaded === true ? [t('providers.model.loaded')] : [];
  return [e.label || e.id, ...size, ...loaded].join(' · ');
}

const labelOf = (kind: LocalRuntime, runtimes: readonly RuntimeInfo[]) =>
  runtimes.find((r) => r.kind === kind)?.label ?? RUNTIME_LABEL[kind];

export function localSelect(catalog: LocalCatalog, runtime: LocalRuntime, model: string, i18n: I18n): LocalSelectVM {
  const value = optionValue(runtime, model);
  const groups = RUNTIME_ORDER
    .map((kind) => ({
      runtime: kind,
      label: labelOf(kind, catalog.runtimes),
      options: catalog.entries.filter((e) => e.runtime === kind).map((e) => ({ value: optionValue(kind, e.id), label: entryLabel(e, i18n) })),
    }))
    .filter((g) => g.options.length > 0);
  const listed = catalog.entries.some((e) => e.runtime === runtime && e.id === model);
  return { value, orphan: listed ? null : { value, label: i18n.t('providers.model.current', { model }) }, groups };
}

const statusKey = (r: RuntimeInfo) =>
  !r.installed ? 'providers.runtime.missing' : r.running ? 'providers.runtime.running' : 'providers.runtime.stopped';

export const runtimeLines = (runtimes: readonly RuntimeInfo[], { t }: I18n): readonly RuntimeLine[] =>
  runtimes.map((r) => ({ kind: r.kind, text: t(statusKey(r), { runtime: r.label || RUNTIME_LABEL[r.kind] }), error: r.error }));

/** Erro no card: o de PUT sempre; o de carga some quando repete o de um runtime, já mostrado na linha dele. */
export function cardError(error: string | null, putError: string | null, runtimes: readonly RuntimeInfo[] | null): string | null {
  if (putError !== null) return putError;
  return runtimes?.some((r) => r.error !== null && r.error === error) ? null : error;
}
