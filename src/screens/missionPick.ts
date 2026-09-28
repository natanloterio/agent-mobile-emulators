import type { I18n } from '../i18n/translate';
import type { FleetSnapshot } from '../live/types';
import { isOpenMission } from '../state/missionView';

/** `replaces`: a identidade tem uma missão parada (pausada, esperando humano ou a etapa anterior); iniciar abandona essa missão. */
export interface MissionIdentityOption { readonly id: string; readonly name: string; readonly handle: string; readonly disabled: boolean; readonly note: string; readonly replaces?: boolean }

/** Nomes das identidades escolhidas cuja missão parada seria substituída (para a confirmação). */
export function replacedNames(options: readonly MissionIdentityOption[], ids: readonly string[]): readonly string[] {
  const chosen = new Set(ids);
  return options.filter((o) => o.replaces && chosen.has(o.id)).map((o) => o.name);
}

/** Marcadas que ainda podem rodar: uma opção pode ter ficado ocupada depois de marcada. */
export function pickedFree(options: readonly MissionIdentityOption[], picked: ReadonlySet<string>): readonly string[] {
  return options.filter((o) => !o.disabled && picked.has(o.id)).map((o) => o.id);
}

/** "Todas": marca todas as livres; se já estão todas marcadas, desmarca. */
export function toggleAll(options: readonly MissionIdentityOption[], picked: ReadonlySet<string>): ReadonlySet<string> {
  const free = options.filter((o) => !o.disabled).map((o) => o.id);
  const allOn = free.length > 0 && free.every((id) => picked.has(id));
  return new Set(allOn ? [] : free);
}

/** Marca ou desmarca uma identidade (conjunto novo). */
export function togglePick(picked: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(picked);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

/**
 * Opções do composer a partir do snapshot. Missão rodando bloqueia a identidade; missão parada (pausada, esperando
 * humano, esperando a etapa anterior) não: a identidade fica escolhível e iniciar abandona essa missão, com confirmação.
 */
export function missionOptions(snap: FleetSnapshot | null, { t }: Pick<I18n, 't'>): readonly MissionIdentityOption[] {
  return (snap?.identities ?? [])
    .filter((i) => !i.discardedAt && i.state !== 'banned')
    .map((i) => {
      const open = (snap?.missions ?? []).find((m) => m.identityId === i.id && isOpenMission(m));
      const running = open?.state === 'running';
      const disabled = running || !!i.controlled || !!i.paused || i.state === 'running';
      const note = running ? t('mission.state.running')
        : i.controlled ? t('device.control.release') : i.paused ? t('device.resume')
        : open ? t('mission.pick.replaces', { state: t(`mission.state.${open.state}`) })
        : i.state;
      return { id: i.id, name: i.name, handle: i.handle, disabled, note, replaces: !!open && !disabled };
    });
}
