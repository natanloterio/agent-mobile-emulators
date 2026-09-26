import { describe, expect, it } from 'vitest';
import { demoPastGoals, goalExamples, localizePastRow, PAST_GOALS } from '../data/goals';
import { createI18n, PT } from '../i18n/translate';
import { createInitialState } from './fleetReducer';
import { selectCostRows, selectReportCards, selectTiles } from './selectors';

const tiles = selectTiles(createInitialState(), 8);

describe('relatório — cards e custo', () => {
  it('português segue igual e o card sabe se refazer em outro idioma', () => {
    const pt = selectReportCards(tiles);
    expect(pt.map((c) => c.label)).toEqual(['tarefas concluídas', 'comentários respondidos', 'precisam de você', 'custo do objetivo']);
    expect(pt[3].value).toMatch(/^US\$ \d+,\d\d$/);
    expect(pt[3].localize?.usd).toBeCloseTo(tiles.reduce((a, d) => a + d.cost, 0), 8);
    expect(pt[0].localize).toEqual({ labelKey: 'report.cards.done' });
  });
  it('inglês, chinês e alemão', () => {
    const en = selectReportCards(tiles, createI18n('en'));
    expect(en.map((c) => c.label)).toEqual(['tasks completed', 'comments answered', 'need you', 'goal cost']);
    expect(en[3].value).toMatch(/^\$\d+\.\d\d$/);
    expect(selectReportCards(tiles, createI18n('zh'))[0].label).toBe('已完成任务');
    const rows = selectCostRows(tiles, createI18n('de'));
    expect(rows[0].costFmt).toMatch(/^\d+,\d\d\s\$$/);
    expect(rows[0].cost).toBe(tiles[0].cost);
    expect(selectCostRows(tiles)[0].costFmt).toMatch(/^US\$ /);
  });
});

describe('dados de objetivo — demo', () => {
  it('exemplos preenchem o objetivo completo no idioma', () => {
    expect(goalExamples()[0]).toEqual({ label: 'Responder comentários das últimas 24 h', text: 'Responder comentários das últimas 24 h em todas as contas' });
    expect(goalExamples(createI18n('en'))[2]).toEqual({ label: 'Find unanswered DMs', text: 'Find unanswered DMs on every account' });
    expect(goalExamples(createI18n('zh'))[1].text).toBe('在所有账号上给快拍回复点赞');
  });
  it('histórico demo: português como antes; linha do demo é traduzida, a do daemon passa igual', () => {
    expect(PAST_GOALS[0]).toEqual({ text: 'Responder comentários do fim de semana', pattern: 'fan-out', result: '8/8 · 142 respostas', cost: 'US$ 4,10' });
    expect(demoPastGoals(PT)).toEqual(PAST_GOALS);
    const en = createI18n('en');
    const demoRow = { ...PAST_GOALS[2], key: PAST_GOALS[2].text };
    expect(localizePastRow(demoRow, en)).toEqual({ ...demoRow, text: 'Review a queue of 300 mentions', cost: '$6.02' });
    const liveRow = { key: 'goal-1', text: 'Responder comentários', pattern: 'fan-out', result: '1/2 · 0 needs', cost: 'US$ 0,10' };
    expect(localizePastRow(liveRow, en)).toBe(liveRow);
  });
});
