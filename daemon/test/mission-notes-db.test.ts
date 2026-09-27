import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/open.js';
import { upsertIdentity } from '../src/db/identities.js';
import { createMission } from '../src/db/missions.js';
import { addNote, listNotes, markNotesRead, unreadNotes } from '../src/db/mission-notes.js';

const row = { id: 'conta2', name: 'conta2', handle: 'sem conta', avdName: 'x', serial: 's', consolePort: 5556, mcpHostPort: 8081, mcpToken: 't', deviceSlug: 'conta2', appPackage: 'com.instagram.android', appVersionName: '1', state: 'idle' as const };
const fresh = () => { const db = openDb(':memory:'); upsertIdentity(db, row); return db; };

describe('notas do operador no banco', () => {
  it('addNote grava e devolve o id; listNotes vem mais recente primeiro', () => {
    const db = fresh(); const m = createMission(db, 'conta2', 'missão', 'pt');
    const id1 = addNote(db, m, 'primeira instrução');
    const id2 = addNote(db, m, 'segunda instrução');
    expect(id2).toBeGreaterThan(id1);
    const notes = listNotes(db, m);
    expect(notes.map((n) => n.text)).toEqual(['segunda instrução', 'primeira instrução']);
    expect(notes[0]).toMatchObject({ id: id2, readAt: null, readSeq: null });
  });
  it('unreadNotes vem na ordem de criação; marca lida some da lista', () => {
    const db = fresh(); const m = createMission(db, 'conta2', 'missão', 'pt');
    const id1 = addNote(db, m, 'a'); const id2 = addNote(db, m, 'b');
    expect(unreadNotes(db, m).map((n) => n.id)).toEqual([id1, id2]);
    markNotesRead(db, [id1], 3);
    const [first, ...rest] = unreadNotes(db, m);
    expect(first.id).toBe(id2);
    expect(rest).toEqual([]);
    expect(listNotes(db, m).find((n) => n.id === id1)).toMatchObject({ readSeq: 3 });
  });
  it('markNotesRead não sobrescreve uma nota já lida (a primeira leitura vence)', () => {
    const db = fresh(); const m = createMission(db, 'conta2', 'missão', 'pt');
    const id = addNote(db, m, 'x');
    markNotesRead(db, [id], 1);
    markNotesRead(db, [id], 5);
    expect(listNotes(db, m).find((n) => n.id === id)).toMatchObject({ readSeq: 1 });
  });
  it('markNotesRead com lista vazia não erra', () => {
    const db = fresh();
    expect(() => markNotesRead(db, [], 1)).not.toThrow();
  });
  it('notas são isoladas por missão', () => {
    const db = fresh();
    const a = createMission(db, 'conta2', 'missão a', 'pt');
    const b = createMission(db, 'conta2', 'missão b', 'pt');
    addNote(db, a, 'só de a');
    expect(listNotes(db, b)).toEqual([]);
    expect(listNotes(db, a)).toHaveLength(1);
  });
});
