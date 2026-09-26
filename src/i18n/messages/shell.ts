import { defineMessages } from '../define';

/** Navegação, barra lateral, topo mobile, medidores do host e seletor de idioma. */
export const shell = defineMessages({
  'nav.cockpit': 'Cockpit',
  'nav.new': 'Novo objetivo',
  'nav.new.short': 'Novo',
  'nav.report': 'Relatório',
  'nav.ids': 'Identidades',
  'nav.ids.short': 'IDs',
  'nav.prov': 'Provedores',
  'nav.prov.short': 'Modelos',
  'nav.aria': 'Principal',
  'meters.title': 'Recursos do host',
  'meters.ceiling': 'Teto: {cpu} por CPU · {adb} pelo adb',
  'meters.cpuValue': '{pct} · {threads} threads',
  'language.label': 'Idioma',
}, {
  en: {
    'nav.cockpit': 'Cockpit', 'nav.new': 'New goal', 'nav.new.short': 'New', 'nav.report': 'Report', 'nav.ids': 'Identities',
    'nav.ids.short': 'IDs', 'nav.prov': 'Providers', 'nav.prov.short': 'Models', 'nav.aria': 'Main',
    'meters.title': 'Host resources', 'meters.ceiling': 'Ceiling: {cpu} by CPU · {adb} by adb', 'meters.cpuValue': '{pct} · {threads} threads',
    'language.label': 'Language',
  },
  es: {
    'nav.cockpit': 'Cockpit', 'nav.new': 'Nuevo objetivo', 'nav.new.short': 'Nuevo', 'nav.report': 'Informe', 'nav.ids': 'Identidades',
    'nav.ids.short': 'IDs', 'nav.prov': 'Proveedores', 'nav.prov.short': 'Modelos', 'nav.aria': 'Principal',
    'meters.title': 'Recursos del host', 'meters.ceiling': 'Límite: {cpu} por CPU · {adb} por adb', 'meters.cpuValue': '{pct} · {threads} hilos',
    'language.label': 'Idioma',
  },
  fr: {
    'nav.cockpit': 'Cockpit', 'nav.new': 'Nouvel objectif', 'nav.new.short': 'Nouveau', 'nav.report': 'Rapport', 'nav.ids': 'Identités',
    'nav.ids.short': 'IDs', 'nav.prov': 'Fournisseurs', 'nav.prov.short': 'Modèles', 'nav.aria': 'Principale',
    'meters.title': 'Ressources de l’hôte', 'meters.ceiling': 'Plafond : {cpu} par CPU · {adb} par adb', 'meters.cpuValue': '{pct} · {threads} threads',
    'language.label': 'Langue',
  },
  de: {
    'nav.cockpit': 'Cockpit', 'nav.new': 'Neues Ziel', 'nav.new.short': 'Neu', 'nav.report': 'Bericht', 'nav.ids': 'Identitäten',
    'nav.ids.short': 'IDs', 'nav.prov': 'Anbieter', 'nav.prov.short': 'Modelle', 'nav.aria': 'Hauptnavigation',
    'meters.title': 'Host-Ressourcen', 'meters.ceiling': 'Obergrenze: {cpu} per CPU · {adb} per adb', 'meters.cpuValue': '{pct} · {threads} Threads',
    'language.label': 'Sprache',
  },
  zh: {
    'nav.cockpit': '驾驶舱', 'nav.new': '新目标', 'nav.new.short': '新建', 'nav.report': '报告', 'nav.ids': '身份',
    'nav.ids.short': '身份', 'nav.prov': '模型提供方', 'nav.prov.short': '模型', 'nav.aria': '主导航',
    'meters.title': '主机资源', 'meters.ceiling': '上限：CPU {cpu} 台 · adb {adb} 台', 'meters.cpuValue': '{pct} · {threads} 线程',
    'language.label': '语言',
  },
});
