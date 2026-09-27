export interface MissionIdentityOption { readonly id: string; readonly name: string; readonly handle: string; readonly disabled: boolean; readonly note: string }

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
