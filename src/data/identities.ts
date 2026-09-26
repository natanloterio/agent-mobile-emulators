import type { ExtraIdentity, Identity, Lifecycle, ToolStep } from '../types/fleet';

// Dados de demonstração vindos do design. Na fase 2 do spec o daemon substitui isto.
export const IDENTITIES: readonly Identity[] = [
  { name: 'conta1', handle: '@aurora.moda', state: 'running', task: 'Respondendo comentários', steps: 34, budget: 60, cost: 0.41, error: '' },
  { name: 'conta2', handle: '@casa.ipe', state: 'running', task: 'Respondendo comentários', steps: 21, budget: 60, cost: 0.27, error: '' },
  { name: 'conta3', handle: '@nuvem.cafe', state: 'needs', task: 'Parada', steps: 12, budget: 60, cost: 0.19, error: 'Checkpoint: "Confirme que é você" após o 3º envio' },
  { name: 'conta4', handle: '@lume.studio', state: 'running', task: 'Respondendo comentários', steps: 47, budget: 60, cost: 0.58, error: '' },
  { name: 'conta5', handle: '@trilha.bike', state: 'idle', task: 'Concluída · 14 respostas', steps: 52, budget: 60, cost: 0.63, error: '' },
  { name: 'conta6', handle: '@pao.do.bairro', state: 'running', task: 'Escalou p/ modelo forte', steps: 29, budget: 60, cost: 0.52, error: 'Tela inesperada 3× (story aberto)' },
  { name: 'conta7', handle: '@verde.vivo', state: 'offline', task: 'Sonda falhou', steps: 0, budget: 60, cost: 0, error: 'versionName 449.0 ≠ 448.0.0.52.84 registrado' },
  { name: 'conta8', handle: '@mar.azul.surf', state: 'running', task: 'Respondendo comentários', steps: 8, budget: 60, cost: 0.09, error: '' },
  { name: 'conta9', handle: '@forno.lenha', state: 'idle', task: 'Aguardando', steps: 0, budget: 60, cost: 0, error: '' },
  { name: 'conta10', handle: '@ateliê.rosa', state: 'idle', task: 'Aguardando', steps: 0, budget: 60, cost: 0, error: '' },
];

export const LIFECYCLE_BY_NAME: Readonly<Record<string, Lifecycle>> = {
  conta1: 'running', conta2: 'running', conta3: 'dirty', conta4: 'running', conta5: 'logged-in',
  conta6: 'running', conta7: 'logged-in', conta8: 'running', conta9: 'logged-in', conta10: 'restored',
};

export const EXTRA_IDENTITIES: readonly ExtraIdentity[] = [
  { name: 'conta11', handle: '@loja.norte', lc: 'banned', app: 'Instagram', version: '448.0.0.52.84', snap: 'banida em 12/09', disk: '7,1 / 8 GB presos', diskPct: 89, ports: '—', action: 'Liberar disco' },
  { name: 'conta12', handle: 'sem conta', lc: 'provisioned', app: 'Instagram', version: '448.0.0.52.84', snap: '—', disk: '3,4 / 8 GB', diskPct: 42, ports: '5578 · 8092', action: 'Fazer login' },
];

export const DISK_PCT_BY_INDEX: readonly number[] = [48, 41, 72, 55, 38, 60, 44, 52, 30, 34];

export const RECENT_TOOLS: readonly ToolStep[] = [
  { tool: 'tap', desc: 'Toca no comentário de @jufs' },
  { tool: 'get_screen_state', desc: 'Lê a tela · 2,6k tokens' },
  { tool: 'type_text', desc: 'Digita resposta curta' },
  { tool: 'tap', desc: 'Enviar · gate irreversível ok' },
  { tool: 'scroll', desc: 'Próximo comentário' },
  { tool: 'get_screen_state', desc: 'Ledger: item já tratado, pula' },
];

export const LIFECYCLE_ORDER: readonly Lifecycle[] = [
  'blank', 'provisioned', 'logged-in', 'running', 'dirty', 'restored', 'banned',
];

export const TARGET_APP = 'Instagram';
export const TARGET_APP_VERSION = '448.0.0.52.84';
