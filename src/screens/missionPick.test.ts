import { describe, expect, it } from 'vitest';
import { pickedFree, toggleAll, togglePick, type MissionIdentityOption } from './missionPick';

const opt = (id: string, disabled = false): MissionIdentityOption => ({ id, name: id, handle: '@x', disabled, note: '' });
const opts = [opt('conta1'), opt('conta2', true), opt('conta3')];

describe('seleção de identidades da missão', () => {
  it('pickedFree ignora as marcadas que ficaram ocupadas, na ordem da lista', () => {
    expect(pickedFree(opts, new Set(['conta3', 'conta2', 'conta1']))).toEqual(['conta1', 'conta3']);
  });
  it('toggleAll marca só as livres; com todas marcadas, desmarca', () => {
    const all = toggleAll(opts, new Set(['conta1']));
    expect([...all].sort()).toEqual(['conta1', 'conta3']);
    expect([...toggleAll(opts, all)]).toEqual([]);
  });
  it('togglePick alterna sem mexer no conjunto original', () => {
    const before = new Set(['conta1']);
    expect([...togglePick(before, 'conta3')].sort()).toEqual(['conta1', 'conta3']);
    expect([...togglePick(before, 'conta1')]).toEqual([]);
    expect([...before]).toEqual(['conta1']);
  });
});
