import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.js';
import { openDb } from '../src/db/open.js';
import { readStepBudgets, writeStepBudgets } from '../src/db/settings.js';

describe('limites configuráveis (settings.stepBudget.*)', () => {
  it('sem linha gravada, cai no default do CONFIG', () => {
    const db = openDb(':memory:');
    expect(readStepBudgets(db)).toEqual({ goal: CONFIG.worker.stepBudget, mission: CONFIG.mission.subtaskStepBudget });
  });
  it('grava número e null; a leitura reflete os dois', () => {
    const db = openDb(':memory:');
    expect(writeStepBudgets(db, { goal: 45, mission: null })).toEqual({ goal: 45, mission: null });
    expect(readStepBudgets(db)).toEqual({ goal: 45, mission: null });
  });
  it('patch parcial: só a chave presente muda; a ausente mantém o valor gravado antes', () => {
    const db = openDb(':memory:');
    writeStepBudgets(db, { goal: 45, mission: 90 });
    expect(writeStepBudgets(db, { goal: 100 })).toEqual({ goal: 100, mission: 90 });
    expect(writeStepBudgets(db, { mission: null })).toEqual({ goal: 100, mission: null });
  });
  it('linha ilegível (JSON inválido ou tipo errado) cai no default', () => {
    const db = openDb(':memory:');
    db.prepare("insert into settings (key, value) values ('stepBudget.goal', 'não é json')").run();
    db.prepare("insert into settings (key, value) values ('stepBudget.mission', '\"texto\"')").run();
    expect(readStepBudgets(db)).toEqual({ goal: CONFIG.worker.stepBudget, mission: CONFIG.mission.subtaskStepBudget });
  });
});
