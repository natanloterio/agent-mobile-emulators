import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config.js';
import { openDb } from '../src/db/open.js';
import { readGuideCompleted, readLocalParallel, readStepBudgets, writeGuideCompleted, writeLocalParallel, writeStepBudgets } from '../src/db/settings.js';

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

describe('paralelismo local configurável (settings.local.parallel)', () => {
  it('sem linha gravada, cai no default 1', () => {
    const db = openDb(':memory:');
    expect(readLocalParallel(db)).toBe(1);
  });
  it('grava e lê de volta (1..8)', () => {
    const db = openDb(':memory:');
    expect(writeLocalParallel(db, 4)).toBe(4);
    expect(readLocalParallel(db)).toBe(4);
  });
  it('fora de 1..8, não inteiro ou JSON inválido: cai no default 1', () => {
    const db = openDb(':memory:');
    db.prepare("insert into settings (key, value) values ('local.parallel', '9')").run();
    expect(readLocalParallel(db)).toBe(1);
    db.prepare("update settings set value='0' where key='local.parallel'").run();
    expect(readLocalParallel(db)).toBe(1);
    db.prepare("update settings set value='1.5' where key='local.parallel'").run();
    expect(readLocalParallel(db)).toBe(1);
    db.prepare("update settings set value='não é json' where key='local.parallel'").run();
    expect(readLocalParallel(db)).toBe(1);
  });
});

describe('configuração concluída no Guia (settings.guide.completed)', () => {
  it('sem linha, não concluída; gravar true e false reflete na leitura', () => {
    const db = openDb(':memory:');
    expect(readGuideCompleted(db)).toBe(false);
    expect(writeGuideCompleted(db, true)).toBe(true);
    expect(readGuideCompleted(db)).toBe(true);
    expect(writeGuideCompleted(db, false)).toBe(false);
  });
  it('linha ilegível conta como não concluída', () => {
    const db = openDb(':memory:');
    db.prepare("insert into settings (key, value) values ('guide.completed', 'não é json')").run();
    expect(readGuideCompleted(db)).toBe(false);
    db.prepare("update settings set value='1' where key='guide.completed'").run();
    expect(readGuideCompleted(db)).toBe(false);
  });
});
