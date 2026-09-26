/** Idiomas em que o líder escreve justificativa e instruções (os mesmos seis da interface). Sem `lang`, português. */
export const LANGS = ['pt', 'en', 'es', 'fr', 'de', 'zh'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'pt';

interface LeaderTexts {
  /** Nome do idioma como o prompt (em português) o pede. */
  readonly promptName: string;
  readonly fanOut: string;
  readonly sharding: string;
  /** Fatia do sharding determinístico; `{k}` = posição (1..n), `{n}` = total, `{k2}`/`{k3}` = próximas posições. */
  readonly slice: string;
}

export const LEADER_TEXTS: Readonly<Record<Lang, LeaderTexts>> = {
  pt: {
    promptName: 'português',
    fanOut: 'Regra determinística: o trabalho pertence a cada conta → fan-out, uma tarefa por identidade.',
    sharding: 'Regra determinística: fila de itens compartilhada → sharding, uma fatia por identidade pronta.',
    slice: 'Sua fatia {k} de {n}: trate só os itens nas posições {k}, {k2}, {k3}… da fila (contando a partir de 1).',
  },
  en: {
    promptName: 'inglês (English)',
    fanOut: 'Deterministic rule: the work belongs to each account → fan-out, one task per identity.',
    sharding: 'Deterministic rule: shared queue of items → sharding, one slice per ready identity.',
    slice: 'Your slice {k} of {n}: handle only the items at positions {k}, {k2}, {k3}… of the queue (counting from 1).',
  },
  es: {
    promptName: 'espanhol (español)',
    fanOut: 'Regla determinista: el trabajo pertenece a cada cuenta → fan-out, una tarea por identidad.',
    sharding: 'Regla determinista: cola de ítems compartida → sharding, una porción por identidad lista.',
    slice: 'Tu porción {k} de {n}: trata solo los ítems en las posiciones {k}, {k2}, {k3}… de la cola (contando desde 1).',
  },
  fr: {
    promptName: 'francês (français)',
    fanOut: 'Règle déterministe : le travail appartient à chaque compte → fan-out, une tâche par identité.',
    sharding: 'Règle déterministe : file d’éléments partagée → sharding, une part par identité prête.',
    slice: 'Votre part {k} sur {n} : traitez uniquement les éléments aux positions {k}, {k2}, {k3}… de la file (en comptant à partir de 1).',
  },
  de: {
    promptName: 'alemão (Deutsch)',
    fanOut: 'Deterministische Regel: Die Arbeit gehört zu jedem Konto → fan-out, eine Aufgabe pro Identität.',
    sharding: 'Deterministische Regel: gemeinsame Warteschlange von Einträgen → sharding, ein Anteil pro bereiter Identität.',
    slice: 'Dein Anteil {k} von {n}: Bearbeite nur die Einträge an den Positionen {k}, {k2}, {k3}… der Warteschlange (ab 1 gezählt).',
  },
  zh: {
    promptName: 'chinês simplificado (简体中文)',
    fanOut: '确定性规则：工作归属于每个账号 → fan-out，每个身份一个任务。',
    sharding: '确定性规则：共享的条目队列 → sharding，每个就绪身份一个分片。',
    slice: '你的分片 {k}/{n}：只处理队列中第 {k}、{k2}、{k3}… 位的条目（从 1 开始计数）。',
  },
};

export function sliceInstruction(lang: Lang, k: number, n: number): string {
  const vars: Readonly<Record<string, number>> = { k: k + 1, n, k2: k + 1 + n, k3: k + 1 + 2 * n };
  return LEADER_TEXTS[lang].slice.replace(/\{(\w+)\}/g, (m, name: string) => String(vars[name] ?? m));
}
