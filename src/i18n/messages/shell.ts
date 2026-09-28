import { defineMessages } from '../define';

/** Navegação, barra lateral, topo mobile, medidores do host e seletor de idioma. */
export const shell = defineMessages({
  'nav.cockpit': 'Cockpit',
  'nav.new': 'Nova missão',
  'nav.new.short': 'Missão',
  'nav.report': 'Relatório',
  'nav.ids': 'Identidades',
  'nav.ids.short': 'Identidades',
  'nav.prov': 'Provedores',
  'nav.prov.short': 'Provedores',
  'nav.aria': 'Principal',
  'meters.title': 'Recursos do host',
  'meters.ceiling': 'Teto: {cpu} por CPU · {adb} pelo adb',
  'meters.cpuValue': '{pct} · {threads} threads',
  'meters.unifiedNote': 'Memória unificada: a GPU e os modelos locais usam esta mesma RAM',
  'language.label': 'Idioma',
}, {
  en: {
    'nav.cockpit': 'Cockpit', 'nav.new': 'New mission', 'nav.new.short': 'Mission', 'nav.report': 'Report', 'nav.ids': 'Identities',
    'nav.ids.short': 'Identities', 'nav.prov': 'Providers', 'nav.prov.short': 'Providers', 'nav.aria': 'Main',
    'meters.title': 'Host resources', 'meters.ceiling': 'Ceiling: {cpu} by CPU · {adb} by adb', 'meters.cpuValue': '{pct} · {threads} threads',
    'meters.unifiedNote': 'Unified memory: the GPU and local models share this RAM',
    'language.label': 'Language',
  },
  es: {
    'nav.cockpit': 'Cockpit', 'nav.new': 'Nueva misión', 'nav.new.short': 'Misión', 'nav.report': 'Informe', 'nav.ids': 'Identidades',
    'nav.ids.short': 'Identidades', 'nav.prov': 'Proveedores', 'nav.prov.short': 'Proveedores', 'nav.aria': 'Principal',
    'meters.title': 'Recursos del host', 'meters.ceiling': 'Límite: {cpu} por CPU · {adb} por adb', 'meters.cpuValue': '{pct} · {threads} hilos',
    'meters.unifiedNote': 'Memoria unificada: la GPU y los modelos locales usan esta misma RAM',
    'language.label': 'Idioma',
  },
  fr: {
    'nav.cockpit': 'Cockpit', 'nav.new': 'Nouvelle mission', 'nav.new.short': 'Mission', 'nav.report': 'Rapport', 'nav.ids': 'Identités',
    'nav.ids.short': 'Identités', 'nav.prov': 'Fournisseurs', 'nav.prov.short': 'Fournisseurs', 'nav.aria': 'Principale',
    'meters.title': 'Ressources de l’hôte', 'meters.ceiling': 'Plafond : {cpu} par CPU · {adb} par adb', 'meters.cpuValue': '{pct} · {threads} threads',
    'meters.unifiedNote': 'Mémoire unifiée : le GPU et les modèles locaux partagent cette RAM',
    'language.label': 'Langue',
  },
  de: {
    'nav.cockpit': 'Cockpit', 'nav.new': 'Neue Mission', 'nav.new.short': 'Mission', 'nav.report': 'Bericht', 'nav.ids': 'Identitäten',
    'nav.ids.short': 'Identitäten', 'nav.prov': 'Anbieter', 'nav.prov.short': 'Anbieter', 'nav.aria': 'Hauptnavigation',
    'meters.title': 'Host-Ressourcen', 'meters.ceiling': 'Obergrenze: {cpu} per CPU · {adb} per adb', 'meters.cpuValue': '{pct} · {threads} Threads',
    'meters.unifiedNote': 'Einheitlicher Speicher: GPU und lokale Modelle teilen sich diesen RAM',
    'language.label': 'Sprache',
  },
  zh: {
    'nav.cockpit': '驾驶舱', 'nav.new': '新任务', 'nav.new.short': '任务', 'nav.report': '报告', 'nav.ids': '身份',
    'nav.ids.short': '身份', 'nav.prov': '模型提供方', 'nav.prov.short': '提供方', 'nav.aria': '主导航',
    'meters.title': '主机资源', 'meters.ceiling': '上限：CPU {cpu} 台 · adb {adb} 台', 'meters.cpuValue': '{pct} · {threads} 线程',
    'meters.unifiedNote': '统一内存：GPU 和本地模型共用这部分内存',
    'language.label': '语言',
  },
});
